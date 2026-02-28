using HarryMack.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Npgsql;
using NpgsqlTypes;

namespace HarryMack.Api.Controllers;

[ApiController]
[Route("api/sessions")]
public class SessionsController : ControllerBase
{
    private readonly NpgsqlDataSource _db;

    public SessionsController(NpgsqlDataSource db) => _db = db;

    [HttpPost]
    public async Task<ActionResult<SessionDto>> Create([FromBody] CreateSessionRequest req)
    {
        await using var conn = await _db.OpenConnectionAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
            INSERT INTO sessions (cards_shown)
            VALUES ($1)
            RETURNING id, started_at, cards_shown";

        var guids = req.CardsShown.Select(Guid.Parse).ToArray();
        var param = new NpgsqlParameter
        {
            Value = guids,
            NpgsqlDbType = NpgsqlDbType.Array | NpgsqlDbType.Uuid
        };
        cmd.Parameters.Add(param);

        await using var reader = await cmd.ExecuteReaderAsync();
        await reader.ReadAsync();

        var cardsShown = reader.IsDBNull(2) ? Array.Empty<Guid>() : reader.GetFieldValue<Guid[]>(2);
        return Ok(new SessionDto(reader.GetGuid(0), reader.GetFieldValue<DateTimeOffset>(1), cardsShown));
    }

    [HttpGet]
    public async Task<ActionResult<List<SessionDto>>> GetAll()
    {
        var result = new List<SessionDto>();
        await using var conn = await _db.OpenConnectionAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT id, started_at, cards_shown FROM sessions ORDER BY started_at DESC";

        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            var cardsShown = reader.IsDBNull(2) ? Array.Empty<Guid>() : reader.GetFieldValue<Guid[]>(2);
            result.Add(new SessionDto(reader.GetGuid(0), reader.GetFieldValue<DateTimeOffset>(1), cardsShown));
        }
        return Ok(result);
    }
}
