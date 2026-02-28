using System.Text.Json;
using HarryMack.Api.Models;
using OpenAI.Chat;

namespace HarryMack.Api.Services;

public class LlmExtractor
{
    private readonly ChatClient _chat;
    private readonly SemaphoreSlim _llmSem = new(1); // serialize Gemini calls to avoid RPM limits

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNameCaseInsensitive = true
    };

    public LlmExtractor(ChatClient chat) => _chat = chat;

    public Task<List<ExtractedBar>> ExtractAsync(List<RawLine> lines) => ExtractBatchAsync(lines);

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

Return JSON array (one entry per line, same order):
[
  {{
    ""index"": 0,
    ""is_freestyle"": true,
    ""opener"": ""the full natural opening phrase of the bar"",
    ""rhyme_words"": [""word1"", ""word2""]
  }}
]

Rules:
- is_freestyle: true only for actual rap bars with rhythm and rhyme intent. False for filler (""Yeah"", ""Uh"", ""Okay""), crowd talk, questions, reactions, or non-rap speech.
- opener: the VERBATIM first clause of the bar — the reusable template portion before topic-specific content begins. Stop at the first comma, or just before a comparative/relative word (""like"", ""as"", ""that"") or conjunction (""and"", ""but"") that starts the completing/specific content. Examples: ""every time I'm rhymin"" (stops before comma), ""I'mma flip em in reverse"" (stops before ""like your blue trucker hat""), ""Mack coming off of the top"" (stops before ""and I do it well""), ""H Mack, I break it down with"" (the setup phrase). Skip a leading standalone filler word (""yeah"", ""uh"", ""okay"", ""alright"") only if it is the single first word. Never start with a mid-sentence connective (""and"", ""but"", ""so"", ""'cause"", ""cuz"", ""because"", ""then""). null if not freestyle.
- rhyme_words: JSON array of words from this line that PHONETICALLY rhyme with each other. Two words rhyme only if they share the SAME vowel sound AND the same following consonants from the last stressed syllable (e.g. side/ride/guide rhyme, real/feel/appeal rhyme, flames/games/names rhyme). Words that merely share a theme, alliterate, or have a similar-sounding vowel but different ending do NOT count (e.g. ""side"" does NOT rhyme with ""blind"", ""still"", ""game"", ""real"", or ""live""). Include end rhymes and internal rhymes, but ONLY include words where every word in the array rhymes with every other word in the array. If the line has "" / "", include rhyming words from both bar segments. E.g. for ""every time I rhyme, I'm the fatalist"" return [""time"", ""rhyme"", ""I'm""] (they rhyme together; ""fatalist"" is excluded because its partner is in the next bar). When uncertain, exclude the word. Empty array if not freestyle or no clear within-line rhymes.

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
