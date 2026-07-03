using HarryMack.Api.Data;
using Microsoft.Data.Sqlite;
using Xunit;

public class SchemaTests
{
    private static async Task<bool> TableExistsAsync(SqliteConnection conn, string name)
    {
        var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT name FROM sqlite_master WHERE type='table' AND name=$n";
        cmd.Parameters.AddWithValue("$n", name);
        return (string?)await cmd.ExecuteScalarAsync() == name;
    }

    [Theory]
    [InlineData("transcript_words")]
    [InlineData("rhyme_events")]
    [InlineData("rhyme_groups")]
    [InlineData("rhyme_annotations")]
    [InlineData("bar_labels")]
    public async Task InitSchema_CreatesAnalysisTable(string table)
    {
        var cs = "Data Source=file:schematest?mode=memory&cache=shared";
        await using var keepAlive = new SqliteConnection(cs);
        await keepAlive.OpenAsync();
        await Db.InitSchemaAsync(cs);
        await using var conn = new SqliteConnection(cs);
        await conn.OpenAsync();
        Assert.True(await TableExistsAsync(conn, table));
    }

    [Fact]
    public async Task InitSchema_KeepsExistingTables()
    {
        var cs = "Data Source=file:schematest2?mode=memory&cache=shared";
        await using var keepAlive = new SqliteConnection(cs);
        await keepAlive.OpenAsync();
        await Db.InitSchemaAsync(cs);
        await using var conn = new SqliteConnection(cs);
        await conn.OpenAsync();
        foreach (var t in new[] { "videos", "bars", "openers", "opener_sources",
            "rhyme_words", "rhyme_pairs", "rhyme_word_bars", "sessions", "saved_openers" })
        {
            Assert.True(await TableExistsAsync(conn, t), $"missing existing table {t}");
        }
    }
}
