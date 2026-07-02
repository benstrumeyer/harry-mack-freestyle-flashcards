using HarryMack.Api.Data;
using HarryMack.Api.Models;
using Microsoft.AspNetCore.Mvc;

namespace HarryMack.Api.Controllers;

[ApiController]
[Route("api/saved")]
public class SavedOpenersController : ControllerBase
{
    private readonly Db _db;

    public SavedOpenersController(Db db) => _db = db;

    private static SavedOpenerDto ReadSaved(Microsoft.Data.Sqlite.SqliteDataReader reader) =>
        new(
            reader.GetString(0),
            reader.IsDBNull(1) ? null : reader.GetString(1),
            reader.GetString(2),
            Sql.Ts(reader.GetString(3))
        );

    [HttpGet]
    public async Task<ActionResult<List<SavedOpenerDto>>> GetAll()
    {
        var result = new List<SavedOpenerDto>();
        await using var conn = _db.Open();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT id, opener_id, text, saved_at FROM saved_openers ORDER BY saved_at DESC";
        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
            result.Add(ReadSaved(reader));
        return Ok(result);
    }

    [HttpPost]
    public async Task<ActionResult<SavedOpenerDto>> Save([FromBody] SaveOpenerRequest req)
    {
        if (!Guid.TryParse(req.OpenerId, out var parsed))
            return BadRequest("Invalid opener id");
        var openerId = parsed.ToString("N");

        await using var conn = _db.Open();

        // Prevent duplicates by opener_id
        await using (var checkCmd = conn.CreateCommand())
        {
            checkCmd.CommandText = "SELECT id, opener_id, text, saved_at FROM saved_openers WHERE opener_id = $p1";
            checkCmd.Parameters.AddWithValue("$p1", openerId);
            await using var checkReader = await checkCmd.ExecuteReaderAsync();
            if (await checkReader.ReadAsync())
                return Ok(ReadSaved(checkReader));
        }

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
            INSERT INTO saved_openers (id, opener_id, text)
            VALUES ($p1, $p2, $p3)
            RETURNING id, opener_id, text, saved_at";
        cmd.Parameters.AddWithValue("$p1", Guid.NewGuid().ToString("N"));
        cmd.Parameters.AddWithValue("$p2", openerId);
        cmd.Parameters.AddWithValue("$p3", req.Text);
        await using var reader = await cmd.ExecuteReaderAsync();
        await reader.ReadAsync();
        return Ok(ReadSaved(reader));
    }

    [HttpPatch("{id}")]
    public async Task<ActionResult<SavedOpenerDto>> UpdateText(string id, [FromBody] UpdateSavedOpenerRequest req)
    {
        var text = req.Text.Trim();
        if (string.IsNullOrEmpty(text)) return BadRequest("Text cannot be empty");

        await using var conn = _db.Open();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
            UPDATE saved_openers SET text = $p2 WHERE id = $p1
            RETURNING id, opener_id, text, saved_at";
        cmd.Parameters.AddWithValue("$p1", id);
        cmd.Parameters.AddWithValue("$p2", text);
        await using var reader = await cmd.ExecuteReaderAsync();
        if (!await reader.ReadAsync()) return NotFound();
        return Ok(ReadSaved(reader));
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(string id)
    {
        await using var conn = _db.Open();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "DELETE FROM saved_openers WHERE id = $p1";
        cmd.Parameters.AddWithValue("$p1", id);
        var rows = await cmd.ExecuteNonQueryAsync();
        return rows > 0 ? NoContent() : NotFound();
    }
}
