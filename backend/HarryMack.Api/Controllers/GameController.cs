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

    // GET /api/game/wordlist/{artist}
    // Shape consumed by the Rhyme Game UI:
    //   { "words": [[word, syllables, rhymeKey, inCorpus], ...], "openers": [text, ...] }
    // rhymeKey = the espeak X-SAMPA tail stored in rhyme_words.phonemes (shared key = perfect rhyme).
    // NOTE: rhyme_words/openers are not yet artist-scoped (single-artist corpus today); `artist` is
    // accepted for forward-compat and to lock the contract before the multi-artist scoping fix lands.
    [HttpGet("wordlist/{artist}")]
    public async Task<ActionResult<object>> GetWordList(string artist)
    {
        var words = new List<object[]>();
        var openers = new List<string>();
        await using var conn = _db.Open();

        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = @"SELECT word, phonemes FROM rhyme_words
                                WHERE phonemes IS NOT NULL AND phonemes <> ''
                                ORDER BY frequency DESC";
            await using var reader = await cmd.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                var word = reader.GetString(0);
                var key = reader.GetString(1);
                words.Add(new object[] { word, Syllables(word), key, 1 });
            }
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
