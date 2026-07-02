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
}
