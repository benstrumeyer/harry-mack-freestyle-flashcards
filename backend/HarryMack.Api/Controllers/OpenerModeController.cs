using HarryMack.Api.Data;
using HarryMack.Api.Models;
using HarryMack.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace HarryMack.Api.Controllers;

// Rhyme Game — opener mode (spec §7b / Spec 2). Present an opener; the player inputs
// rhymes; the app validates each against the rhyme dictionary + the opener's source-bar
// target rhyme sound (espeak canonical + delivered keys).
[ApiController]
[Route("api/game/opener")]
public class OpenerModeController : ControllerBase
{
    private readonly Db _db;
    private readonly PhoneticService _phonetics;

    public OpenerModeController(Db db, PhoneticService phonetics)
    {
        _db = db;
        _phonetics = phonetics;
    }

    // GET /api/game/opener/{openerId}
    // Target rhyme sound = the opener's source-bar rhyme word (opener_sources →
    // rhyme_word_bars → rhyme_words); valid words = rhyme_dictionary entries sharing its key.
    [HttpGet("{openerId}")]
    public async Task<ActionResult<OpenerChallengeDto>> GetChallenge(string openerId)
    {
        await using var conn = _db.Open();

        // Opener exists?
        string openerText;
        {
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT text FROM openers WHERE id = $id";
            cmd.Parameters.AddWithValue("$id", openerId);
            if (await cmd.ExecuteScalarAsync() is not string t)
                return NotFound($"No opener with id {openerId}.");
            openerText = t;
        }

        // Target rhyme word + canonical key from the source bar's rhyme word.
        string? targetWord = null, targetKey = null;
        {
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = @"
                SELECT rw.word, rw.phonemes
                FROM opener_sources os
                JOIN rhyme_word_bars rwb ON rwb.bar_id = os.bar_id
                JOIN rhyme_words rw ON rw.id = rwb.word_id
                WHERE os.opener_id = $id
                ORDER BY rw.frequency DESC, rw.word
                LIMIT 1";
            cmd.Parameters.AddWithValue("$id", openerId);
            await using var r = await cmd.ExecuteReaderAsync();
            if (await r.ReadAsync())
            {
                targetWord = r.GetString(0);
                targetKey = r.IsDBNull(1) ? null : r.GetString(1);
            }
        }

        // Delivered key of that bar's end rhyme (if the analysis stage has run for the song).
        string? targetDeliveredKey = null;
        if (!string.IsNullOrEmpty(targetKey))
        {
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = @"
                SELECT e.delivered_key
                FROM opener_sources os
                JOIN bars b ON b.id = os.bar_id
                JOIN rhyme_events e ON e.video_id = b.video_id AND e.bar_index = b.bar_index
                WHERE os.opener_id = $id AND e.canonical_key = $ck AND e.delivered_key IS NOT NULL
                ORDER BY e.intra_bar_index DESC
                LIMIT 1";
            cmd.Parameters.AddWithValue("$id", openerId);
            cmd.Parameters.AddWithValue("$ck", targetKey);
            if (await cmd.ExecuteScalarAsync() is string dk)
                targetDeliveredKey = dk;
        }

        // Valid rhyming words = dictionary entries sharing the canonical key.
        var validWords = new List<string>();
        if (!string.IsNullOrEmpty(targetKey))
        {
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = @"
                SELECT DISTINCT word FROM rhyme_dictionary
                WHERE key = $ck AND word IS NOT NULL AND word <> ''
                ORDER BY word";
            cmd.Parameters.AddWithValue("$ck", targetKey);
            await using var r = await cmd.ExecuteReaderAsync();
            while (await r.ReadAsync())
                validWords.Add(r.GetString(0));
        }

        return Ok(new OpenerChallengeDto(
            openerId, openerText, targetWord, targetKey, targetDeliveredKey, validWords));
    }

    // POST /api/game/opener/{openerId}/validate  body: { "word": "..." }
    // Valid when the submitted word rhymes with the target: espeak canonical tail matching
    // the target's canonical or delivered key (or a rhyme of the actual target word), or the
    // word being a known dictionary rhyme for that key.
    [HttpPost("{openerId}/validate")]
    public async Task<ActionResult<OpenerValidationDto>> Validate(
        string openerId, [FromBody] OpenerGuessRequest req)
    {
        var word = req?.Word?.Trim().ToLowerInvariant() ?? "";
        if (string.IsNullOrEmpty(word))
            return BadRequest("A word is required.");

        var challengeResult = await GetChallenge(openerId);
        if (challengeResult.Result is NotFoundObjectResult nf)
            return NotFound(nf.Value);
        var challenge = (OpenerChallengeDto)((OkObjectResult)challengeResult.Result!).Value!;

        var submittedKey = await _phonetics.GetRhymeTailAsync(word);

        string? matchedOn = null;
        if (challenge.TargetKey != null && submittedKey != null && submittedKey == challenge.TargetKey)
            matchedOn = "canonical";
        else if (challenge.TargetWord != null && await _phonetics.RhymesAsync(word, challenge.TargetWord))
            matchedOn = "canonical";
        else if (challenge.TargetDeliveredKey != null && submittedKey != null && submittedKey == challenge.TargetDeliveredKey)
            matchedOn = "delivered";
        else if (challenge.ValidWords.Contains(word))
            matchedOn = "dictionary";

        return Ok(new OpenerValidationDto(
            matchedOn != null, word, submittedKey, challenge.TargetKey, matchedOn));
    }
}
