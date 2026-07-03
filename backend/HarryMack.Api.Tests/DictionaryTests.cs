using HarryMack.Api.Data;
using HarryMack.Api.Models;
using HarryMack.Api.Services;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

public class DictionaryTests
{
    // Extractor that returns a distinct video per url, each carrying the same
    // "care"/"air" rhyme (canonical key "e@r", one rhyme group). Ingesting both
    // urls must roll the shared rhyme up into the dictionary across both songs.
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

    [Fact]
    public async Task IngestTwoSongs_AggregatesDictionaryFrequencyAndSongCount()
    {
        var cs = "Data Source=file:memdb_dict?mode=memory&cache=shared";
        await using var keep = new SqliteConnection(cs);
        await keep.OpenAsync();
        await Db.InitSchemaAsync(cs);
        var db = new Db(cs);
        var svc = new PipelineService(db, new TwoVideoExtractor(),
            new PhoneticService(NullLogger<PhoneticService>.Instance), NullLogger<PipelineService>.Instance);

        await svc.ProcessUrlAsync("https://youtu.be/VIDEO_ONE", "harry_mack");
        await svc.ProcessUrlAsync("https://youtu.be/VIDEO_TWO", "harry_mack");

        await using var c = db.Open();

        // "care" appears once per song → frequency 2 across 2 distinct songs.
        var care = c.CreateCommand();
        care.CommandText =
            "SELECT frequency, song_count, key, artist FROM rhyme_dictionary WHERE word = 'care'";
        await using (var r = await care.ExecuteReaderAsync())
        {
            Assert.True(await r.ReadAsync());
            Assert.Equal(2L, r.GetInt64(0));   // frequency
            Assert.Equal(2L, r.GetInt64(1));   // song_count
            Assert.Equal("e@r", r.GetString(2));
            Assert.Equal("harry_mack", r.GetString(3));
            Assert.False(await r.ReadAsync()); // one row per (artist, word, key)
        }

        // Co-grouped words yield a directed-normalized pair (air < care).
        var pair = c.CreateCommand();
        pair.CommandText =
            "SELECT word_a, word_b, key, frequency FROM rhyme_dictionary_pairs WHERE artist = 'harry_mack'";
        await using (var r = await pair.ExecuteReaderAsync())
        {
            Assert.True(await r.ReadAsync());
            Assert.Equal("air", r.GetString(0));
            Assert.Equal("care", r.GetString(1));
            Assert.Equal("e@r", r.GetString(2));
            Assert.Equal(2L, r.GetInt64(3)); // pair seen once per song
            Assert.False(await r.ReadAsync());
        }
    }
}
