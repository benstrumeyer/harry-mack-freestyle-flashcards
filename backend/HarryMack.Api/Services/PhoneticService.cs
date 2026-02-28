using System.Collections.Concurrent;
using System.Diagnostics;

namespace HarryMack.Api.Services;

public class PhoneticService
{
    // X-SAMPA vowel phonemes produced by espeak-ng -x
    private static readonly HashSet<string> XSampaVowels = new(StringComparer.Ordinal)
    {
        "a", "e", "i", "o", "u",
        "A", "E", "I", "O", "U",
        "V", "Q", "@", "3", "{",
        "aI", "aU", "OI", "eI", "@U",
        "i:", "u:", "A:", "O:", "3:", "a:",
        "E@", "I@", "U@", "e@",
        "Oi", "Ei", "ai", "au", "oi",
    };

    private readonly ConcurrentDictionary<string, string?> _cache = new(StringComparer.OrdinalIgnoreCase);
    private readonly ILogger<PhoneticService> _logger;

    public PhoneticService(ILogger<PhoneticService> logger) => _logger = logger;

    /// <summary>
    /// Returns the rhyme tail: phonemes from the last stressed vowel to the end.
    /// E.g. "side" → "aI d", "blind" → "aI n d", "ride" → "aI d"
    /// </summary>
    public async Task<string?> GetRhymeTailAsync(string word)
    {
        if (_cache.TryGetValue(word, out var cached)) return cached;

        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = "espeak-ng",
                Arguments = $"-q -x \"{word.ToLowerInvariant()}\"",
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false
            };

            using var proc = Process.Start(psi);
            if (proc == null) return null;

            var output = (await proc.StandardOutput.ReadToEndAsync()).Trim();
            await proc.WaitForExitAsync();

            var tail = ParseRhymeTail(output);
            _cache[word] = tail;
            return tail;
        }
        catch (Exception ex)
        {
            _logger.LogWarning("espeak-ng failed for '{word}': {msg}", word, ex.Message);
            return null;
        }
    }

    /// <summary>Precompute rhyme tails for a batch of words concurrently.</summary>
    public async Task PrefetchAsync(IEnumerable<string> words)
    {
        using var sem = new SemaphoreSlim(8);
        var tasks = words
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Where(w => !_cache.ContainsKey(w))
            .Select(async w =>
            {
                await sem.WaitAsync();
                try { await GetRhymeTailAsync(w); }
                finally { sem.Release(); }
            });
        await Task.WhenAll(tasks);
    }

    public async Task<bool> RhymesAsync(string wordA, string wordB)
    {
        if (string.Equals(wordA, wordB, StringComparison.OrdinalIgnoreCase)) return true;
        var tailA = await GetRhymeTailAsync(wordA);
        var tailB = await GetRhymeTailAsync(wordB);
        return tailA != null && tailB != null && tailA == tailB;
    }

    private static string? ParseRhymeTail(string espeakOutput)
    {
        if (string.IsNullOrWhiteSpace(espeakOutput)) return null;

        // espeak-ng -x outputs like: "s aI d " or "'saId" depending on version
        // Normalise: strip stress markers, split on whitespace
        var raw = espeakOutput
            .Replace("'", " ")
            .Replace(",", " ")
            .Replace("\n", " ")
            .Trim();

        var phonemes = raw
            .Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(p => !string.IsNullOrEmpty(p))
            .ToList();

        if (phonemes.Count == 0) return null;

        // Find the index of the last vowel phoneme
        int lastVowelIdx = -1;
        for (int i = phonemes.Count - 1; i >= 0; i--)
        {
            if (XSampaVowels.Contains(phonemes[i]))
            {
                lastVowelIdx = i;
                break;
            }
        }

        if (lastVowelIdx < 0) return null;

        return string.Join(" ", phonemes.Skip(lastVowelIdx));
    }
}
