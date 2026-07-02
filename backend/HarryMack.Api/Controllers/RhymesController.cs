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
}
