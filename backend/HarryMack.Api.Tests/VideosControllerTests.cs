using HarryMack.Api.Controllers;
using HarryMack.Api.Data;
using HarryMack.Api.Models;
using HarryMack.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

public class VideosControllerTests
{
    // Extractor returning two freestyle bars PLUS a full analysis payload (density 0.42).
    class SeedExtractor : IExtractorClient
    {
        private readonly double _density;
        public SeedExtractor(double density = 0.42) => _density = density;

        public Task<ExtractResultDto> ExtractAsync(string url, string artist, CancellationToken ct) =>
            Task.FromResult(new ExtractResultDto(
                new VideoMetaDto("abc123XYZ_9", "Analysis Video", 30.0, url),
                new List<SidecarBarDto>
                {
                    new("people don't care", 1.0, 3.0, "people", "care", "e@r", true, "SPEAKER_00"),
                    new("hands in the air", 3.5, 5.0, "hands", "air", "e@r", true, "SPEAKER_00"),
                },
                MakeAnalysis(_density)));

        // POST /analyze path — the sidecar returns an ExtractResult with empty bars + analysis set.
        public Task<AnalysisDto> AnalyzeAsync(string url, CancellationToken ct) =>
            Task.FromResult(MakeAnalysis(_density));

        public static AnalysisDto MakeAnalysis(double density) => new AnalysisDto(
            Words: new List<WordDto>
            {
                new("people", 1.0, 1.5), new("don't", 1.5, 1.7), new("care", 1.7, 3.0),
                new("hands", 3.5, 3.8), new("in", 3.8, 3.9), new("the", 3.9, 4.0), new("air", 4.0, 5.0),
            },
            Events: new List<RhymeEventDto>
            {
                new(2, "care", 0, 2, 1.7, 3.0, "e@r", "er", new List<string> { "e@" }, 1, "perfect-end", 0),
                new(6, "air", 1, 3, 4.0, 5.0, "e@r", "er", new List<string> { "e@" }, 1, "perfect-end", 0),
            },
            Groups: new List<RhymeGroupDto> { new(0, 120, new List<int> { 2, 6 }, "e@r") },
            BarLabels: new Dictionary<int, string> { { 0, "perfect-end" }, { 1, "perfect-end" } },
            Scheme: new Dictionary<int, string> { { 0, "AA" }, { 1, "AA" } },
            Density: density,
            DetectorVersion: 1);
    }

    private static async Task<(Db db, string videoId)> SeedAsync(string name, IExtractorClient extractor)
    {
        var cs = $"Data Source=file:{name}?mode=memory&cache=shared";
        var keep = new SqliteConnection(cs);
        await keep.OpenAsync();
        await Db.InitSchemaAsync(cs);
        var db = new Db(cs);
        var svc = new PipelineService(db, extractor,
            new PhoneticService(NullLogger<PhoneticService>.Instance), NullLogger<PipelineService>.Instance);
        await svc.ProcessUrlAsync("https://youtu.be/abc123XYZ_9", "harry_mack");

        await using var c = db.Open();
        var idCmd = c.CreateCommand();
        idCmd.CommandText = "SELECT id FROM videos LIMIT 1";
        var videoId = (string)(await idCmd.ExecuteScalarAsync())!;
        return (db, videoId);
    }

    [Fact]
    public async Task GetVideos_ReturnsSummaryWithCountsAndDensity()
    {
        var (db, videoId) = await SeedAsync("memdb_videos_list", new SeedExtractor());
        var controller = new VideosController(db);

        var result = await controller.GetVideos();
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var list = Assert.IsType<List<VideoSummaryDto>>(ok.Value);

        var v = Assert.Single(list);
        Assert.Equal(videoId, v.Id);
        Assert.Equal("Analysis Video", v.Title);
        Assert.Equal("harry_mack", v.Artist);
        Assert.Equal(2, v.BarCount);
        Assert.Equal(7, v.WordCount);
        Assert.Equal(0.42, v.Density!.Value, 3);
    }

    [Fact]
    public async Task GetAnalysis_ReturnsWordsEventsGroupsSchemeDensity()
    {
        var (db, videoId) = await SeedAsync("memdb_videos_analysis", new SeedExtractor());
        var controller = new VideosController(db);

        var result = await controller.GetAnalysis(videoId);
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var analysis = Assert.IsType<VideoAnalysisDto>(ok.Value);

        Assert.Equal(videoId, analysis.Video.Id);
        Assert.Equal(7, analysis.Words.Count);
        Assert.Equal(2, analysis.Events.Count);
        var g = Assert.Single(analysis.Groups);
        Assert.Equal(120, g.Hue);
        Assert.Equal("AA", analysis.Scheme[0]);
        Assert.Equal(0.42, analysis.Density, 3);

        // words carry their transcript order + text
        Assert.Equal("people", analysis.Words[0].Text);
        Assert.Equal(6, analysis.Words[6].WordIndex);
        // rhyme event points at its group
        Assert.Contains(analysis.Events, e => e.WordIndex == 2 && e.GroupIndex == 0 && e.Detector == "perfect-end");
    }

    [Fact]
    public async Task GetAnalysis_UnknownVideo_ReturnsNotFound()
    {
        var (db, _) = await SeedAsync("memdb_videos_404", new SeedExtractor());
        var controller = new VideosController(db);

        var result = await controller.GetAnalysis("does-not-exist");
        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    [Fact]
    public async Task PostAnalyze_ReanalyzesExistingVideo_WithoutDuplicating()
    {
        // Seed with density 0.42, then re-analyze with a fresh payload (density 0.99).
        var (db, videoId) = await SeedAsync("memdb_reanalyze", new SeedExtractor(0.42));
        var reExtractor = new SeedExtractor(0.99);
        var svc = new PipelineService(db, reExtractor,
            new PhoneticService(NullLogger<PhoneticService>.Instance), NullLogger<PipelineService>.Instance);
        var controller = new PipelineController(svc, null!);

        var result = await controller.Analyze(videoId);
        Assert.IsType<OkObjectResult>(result);

        await using var c = db.Open();

        // Density updated to the fresh value.
        var den = c.CreateCommand();
        den.CommandText = "SELECT density FROM rhyme_annotations WHERE video_id = $v";
        den.Parameters.AddWithValue("$v", videoId);
        Assert.Equal(0.99, (double)(await den.ExecuteScalarAsync())!, 3);

        // Re-analysis replaced rather than duplicated the additive rows.
        var words = c.CreateCommand();
        words.CommandText = "SELECT COUNT(*) FROM transcript_words WHERE video_id = $v";
        words.Parameters.AddWithValue("$v", videoId);
        Assert.Equal(7L, (long)(await words.ExecuteScalarAsync())!);

        var events = c.CreateCommand();
        events.CommandText = "SELECT COUNT(*) FROM rhyme_events WHERE video_id = $v";
        events.Parameters.AddWithValue("$v", videoId);
        Assert.Equal(2L, (long)(await events.ExecuteScalarAsync())!);
    }

    [Fact]
    public async Task PostAnalyze_UnknownVideo_ReturnsNotFound()
    {
        var (db, _) = await SeedAsync("memdb_reanalyze_404", new SeedExtractor());
        var svc = new PipelineService(db, new SeedExtractor(),
            new PhoneticService(NullLogger<PhoneticService>.Instance), NullLogger<PipelineService>.Instance);
        var controller = new PipelineController(svc, null!);

        var result = await controller.Analyze("nope");
        Assert.IsType<NotFoundObjectResult>(result);
    }
}
