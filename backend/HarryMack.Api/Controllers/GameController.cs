using HarryMack.Api.Data;
using Microsoft.AspNetCore.Mvc;

namespace HarryMack.Api.Controllers;

[ApiController]
[Route("api/game")]
public class GameController : ControllerBase
{
    private readonly Db _db;

    public GameController(Db db) => _db = db;

    private static int Syllables(string w)
    {
        int n = 0; bool prevVowel = false;
        foreach (var ch in w.ToLowerInvariant())
        {
            bool v = "aeiouy".IndexOf(ch) >= 0;
            if (v && !prevVowel) n++;
            prevVowel = v;
        }
        return Math.Max(1, n);
    }

    // Difficulty → inclusive syllable range applied to the word bank. Unknown/empty = no filter.
    private static (int min, int max)? DifficultyRange(string? difficulty) =>
        (difficulty?.Trim().ToLowerInvariant()) switch
        {
            "easy"   => (1, 2),
            "medium" => (2, 3),
            "hard"   => (3, 99),
            _        => null,
        };

    // GET /api/game/wordlist/{artist}?scope=song|artist|global&videoId=&difficulty=
    // Shape consumed by the Rhyme Game UI (unchanged, backward-compatible):
    //   { "words": [[word, syllables, rhymeKey, inCorpus], ...], "openers": [text, ...] }
    // rhymeKey = the canonical espeak X-SAMPA tail (shared key = perfect rhyme).
    // Words are now sourced from rhyme_dictionary (the analysis-derived corpus):
    //   scope=artist (DEFAULT) → this artist's dictionary entries — the legacy contract.
    //   scope=global           → every artist's entries rolled up per (word, key) — a larger bank.
    //   scope=song&videoId=…   → just that video's rhyme-group words.
    // `difficulty` optionally narrows the bank to a syllable range; omitted = full bank.
    [HttpGet("wordlist/{artist}")]
    public async Task<ActionResult<object>> GetWordList(
        string artist,
        [FromQuery] string scope = "artist",
        [FromQuery] string? videoId = null,
        [FromQuery] string? difficulty = null)
    {
        var words = new List<object[]>();
        var openers = new List<string>();
        var range = DifficultyRange(difficulty);
        await using var conn = _db.Open();

        void Add(string word, string? key)
        {
            if (string.IsNullOrEmpty(key)) return;
            var syl = Syllables(word);
            if (range is { } r && (syl < r.min || syl > r.max)) return;
            words.Add(new object[] { word, syl, key, 1 });
        }

        await using (var cmd = conn.CreateCommand())
        {
            if (string.Equals(scope, "global", StringComparison.OrdinalIgnoreCase))
            {
                // Roll every artist's dictionary up per (word, key) — the widest bank.
                cmd.CommandText = @"SELECT word, key FROM rhyme_dictionary
                                    WHERE key IS NOT NULL AND key <> ''
                                    GROUP BY word, key
                                    ORDER BY SUM(frequency) DESC, word";
            }
            else if (string.Equals(scope, "song", StringComparison.OrdinalIgnoreCase))
            {
                // Just the words that appear in this video's rhyme groups.
                cmd.CommandText = @"SELECT DISTINCT lower(tw.text) AS word, e.canonical_key AS key
                                    FROM rhyme_events e
                                    JOIN transcript_words tw
                                      ON tw.video_id = e.video_id AND tw.word_index = e.word_index
                                    WHERE e.video_id = $videoId
                                      AND e.canonical_key IS NOT NULL AND e.canonical_key <> ''
                                    ORDER BY word";
                cmd.Parameters.AddWithValue("$videoId", (object?)videoId ?? DBNull.Value);
            }
            else
            {
                // Default: this artist's dictionary — the legacy game contract.
                cmd.CommandText = @"SELECT word, key FROM rhyme_dictionary
                                    WHERE artist = $artist AND key IS NOT NULL AND key <> ''
                                    ORDER BY frequency DESC, word";
                cmd.Parameters.AddWithValue("$artist", artist);
            }

            await using var reader = await cmd.ExecuteReaderAsync();
            while (await reader.ReadAsync())
                Add(reader.GetString(0), reader.IsDBNull(1) ? null : reader.GetString(1));
        }

        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = "SELECT text FROM openers ORDER BY frequency DESC LIMIT 24";
            await using var reader = await cmd.ExecuteReaderAsync();
            while (await reader.ReadAsync())
                openers.Add(reader.GetString(0));
        }

        return Ok(new { words, openers });
    }
}
