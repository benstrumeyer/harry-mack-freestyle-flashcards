using System.Diagnostics;
using System.Text.RegularExpressions;
using HarryMack.Api.Models;
using Npgsql;
using NpgsqlTypes;

namespace HarryMack.Api.Services;

public class PipelineService
{
    private readonly NpgsqlDataSource _db;
    private readonly TranscriptParser _parser;
    private readonly LlmExtractor _extractor;
    private readonly PhoneticService _phonetic;
    private readonly ILogger<PipelineService> _logger;
    private const string TranscriptsDir = "/app/transcripts";

    public PipelineService(NpgsqlDataSource db, TranscriptParser parser, LlmExtractor extractor, PhoneticService phonetic, ILogger<PipelineService> logger)
    {
        _db = db;
        _parser = parser;
        _extractor = extractor;
        _phonetic = phonetic;
        _logger = logger;
    }

    public async Task<PipelineResultDto> ProcessLocalAsync()
    {
        if (!Directory.Exists(TranscriptsDir))
            return new PipelineResultDto("Transcripts directory not found.", 0, 0, 0);

        var files = Directory.GetFiles(TranscriptsDir, "*.txt");
        if (files.Length == 0)
            return new PipelineResultDto("No .txt files found in transcripts/.", 0, 0, 0);

        int totalBars = 0, totalOpeners = 0, totalRhymes = 0;

        foreach (var filePath in files)
        {
            var filename = Path.GetFileName(filePath);

            if (await FileAlreadyProcessedAsync(filename))
            {
                _logger.LogInformation("Skipping already-processed file: {filename}", filename);
                continue;
            }

            _logger.LogInformation("Processing local transcript: {filename}", filename);

            var rawLines = _parser.ParseLocalTxt(filePath);
            if (rawLines.Count == 0)
            {
                _logger.LogWarning("No lines extracted from {filename}", filename);
                continue;
            }

            var extracted = await _extractor.ExtractAsync(rawLines);
            var bars = extracted.Where(e => e.IsFreestyle).ToList();

            var (openers, rhymes) = await UpsertResultsAsync(
                title: filename, source: "local", filename: filename,
                youtubeId: null, url: null, rawLines: rawLines, extractedBars: bars);

            totalBars += bars.Count;
            totalOpeners += openers;
            totalRhymes += rhymes;
        }

        return new PipelineResultDto($"Processed {files.Length} file(s).", totalBars, totalOpeners, totalRhymes);
    }

    public async Task<PipelineResultDto> ProcessUrlAsync(string url)
    {
        url = NormalizeYoutubeUrl(url);
        var youtubeId = ExtractYoutubeId(url);
        if (youtubeId == null)
            throw new ArgumentException("Could not extract YouTube ID from URL.");

        if (await YoutubeAlreadyProcessedAsync(youtubeId))
            return new PipelineResultDto($"Already processed: {youtubeId}.", 0, 0, 0);

        _logger.LogInformation("Running yt-dlp for {youtubeId}", youtubeId);

        var vttPath = await DownloadSubtitlesAsync(url, youtubeId);
        if (vttPath == null)
            throw new InvalidOperationException("yt-dlp did not produce a subtitle file.");

        var rawLines = _parser.ParseVtt(vttPath);
        try { File.Delete(vttPath); } catch { /* best effort */ }

        if (rawLines.Count == 0)
            return new PipelineResultDto("No lines extracted from VTT.", 0, 0, 0);

        var extracted = await _extractor.ExtractAsync(rawLines);
        var bars = extracted.Where(e => e.IsFreestyle).ToList();

        var title = await FetchVideoTitleAsync(url);

        var (openers, rhymes) = await UpsertResultsAsync(
            title: title ?? youtubeId, source: "youtube", filename: null,
            youtubeId: youtubeId, url: url, rawLines: rawLines, extractedBars: bars);

        return new PipelineResultDto($"Processed YouTube video {youtubeId}.", bars.Count, openers, rhymes);
    }

