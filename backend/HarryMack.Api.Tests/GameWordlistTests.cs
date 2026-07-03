using HarryMack.Api.Controllers;
using HarryMack.Api.Data;
using HarryMack.Api.Models;
using HarryMack.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

public class GameWordlistTests
{
    // Two videos with DISTINCT rhyme sets, ingested under DISTINCT artists, so that the
    // global word bank is strictly larger than any single artist's:
    //   harry_mack -> {care, air}   (key "e@r")
    //   other_mc   -> {night, light}(key "aIt")
    class TwoArtistExtractor : IExtractorClient
    {
        public Task<ExtractResultDto> ExtractAsync(string url, string artist, CancellationToken ct)
        {
            if (url.Contains("HM_ONE"))
            {
                return Task.FromResult(new ExtractResultDto(
                    new VideoMetaDto("hmOne111111", "HM One", 30.0, url),
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

            return Task.FromResult(new ExtractResultDto(
                new VideoMetaDto("otOne111111", "Other One", 30.0, url),
                new List<SidecarBarDto>
                {
                    new("out in the night", 1.0, 3.0, "out", "night", "aIt", true, "SPEAKER_00"),
                    new("shining a light", 3.5, 5.0, "shining", "light", "aIt", true, "SPEAKER_00"),
                },
                new AnalysisDto(
                    Words: new List<WordDto>
                    {
                        new("out", 1.0, 1.3), new("in", 1.3, 1.5), new("the", 1.5, 1.7), new("night", 1.7, 3.0),
                        new("shining", 3.5, 3.8), new("a", 3.8, 3.9), new("light", 4.0, 5.0),
                    },
                    Events: new List<RhymeEventDto>
                    {
                        new(3, "night", 0, 3, 1.7, 3.0, "aIt", "ait", new List<string> { "aI" }, 1, "perfect-end", 0),
                        new(6, "light", 1, 3, 4.0, 5.0, "aIt", "ait", new List<string> { "aI" }, 1, "perfect-end", 0),
                    },
                    Groups: new List<RhymeGroupDto> { new(0, 200, new List<int> { 3, 6 }, "aIt") },
                    BarLabels: new Dictionary<int, string> { { 0, "perfect-end" }, { 1, "perfect-end" } },
                    Scheme: new Dictionary<int, string> { { 0, "AA" }, { 1, "AA" } },
                    Density: 0.42, DetectorVersion: 1)));
        }
    }

    private static async Task<(Db db, string hmVideoId)> SeedAsync(string name)
    {
        var cs = $"Data Source=file:{name}?mode=memory&cache=shared";
        var keep = new SqliteConnection(cs);
        await keep.OpenAsync();
        await Db.InitSchemaAsync(cs);
        var db = new Db(cs);
        var svc = new PipelineService(db, new TwoArtistExtractor(),
            new PhoneticService(NullLogger<PhoneticService>.Instance), NullLogger<PipelineService>.Instance);

        await svc.ProcessUrlAsync("https://youtu.be/HM_ONE", "harry_mack");
        await svc.ProcessUrlAsync("https://youtu.be/OTHER_ONE", "other_mc");

        await using var c = db.Open();
        var idCmd = c.CreateCommand();
        idCmd.CommandText = "SELECT id FROM videos WHERE youtube_id = 'hmOne111111'";
        var hmVideoId = (string)(await idCmd.ExecuteScalarAsync())!;
        return (db, hmVideoId);
    }

    // Reflect the anonymous `{ words, openers }` payload into typed lists.
    private static (List<object[]> words, List<string> openers) Unwrap(ActionResult<object> result)
    {
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var val = ok.Value!;
        var words = (List<object[]>)val.GetType().GetProperty("words")!.GetValue(val)!;
        var openers = (List<string>)val.GetType().GetProperty("openers")!.GetValue(val)!;
        return (words, openers);
    }

    [Fact]
    public async Task GetWordList_DefaultCall_ReturnsLegacyShapeScopedToArtist()
    {
        var (db, _) = await SeedAsync("memdb_game_default");
        var controller = new GameController(db);

        // Default call: no scope/videoId/difficulty — must still return the legacy contract.
        var (words, openers) = Unwrap(await controller.GetWordList("harry_mack"));

        Assert.NotEmpty(words);
        // Each tuple is [word:string, syllables:int, key:string, inCorpus:int].
        foreach (var w in words)
        {
            Assert.Equal(4, w.Length);
            Assert.IsType<string>(w[0]);
            Assert.IsType<int>(w[1]);
            Assert.IsType<string>(w[2]);
            Assert.IsType<int>(w[3]);
        }

        // Artist-scoped by default: harry_mack's words present, other_mc's absent.
        Assert.Contains(words, w => (string)w[0] == "care");
        Assert.Contains(words, w => (string)w[0] == "air");
        Assert.DoesNotContain(words, w => (string)w[0] == "night");
        Assert.NotNull(openers);
    }

    [Fact]
    public async Task GetWordList_GlobalScope_YieldsMoreWordsThanArtist()
    {
        var (db, _) = await SeedAsync("memdb_game_global");
        var controller = new GameController(db);

        var (artistWords, _) = Unwrap(await controller.GetWordList("harry_mack"));
        var (globalWords, _) = Unwrap(await controller.GetWordList("harry_mack", scope: "global"));

        Assert.True(globalWords.Count > artistWords.Count,
            $"global ({globalWords.Count}) should exceed artist ({artistWords.Count})");
        // Global pulls in the other artist's bank.
        Assert.Contains(globalWords, w => (string)w[0] == "care");
        Assert.Contains(globalWords, w => (string)w[0] == "night");
        Assert.Contains(globalWords, w => (string)w[0] == "light");
    }

    [Fact]
    public async Task GetWordList_SongScope_ReturnsOnlyThatVideosWords()
    {
        var (db, hmVideoId) = await SeedAsync("memdb_game_song");
        var controller = new GameController(db);

        var (words, _) = Unwrap(await controller.GetWordList("harry_mack", scope: "song", videoId: hmVideoId));

        Assert.Contains(words, w => (string)w[0] == "care");
        Assert.Contains(words, w => (string)w[0] == "air");
        Assert.DoesNotContain(words, w => (string)w[0] == "night");
        Assert.DoesNotContain(words, w => (string)w[0] == "light");
    }
}
