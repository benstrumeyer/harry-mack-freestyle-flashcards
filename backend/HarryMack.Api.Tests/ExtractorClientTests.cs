using System.Net;
using System.Text;
using HarryMack.Api.Services;
using Xunit;

public class ExtractorClientTests
{
    class StubHandler : HttpMessageHandler
    {
        int _polls;
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage r, CancellationToken ct)
        {
            // The real sidecar (FastAPI/Pydantic) emits snake_case.
            string body = r.RequestUri!.AbsolutePath.EndsWith("/extract")
                ? "{\"job_id\":\"j1\"}"
                : (_polls++ == 0
                    ? "{\"status\":\"running\",\"stage\":\"transcribe\",\"progress\":0.6,\"error\":null,\"result\":null}"
                    : "{\"status\":\"done\",\"stage\":\"done\",\"progress\":1.0,\"error\":null,\"result\":{\"video\":{\"youtube_id\":\"x\",\"title\":\"t\",\"duration_seconds\":1.0,\"url\":\"u\"},\"bars\":[{\"text\":\"people don't care\",\"start\":0,\"end\":1,\"opener\":\"people\",\"rhyme_word\":\"care\",\"rhyme_key\":\"e r\",\"is_freestyle\":true,\"speaker\":null}]}}");
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
                { Content = new StringContent(body, Encoding.UTF8, "application/json") });
        }
    }

    [Fact]
    public async Task ExtractAsync_PollsToDone_ReturnsBars()
    {
        var http = new HttpClient(new StubHandler()) { BaseAddress = new Uri("http://localhost:8900") };
        var client = new ExtractorClient(http) { PollDelayMs = 0 };
        var res = await client.ExtractAsync("u", "harry_mack", default);
        Assert.Single(res.Bars);
        Assert.Equal("care", res.Bars[0].RhymeWord);
    }

    // Sidecar emits an `analysis` block alongside `bars` (snake_case Pydantic).
    class AnalysisStubHandler : HttpMessageHandler
    {
        int _polls;
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage r, CancellationToken ct)
        {
            string body = r.RequestUri!.AbsolutePath.EndsWith("/extract")
                ? "{\"job_id\":\"j1\"}"
                : (_polls++ == 0
                    ? "{\"status\":\"running\",\"stage\":\"analyze\",\"progress\":0.6,\"error\":null,\"result\":null}"
                    : "{\"status\":\"done\",\"stage\":\"done\",\"progress\":1.0,\"error\":null,\"result\":{" +
                      "\"video\":{\"youtube_id\":\"x\",\"title\":\"t\",\"duration_seconds\":1.0,\"url\":\"u\"}," +
                      "\"bars\":[{\"text\":\"i explore\",\"start\":0,\"end\":0.5,\"opener\":\"i\",\"rhyme_word\":\"explore\",\"rhyme_key\":\"o@\",\"is_freestyle\":true,\"speaker\":null}]," +
                      "\"analysis\":{" +
                        "\"words\":[" +
                          "{\"text\":\"i\",\"start\":0.0,\"end\":0.1,\"score\":1.0,\"speaker\":null}," +
                          "{\"text\":\"explore\",\"start\":0.1,\"end\":0.5,\"score\":0.9,\"speaker\":null}," +
                          "{\"text\":\"give\",\"start\":1.0,\"end\":1.2,\"score\":1.0,\"speaker\":null}," +
                          "{\"text\":\"more\",\"start\":1.2,\"end\":1.5,\"score\":1.0,\"speaker\":null}]," +
                        "\"events\":[" +
                          "{\"word_index\":1,\"text\":\"explore\",\"bar_index\":0,\"intra_bar_index\":1,\"start\":0.1,\"end\":0.5,\"canonical_key\":\"o@\",\"delivered_key\":\"or\",\"vowel_seq\":[\"o@\"],\"stress\":1,\"detector\":\"perfect-end\",\"group_index\":0}," +
                          "{\"word_index\":3,\"text\":\"more\",\"bar_index\":1,\"intra_bar_index\":1,\"start\":1.2,\"end\":1.5,\"canonical_key\":\"o@\",\"delivered_key\":\"or\",\"vowel_seq\":[\"o@\"],\"stress\":1,\"detector\":\"perfect-end\",\"group_index\":0}]," +
                        "\"groups\":[{\"group_index\":0,\"hue\":0,\"word_indices\":[1,3],\"key\":\"o@\"}]," +
                        "\"bar_labels\":{\"0\":\"perfect-end\",\"1\":\"perfect-end\"}," +
                        "\"scheme\":{\"0\":\"AABB\"}," +
                        "\"density\":0.42," +
                        "\"detector_version\":1}}}");
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
                { Content = new StringContent(body, Encoding.UTF8, "application/json") });
        }
    }

    [Fact]
    public async Task ExtractAsync_ParsesAnalysisBlock()
    {
        var http = new HttpClient(new AnalysisStubHandler()) { BaseAddress = new Uri("http://localhost:8900") };
        var client = new ExtractorClient(http) { PollDelayMs = 0 };
        var res = await client.ExtractAsync("u", "harry_mack", default);

        Assert.NotNull(res.Analysis);
        var a = res.Analysis!;
        Assert.Equal(1, a.DetectorVersion);
        Assert.Equal(0.42, a.Density, 3);
        Assert.Equal(4, a.Words.Count);
        Assert.Equal("explore", a.Words[1].Text);
        Assert.Equal(0.9, a.Words[1].Score, 3);
        Assert.Equal(2, a.Events.Count);
        Assert.Equal(3, a.Events[1].WordIndex);
        Assert.Equal(1, a.Events[1].IntraBarIndex);
        Assert.Equal("o@", a.Events[0].CanonicalKey);
        Assert.Equal("or", a.Events[0].DeliveredKey);
        Assert.Equal(new List<string> { "o@" }, a.Events[0].VowelSeq);
        Assert.Equal(1, a.Events[0].Stress);
        Assert.Equal("perfect-end", a.Events[0].Detector);
        Assert.Equal(0, a.Events[0].GroupIndex);
        Assert.Single(a.Groups);
        Assert.Equal(new List<int> { 1, 3 }, a.Groups[0].WordIndices);
        Assert.Equal("perfect-end", a.BarLabels[1]);
        Assert.Equal("AABB", a.Scheme[0]);
    }
}
