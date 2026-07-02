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
    private static int _playlistRunning = 0; // guard against double-submission

    public PipelineController(PipelineService pipeline, IServiceScopeFactory scopeFactory)
    {
        _pipeline = pipeline;
        _scopeFactory = scopeFactory;
    }

    [HttpPost("process-url")]
    public async Task<ActionResult<PipelineResultDto>> ProcessUrl([FromBody] ProcessUrlRequest req)
    {
        var result = await _pipeline.ProcessUrlAsync(req.Url, "harry_mack");
        return Ok(result);
    }

    [HttpPost("process-playlist")]
    public async Task<ActionResult<PlaylistQueuedDto>> ProcessPlaylist([FromBody] ProcessPlaylistRequest req)
    {
        if (Interlocked.CompareExchange(ref _playlistRunning, 1, 0) != 0)
            return Conflict(new PlaylistQueuedDto("A playlist is already being processed. Wait for it to finish.", 0));

        var videoUrls = await _pipeline.GetPlaylistVideoUrlsAsync(req.Url);
        if (videoUrls.Count == 0)
        {
            Interlocked.Exchange(ref _playlistRunning, 0);
            return Ok(new PlaylistQueuedDto("No videos found in playlist.", 0));
        }

        _ = Task.Run(async () =>
        {
            try
            {
                await using var scope = _scopeFactory.CreateAsyncScope();
                var pipeline = scope.ServiceProvider.GetRequiredService<PipelineService>();
                await pipeline.ProcessPlaylistVideosAsync(videoUrls, "harry_mack");
            }
            finally
            {
                Interlocked.Exchange(ref _playlistRunning, 0);
            }
        });

        return Accepted(new PlaylistQueuedDto($"Queued {videoUrls.Count} videos for background processing.", videoUrls.Count));
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
