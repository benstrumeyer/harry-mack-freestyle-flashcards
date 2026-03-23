using System.Text.Json;
using HarryMack.Api.Models;
using OpenAI.Chat;

namespace HarryMack.Api.Services;

public class LlmExtractor
{
    private readonly ChatClient _chat;
    private readonly ILogger<LlmExtractor> _logger;
    private readonly SemaphoreSlim _llmSem = new(1); // serialize Gemini calls to avoid RPM limits

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNameCaseInsensitive = true
    };

    public LlmExtractor(ChatClient chat, ILogger<LlmExtractor> logger)
    {
        _chat = chat;
        _logger = logger;
    }

    private const int BatchSize = 15; // keep batches small so LLM output doesn't get truncated

    public async Task<List<ExtractedBar>> ExtractAsync(List<RawLine> lines)
    {
        var results = new List<ExtractedBar>();
        for (int i = 0; i < lines.Count; i += BatchSize)
        {
            var batch = lines.Skip(i).Take(BatchSize).ToList();
            _logger.LogInformation("Extracting batch {start}-{end} of {total}", i, Math.Min(i + BatchSize, lines.Count), lines.Count);
            var extracted = await ExtractBatchAsync(batch);
            results.AddRange(extracted);
        }
        return results;
    }

    private async Task<List<ExtractedBar>> ExtractBatchAsync(List<RawLine> batch)
    {
        await _llmSem.WaitAsync();
        try
        {
            var linesText = string.Join("\n", batch.Select(l =>
            {
                if (l.TimestampSeconds.HasValue)
                {
                    int min = (int)(l.TimestampSeconds.Value / 60);
                    int sec = (int)(l.TimestampSeconds.Value % 60);
                    return $"[{min}:{sec:D2}] {l.Text}";
                }
                return l.Text;
            }));

            const string systemPrompt =
                "You are a freestyle rap analyst. Given timestamped lines from a Harry Mack freestyle rap transcript, " +
                "classify each line and extract patterns. Return a JSON array — one object per line.";

            var userPrompt = $@"Lines:
{linesText}

IMPORTANT: Each input line may contain MULTIPLE rap bars run together. You MUST split them into individual bars first.

Return a JSON array — one object per INDIVIDUAL BAR (not per input line). A single input line may produce many entries.

[
  {{
    ""index"": 0,
    ""bar_text"": ""the exact verbatim text of this single bar"",
    ""is_freestyle"": true,
    ""opener"": ""verbatim prefix of bar_text"",
    ""rhyme_words"": [""word1"", ""word2""]
  }}
]

Rules:
- index: the index of the INPUT LINE this bar came from (multiple bars can share the same index).
- bar_text: the EXACT verbatim text of ONE bar, copied character-for-character from the input. A bar is typically one complete thought/sentence with a rhyme at the end (6-20 words). Split at sentence boundaries, natural pauses, or where the rhyme scheme resets. Do NOT merge multiple bars into one entry.
- is_freestyle: true only for actual rap bars with rhythm and rhyme intent. False for filler (""Yeah"", ""Uh"", ""Okay""), crowd talk, questions, reactions, or non-rap speech.
- opener: a VERBATIM prefix of bar_text — the reusable sentence-starter template (2-7 words). Must be an exact substring starting at position 0 of bar_text. Stop before topic-specific content: at the first comma, or just before a comparative/relative word (""like"", ""as"", ""that"") or conjunction that starts the completing content. Examples: ""Every time I rhyme"" from ""Every time I rhyme, I cut like a surgeon"", ""I'mma flip em in reverse"" from ""I'mma flip em in reverse like your blue trucker hat"", ""Mac off the top"" from ""Mac off the top of this"". Never start with a mid-sentence connective (""and"", ""but"", ""so"", ""'cause"", ""cuz"", ""because"", ""then""). null if not freestyle or no clear reusable opener.
- rhyme_words: words from THIS SINGLE bar_text that phonetically rhyme with each other (same vowel sound + same following consonants from last stressed syllable). Empty array if none.

Respond with ONLY the raw JSON array, no markdown, no explanation.";

            var messages = new List<ChatMessage>
            {
                new SystemChatMessage(systemPrompt),
                new UserChatMessage(userPrompt)
            };

            ChatCompletion completion = await CompleteChatWithRetryAsync(messages);
            if (completion.Content == null || completion.Content.Count == 0) return [];
            var json = completion.Content[0].Text.Trim();

            // Strip markdown code fences if present
            if (json.StartsWith("```"))
            {
                var firstNewline = json.IndexOf('\n');
                if (firstNewline >= 0) json = json[(firstNewline + 1)..];
                var lastFence = json.LastIndexOf("```");
                if (lastFence >= 0) json = json[..lastFence];
                json = json.Trim();
            }

            _logger.LogInformation("LLM response ({len} chars): {json}", json.Length, json.Length > 2000 ? json[..2000] + "..." : json);
            var extracted = JsonSerializer.Deserialize<List<ExtractedBar>>(json, JsonOpts);
            return extracted ?? [];
        }
        finally
        {
            _llmSem.Release();
        }
    }

    private async Task<ChatCompletion> CompleteChatWithRetryAsync(List<ChatMessage> messages)
    {
        int delayMs = 5000;
        for (int attempt = 0; attempt < 5; attempt++)
        {
            try
            {
                return await _chat.CompleteChatAsync(messages);
            }
            catch (System.ClientModel.ClientResultException ex) when (ex.Status == 429)
            {
                if (attempt == 4) throw;
                await Task.Delay(delayMs);
                delayMs *= 2;
            }
        }
        throw new InvalidOperationException("Unreachable");
    }
}
