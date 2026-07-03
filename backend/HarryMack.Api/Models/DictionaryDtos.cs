namespace HarryMack.Api.Models;

// --- Rhyme-dictionary response DTOs (served to the React client) ---
// Read from the persisted rhyme_groups / rhyme_events / transcript_words (per-song)
// and the cross-song rhyme_dictionary / rhyme_dictionary_pairs tables.

// One rhyme group within a single song, with its member words.
public record SongDictionaryGroupDto(int GroupIndex, int Hue, string? Key, List<string> Words);

// Per-song rhyme dictionary (`GET /api/videos/{id}/rhyme-dictionary`).
public record SongDictionaryDto(string VideoId, List<SongDictionaryGroupDto> Groups);

// One aggregate rhyme-dictionary entry (`GET /api/rhymes/dictionary`).
// Artist is null for `scope=global` (rolled up across artists).
public record DictionaryEntryDto(
    string Word, string? Key, int VowelRun, int Frequency, int SongCount,
    bool IsMultisyllabic, bool IsInternal, string? Artist);

// One rhyming partner of a queried word (`GET /api/rhymes/dictionary/{word}`).
public record RhymePartnerDto(string Word, string? Key, int Frequency);

// Everything that rhymes with a queried word.
public record WordRhymesDto(string Word, string? Artist, List<RhymePartnerDto> Rhymes);
