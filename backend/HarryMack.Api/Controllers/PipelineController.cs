using HarryMack.Api.Models;
using HarryMack.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace HarryMack.Api.Controllers;

[ApiController]
[Route("api/pipeline")]
public class PipelineController : ControllerBase
{
    private readonly PipelineService _pipeline;
    private readonly IServiceScopeFactory _scopeFactory;

    public PipelineController(PipelineService pipeline, IServiceScopeFactory scopeFactory)
    {
        _pipeline = pipeline;
        _scopeFactory = scopeFactory;
    }

    [HttpPost("process-url")]
    public async Task<ActionResult<PipelineResultDto>> ProcessUrl([FromBody] ProcessUrlRequest req)
    {
        var result = await _pipeline.ProcessUrlAsync(req.Url);
        return Ok(result);
    }

    [HttpPost("process-playlist")]
    public async Task<ActionResult<PlaylistQueuedDto>> ProcessPlaylist([FromBody] ProcessPlaylistRequest req)
    {
        var videoUrls = await _pipeline.GetPlaylistVideoUrlsAsync(req.Url);
        if (videoUrls.Count == 0)
            return Ok(new PlaylistQueuedDto("No videos found in playlist.", 0));

        // Fire and forget — survives frontend refreshes, runs 3 videos concurrently
        _ = Task.Run(async () =>
        {
            await using var scope = _scopeFactory.CreateAsyncScope();
            var pipeline = scope.ServiceProvider.GetRequiredService<PipelineService>();
            await pipeline.ProcessPlaylistVideosAsync(videoUrls);
        });

        return Accepted(new PlaylistQueuedDto($"Queued {videoUrls.Count} videos for background processing.", videoUrls.Count));
    }

    [HttpPost("parse-local")]
    public async Task<ActionResult<PipelineResultDto>> ParseLocal()
    {
        var result = await _pipeline.ProcessLocalAsync();
        return Ok(result);
    }

    [HttpDelete("reset")]
    public async Task<IActionResult> Reset()
    {
        await _pipeline.ResetAllAsync();
        return Ok(new { message = "All data reset." });
    }

    [HttpGet("status")]
    public async Task<ActionResult<List<VideoStatusDto>>> GetStatus()
    {
        var status = await _pipeline.GetStatusAsync();
        return Ok(status);
    }

    [HttpPost("validate-rhymes")]
    public async Task<ActionResult<ValidateRhymesResultDto>> ValidateRhymes()
    {
        var (removed, total) = await _pipeline.ValidateRhymePairsAsync();
        return Ok(new ValidateRhymesResultDto($"Removed {removed} of {total} rhyme pairs that failed phonetic validation.", removed, total));
    }
}