    public async Task<List<string>> GetPlaylistVideoUrlsAsync(string playlistUrl)
    {
        playlistUrl = NormalizeYoutubeUrl(playlistUrl);

        // watch_videos URLs embed video IDs directly — parse them instead of using yt-dlp
        var watchVideosMatch = Regex.Match(playlistUrl, @"[?&]video_ids=([^&]+)");
        if (watchVideosMatch.Success)
        {
            var ids = Uri.UnescapeDataString(watchVideosMatch.Groups[1].Value)
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            return ids.Select(id => $"https://www.youtube.com/watch?v={id}").ToList();
        }

        var psi = new ProcessStartInfo
        {
            FileName = "yt-dlp",
            Arguments = $"--flat-playlist --print \"%(url)s\" \"{playlistUrl}\"",
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false
        };

        using var proc = Process.Start(psi) ?? throw new InvalidOperationException("Failed to start yt-dlp.");
        var output = await proc.StandardOutput.ReadToEndAsync();
        var stderrTask = proc.StandardError.ReadToEndAsync();
        await proc.WaitForExitAsync();
        await stderrTask;

        return output.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToList();
    }

    public async Task ProcessPlaylistVideosAsync(List<string> videoUrls)
    {
        _logger.LogInformation("Background playlist: processing {count} videos (2 concurrent)", videoUrls.Count);

        using var sem = new SemaphoreSlim(2);

        var tasks = videoUrls.Select(async url =>
        {
            await sem.WaitAsync();
            try { await ProcessUrlWithRetryAsync(url); }
            finally { sem.Release(); }
        });

        await Task.WhenAll(tasks);
        _logger.LogInformation("Background playlist complete.");
    }

    private async Task ProcessUrlWithRetryAsync(string url, int maxAttempts = 3)
    {
        int delayMs = 10_000;
        for (int attempt = 1; attempt <= maxAttempts; attempt++)
        {
            try
            {
                await ProcessUrlAsync(url);
                return;
            }
            catch (InvalidOperationException ex) when (ex.Message.Contains("subtitle file"))
            {
                // Video has no captions — retrying won't help
                _logger.LogWarning("Skipping {url}: no subtitles available", url);
                return;
            }
            catch (Exception ex) when (ex.Message.Contains("429"))
            {
                // LlmExtractor already retried 5 times with backoff — don't retry the whole video
                _logger.LogError("Giving up on {url}: Gemini rate limit exhausted after LLM retries", url);
                return;
            }
            catch (Exception ex)
            {
                if (attempt == maxAttempts)
                {
                    _logger.LogError("Giving up on {url} after {maxAttempts} attempts: {msg}", url, maxAttempts, ex.Message);
                    return;
                }
                _logger.LogWarning("Attempt {attempt}/{maxAttempts} failed for {url}: {msg}. Retrying in {delay}s…",
                    attempt, maxAttempts, url, ex.Message, delayMs / 1000);
                await Task.Delay(delayMs);
                delayMs = Math.Min(delayMs * 2, 120_000);
            }
        }
    }

    public async Task ResetAllAsync()
    {
        await using var conn = await _db.OpenConnectionAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "TRUNCATE videos, openers, rhyme_words, sessions CASCADE";
        await cmd.ExecuteNonQueryAsync();
    }

