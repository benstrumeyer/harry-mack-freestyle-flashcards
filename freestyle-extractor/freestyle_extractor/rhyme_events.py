"""Build per-word rhyme events from aligned words, bars, and delivered keys."""

from .models import Word, Bar, RhymeEvent
from . import phonetics


def _assign_bar(word: Word, bars: list[Bar]) -> int:
    """Return the index of the bar whose [start, end] contains the word's
    midpoint, or -1 if none."""
    mid = (word.start + word.end) / 2.0
    for i, b in enumerate(bars):
        if b.start <= mid <= b.end:
            return i
    return -1


def build_events(words: list[Word], bars: list[Bar],
                 delivered: list[str | None]) -> list[RhymeEvent]:
    """Construct a RhymeEvent per word.

    Each word is assigned to the bar whose [start, end] span contains its
    temporal midpoint (-1 if none). intra_bar_index is the running position
    within that bar. Canonical keys come from espeak (phonetics.rhyme_tail),
    vowel_seq from phonetics.vowel_sequence, and delivered keys are passed
    through from the wav2vec2 delivered_keys output. Stress is the count of
    espeak primary-stress markers (`'`) in the word's phonemes.
    """
    events: list[RhymeEvent] = []
    per_bar_counter: dict[int, int] = {}
    for wi, w in enumerate(words):
        bar_index = _assign_bar(w, bars)
        intra = per_bar_counter.get(bar_index, 0)
        per_bar_counter[bar_index] = intra + 1

        canonical_key = phonetics.rhyme_tail(w.text)
        vowel_seq = phonetics.vowel_sequence(w.text)
        stress = phonetics._phonemes(w.text).count("'")
        delivered_key = delivered[wi] if wi < len(delivered) else None

        events.append(RhymeEvent(
            word_index=wi,
            text=w.text,
            bar_index=bar_index,
            intra_bar_index=intra,
            start=w.start,
            end=w.end,
            canonical_key=canonical_key,
            delivered_key=delivered_key,
            vowel_seq=vowel_seq,
            stress=stress,
        ))
    return events
