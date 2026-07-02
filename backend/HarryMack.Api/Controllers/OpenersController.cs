using HarryMack.Api.Data;
using HarryMack.Api.Models;
using Microsoft.AspNetCore.Mvc;

namespace HarryMack.Api.Controllers;

[ApiController]
[Route("api/openers")]
public class OpenersController : ControllerBase
{
    private readonly Db _db;

    public OpenersController(Db db) => _db = db;

    private static OpenerDto ReadOpener(Microsoft.Data.Sqlite.SqliteDataReader reader) =>
        new(
            reader.GetString(0),
            reader.GetString(1),
            reader.GetInt32(2),
            Json.ToArray(reader.IsDBNull(3) ? null : reader.GetString(3))
        );

    [HttpGet]
    public async Task<ActionResult<List<OpenerDto>>> GetAll([FromQuery] string? search)
    {
        var result = new List<OpenerDto>();
        await using var conn = _db.Open();
        await using var cmd = conn.CreateCommand();

        if (string.IsNullOrWhiteSpace(search))
        {
            cmd.CommandText = @"
                SELECT id, text, frequency, example_completions
                FROM openers
                ORDER BY frequency DESC, text";
        }
        else
        {
            cmd.CommandText = @"
                SELECT id, text, frequency, example_completions
                FROM openers
                WHERE text LIKE '%' || $p1 || '%'
                ORDER BY frequency DESC, text";
            cmd.Parameters.AddWithValue("$p1", search);
        }

        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
            result.Add(ReadOpener(reader));

        return Ok(result);
    }

    [HttpGet("{id}/sources")]
    public async Task<ActionResult<List<BarSourceDto>>> GetSources(string id)
    {
        var result = new List<BarSourceDto>();
        await using var conn = _db.Open();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
            SELECT v.title, v.url, v.youtube_id, b.timestamp_seconds, b.text
            FROM opener_sources os
            JOIN bars b ON b.id = os.bar_id
            JOIN videos v ON v.id = b.video_id
            WHERE os.opener_id = $p1
            ORDER BY v.title, b.timestamp_seconds NULLS LAST";
        cmd.Parameters.AddWithValue("$p1", id);

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

        return Ok(result);
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(string id)
    {
        await using var conn = _db.Open();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "DELETE FROM openers WHERE id = $p1";
        cmd.Parameters.AddWithValue("$p1", id);
        var rows = await cmd.ExecuteNonQueryAsync();
        return rows > 0 ? NoContent() : NotFound();
    }

    [HttpGet("random")]
    public async Task<ActionResult<OpenerDto>> GetRandom()
    {
        await using var conn = _db.Open();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
            SELECT id, text, frequency, example_completions
            FROM openers
            ORDER BY RANDOM()
            LIMIT 1";

        await using var reader = await cmd.ExecuteReaderAsync();
        if (!await reader.ReadAsync())
            return NotFound("No openers found. Add transcripts via the Pipeline page.");

        return Ok(ReadOpener(reader));
    }
}
