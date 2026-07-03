using HarryMack.Api.Data;
using HarryMack.Api.Models;
using HarryMack.Api.Services;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

public class PersistenceTests
{
    // Extractor returning two freestyle bars PLUS a full analysis payload.
    class AnalysisExtractor : IExtractorClient
    {
        public Task<ExtractResultDto> ExtractAsync(string url, string artist, CancellationToken ct) =>
            Task.FromResult(new ExtractResultDto(
                new VideoMetaDto("abc123XYZ_9", "Analysis Video", 30.0, url),
                new List<SidecarBarDto>
                {
                    new("people don't care", 1.0, 3.0, "people", "care", "e@r", true, "SPEAKER_00"),
                    new("hands in the air", 3.5, 5.0, "hands", "air", "e@r", true, "SPEAKER_00"),
                },
                new AnalysisDto(
                    Words: new List<WordDto>
                    {
                        // full transcript — includes non-rhyming filler words
                        new("people", 1.0, 1.5),
                        new("don't", 1.5, 1.7),
                        new("care", 1.7, 3.0),
                        new("hands", 3.5, 3.8),
                        new("in", 3.8, 3.9),
                        new("the", 3.9, 4.0),
                        new("air", 4.0, 5.0),
                    },
                    Events: new List<RhymeEventDto>
                    {
                        new(2, "care", 0, 2, 1.7, 3.0, "e@r", "er", new List<string> { "e@" }, 1, "perfect-end", 0),
                        new(6, "air", 1, 3, 4.0, 5.0, "e@r", "er", new List<string> { "e@" }, 1, "perfect-end", 0),
                    },
                    Groups: new List<RhymeGroupDto>
                    {
                        new(0, 120, new List<int> { 2, 6 }, "e@r"),
                    },
                    BarLabels: new Dictionary<int, string> { { 0, "perfect-end" }, { 1, "perfect-end" } },
                    Scheme: new Dictionary<int, string> { { 0, "AA" }, { 1, "AA" } },
                    Density: 0.42,
                    DetectorVersion: 1)));
    }

    [Fact]
    public async Task ProcessUrl_PersistsFullTranscript_AndAnalysis()
    {
        var cs = "Data Source=file:memdb_persist?mode=memory&cache=shared";
        await using var keep = new SqliteConnection(cs);
        await keep.OpenAsync();
        await Db.InitSchemaAsync(cs);
        var db = new Db(cs);
        var svc = new PipelineService(db, new AnalysisExtractor(),
            new PhoneticService(NullLogger<PhoneticService>.Instance), NullLogger<PipelineService>.Instance);

        await svc.ProcessUrlAsync("https://youtu.be/abc123XYZ_9", "harry_mack");

        await using var c = db.Open();

        // Full transcript stored — one row per analysis word (incl. non-freestyle filler).
        var words = c.CreateCommand();
        words.CommandText = "SELECT COUNT(*) FROM transcript_words";
        Assert.Equal(7L, (long)(await words.ExecuteScalarAsync())!);

        // Rhyme events present.
        var events = c.CreateCommand();
        events.CommandText = "SELECT COUNT(*) FROM rhyme_events";
        Assert.Equal(2L, (long)(await events.ExecuteScalarAsync())!);

        // Rhyme groups present.
        var groups = c.CreateCommand();
        groups.CommandText = "SELECT COUNT(*) FROM rhyme_groups";
        Assert.Equal(1L, (long)(await groups.ExecuteScalarAsync())!);

        // One annotation row per video with the stamped detector version + density.
        var ann = c.CreateCommand();
        ann.CommandText = "SELECT detector_version, density FROM rhyme_annotations";
        await using var r = await ann.ExecuteReaderAsync();
        Assert.True(await r.ReadAsync());
        Assert.Equal(1L, r.GetInt64(0));
        Assert.Equal(0.42, r.GetDouble(1), 3);
        Assert.False(await r.ReadAsync()); // exactly one row

        // Bar labels persisted against real bar ids.
        var labels = c.CreateCommand();
        labels.CommandText = "SELECT COUNT(*) FROM bar_labels";
        Assert.Equal(2L, (long)(await labels.ExecuteScalarAsync())!);
    }
}
