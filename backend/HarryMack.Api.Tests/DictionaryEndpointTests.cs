using HarryMack.Api.Controllers;
using HarryMack.Api.Data;
using HarryMack.Api.Models;
using HarryMack.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

public class DictionaryEndpointTests
{
    // Two videos sharing the "care"/"air" rhyme (canonical key "e@r", one group each).
    // Ingesting both populates rhyme_dictionary (freq 2, song_count 2) + a pair (air, care).
    class TwoVideoExtractor : IExtractorClient
    {
        public Task<ExtractResultDto> ExtractAsync(string url, string artist, CancellationToken ct)
        {
            var ytId = url.Contains("VIDEO_ONE") ? "vidOne11111" : "vidTwo22222";
            var title = url.Contains("VIDEO_ONE") ? "Song One" : "Song Two";
            return Task.FromResult(new ExtractResultDto(
                new VideoMetaDto(ytId, title, 30.0, url),
                new List<SidecarBarDto>
                {
                    new("people don't care", 1.0, 3.0, "people", "care", "e@r", true, "SPEAKER_00"),
                    new("hands in the air", 3.5, 5.0, "hands", "air", "e@r", true, "SPEAKER_00"),
                },
                new AnalysisDto(
                    Words: new List<WordDto>
                    {
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
    }

    private static async Task<(Db db, string videoOneId)> SeedAsync(string name)
    {
        var cs = $"Data Source=file:{name}?mode=memory&cache=shared";
        var keep = new SqliteConnection(cs);
        await keep.OpenAsync();
        await Db.InitSchemaAsync(cs);
        var db = new Db(cs);
        var svc = new PipelineService(db, new TwoVideoExtractor(),
            new PhoneticService(NullLogger<PhoneticService>.Instance), NullLogger<PipelineService>.Instance);

        await svc.ProcessUrlAsync("https://youtu.be/VIDEO_ONE", "harry_mack");
        await svc.ProcessUrlAsync("https://youtu.be/VIDEO_TWO", "harry_mack");

        await using var c = db.Open();
        var idCmd = c.CreateCommand();
        idCmd.CommandText = "SELECT id FROM videos WHERE youtube_id = 'vidOne11111'";
        var videoOneId = (string)(await idCmd.ExecuteScalarAsync())!;
        return (db, videoOneId);
    }

    [Fact]
    public async Task GetSongDictionary_ReturnsPerSongGroupsWithMemberWords()
    {
        var (db, videoOneId) = await SeedAsync("memdb_dict_song");
        var controller = new RhymesController(db);

        var result = await controller.GetSongDictionary(videoOneId);
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var dict = Assert.IsType<SongDictionaryDto>(ok.Value);

        Assert.Equal(videoOneId, dict.VideoId);
        var group = Assert.Single(dict.Groups);
        Assert.Equal(0, group.GroupIndex);
        Assert.Equal(120, group.Hue);
        Assert.Equal("e@r", group.Key);
        Assert.Contains("care", group.Words);
        Assert.Contains("air", group.Words);
    }

    [Fact]
    public async Task GetSongDictionary_UnknownVideo_ReturnsNotFound()
    {
        var (db, _) = await SeedAsync("memdb_dict_song_404");
        var controller = new RhymesController(db);

        var result = await controller.GetSongDictionary("nope");
        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    [Fact]
    public async Task GetDictionary_GlobalScope_AggregatesAcrossSongs()
    {
        var (db, _) = await SeedAsync("memdb_dict_global");
        var controller = new RhymesController(db);

        var result = await controller.GetDictionary("global", null);
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var entries = Assert.IsType<List<DictionaryEntryDto>>(ok.Value);

        var care = Assert.Single(entries, e => e.Word == "care");
        Assert.Equal("e@r", care.Key);
        Assert.Equal(2, care.Frequency);   // once per song
        Assert.Equal(2, care.SongCount);   // two distinct songs
        Assert.Contains(entries, e => e.Word == "air");
    }

    [Fact]
    public async Task GetDictionary_ArtistScope_FiltersByArtist()
    {
        var (db, _) = await SeedAsync("memdb_dict_artist");
        var controller = new RhymesController(db);

        var mine = await controller.GetDictionary("artist", "harry_mack");
        var ok = Assert.IsType<OkObjectResult>(mine.Result);
        var entries = Assert.IsType<List<DictionaryEntryDto>>(ok.Value);
        Assert.Contains(entries, e => e.Word == "care" && e.Artist == "harry_mack");

        var other = await controller.GetDictionary("artist", "nobody");
        var okOther = Assert.IsType<OkObjectResult>(other.Result);
        var empty = Assert.IsType<List<DictionaryEntryDto>>(okOther.Value);
        Assert.Empty(empty);
    }

    [Fact]
    public async Task GetWordRhymes_ReturnsEverythingThatRhymes()
    {
        var (db, _) = await SeedAsync("memdb_dict_word");
        var controller = new RhymesController(db);

        var careResult = await controller.GetWordRhymes("care", null);
        var ok = Assert.IsType<OkObjectResult>(careResult.Result);
        var care = Assert.IsType<WordRhymesDto>(ok.Value);
        Assert.Equal("care", care.Word);
        var partner = Assert.Single(care.Rhymes);
        Assert.Equal("air", partner.Word);
        Assert.Equal("e@r", partner.Key);
        Assert.Equal(2, partner.Frequency);

        // Symmetric: "air" rhymes with "care".
        var airResult = await controller.GetWordRhymes("Air", null);
        var okAir = Assert.IsType<OkObjectResult>(airResult.Result);
        var air = Assert.IsType<WordRhymesDto>(okAir.Value);
        Assert.Contains(air.Rhymes, r => r.Word == "care");
    }
}
