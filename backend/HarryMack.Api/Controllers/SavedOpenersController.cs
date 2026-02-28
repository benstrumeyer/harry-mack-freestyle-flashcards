using HarryMack.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Npgsql;

namespace HarryMack.Api.Controllers;

[ApiController]
[Route("api/saved")]
public class SavedOpenersController : ControllerBase
{
    private readonly NpgsqlDataSource _db;

    public SavedOpenersController(NpgsqlDataSource db) => _db = db;

    [HttpGet]
    public async Task<ActionResult<List<SavedOpenerDto>>> GetAll()
    {
        var result = new List<SavedOpenerDto>();
        await using var conn = await _db.OpenConnectionAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT id, opener_id, text, saved_at FROM saved_openers ORDER BY saved_at DESC";
        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            result.Add(new SavedOpenerDto(
                reader.GetGuid(0),
                reader.IsDBNull(1) ? null : reader.GetGuid(1),
                reader.GetString(2),
                reader.GetFieldValue<DateTimeOffset>(3)
            ));
        }
        return Ok(result);
    }

    [HttpPost]
    public async Task<ActionResult<SavedOpenerDto>> Save([FromBody] SaveOpenerRequest req)
    {
        if (!Guid.TryParse(req.OpenerId, out var openerId))
            return BadRequest("Invalid opener id");

        await using var conn = await _db.OpenConnectionAsync();

        // Prevent duplicates by opener_id
        await using var checkCmd = conn.CreateCommand();
        checkCmd.CommandText = "SELECT id, opener_id, text, saved_at FROM saved_openers WHERE opener_id = $1";
        checkCmd.Parameters.AddWithValue(openerId);
        await using var checkReader = await checkCmd.ExecuteReaderAsync();
        if (await checkReader.ReadAsync())
        {
            return Ok(new SavedOpenerDto(
                checkReader.GetGuid(0),
                checkReader.IsDBNull(1) ? null : checkReader.GetGuid(1),
                checkReader.GetString(2),
                checkReader.GetFieldValue<DateTimeOffset>(3)
            ));
        }
        await checkReader.CloseAsync();

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
            INSERT INTO saved_openers (opener_id, text)
            VALUES ($1, $2)
            RETURNING id, opener_id, text, saved_at";
        cmd.Parameters.AddWithValue(openerId);
        cmd.Parameters.AddWithValue(req.Text);
        await using var reader = await cmd.ExecuteReaderAsync();
        await reader.ReadAsync();
        return Ok(new SavedOpenerDto(
            reader.GetGuid(0),
            reader.IsDBNull(1) ? null : reader.GetGuid(1),
            reader.GetString(2),
            reader.GetFieldValue<DateTimeOffset>(3)
        ));
    }

    [HttpPatch("{id}")]
    public async Task<ActionResult<SavedOpenerDto>> UpdateText(Guid id, [FromBody] UpdateSavedOpenerRequest req)
    {
        var text = req.Text.Trim();
        if (string.IsNullOrEmpty(text)) return BadRequest("Text cannot be empty");

        await using var conn = await _db.OpenConnectionAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
            UPDATE saved_openers SET text = $2 WHERE id = $1
            RETURNING id, opener_id, text, saved_at";
        cmd.Parameters.AddWithValue(id);
        cmd.Parameters.AddWithValue(text);
        await using var reader = await cmd.ExecuteReaderAsync();
        if (!await reader.ReadAsync()) return NotFound();
        return Ok(new SavedOpenerDto(
            reader.GetGuid(0),
            reader.IsDBNull(1) ? null : reader.GetGuid(1),
            reader.GetString(2),
            reader.GetFieldValue<DateTimeOffset>(3)
        ));
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(Guid id)
    {
        await using var conn = await _db.OpenConnectionAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "DELETE FROM saved_openers WHERE id = $1";
        cmd.Parameters.AddWithValue(id);
        var rows = await cmd.ExecuteNonQueryAsync();
        return rows > 0 ? NoContent() : NotFound();
    }
}
