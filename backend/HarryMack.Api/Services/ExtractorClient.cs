using System.Net.Http.Json;
using System.Text.Json;
using HarryMack.Api.Models;

namespace HarryMack.Api.Services;

public class ExtractorClient(HttpClient http)
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
