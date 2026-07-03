using System.Text.Json;
using HarryMack.Api.Data;
using HarryMack.Api.Models;
using Microsoft.AspNetCore.Mvc;

namespace HarryMack.Api.Controllers;

[ApiController]
[Route("api/videos")]
public class VideosController : ControllerBase
{
    private readonly Db _db;

    public VideosController(Db db) => _db = db;

    // GET /api/videos — one summary row per ingested video for the Songs list.
    [HttpGet]
    public async Task<ActionResult<List<VideoSummaryDto>>> GetVideos()
    {
        var result = new List<VideoSummaryDto>();
        await using var conn = _db.Open();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
            SELECT v.id, v.title, v.artist,
                   (SELECT COUNT(*) FROM bars b WHERE b.video_id = v.id) AS bar_count,
                   (SELECT COUNT(*) FROM transcript_words tw WHERE tw.video_id = v.id) AS word_count,
                   ra.density, v.youtube_id
            FROM videos v
            LEFT JOIN rhyme_annotations ra ON ra.video_id = v.id
            ORDER BY v.processed_at DESC, v.title";

        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            result.Add(new VideoSummaryDto(
                reader.GetString(0),
                reader.IsDBNull(1) ? null : reader.GetString(1),
                reader.IsDBNull(2) ? null : reader.GetString(2),
                reader.GetInt32(3),
                reader.GetInt32(4),
                reader.IsDBNull(5) ? null : reader.GetDouble(5),
                reader.IsDBNull(6) ? null : reader.GetString(6)));
        }
        return Ok(result);
    }

    // GET /api/videos/{id}/analysis — full annotated-transcript payload.
    [HttpGet("{id}/analysis")]
    public async Task<ActionResult<VideoAnalysisDto>> GetAnalysis(string id)
    {
        await using var conn = _db.Open();

        // Video summary (also confirms existence).
        VideoSummaryDto? summary = null;
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = @"
                SELECT v.id, v.title, v.artist,
                       (SELECT COUNT(*) FROM bars b WHERE b.video_id = v.id) AS bar_count,
                       (SELECT COUNT(*) FROM transcript_words tw WHERE tw.video_id = v.id) AS word_count,
                       ra.density, v.youtube_id
                FROM videos v
                LEFT JOIN rhyme_annotations ra ON ra.video_id = v.id
                WHERE v.id = $id";
            cmd.Parameters.AddWithValue("$id", id);
            await using var r = await cmd.ExecuteReaderAsync();
            if (await r.ReadAsync())
                summary = new VideoSummaryDto(
                    r.GetString(0),
                    r.IsDBNull(1) ? null : r.GetString(1),
                    r.IsDBNull(2) ? null : r.GetString(2),
                    r.GetInt32(3),
                    r.GetInt32(4),
                    r.IsDBNull(5) ? null : r.GetDouble(5),
                    r.IsDBNull(6) ? null : r.GetString(6));
        }

        if (summary is null)
            return NotFound($"No video with id {id}.");

        // Full transcript words.
        var words = new List<TranscriptWordDto>();
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = @"
                SELECT word_index, text, start_seconds, end_seconds, score, ipa, vowel_seq, delivered_ipa
                FROM transcript_words
                WHERE video_id = $id
                ORDER BY word_index";
            cmd.Parameters.AddWithValue("$id", id);
            await using var r = await cmd.ExecuteReaderAsync();
            while (await r.ReadAsync())
            {
                words.Add(new TranscriptWordDto(
                    r.GetInt32(0),
                    r.GetString(1),
                    r.GetDouble(2),
                    r.GetDouble(3),
                    r.IsDBNull(4) ? null : r.GetDouble(4),
                    r.IsDBNull(5) ? null : r.GetString(5),
                    r.IsDBNull(6) ? null : JsonSerializer.Deserialize<List<string>>(r.GetString(6)),
                    r.IsDBNull(7) ? null : r.GetString(7)));
            }
        }

        // Rhyme events.
        var events = new List<AnalysisEventDto>();
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = @"
                SELECT word_index, bar_index, intra_bar_index,
                       canonical_key, delivered_key, detector, group_index, stress
                FROM rhyme_events
                WHERE video_id = $id
                ORDER BY word_index";
            cmd.Parameters.AddWithValue("$id", id);
            await using var r = await cmd.ExecuteReaderAsync();
            while (await r.ReadAsync())
            {
                events.Add(new AnalysisEventDto(
                    r.GetInt32(0),
                    r.GetInt32(1),
                    r.GetInt32(2),
                    r.IsDBNull(3) ? null : r.GetString(3),
                    r.IsDBNull(4) ? null : r.GetString(4),
                    r.IsDBNull(5) ? null : r.GetString(5),
                    r.IsDBNull(6) ? null : r.GetInt32(6),
                    r.IsDBNull(7) ? 0 : r.GetInt32(7)));
            }
        }

        // Rhyme groups.
        var groups = new List<AnalysisGroupDto>();
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = @"
                SELECT group_index, hue, size, key
                FROM rhyme_groups
                WHERE video_id = $id
                ORDER BY group_index";
            cmd.Parameters.AddWithValue("$id", id);
            await using var r = await cmd.ExecuteReaderAsync();
            while (await r.ReadAsync())
            {
                groups.Add(new AnalysisGroupDto(
                    r.GetInt32(0),
                    r.IsDBNull(1) ? 0 : r.GetInt32(1),
                    r.IsDBNull(2) ? 0 : r.GetInt32(2),
                    r.IsDBNull(3) ? null : r.GetString(3)));
            }
        }

        // Scheme + density from the annotation row.
        var scheme = new Dictionary<int, string>();
        double density = 0;
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = "SELECT scheme_json, density FROM rhyme_annotations WHERE video_id = $id";
            cmd.Parameters.AddWithValue("$id", id);
            await using var r = await cmd.ExecuteReaderAsync();
            if (await r.ReadAsync())
            {
                if (!r.IsDBNull(0))
                    scheme = JsonSerializer.Deserialize<Dictionary<int, string>>(r.GetString(0))
                             ?? new Dictionary<int, string>();
                density = r.IsDBNull(1) ? 0 : r.GetDouble(1);
            }
        }

        return Ok(new VideoAnalysisDto(summary, words, events, groups, scheme, density));
    }
}
