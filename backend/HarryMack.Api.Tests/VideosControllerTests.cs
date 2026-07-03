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
        var controller = new VideosController(db, new SeedExtractor());

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
        var controller = new VideosController(db, new SeedExtractor());

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
        var controller = new VideosController(db, new SeedExtractor());

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

    // Captures the analysis/engine/draft handed to the sidecar and returns a
    // canned draft (word indices 2 and 6 co-grouped).
    class CapturingExtractor : IExtractorClient
    {
        public AnalysisDto? Analysis;
        public string? Engine;
        public UserAnnotationDto? AiDraft;
        public AutoAnnotateResultDto Result = new(
            new Dictionary<string, List<int>> { { "0", new() { 2, 6 } } },
            new Dictionary<string, double> { { "0", 1.0 } });

        public Task<ExtractResultDto> ExtractAsync(string url, string artist, CancellationToken ct) =>
            throw new NotImplementedException();

        public Task<AutoAnnotateResultDto> AutoAnnotateAsync(
            AnalysisDto analysis, string engine, UserAnnotationDto? aiDraft, CancellationToken ct)
        {
            Analysis = analysis; Engine = engine; AiDraft = aiDraft;
            return Task.FromResult(Result);
        }
    }

    [Theory]
    [InlineData("ensemble")]
    [InlineData("local")]
    public async Task GetAutoAnnotate_ComputesDraftViaSidecar(string engine)
    {
        var (db, videoId) = await SeedAsync($"memdb_autoanno_{engine}", new SeedExtractor());
        var extractor = new CapturingExtractor();
        var controller = new VideosController(db, extractor);

        var result = await controller.GetAutoAnnotate(videoId, engine);
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var draft = Assert.IsType<UserAnnotationDto>(ok.Value);

        // The sidecar-proposed groups come back as the draft's groups.
        Assert.Equal(new List<int> { 2, 6 }, draft.Groups["0"]);
        // The engine is forwarded, and the persisted analysis is reconstructed.
        Assert.Equal(engine, extractor.Engine);
        Assert.NotNull(extractor.Analysis);
        Assert.Equal(2, extractor.Analysis!.Events.Count);
        Assert.Equal("care", extractor.Analysis.Events[0].Text);
        Assert.Equal("e@r", extractor.Analysis.Events[0].CanonicalKey);
    }

    [Fact]
    public async Task GetAutoAnnotate_Ai_ReturnsStoredDraft()
    {
        var (db, videoId) = await SeedAsync("memdb_autoanno_ai", new SeedExtractor());
        var controller = new VideosController(db, new CapturingExtractor());

        var stored = new UserAnnotationDto(
            new List<List<int>> { new() { 0, 1, 2 } },
            new Dictionary<string, List<int>> { { "e@r", new() { 2, 6 } } });
        await controller.PutAiDraft(videoId, stored);

        var result = await controller.GetAutoAnnotate(videoId, "ai");
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var draft = Assert.IsType<UserAnnotationDto>(ok.Value);
        Assert.Equal(stored.Bars, draft.Bars);
        Assert.Equal(stored.Groups, draft.Groups);
    }

    [Fact]
    public async Task GetAutoAnnotate_Ai_NoDraft_ReturnsNoContent()
    {
        var (db, videoId) = await SeedAsync("memdb_autoanno_ai_empty", new SeedExtractor());
        var controller = new VideosController(db, new CapturingExtractor());

        var result = await controller.GetAutoAnnotate(videoId, "ai");
        Assert.IsType<NoContentResult>(result.Result);
    }

    [Fact]
    public async Task GetAutoAnnotate_ForwardsStoredAiDraftAsSignal()
    {
        var (db, videoId) = await SeedAsync("memdb_autoanno_signal", new SeedExtractor());
        var extractor = new CapturingExtractor();
        var controller = new VideosController(db, extractor);

        var aiDraft = new UserAnnotationDto(
            new List<List<int>>(),
            new Dictionary<string, List<int>> { { "e@r", new() { 2, 6 } } });
        await controller.PutAiDraft(videoId, aiDraft);

        await controller.GetAutoAnnotate(videoId, "ensemble");
        Assert.NotNull(extractor.AiDraft);
        Assert.Equal(aiDraft.Groups, extractor.AiDraft!.Groups);
    }

    [Fact]
    public async Task GetAutoAnnotate_NeverOverwritesSavedAnnotation()
    {
        var (db, videoId) = await SeedAsync("memdb_autoanno_safe", new SeedExtractor());
        var controller = new VideosController(db, new CapturingExtractor());

        var saved = new UserAnnotationDto(
            new List<List<int>> { new() { 0, 1 } },
            new Dictionary<string, List<int>> { { "mine", new() { 0, 1 } } });
        await controller.PutAnnotation(videoId, saved);

        await controller.GetAutoAnnotate(videoId, "ensemble");

        var annResult = await controller.GetAnnotation(videoId);
        var annOk = Assert.IsType<OkObjectResult>(annResult.Result);
        var ann = Assert.IsType<UserAnnotationDto>(annOk.Value);
        Assert.Equal(saved.Bars, ann.Bars);
        Assert.Equal(saved.Groups, ann.Groups);
    }

    [Fact]
    public async Task GetAutoAnnotate_UnknownVideo_ReturnsNotFound()
    {
        var (db, _) = await SeedAsync("memdb_autoanno_404", new SeedExtractor());
        var controller = new VideosController(db, new CapturingExtractor());

        var result = await controller.GetAutoAnnotate("nope", "ensemble");
        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    [Fact]
    public async Task GetAutoAnnotate_UnknownEngine_ReturnsBadRequest()
    {
        var (db, videoId) = await SeedAsync("memdb_autoanno_badengine", new SeedExtractor());
        var controller = new VideosController(db, new CapturingExtractor());

        var result = await controller.GetAutoAnnotate(videoId, "gpt");
        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task GetAiDraft_NoDraft_ReturnsNoContent()
    {
        var (db, videoId) = await SeedAsync("memdb_aidraft_empty", new SeedExtractor());
        var controller = new VideosController(db, new SeedExtractor());

        var result = await controller.GetAiDraft(videoId);
        Assert.IsType<NoContentResult>(result.Result);
    }

    [Fact]
    public async Task PutThenGetAiDraft_RoundTrips()
    {
        var (db, videoId) = await SeedAsync("memdb_aidraft_roundtrip", new SeedExtractor());
        var controller = new VideosController(db, new SeedExtractor());

        var draft = new UserAnnotationDto(
            Bars: new List<List<int>> { new() { 0, 1, 2 }, new() { 3, 4, 5, 6 } },
            Groups: new Dictionary<string, List<int>> { { "e@r", new() { 2, 6 } } },
            Paras: new List<int> { 0 },
            Types: new Dictionary<string, string> { { "2", "end" }, { "6", "end" } });

        var put = await controller.PutAiDraft(videoId, draft);
        Assert.IsType<NoContentResult>(put);

        var get = await controller.GetAiDraft(videoId);
        var ok = Assert.IsType<OkObjectResult>(get.Result);
        var back = Assert.IsType<UserAnnotationDto>(ok.Value);

        Assert.Equal(draft.Bars, back.Bars);
        Assert.Equal(draft.Groups, back.Groups);
        Assert.Equal(draft.Paras, back.Paras);
        Assert.Equal(draft.Types, back.Types);
    }

    [Fact]
    public async Task PutAiDraft_Twice_OverwritesDraftOnly()
    {
        var (db, videoId) = await SeedAsync("memdb_aidraft_overwrite", new SeedExtractor());
        var controller = new VideosController(db, new SeedExtractor());

        var first = new UserAnnotationDto(
            new List<List<int>> { new() { 0 } },
            new Dictionary<string, List<int>>());
        var second = new UserAnnotationDto(
            new List<List<int>> { new() { 1, 2 } },
            new Dictionary<string, List<int>> { { "ay", new() { 1, 2 } } });

        await controller.PutAiDraft(videoId, first);
        await controller.PutAiDraft(videoId, second);

        var get = await controller.GetAiDraft(videoId);
        var ok = Assert.IsType<OkObjectResult>(get.Result);
        var back = Assert.IsType<UserAnnotationDto>(ok.Value);
        Assert.Equal(second.Bars, back.Bars);
        Assert.Single(back.Groups);
    }

    [Fact]
    public async Task AiDraft_IsSeparateFromSavedAnnotation()
    {
        var (db, videoId) = await SeedAsync("memdb_aidraft_separate", new SeedExtractor());
        var controller = new VideosController(db, new SeedExtractor());

        // User saves their own annotation.
        var saved = new UserAnnotationDto(
            new List<List<int>> { new() { 0, 1 } },
            new Dictionary<string, List<int>>());
        await controller.PutAnnotation(videoId, saved);

        // A Claude-Code-authored draft is stored separately.
        var draft = new UserAnnotationDto(
            new List<List<int>> { new() { 9, 9, 9 } },
            new Dictionary<string, List<int>> { { "draft", new() { 9 } } });
        await controller.PutAiDraft(videoId, draft);

        // The draft never overwrote the saved annotation.
        var annResult = await controller.GetAnnotation(videoId);
        var annOk = Assert.IsType<OkObjectResult>(annResult.Result);
        var ann = Assert.IsType<UserAnnotationDto>(annOk.Value);
        Assert.Equal(saved.Bars, ann.Bars);

        // And the draft round-trips independently.
        var draftResult = await controller.GetAiDraft(videoId);
        var draftOk = Assert.IsType<OkObjectResult>(draftResult.Result);
        var draftBack = Assert.IsType<UserAnnotationDto>(draftOk.Value);
        Assert.Equal(draft.Bars, draftBack.Bars);
    }
}
