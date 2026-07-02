using HarryMack.Api.Data;
using HarryMack.Api.Models;
using Microsoft.AspNetCore.Mvc;

namespace HarryMack.Api.Controllers;

[ApiController]
[Route("api/sessions")]
public class SessionsController : ControllerBase
{
    private readonly Db _db;

    public SessionsController(Db db) => _db = db;

    private static SessionDto ReadSession(Microsoft.Data.Sqlite.SqliteDataReader reader) =>
        new(
            reader.GetString(0),
            Sql.Ts(reader.GetString(1)),
            Json.ToArray(reader.IsDBNull(2) ? null : reader.GetString(2))
        );

    [HttpPost]
    public async Task<ActionResult<SessionDto>> Create([FromBody] CreateSessionRequest req)
    {
        await using var conn = _db.Open();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
            INSERT INTO sessions (id, cards_shown)
            VALUES ($p1, $p2)
            RETURNING id, started_at, cards_shown";
        cmd.Parameters.AddWithValue("$p1", Guid.NewGuid().ToString("N"));
        cmd.Parameters.AddWithValue("$p2", Json.Of(req.CardsShown));

        await using var reader = await cmd.ExecuteReaderAsync();
        await reader.ReadAsync();
        return Ok(ReadSession(reader));
    }

    [HttpGet]
    public async Task<ActionResult<List<SessionDto>>> GetAll()
    {
        var result = new List<SessionDto>();
        await using var conn = _db.Open();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT id, started_at, cards_shown FROM sessions ORDER BY started_at DESC";

        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
            result.Add(ReadSession(reader));
        return Ok(result);
    }
}
