using System.Text.Json;
using HarryMack.Api.Data;
using HarryMack.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;

namespace HarryMack.Api.Controllers;

[ApiController]
[Route("api/videos")]
public class VideosController : ControllerBase
{
    private readonly Db _db;

    public VideosController(Db db) => _db = db;

    // GET /api/videos — one summary row per ingested video for the Songs list.
    [HttpGet]
    public async Task<ActionResult<List<VideoSummaryDto>>> GetVideos()
    {
        var result = new List<VideoSummaryDto>();
        await using var conn = _db.Open();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
            SELECT v.id, v.title, v.artist,
                   (SELECT COUNT(*) FROM bars b WHERE b.video_id = v.id) AS bar_count,
                   (SELECT COUNT(*) FROM transcript_words tw WHERE tw.video_id = v.id) AS word_count,
                   ra.density, v.youtube_id
            FROM videos v
            LEFT JOIN rhyme_annotations ra ON ra.video_id = v.id
            ORDER BY v.processed_at DESC, v.title";

        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            result.Add(new VideoSummaryDto(
                reader.GetString(0),
                reader.IsDBNull(1) ? null : reader.GetString(1),
                reader.IsDBNull(2) ? null : reader.GetString(2),
                reader.GetInt32(3),
                reader.GetInt32(4),
                reader.IsDBNull(5) ? null : reader.GetDouble(5),
                reader.IsDBNull(6) ? null : reader.GetString(6)));
        }
        return Ok(result);
    }

    // GET /api/videos/{id}/analysis — full annotated-transcript payload.
    [HttpGet("{id}/analysis")]
    public async Task<ActionResult<VideoAnalysisDto>> GetAnalysis(string id)
    {
        await using var conn = _db.Open();

        // Video summary (also confirms existence).
        VideoSummaryDto? summary = null;
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = @"
                SELECT v.id, v.title, v.artist,
                       (SELECT COUNT(*) FROM bars b WHERE b.video_id = v.id) AS bar_count,
                       (SELECT COUNT(*) FROM transcript_words tw WHERE tw.video_id = v.id) AS word_count,
                       ra.density, v.youtube_id
                FROM videos v
                LEFT JOIN rhyme_annotations ra ON ra.video_id = v.id
                WHERE v.id = $id";
            cmd.Parameters.AddWithValue("$id", id);
            await using var r = await cmd.ExecuteReaderAsync();
            if (await r.ReadAsync())
                summary = new VideoSummaryDto(
                    r.GetString(0),
                    r.IsDBNull(1) ? null : r.GetString(1),
                    r.IsDBNull(2) ? null : r.GetString(2),
                    r.GetInt32(3),
                    r.GetInt32(4),
                    r.IsDBNull(5) ? null : r.GetDouble(5),
                    r.IsDBNull(6) ? null : r.GetString(6));
        }

        if (summary is null)
            return NotFound($"No video with id {id}.");

        // Full transcript words.
        var words = new List<TranscriptWordDto>();
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = @"
                SELECT word_index, text, start_seconds, end_seconds, score, ipa, vowel_seq, delivered_ipa
                FROM transcript_words
                WHERE video_id = $id
                ORDER BY word_index";
            cmd.Parameters.AddWithValue("$id", id);
            await using var r = await cmd.ExecuteReaderAsync();
            while (await r.ReadAsync())
            {
                words.Add(new TranscriptWordDto(
                    r.GetInt32(0),
                    r.GetString(1),
                    r.GetDouble(2),
                    r.GetDouble(3),
                    r.IsDBNull(4) ? null : r.GetDouble(4),
                    r.IsDBNull(5) ? null : r.GetString(5),
                    r.IsDBNull(6) ? null : JsonSerializer.Deserialize<List<string>>(r.GetString(6)),
                    r.IsDBNull(7) ? null : r.GetString(7)));
            }
        }

        // Rhyme events.
        var events = new List<AnalysisEventDto>();
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = @"
                SELECT word_index, bar_index, intra_bar_index,
                       canonical_key, delivered_key, detector, group_index, stress
                FROM rhyme_events
                WHERE video_id = $id
                ORDER BY word_index";
            cmd.Parameters.AddWithValue("$id", id);
            await using var r = await cmd.ExecuteReaderAsync();
            while (await r.ReadAsync())
            {
                events.Add(new AnalysisEventDto(
                    r.GetInt32(0),
                    r.GetInt32(1),
                    r.GetInt32(2),
                    r.IsDBNull(3) ? null : r.GetString(3),
                    r.IsDBNull(4) ? null : r.GetString(4),
                    r.IsDBNull(5) ? null : r.GetString(5),
                    r.IsDBNull(6) ? null : r.GetInt32(6),
                    r.IsDBNull(7) ? 0 : r.GetInt32(7)));
            }
        }

        // Rhyme groups.
        var groups = new List<AnalysisGroupDto>();
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = @"
                SELECT group_index, hue, size, key
                FROM rhyme_groups
                WHERE video_id = $id
                ORDER BY group_index";
            cmd.Parameters.AddWithValue("$id", id);
            await using var r = await cmd.ExecuteReaderAsync();
            while (await r.ReadAsync())
            {
                groups.Add(new AnalysisGroupDto(
                    r.GetInt32(0),
                    r.IsDBNull(1) ? 0 : r.GetInt32(1),
                    r.IsDBNull(2) ? 0 : r.GetInt32(2),
                    r.IsDBNull(3) ? null : r.GetString(3)));
            }
        }

        // Scheme + density from the annotation row.
        var scheme = new Dictionary<int, string>();
        double density = 0;
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = "SELECT scheme_json, density FROM rhyme_annotations WHERE video_id = $id";
            cmd.Parameters.AddWithValue("$id", id);
            await using var r = await cmd.ExecuteReaderAsync();
            if (await r.ReadAsync())
            {
                if (!r.IsDBNull(0))
                    scheme = JsonSerializer.Deserialize<Dictionary<int, string>>(r.GetString(0))
                             ?? new Dictionary<int, string>();
                density = r.IsDBNull(1) ? 0 : r.GetDouble(1);
            }
        }

        return Ok(new VideoAnalysisDto(summary, words, events, groups, scheme, density));
    }

    // GET /api/videos/{id}/annotation — the user's saved bar/rhyme annotation (204 if none).
    [HttpGet("{id}/annotation")]
    public async Task<ActionResult<UserAnnotationDto>> GetAnnotation(string id)
    {
        await using var conn = _db.Open();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT bars_json, groups_json, paras_json, types_json FROM user_annotations WHERE video_id = $id";
        cmd.Parameters.AddWithValue("$id", id);
        await using var r = await cmd.ExecuteReaderAsync();
        if (!await r.ReadAsync()) return NoContent();
        var bars = r.IsDBNull(0) ? new List<List<int>>()
            : JsonSerializer.Deserialize<List<List<int>>>(r.GetString(0)) ?? new();
        var groups = r.IsDBNull(1) ? new Dictionary<string, List<int>>()
            : JsonSerializer.Deserialize<Dictionary<string, List<int>>>(r.GetString(1)) ?? new();
        var paras = r.IsDBNull(2) ? new List<int>()
            : JsonSerializer.Deserialize<List<int>>(r.GetString(2)) ?? new();
        var types = r.IsDBNull(3) ? new Dictionary<string, string>()
            : JsonSerializer.Deserialize<Dictionary<string, string>>(r.GetString(3)) ?? new();
        return Ok(new UserAnnotationDto(bars, groups, paras, types));
    }

    // PUT /api/videos/{id}/annotation — upsert the user's annotation.
    [HttpPut("{id}/annotation")]
    public async Task<ActionResult> PutAnnotation(string id, [FromBody] UserAnnotationDto body)
    {
        await using var conn = _db.Open();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
            INSERT INTO user_annotations (video_id, bars_json, groups_json, paras_json, types_json, updated_at)
            VALUES ($id, $bars, $groups, $paras, $types, datetime('now'))
            ON CONFLICT(video_id) DO UPDATE
              SET bars_json = $bars, groups_json = $groups, paras_json = $paras,
                  types_json = $types, updated_at = datetime('now')";
        cmd.Parameters.AddWithValue("$id", id);
        cmd.Parameters.AddWithValue("$bars", JsonSerializer.Serialize(body.Bars));
        cmd.Parameters.AddWithValue("$groups", JsonSerializer.Serialize(body.Groups));
        cmd.Parameters.AddWithValue("$paras", JsonSerializer.Serialize(body.Paras ?? new List<int>()));
        cmd.Parameters.AddWithValue("$types", JsonSerializer.Serialize(body.Types ?? new Dictionary<string, string>()));
        await cmd.ExecuteNonQueryAsync();

        // Feed the user's confirmed rhyme groups straight into the rhyme dictionary
        // (ground-truth labels → the database that powers the Rhyme Game).
        await FeedDictionaryAsync(conn, id, body.Groups);
        return NoContent();
    }

    // GET /api/videos/{id}/ai-draft — a Claude-Code-authored suggestion draft
    // (same shape as UserAnnotationDto). 204 when no draft has been pushed.
    // The draft is separate from the user's saved annotation — a suggestion source
    // the editor can load, never ground truth.
    [HttpGet("{id}/ai-draft")]
    public async Task<ActionResult<UserAnnotationDto>> GetAiDraft(string id)
    {
        await using var conn = _db.Open();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT ai_draft_json FROM user_annotations WHERE video_id = $id";
        cmd.Parameters.AddWithValue("$id", id);
        var raw = await cmd.ExecuteScalarAsync();
        if (raw is not string json || json.Length == 0) return NoContent();
        var draft = JsonSerializer.Deserialize<UserAnnotationDto>(json);
        if (draft is null) return NoContent();
        return Ok(draft);
    }

    // PUT /api/videos/{id}/ai-draft — store a Claude-Code-authored draft. This only
    // writes ai_draft_json; it NEVER touches the user's saved bars/groups columns and
    // does NOT feed the rhyme dictionary. Key-free: the app never calls any LLM API.
    [HttpPut("{id}/ai-draft")]
    public async Task<ActionResult> PutAiDraft(string id, [FromBody] UserAnnotationDto body)
    {
        await using var conn = _db.Open();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
            INSERT INTO user_annotations (video_id, ai_draft_json, updated_at)
            VALUES ($id, $draft, datetime('now'))
            ON CONFLICT(video_id) DO UPDATE
              SET ai_draft_json = $draft, updated_at = datetime('now')";
        cmd.Parameters.AddWithValue("$id", id);
        cmd.Parameters.AddWithValue("$draft", JsonSerializer.Serialize(body));
        await cmd.ExecuteNonQueryAsync();
        return NoContent();
    }

    // Aggregate the user's saved rhyme groups (keyed by rhyme sound) into
    // rhyme_dictionary + rhyme_dictionary_pairs for the video's artist.
    private static async Task FeedDictionaryAsync(SqliteConnection conn, string videoId,
        Dictionary<string, List<int>> groups)
    {
        if (groups.Count == 0) return;

        string artist = "harry_mack";
        var wordText = new Dictionary<int, string>();
        await using (var vc = conn.CreateCommand())
        {
            vc.CommandText = "SELECT COALESCE(artist,'harry_mack') FROM videos WHERE id=$id";
            vc.Parameters.AddWithValue("$id", videoId);
            if (await vc.ExecuteScalarAsync() is string a && a.Length > 0) artist = a;
        }
        await using (var wc = conn.CreateCommand())
        {
            wc.CommandText = "SELECT word_index, text FROM transcript_words WHERE video_id=$id";
            wc.Parameters.AddWithValue("$id", videoId);
            await using var r = await wc.ExecuteReaderAsync();
            while (await r.ReadAsync()) wordText[r.GetInt32(0)] = r.GetString(1).Trim().ToLowerInvariant();
        }

        foreach (var (key, wis) in groups)
        {
            var words = wis.Where(wordText.ContainsKey).Select(wi => wordText[wi])
                           .Where(w => w.Length > 0).Distinct().ToList();
            if (words.Count < 2) continue; // a rhyme needs >= 2 distinct words
            var multi = key.Length >= 3 ? 1 : 0;
            foreach (var w in words)
            {
                await using var dc = conn.CreateCommand();
                dc.CommandText = @"
                    INSERT INTO rhyme_dictionary (id, key, vowel_run, artist, word, frequency, song_count, is_multisyllabic, is_internal)
                    VALUES ($id, $key, $vr, $artist, $word, 1, 1, $multi, 0)
                    ON CONFLICT(artist, word, key) DO UPDATE SET
                      frequency = frequency + 1, is_multisyllabic = MAX(is_multisyllabic, $multi)";
                dc.Parameters.AddWithValue("$id", Guid.NewGuid().ToString("N"));
                dc.Parameters.AddWithValue("$key", key);
                dc.Parameters.AddWithValue("$vr", multi);
                dc.Parameters.AddWithValue("$artist", artist);
                dc.Parameters.AddWithValue("$word", w);
                dc.Parameters.AddWithValue("$multi", multi);
                await dc.ExecuteNonQueryAsync();
            }
            for (int a = 0; a < words.Count; a++)
                for (int b = a + 1; b < words.Count; b++)
                {
                    var (wa, wb) = string.CompareOrdinal(words[a], words[b]) <= 0 ? (words[a], words[b]) : (words[b], words[a]);
                    await using var pc = conn.CreateCommand();
                    pc.CommandText = @"
                        INSERT INTO rhyme_dictionary_pairs (word_a, word_b, key, artist, frequency)
                        VALUES ($a, $b, $key, $artist, 1)
                        ON CONFLICT(word_a, word_b, artist) DO UPDATE SET frequency = frequency + 1, key = $key";
                    pc.Parameters.AddWithValue("$a", wa);
                    pc.Parameters.AddWithValue("$b", wb);
                    pc.Parameters.AddWithValue("$key", key);
                    pc.Parameters.AddWithValue("$artist", artist);
                    await pc.ExecuteNonQueryAsync();
                }
        }
    }
}
