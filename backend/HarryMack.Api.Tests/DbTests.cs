using HarryMack.Api.Data;
using Microsoft.Data.Sqlite;
using Xunit;

public class DbTests
{
    [Fact]
    public async Task InitSchema_CreatesVideosTable()
    {
        var cs = "Data Source=file:memdb1?mode=memory&cache=shared";
        await using var keepAlive = new SqliteConnection(cs);
        await keepAlive.OpenAsync();
        await Db.InitSchemaAsync(cs);
        await using var conn = new SqliteConnection(cs);
        await conn.OpenAsync();
        var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT name FROM sqlite_master WHERE type='table' AND name='videos'";
        Assert.Equal("videos", await cmd.ExecuteScalarAsync());
    }
}
