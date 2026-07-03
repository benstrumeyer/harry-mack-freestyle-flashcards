using HarryMack.Api.Controllers;
using HarryMack.Api.Data;
using HarryMack.Api.Models;
using HarryMack.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

// Spec §7b / Spec 2 — Rhyme Game opener mode (Task 5.1, backend).
// One video: opener "people" → source bar "people don't care" whose rhyme word is
// "care" (canonical key "e@r", delivered "er"). The rhyme dictionary holds {care, air}
// under key "e@r". The endpoint exposes, per opener, the target rhyme key + valid words,
// and validates a submitted word via espeak (canonical/delivered).
public class OpenerModeTests
{
    class OneVideoExtractor : IExtractorClient
    {
        public Task<ExtractResultDto> ExtractAsync(string url, string artist, CancellationToken ct) =>
            Task.FromResult(new ExtractResultDto(
                new VideoMetaDto("vidOne11111", "Song One", 30.0, url),
                new List<SidecarBarDto>
                {
                    new("people don't care", 1.0, 3.0, "people", "care", "e@r", true, "SPEAKER_00"),
                    new("hands in the air", 3.5, 5.0, "hands", "air", "e@r", true, "SPEAKER_00"),
                },
                new AnalysisDto(
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
                    Density: 0.42, DetectorVersion: 1)));
    }

    private static async Task<(Db db, string openerId)> SeedAsync(string name)
    {
        var cs = $"Data Source=file:{name}?mode=memory&cache=shared";
        var keep = new SqliteConnection(cs);
        await keep.OpenAsync();
        await Db.InitSchemaAsync(cs);
        var db = new Db(cs);
        var svc = new PipelineService(db, new OneVideoExtractor(),
            new PhoneticService(NullLogger<PhoneticService>.Instance), NullLogger<PipelineService>.Instance);

        await svc.ProcessUrlAsync("https://youtu.be/VIDEO_ONE", "harry_mack");

        await using var c = db.Open();
        var idCmd = c.CreateCommand();
        idCmd.CommandText = "SELECT id FROM openers WHERE text = 'people'";
        var openerId = (string)(await idCmd.ExecuteScalarAsync())!;
        return (db, openerId);
    }

    private static OpenerModeController NewController(Db db) =>
        new(db, new PhoneticService(NullLogger<PhoneticService>.Instance));

    [Fact]
    public async Task GetChallenge_ReturnsTargetKeyAndValidWords()
    {
        var (db, openerId) = await SeedAsync("memdb_opener_challenge");
        var controller = NewController(db);

        var result = await controller.GetChallenge(openerId);
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var dto = Assert.IsType<OpenerChallengeDto>(ok.Value);

        Assert.Equal(openerId, dto.OpenerId);
        Assert.Equal("people", dto.OpenerText);
        Assert.Equal("care", dto.TargetWord);      // rhyme word of the source bar
        Assert.Equal("e@r", dto.TargetKey);        // its stored canonical key
        Assert.Equal("er", dto.TargetDeliveredKey); // how it was delivered
        Assert.Contains("care", dto.ValidWords);
        Assert.Contains("air", dto.ValidWords);
    }

    [Fact]
    public async Task GetChallenge_UnknownOpener_ReturnsNotFound()
    {
        var (db, _) = await SeedAsync("memdb_opener_404");
        var controller = NewController(db);

        var result = await controller.GetChallenge("nope");
        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    [Fact]
    public async Task Validate_RhymingWord_IsValid()
    {
        var (db, openerId) = await SeedAsync("memdb_opener_valid");
        var controller = NewController(db);

        // "hair" rhymes with the target "care" via espeak, though it's not in the dictionary.
        var result = await controller.Validate(openerId, new OpenerGuessRequest("hair"));
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var dto = Assert.IsType<OpenerValidationDto>(ok.Value);

        Assert.True(dto.Valid);
        Assert.Equal("hair", dto.Word);
        Assert.Equal("e@r", dto.TargetKey);
        Assert.NotNull(dto.MatchedOn);
    }

    [Fact]
    public async Task Validate_DictionaryWord_IsValid()
    {
        var (db, openerId) = await SeedAsync("memdb_opener_dict");
        var controller = NewController(db);

        var result = await controller.Validate(openerId, new OpenerGuessRequest("air"));
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var dto = Assert.IsType<OpenerValidationDto>(ok.Value);
        Assert.True(dto.Valid);
    }

    [Fact]
    public async Task Validate_NonRhymingWord_IsInvalid()
    {
        var (db, openerId) = await SeedAsync("memdb_opener_invalid");
        var controller = NewController(db);

        var result = await controller.Validate(openerId, new OpenerGuessRequest("cat"));
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var dto = Assert.IsType<OpenerValidationDto>(ok.Value);

        Assert.False(dto.Valid);
        Assert.Null(dto.MatchedOn);
    }

    [Fact]
    public async Task Validate_UnknownOpener_ReturnsNotFound()
    {
        var (db, _) = await SeedAsync("memdb_opener_validate_404");
        var controller = NewController(db);

        var result = await controller.Validate("nope", new OpenerGuessRequest("care"));
        Assert.IsType<NotFoundObjectResult>(result.Result);
    }
}
