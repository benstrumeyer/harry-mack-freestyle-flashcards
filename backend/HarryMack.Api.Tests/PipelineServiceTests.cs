using HarryMack.Api.Data;
using HarryMack.Api.Models;
using HarryMack.Api.Services;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

public class PipelineServiceTests
{
    class FakeExtractor : IExtractorClient
    {
        public Task<ExtractResultDto> ExtractAsync(string url, string artist, CancellationToken ct) =>
            Task.FromResult(new ExtractResultDto(
                new VideoMetaDto("abc123XYZ_1", "Test Video", 30.0, url),
                new List<SidecarBarDto>
                {
                    new("people don't care", 1.0, 3.0, "people", "care", "e r", true, "SPEAKER_00"),
                    new("hands in the air", 3.5, 5.0, "hands", "air", "e r", true, "SPEAKER_00"),
                }));
    }

    [Fact]
    public async Task ProcessUrl_PersistsBars_AndFormsCouplet()
    {
        var cs = "Data Source=file:memdb3?mode=memory&cache=shared";
        await using var keep = new SqliteConnection(cs);
        await keep.OpenAsync();
        await Db.InitSchemaAsync(cs);
        var db = new Db(cs);
        var svc = new PipelineService(db, new FakeExtractor(),
            new PhoneticService(NullLogger<PhoneticService>.Instance), NullLogger<PipelineService>.Instance);

        var res = await svc.ProcessUrlAsync("https://youtu.be/abc123XYZ_1", "harry_mack");

        Assert.Equal(2, res.BarsExtracted);

        await using var c = db.Open();
        var barCount = c.CreateCommand();
        barCount.CommandText = "SELECT COUNT(*) FROM bars";
        Assert.Equal(2L, (long)(await barCount.ExecuteScalarAsync())!);

        // Both bars share rhyme_key "e r" (care/air) → exactly one couplet pair.
        var pairCount = c.CreateCommand();
        pairCount.CommandText = "SELECT COUNT(*) FROM rhyme_pairs";
        Assert.Equal(1L, (long)(await pairCount.ExecuteScalarAsync())!);
    }
}
