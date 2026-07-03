namespace HarryMack.Api.Models;

// --- Sidecar analysis DTOs — bound with JsonNamingPolicy.SnakeCaseLower ---
// Mirror the freestyle-extractor Pydantic models (models.py): Word, RhymeEvent,
// RhymeGroup, Analysis. C# PascalCase properties map to the sidecar's snake_case
// keys via the SnakeCaseLower naming policy configured in ExtractorClient.

// Mirrors extractor `Word` (text, start, end, score, speaker).
public record WordDto(string Text, double Start, double End, double Score = 1.0, string? Speaker = null);

// Mirrors extractor `RhymeEvent`.
public record RhymeEventDto(
    int WordIndex,
    string Text,
    int BarIndex,
    int IntraBarIndex,
    double Start,
    double End,
    string? CanonicalKey,
    string? DeliveredKey,
    List<string> VowelSeq,
    int Stress,
    string? Detector,
    int? GroupIndex);

// Mirrors extractor `RhymeGroup`.
public record RhymeGroupDto(int GroupIndex, int Hue, List<int> WordIndices, string Key);

// Mirrors extractor `Analysis`.
public record AnalysisDto(
    List<WordDto> Words,
    List<RhymeEventDto> Events,
    List<RhymeGroupDto> Groups,
    Dictionary<int, string> BarLabels,
    Dictionary<int, string> Scheme,
    double Density,
    int DetectorVersion);
