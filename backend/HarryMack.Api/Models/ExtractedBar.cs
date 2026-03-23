using System.Text.Json.Serialization;

namespace HarryMack.Api.Models;

public record ExtractedBar(
    [property: JsonPropertyName("index")] int Index,
    [property: JsonPropertyName("bar_text")] string? BarText,
    [property: JsonPropertyName("is_freestyle")] bool IsFreestyle,
    [property: JsonPropertyName("opener")] string? Opener,
    [property: JsonPropertyName("rhyme_words")] List<string>? RhymeWords
);
