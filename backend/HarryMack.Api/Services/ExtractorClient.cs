using System.Net.Http.Json;
using System.Text.Json;
using HarryMack.Api.Models;

namespace HarryMack.Api.Services;

public interface IExtractorClient
{
    Task<ExtractResultDto> ExtractAsync(string url, string artist, CancellationToken ct);

    // Re-run only the analyze stage for a URL (sidecar POST /analyze). Default throws so
    // existing test doubles that only fake extraction keep compiling.
    Task<AnalysisDto> AnalyzeAsync(string url, CancellationToken ct) =>
        throw new NotImplementedException();
}

public class ExtractorClient(HttpClient http) : IExtractorClient
{
    public int PollDelayMs { get; set; } = 1500;

    // The sidecar (FastAPI/Pydantic) emits snake_case; bind accordingly.
    private static readonly JsonSerializerOptions J = new(JsonSerializerDefaults.Web)
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower
    };

    public async Task<ExtractResultDto> ExtractAsync(string url, string artist, CancellationToken ct)
    {
        var enq = await http.PostAsJsonAsync("/extract",
            new { url, artist, source_type = "freestyle" }, ct);
        return await PollAsync(enq, ct);
    }

    public async Task<AnalysisDto> AnalyzeAsync(string url, CancellationToken ct)
    {
        var enq = await http.PostAsJsonAsync("/analyze",
            new { url, source_type = "freestyle" }, ct);
        var result = await PollAsync(enq, ct);
        return result.Analysis
            ?? throw new InvalidOperationException("analyze job returned no analysis");
    }

    // Poll a just-enqueued sidecar job to completion and return its ExtractResult.
    private async Task<ExtractResultDto> PollAsync(HttpResponseMessage enq, CancellationToken ct)
    {
        enq.EnsureSuccessStatusCode();
        var jobId = (await enq.Content.ReadFromJsonAsync<JsonElement>(cancellationToken: ct))
            .GetProperty("job_id").GetString()!;
        while (true)
        {
            var job = await http.GetFromJsonAsync<JobDto>($"/jobs/{jobId}", J, ct)
                ?? throw new InvalidOperationException("null job");
            if (job.Status == "failed")
                throw new InvalidOperationException($"extractor failed: {job.Error}");
            if (job.Status == "done")
                return job.Result ?? throw new InvalidOperationException("done with no result");
            await Task.Delay(PollDelayMs, ct);
        }
    }
}
