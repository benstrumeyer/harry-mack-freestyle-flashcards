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

// --- API response DTOs (served to the React client; camelCase over the wire) ---
// These read from the persisted additive tables (transcript_words / rhyme_events /
// rhyme_groups / rhyme_annotations), NOT from the sidecar JSON.

// One row per video for the Songs list (`GET /api/videos`).
public record VideoSummaryDto(
    string Id, string? Title, string? Artist, int BarCount, int WordCount, double? Density,
    string? YoutubeId = null);

// Human-in-the-loop annotation: the user's bar boundaries (word indices per bar),
// rhyme groups (groupId -> word indices), paragraph/verse breaks (bar indices that
// start a new verse), and per-word annotation types (wordIndex -> end|internal|
// slant|multi). The source of truth + training labels.
public record UserAnnotationDto(
    List<List<int>> Bars,
    Dictionary<string, List<int>> Groups,
    List<int>? Paras = null,
    Dictionary<string, string>? Types = null);

// One full-transcript word (`transcript_words`).
public record TranscriptWordDto(
    int WordIndex, string Text, double Start, double End,
    double? Score, string? Ipa, List<string>? VowelSeq, string? DeliveredIpa);

// One persisted rhyme event (`rhyme_events`) — carries the group link + detector label.
public record AnalysisEventDto(
    int WordIndex, int BarIndex, int IntraBarIndex,
    string? CanonicalKey, string? DeliveredKey, string? Detector, int? GroupIndex, int Stress);

// One persisted rhyme group (`rhyme_groups`) — hue drives the transcript coloring.
public record AnalysisGroupDto(int GroupIndex, int Hue, int Size, string? Key);

// Full annotated-transcript payload (`GET /api/videos/{id}/analysis`).
public record VideoAnalysisDto(
    VideoSummaryDto Video,
    List<TranscriptWordDto> Words,
    List<AnalysisEventDto> Events,
    List<AnalysisGroupDto> Groups,
    Dictionary<int, string> Scheme,
    double Density);

// Result of re-triggering the analyze stage for an existing video.
public record ReanalyzeResultDto(string Message, int Events, int Groups, double Density);

// Sidecar `/auto-annotate` response — proposed rhyme groups (groupId -> word
// indices) plus a per-group confidence. Bound with SnakeCaseLower.
public record AutoAnnotateResultDto(
    Dictionary<string, List<int>> Groups,
    Dictionary<string, double> Confidences);