    public async Task<(int removed, int total)> ValidateRhymePairsAsync()
    {
        // Load all pairs with word strings
        var pairs = new List<(Guid idA, Guid idB, string wordA, string wordB)>();
        var words = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        await using var conn = await _db.OpenConnectionAsync();
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = @"
                SELECT rp.word_a_id, rp.word_b_id, wa.word, wb.word
                FROM rhyme_pairs rp
                JOIN rhyme_words wa ON wa.id = rp.word_a_id
                JOIN rhyme_words wb ON wb.id = rp.word_b_id";
            await using var reader = await cmd.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                var idA = reader.GetGuid(0);
                var idB = reader.GetGuid(1);
                var wA = reader.GetString(2);
                var wB = reader.GetString(3);
                pairs.Add((idA, idB, wA, wB));
                words.Add(wA);
                words.Add(wB);
            }
        }

        _logger.LogInformation("Validating {count} rhyme pairs across {words} unique words", pairs.Count, words.Count);

        // Prefetch all phoneme tails concurrently
        await _phonetic.PrefetchAsync(words);

        // Check each pair
        int removed = 0;
        foreach (var (idA, idB, wordA, wordB) in pairs)
        {
            var rhymes = await _phonetic.RhymesAsync(wordA, wordB);
            if (!rhymes)
            {
                await using var delCmd = conn.CreateCommand();
                delCmd.CommandText = "DELETE FROM rhyme_pairs WHERE word_a_id = $1 AND word_b_id = $2";
                delCmd.Parameters.AddWithValue(idA);
                delCmd.Parameters.AddWithValue(idB);
                await delCmd.ExecuteNonQueryAsync();
                removed++;
            }
        }

        _logger.LogInformation("Rhyme validation complete: removed {removed}/{total} pairs", removed, pairs.Count);
        return (removed, pairs.Count);
    }

    public async Task<List<VideoStatusDto>> GetStatusAsync()
    {
        var result = new List<VideoStatusDto>();
        await using var conn = await _db.OpenConnectionAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
            SELECT v.id, v.title, v.source, v.filename, v.url, v.processed_at,
                   COUNT(b.id)::int as bar_count
            FROM videos v
            LEFT JOIN bars b ON b.video_id = v.id
            GROUP BY v.id
            ORDER BY v.processed_at DESC";

        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            result.Add(new VideoStatusDto(
                reader.GetGuid(0),
                reader.IsDBNull(1) ? null : reader.GetString(1),
                reader.GetString(2),
                reader.IsDBNull(3) ? null : reader.GetString(3),
                reader.IsDBNull(4) ? null : reader.GetString(4),
                reader.GetFieldValue<DateTimeOffset>(5),
                reader.GetInt32(6)
            ));
        }
        return result;
    }

    // ---- Private helpers ----

    private async Task<bool> FileAlreadyProcessedAsync(string filename)
    {
        await using var conn = await _db.OpenConnectionAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT 1 FROM videos WHERE filename = $1";
        cmd.Parameters.AddWithValue(filename);
        return await cmd.ExecuteScalarAsync() != null;
    }

    private async Task<bool> YoutubeAlreadyProcessedAsync(string youtubeId)
    {
        await using var conn = await _db.OpenConnectionAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT 1 FROM videos WHERE youtube_id = $1";
        cmd.Parameters.AddWithValue(youtubeId);
        return await cmd.ExecuteScalarAsync() != null;
    }

    private static string? ExtractYoutubeId(string url)
    {
        var patterns = new[]
        {
            new Regex(@"[?&]v=([a-zA-Z0-9_-]{11})"),
            new Regex(@"youtu\.be/([a-zA-Z0-9_-]{11})"),
            new Regex(@"shorts/([a-zA-Z0-9_-]{11})")
        };

        foreach (var p in patterns)
        {
            var m = p.Match(url);
            if (m.Success) return m.Groups[1].Value;
        }
        return null;
    }

    // Converts youtube.com/show/VLPLxxx?sbp=... → youtube.com/playlist?list=PLxxx
    private static string NormalizeYoutubeUrl(string url)
    {
        var m = Regex.Match(url, @"youtube\.com/show/(?:VL)?([a-zA-Z0-9_-]+)");
        if (m.Success)
            return $"https://www.youtube.com/playlist?list={m.Groups[1].Value}";
        return url;
    }

    private async Task<string?> FetchVideoTitleAsync(string url)
    {
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = "yt-dlp",
                Arguments = $"--print \"%(title)s\" --skip-download \"{url}\"",
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false
            };
            using var proc = Process.Start(psi);
            if (proc == null) return null;
            var title = (await proc.StandardOutput.ReadLineAsync())?.Trim();
            var stderrTask = proc.StandardError.ReadToEndAsync();
            await proc.WaitForExitAsync();
            await stderrTask;
            return string.IsNullOrWhiteSpace(title) ? null : title;
        }
        catch { return null; }
    }

    private async Task<string?> DownloadSubtitlesAsync(string url, string youtubeId)
    {
        var outputTemplate = $"/tmp/{youtubeId}.%(ext)s";
        var psi = new ProcessStartInfo
        {
            FileName = "yt-dlp",
            Arguments = $"--write-auto-sub --sub-lang en --skip-download --no-progress -o \"{outputTemplate}\" \"{url}\"",
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false
        };

        using var proc = Process.Start(psi) ?? throw new InvalidOperationException("Failed to start yt-dlp.");
        var stdoutTask = proc.StandardOutput.ReadToEndAsync();
        var stderrTask = proc.StandardError.ReadToEndAsync();
        await Task.WhenAll(stdoutTask, stderrTask);
        await proc.WaitForExitAsync();

        _logger.LogInformation("yt-dlp exit {code} for {id}", proc.ExitCode, youtubeId);

        var vttFiles = Directory.GetFiles("/tmp", $"{youtubeId}*.vtt");
        return vttFiles.FirstOrDefault();
    }

    private async Task<(int openers, int rhymes)> UpsertResultsAsync(
        string title, string source, string? filename, string? youtubeId, string? url,
        List<RawLine> rawLines, List<ExtractedBar> extractedBars)
    {
        await using var conn = await _db.OpenConnectionAsync();
        await using var tx = await conn.BeginTransactionAsync();

        try
        {
            Guid videoId;
            {
                await using var cmd = conn.CreateCommand();
                cmd.CommandText = @"
                    INSERT INTO videos (title, source, filename, youtube_id, url)
                    VALUES ($1, $2, $3, $4, $5)
                    RETURNING id";
                cmd.Parameters.AddWithValue(title);
                cmd.Parameters.AddWithValue(source);
                cmd.Parameters.Add(new NpgsqlParameter { Value = (object?)filename ?? DBNull.Value });
                cmd.Parameters.Add(new NpgsqlParameter { Value = (object?)youtubeId ?? DBNull.Value });
                cmd.Parameters.Add(new NpgsqlParameter { Value = (object?)url ?? DBNull.Value });
                videoId = (Guid)(await cmd.ExecuteScalarAsync())!;
            }

            var lineByIndex = rawLines.ToDictionary(l => l.Index);
            int openerCount = 0, rhymeCount = 0;

            foreach (var bar in extractedBars)
            {
                lineByIndex.TryGetValue(bar.Index, out var rawLine);
                var barText = !string.IsNullOrWhiteSpace(bar.BarText) ? bar.BarText : rawLine?.Text ?? "";
                float? ts = rawLine?.TimestampSeconds;

                Guid barId;
                {
                    await using var cmd = conn.CreateCommand();
                    cmd.CommandText = @"
                        INSERT INTO bars (video_id, text, timestamp_seconds, bar_index)
                        VALUES ($1, $2, $3, $4)
                        RETURNING id";
                    cmd.Parameters.AddWithValue(videoId);
                    cmd.Parameters.AddWithValue(barText);
                    cmd.Parameters.Add(new NpgsqlParameter { Value = (object?)ts ?? DBNull.Value });
                    cmd.Parameters.AddWithValue(bar.Index);
                    barId = (Guid)(await cmd.ExecuteScalarAsync())!;
                }

                if (!string.IsNullOrWhiteSpace(bar.Opener)
                    && barText.StartsWith(bar.Opener, StringComparison.OrdinalIgnoreCase))
                {
                    var openerText = bar.Opener.Trim().ToLowerInvariant();
                    Guid openerId;
                    {
                        await using var cmd = conn.CreateCommand();
                        cmd.CommandText = @"
                            INSERT INTO openers (text, frequency, example_completions)
                            VALUES ($1, 1, ARRAY[$2::text])
                            ON CONFLICT (text) DO UPDATE
                              SET frequency = openers.frequency + 1,
                                  example_completions = array_append(openers.example_completions, $2::text)
                            RETURNING id";
                        cmd.Parameters.AddWithValue(openerText);
                        cmd.Parameters.AddWithValue(barText);
                        openerId = (Guid)(await cmd.ExecuteScalarAsync())!;
                        openerCount++;
                    }

                    await using var linkCmd = conn.CreateCommand();
                    linkCmd.CommandText = @"
                        INSERT INTO opener_sources (opener_id, bar_id)
                        VALUES ($1, $2)
                        ON CONFLICT DO NOTHING";
                    linkCmd.Parameters.AddWithValue(openerId);
                    linkCmd.Parameters.AddWithValue(barId);
                    await linkCmd.ExecuteNonQueryAsync();
                }

                if (bar.RhymeWords != null && bar.RhymeWords.Count > 0)
                {
                    var wordPairs = new List<(Guid id, string word)>();
                    var seenWords = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                    foreach (var rawWord in bar.RhymeWords)
                    {
                        var word = rawWord.Trim().ToLowerInvariant();
                        if (string.IsNullOrWhiteSpace(word)) continue;
                        if (!seenWords.Add(word)) continue; // skip duplicates within the same bar

                        Guid wordId;
                        {
                            await using var cmd = conn.CreateCommand();
                            cmd.CommandText = @"
                                INSERT INTO rhyme_words (word, frequency)
                                VALUES ($1, 1)
                                ON CONFLICT (word) DO UPDATE
                                  SET frequency = rhyme_words.frequency + 1
                                RETURNING id";
                            cmd.Parameters.AddWithValue(word);
                            wordId = (Guid)(await cmd.ExecuteScalarAsync())!;
                            rhymeCount++;
                            wordPairs.Add((wordId, word));
                        }

                        await using var rwbCmd = conn.CreateCommand();
                        rwbCmd.CommandText = @"
                            INSERT INTO rhyme_word_bars (word_id, bar_id)
                            VALUES ($1, $2)
                            ON CONFLICT DO NOTHING";
                        rwbCmd.Parameters.AddWithValue(wordId);
                        rwbCmd.Parameters.AddWithValue(barId);
                        await rwbCmd.ExecuteNonQueryAsync();
                    }

                    for (int i = 0; i < wordPairs.Count; i++)
                    {
                        for (int j = i + 1; j < wordPairs.Count; j++)
                        {
                            var (idA, wordA) = wordPairs[i];
                            var (idB, wordB) = wordPairs[j];
                            if (idA == idB) continue; // same word, skip self-pair
                            if (string.Compare(wordA, wordB, StringComparison.Ordinal) > 0)
                                (idA, idB) = (idB, idA);

                            await using var pairCmd = conn.CreateCommand();
                            pairCmd.CommandText = @"
                                INSERT INTO rhyme_pairs (word_a_id, word_b_id, frequency)
                                VALUES ($1, $2, 1)
                                ON CONFLICT (word_a_id, word_b_id) DO UPDATE
                                  SET frequency = rhyme_pairs.frequency + 1";
                            pairCmd.Parameters.AddWithValue(idA);
                            pairCmd.Parameters.AddWithValue(idB);
                            await pairCmd.ExecuteNonQueryAsync();
                        }
                    }
                }
            }

            await tx.CommitAsync();
            return (openerCount, rhymeCount);
        }
        catch
        {
            await tx.RollbackAsync();
            throw;
        }
    }
}
