using HarryMack.Api.Data;
using HarryMack.Api.Models;
using Microsoft.AspNetCore.Mvc;

namespace HarryMack.Api.Controllers;

[ApiController]
[Route("api/rhymes")]
public class RhymesController : ControllerBase
{
    private readonly Db _db;

    public RhymesController(Db db) => _db = db;

    private static RhymeWordDto ReadWord(Microsoft.Data.Sqlite.SqliteDataReader reader) =>
        new(
            reader.GetString(0),
            reader.GetString(1),
            reader.IsDBNull(2) ? null : reader.GetString(2),
            reader.GetInt32(3)
        );

    [HttpGet]
    public async Task<ActionResult<List<RhymeWordDto>>> GetAll()
    {
        var result = new List<RhymeWordDto>();
        await using var conn = _db.Open();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
            SELECT id, word, phonemes, frequency
            FROM rhyme_words
            ORDER BY frequency DESC, word";

        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
            result.Add(ReadWord(reader));
        return Ok(result);
    }

    [HttpGet("map")]
    public async Task<ActionResult<RhymeMapDto>> GetMap()
    {
        var nodes = new List<RhymeWordDto>();
        var edges = new List<RhymePairDto>();

        await using var conn = _db.Open();

        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = "SELECT id, word, phonemes, frequency FROM rhyme_words ORDER BY word";
            await using var reader = await cmd.ExecuteReaderAsync();
            while (await reader.ReadAsync())
                nodes.Add(ReadWord(reader));
        }

        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = @"
                SELECT rwa.word, rwb.word, rp.frequency
                FROM rhyme_pairs rp
                JOIN rhyme_words rwa ON rwa.id = rp.word_a_id
                JOIN rhyme_words rwb ON rwb.id = rp.word_b_id";
            await using var reader = await cmd.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                edges.Add(new RhymePairDto(
                    reader.GetString(0),
                    reader.GetString(1),
                    reader.GetInt32(2)
                ));
            }
        }

        return Ok(new RhymeMapDto(nodes, edges));
    }

    [HttpGet("{word}/sources")]
    public async Task<ActionResult<List<BarSourceDto>>> GetSources(string word)
    {
        await using var conn = _db.Open();

        string wordId;
        {
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT id FROM rhyme_words WHERE word = lower($p1)";
            cmd.Parameters.AddWithValue("$p1", word);
            var val = await cmd.ExecuteScalarAsync();
            if (val == null) return NotFound($"Word '{word}' not found.");
            wordId = (string)val;
        }

        var result = new List<BarSourceDto>();
        {
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = @"
                SELECT v.title, v.url, v.youtube_id, b.timestamp_seconds, b.text
                FROM rhyme_word_bars rwb
                JOIN bars b ON b.id = rwb.bar_id
                JOIN videos v ON v.id = b.video_id
                WHERE rwb.word_id = $p1
                ORDER BY v.title, b.timestamp_seconds NULLS LAST";
            cmd.Parameters.AddWithValue("$p1", wordId);

            await using var reader = await cmd.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                result.Add(new BarSourceDto(
                    reader.IsDBNull(0) ? null : reader.GetString(0),
                    reader.IsDBNull(1) ? null : reader.GetString(1),
                    reader.IsDBNull(2) ? null : reader.GetString(2),
                    reader.IsDBNull(3) ? null : reader.GetFloat(3),
                    reader.GetString(4)
                ));
            }
        }

        return Ok(result);
    }

    [HttpGet("{word}")]
    public async Task<ActionResult<RhymeDetailDto>> GetByWord(string word)
    {
        await using var conn = _db.Open();

        RhymeWordDto baseWord;
        string wordId;
        {
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT id, word, phonemes, frequency FROM rhyme_words WHERE word = lower($p1)";
            cmd.Parameters.AddWithValue("$p1", word);
            await using var reader = await cmd.ExecuteReaderAsync();
            if (!await reader.ReadAsync())
                return NotFound($"Word '{word}' not found.");

            baseWord = ReadWord(reader);
            wordId = baseWord.Id;
        }

        var rhymes = new List<RhymeWordDto>();
        {
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = @"
                SELECT rw.id, rw.word, rw.phonemes, rw.frequency
                FROM rhyme_pairs rp
                JOIN rhyme_words rw ON rw.id = CASE
                    WHEN rp.word_a_id = $p1 THEN rp.word_b_id
                    ELSE rp.word_a_id
                END
                WHERE rp.word_a_id = $p1 OR rp.word_b_id = $p1
                ORDER BY rw.frequency DESC, rw.word";
            cmd.Parameters.AddWithValue("$p1", wordId);
            await using var reader = await cmd.ExecuteReaderAsync();
            while (await reader.ReadAsync())
                rhymes.Add(ReadWord(reader));
        }

        return Ok(new RhymeDetailDto(baseWord, rhymes));
    }

    // GET /api/videos/{id}/rhyme-dictionary — per-song rhyme groups + member words.
    [HttpGet("~/api/videos/{id}/rhyme-dictionary")]
    public async Task<ActionResult<SongDictionaryDto>> GetSongDictionary(string id)
    {
        await using var conn = _db.Open();

        // Confirm the video exists.
        await using (var check = conn.CreateCommand())
        {
            check.CommandText = "SELECT 1 FROM videos WHERE id = $id";
            check.Parameters.AddWithValue("$id", id);
            if (await check.ExecuteScalarAsync() is null)
                return NotFound($"No video with id {id}.");
        }

        // Groups for this video.
        var groupMeta = new List<(int gi, int hue, string? key)>();
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = @"
                SELECT group_index, hue, key
                FROM rhyme_groups
                WHERE video_id = $id
                ORDER BY group_index";
            cmd.Parameters.AddWithValue("$id", id);
            await using var r = await cmd.ExecuteReaderAsync();
            while (await r.ReadAsync())
                groupMeta.Add((
                    r.GetInt32(0),
                    r.IsDBNull(1) ? 0 : r.GetInt32(1),
                    r.IsDBNull(2) ? null : r.GetString(2)));
        }

        // Member words per group (rhyme events joined to the full transcript).
        var wordsByGroup = new Dictionary<int, List<string>>();
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = @"
                SELECT e.group_index, tw.text
                FROM rhyme_events e
                JOIN transcript_words tw
                  ON tw.video_id = e.video_id AND tw.word_index = e.word_index
                WHERE e.video_id = $id AND e.group_index IS NOT NULL
                ORDER BY e.group_index, e.word_index";
            cmd.Parameters.AddWithValue("$id", id);
            await using var r = await cmd.ExecuteReaderAsync();
            while (await r.ReadAsync())
            {
                var gi = r.GetInt32(0);
                var text = r.GetString(1);
                if (!wordsByGroup.TryGetValue(gi, out var list))
                    wordsByGroup[gi] = list = new List<string>();
                if (!list.Contains(text))
                    list.Add(text);
            }
        }

        var groups = groupMeta
            .Select(g => new SongDictionaryGroupDto(
                g.gi, g.hue, g.key,
                wordsByGroup.TryGetValue(g.gi, out var w) ? w : new List<string>()))
            .ToList();

        return Ok(new SongDictionaryDto(id, groups));
    }

    // GET /api/rhymes/dictionary?scope=global|artist&artist=… — aggregate entries.
    [HttpGet("dictionary")]
    public async Task<ActionResult<List<DictionaryEntryDto>>> GetDictionary(
        [FromQuery] string scope = "artist", [FromQuery] string? artist = null)
    {
        var result = new List<DictionaryEntryDto>();
        await using var conn = _db.Open();
        await using var cmd = conn.CreateCommand();

        if (string.Equals(scope, "global", StringComparison.OrdinalIgnoreCase))
        {
            // Roll every artist's entries up per (word, key).
            cmd.CommandText = @"
                SELECT word, key, MAX(vowel_run), SUM(frequency), SUM(song_count),
                       MAX(is_multisyllabic), MAX(is_internal)
                FROM rhyme_dictionary
                GROUP BY word, key
                ORDER BY SUM(frequency) DESC, word";
            await using var r = await cmd.ExecuteReaderAsync();
            while (await r.ReadAsync())
                result.Add(new DictionaryEntryDto(
                    r.GetString(0),
                    r.IsDBNull(1) ? null : r.GetString(1),
                    r.IsDBNull(2) ? 0 : r.GetInt32(2),
                    r.GetInt32(3),
                    r.GetInt32(4),
                    !r.IsDBNull(5) && r.GetInt32(5) != 0,
                    !r.IsDBNull(6) && r.GetInt32(6) != 0,
                    null));
        }
        else
        {
            // Per-artist rows; optional artist filter.
            cmd.CommandText = @"
                SELECT word, key, vowel_run, frequency, song_count,
                       is_multisyllabic, is_internal, artist
                FROM rhyme_dictionary
                WHERE ($artist IS NULL OR artist = $artist)
                ORDER BY frequency DESC, word";
            cmd.Parameters.AddWithValue("$artist", (object?)artist ?? DBNull.Value);
            await using var r = await cmd.ExecuteReaderAsync();
            while (await r.ReadAsync())
                result.Add(new DictionaryEntryDto(
                    r.GetString(0),
                    r.IsDBNull(1) ? null : r.GetString(1),
                    r.IsDBNull(2) ? 0 : r.GetInt32(2),
                    r.GetInt32(3),
                    r.GetInt32(4),
                    !r.IsDBNull(5) && r.GetInt32(5) != 0,
                    !r.IsDBNull(6) && r.GetInt32(6) != 0,
                    r.IsDBNull(7) ? null : r.GetString(7)));
        }

        return Ok(result);
    }

    // GET /api/rhymes/dictionary/{word}?artist=… — everything that rhymes with word.
    [HttpGet("dictionary/{word}")]
    public async Task<ActionResult<WordRhymesDto>> GetWordRhymes(
        string word, [FromQuery] string? artist = null)
    {
        var target = word.Trim().ToLowerInvariant();
        var rhymes = new List<RhymePartnerDto>();

        await using var conn = _db.Open();
        await using var cmd = conn.CreateCommand();
        // Pairs are stored normalized (word_a < word_b); look on both sides and
        // aggregate frequency across artists (or a single artist when filtered).
        cmd.CommandText = @"
            SELECT partner, key, SUM(frequency) AS freq FROM (
                SELECT word_b AS partner, key, frequency, artist
                FROM rhyme_dictionary_pairs WHERE word_a = $w
                UNION ALL
                SELECT word_a AS partner, key, frequency, artist
                FROM rhyme_dictionary_pairs WHERE word_b = $w
            )
            WHERE ($artist IS NULL OR artist = $artist)
            GROUP BY partner, key
            ORDER BY freq DESC, partner";
        cmd.Parameters.AddWithValue("$w", target);
        cmd.Parameters.AddWithValue("$artist", (object?)artist ?? DBNull.Value);

        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
            rhymes.Add(new RhymePartnerDto(
                reader.GetString(0),
                reader.IsDBNull(1) ? null : reader.GetString(1),
                reader.GetInt32(2)));

        return Ok(new WordRhymesDto(target, artist, rhymes));
    }
}
