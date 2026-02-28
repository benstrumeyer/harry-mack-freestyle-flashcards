namespace HarryMack.Api.Models;

// --- Request DTOs ---
public record ProcessUrlRequest(string Url);
public record ProcessPlaylistRequest(string Url);

// --- Response DTOs ---
public record OpenerDto(Guid Id, string Text, int Frequency, string[] ExampleCompletions);
public record RhymeWordDto(Guid Id, string Word, string? Phonemes, int Frequency);
public record RhymePairDto(string WordA, string WordB, int Frequency);
public record RhymeMapDto(List<RhymeWordDto> Nodes, List<RhymePairDto> Edges);
public record RhymeDetailDto(RhymeWordDto Word, List<RhymeWordDto> Rhymes);
public record VideoStatusDto(Guid Id, string? Title, string Source, string? Filename, string? Url, DateTimeOffset ProcessedAt, int BarCount);
public record SessionDto(Guid Id, DateTimeOffset StartedAt, Guid[] CardsShown);
public record CreateSessionRequest(string[] CardsShown);
public record PipelineResultDto(string Message, int BarsExtracted, int OpenersFound, int RhymeWordsFound);
public record SavedOpenerDto(Guid Id, Guid? OpenerId, string Text, DateTimeOffset SavedAt);
public record SaveOpenerRequest(string OpenerId, string Text);
public record UpdateSavedOpenerRequest(string Text);
public record BarSourceDto(string? VideoTitle, string? VideoUrl, string? YoutubeId, float? TimestampSeconds, string BarText);
public record PlaylistQueuedDto(string Message, int VideoCount);
public record ValidateRhymesResultDto(string Message, int Removed, int Total);
