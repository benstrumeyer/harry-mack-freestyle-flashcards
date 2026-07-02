using System.Text.Json;

namespace HarryMack.Api.Data;

public static class Json
{
    public static string[] ToArray(string? json) =>
        string.IsNullOrWhiteSpace(json) ? Array.Empty<string>()
        : JsonSerializer.Deserialize<string[]>(json) ?? Array.Empty<string>();

    public static string Of(IEnumerable<string> items) => JsonSerializer.Serialize(items);
}
