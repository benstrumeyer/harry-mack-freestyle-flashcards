using HarryMack.Api.Data;
using Microsoft.Data.Sqlite;
using Xunit;

public class SqlPortTests
{
    [Fact]
    public async Task OpenerUpsert_IncrementsFrequency_AndAppendsCompletion()
    {
        var cs = "Data Source=file:memdb2?mode=memory&cache=shared";
        await using var keep = new SqliteConnection(cs);
        await keep.OpenAsync();
        await Db.InitSchemaAsync(cs);
        var db = new Db(cs);

        async Task Upsert(string completion)
        {
            await using var c = db.Open();
            var cmd = c.CreateCommand();
            cmd.CommandText = @"INSERT INTO openers (id, text, frequency, example_completions)
                VALUES ($id, $t, 1, json_array($c))
                ON CONFLICT(text) DO UPDATE
                  SET frequency = frequency + 1,
                      example_completions = json_insert(example_completions, '$[#]', $c)";
            cmd.Parameters.AddWithValue("$id", System.Guid.NewGuid().ToString("N"));
            cmd.Parameters.AddWithValue("$t", "I was born");
            cmd.Parameters.AddWithValue("$c", completion);
            await cmd.ExecuteNonQueryAsync();
        }

        await Upsert("in a world");
        await Upsert("on the block");

        await using var conn = db.Open();
        var q = conn.CreateCommand();
        q.CommandText = "SELECT frequency, example_completions FROM openers WHERE text = 'I was born'";
        await using var r = await q.ExecuteReaderAsync();
        Assert.True(await r.ReadAsync());
        Assert.Equal(2L, r.GetInt64(0));
        Assert.Equal(new[] { "in a world", "on the block" }, Json.ToArray(r.GetString(1)));
    }
}
