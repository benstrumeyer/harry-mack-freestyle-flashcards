namespace HarryMack.Api.Models;

// --- Rhyme Game opener-mode DTOs (spec §7b / Spec 2) ---
// The target rhyme sound for an opener is derived from the opener's SOURCE bar rhyme word
// (opener_sources → rhyme_word_bars → rhyme_words). Valid rhyming words come from the
// rhyme dictionary (§4d) sharing that canonical key. Submitted words are validated via
// espeak (canonical tail) against the target's canonical/delivered keys.

// Opener-mode challenge (`GET /api/game/opener/{openerId}`).
public record OpenerChallengeDto(
    string OpenerId,
    string OpenerText,
    string? TargetWord,
    string? TargetKey,
    string? TargetDeliveredKey,
    List<string> ValidWords);

// Submitted guess (`POST /api/game/opener/{openerId}/validate`).
public record OpenerGuessRequest(string Word);

// Validation outcome. MatchedOn ∈ "canonical" | "delivered" | "dictionary" | null.
public record OpenerValidationDto(
    bool Valid,
    string Word,
    string? Key,
    string? TargetKey,
    string? MatchedOn);
