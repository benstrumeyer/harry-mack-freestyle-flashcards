using HarryMack.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Npgsql;

namespace HarryMack.Api.Controllers;

[ApiController]
[Route("api/rhymes")]
public class RhymesController : ControllerBase
{
    private readonly NpgsqlDataSource _db;

    public RhymesController(NpgsqlDataSource db) => _db = db;

    [HttpGet]
    public async Task<ActionResult<List<RhymeWordDto>>> GetAll()
    {
        var result = new List<RhymeWordDto>();
        await using var conn = await _db.OpenConnectionAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
            SELECT id, word, phonemes, frequency
            FROM rhyme_words
            ORDER BY frequency DESC, word";

        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            result.Add(new RhymeWordDto(
                reader.GetGuid(0),
                reader.GetString(1),
                reader.IsDBNull(2) ? null : reader.GetString(2),
                reader.GetInt32(3)
            ));
        }
        return Ok(result);
    }

    [HttpGet("map")]
    public async Task<ActionResult<RhymeMapDto>> GetMap()
    {
        var nodes = new List<RhymeWordDto>();
        var edges = new List<RhymePairDto>();

        await using var conn = await _db.OpenConnectionAsync();

        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = "SELECT id, word, phonemes, frequency FROM rhyme_words ORDER BY word";
            await using var reader = await cmd.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                nodes.Add(new RhymeWordDto(
                    reader.GetGuid(0),
                    reader.GetString(1),
                    reader.IsDBNull(2) ? null : reader.GetString(2),
                    reader.GetInt32(3)
                ));
            }
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
        await using var conn = await _db.OpenConnectionAsync();

        Guid wordId;
        {
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT id FROM rhyme_words WHERE word = lower($1)";
            cmd.Parameters.AddWithValue(word);
            var val = await cmd.ExecuteScalarAsync();
            if (val == null) return NotFound($"Word '{word}' not found.");
            wordId = (Guid)val;
        }

        var result = new List<BarSourceDto>();
        {
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = @"
                SELECT v.title, v.url, v.youtube_id, b.timestamp_seconds, b.text
                FROM rhyme_word_bars rwb
                JOIN bars b ON b.id = rwb.bar_id
                JOIN videos v ON v.id = b.video_id
                WHERE rwb.word_id = $1
                ORDER BY v.title, b.timestamp_seconds NULLS LAST";
            cmd.Parameters.AddWithValue(wordId);

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
        await using var conn = await _db.OpenConnectionAsync();

        RhymeWordDto? baseWord;
        Guid wordId;
        {
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT id, word, phonemes, frequency FROM rhyme_words WHERE word = lower($1)";
            cmd.Parameters.AddWithValue(word);
            await using var reader = await cmd.ExecuteReaderAsync();
            if (!await reader.ReadAsync())
                return NotFound($"Word '{word}' not found.");

            wordId = reader.GetGuid(0);
            baseWord = new RhymeWordDto(wordId, reader.GetString(1),
                reader.IsDBNull(2) ? null : reader.GetString(2), reader.GetInt32(3));
        }

        var rhymes = new List<RhymeWordDto>();
        {
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = @"
                SELECT rw.id, rw.word, rw.phonemes, rw.frequency
                FROM rhyme_pairs rp
                JOIN rhyme_words rw ON rw.id = CASE
                    WHEN rp.word_a_id = $1 THEN rp.word_b_id
                    ELSE rp.word_a_id
                END
                WHERE rp.word_a_id = $1 OR rp.word_b_id = $1
                ORDER BY rw.frequency DESC, rw.word";
            cmd.Parameters.AddWithValue(wordId);
            await using var reader = await cmd.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                rhymes.Add(new RhymeWordDto(
                    reader.GetGuid(0), reader.GetString(1),
                    reader.IsDBNull(2) ? null : reader.GetString(2), reader.GetInt32(3)
                ));
            }
        }

        return Ok(new RhymeDetailDto(baseWord, rhymes));
    }
}
