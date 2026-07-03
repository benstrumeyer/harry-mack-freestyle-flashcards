"""The 6 fixed rhyme-pattern detectors (v1).

Labels every RhymeEvent with exactly one detector drawn from a fixed,
bounded taxonomy:

    perfect-end, slant-end, internal, multisyllabic, chain, none

Precedence (highest wins when several apply):

    chain > multisyllabic > internal > perfect-end > slant-end > none

Consumes: list[RhymeEvent] (from rhyme_events.build_events),
          phonetics.longest_common_vowel_run.
Produces: DETECTOR_VERSION, LOOKBACK_BARS,
          label_events(events) -> dict[int, str],
          bar_final_events(events) -> list[RhymeEvent].
"""

from .models import RhymeEvent
from .phonetics import longest_common_vowel_run

DETECTOR_VERSION = 1
LOOKBACK_BARS = 4

_PRECEDENCE = {
    "chain": 5,
    "multisyllabic": 4,
    "internal": 3,
    "perfect-end": 2,
    "slant-end": 1,
    "none": 0,
}


def bar_final_events(events: list[RhymeEvent]) -> list[RhymeEvent]:
    """Return the last event (highest intra_bar_index) of each assigned bar,
    ordered by bar_index. Events with bar_index < 0 (unassigned) are ignored."""
    finals: dict[int, RhymeEvent] = {}
    for e in events:
        if e.bar_index < 0:
            continue
        cur = finals.get(e.bar_index)
        if cur is None or e.intra_bar_index > cur.intra_bar_index:
            finals[e.bar_index] = e
    return [finals[b] for b in sorted(finals)]


def _within(a: RhymeEvent, b: RhymeEvent) -> bool:
    """True when two events fall within the LOOKBACK_BARS window."""
    return abs(a.bar_index - b.bar_index) <= LOOKBACK_BARS


def _flush_chain(run: list[RhymeEvent], upgrade) -> None:
    """Mark a run as a chain when it spans >= 3 distinct consecutive bars."""
    if len({e.bar_index for e in run}) >= 3:
        for e in run:
            upgrade(e.word_index, "chain")


def label_events(events: list[RhymeEvent]) -> dict[int, str]:
    """Map word_index -> detector label using the fixed precedence.

    - perfect-end: bar-final events within the lookback share a canonical key.
    - slant-end:   bar-final events within the lookback share a delivered key
                   (but not a canonical key).
    - internal:    two events in the same bar share a canonical or delivered key.
    - multisyllabic: two events within the lookback share a common vowel run
                     of length >= 2.
    - chain:       >= 3 events across consecutive bars share a canonical key.
    - none:        no relationship found.
    """
    labels: dict[int, str] = {e.word_index: "none" for e in events}

    def upgrade(wi: int, lab: str) -> None:
        if _PRECEDENCE[lab] > _PRECEDENCE[labels[wi]]:
            labels[wi] = lab

    assigned = [e for e in events if e.bar_index >= 0]

    # --- perfect-end / slant-end: bar-final pairs within the lookback ---
    finals = bar_final_events(events)
    for i in range(len(finals)):
        for j in range(i + 1, len(finals)):
            a, b = finals[i], finals[j]
            if not _within(a, b):
                continue
            if a.canonical_key and a.canonical_key == b.canonical_key:
                upgrade(a.word_index, "perfect-end")
                upgrade(b.word_index, "perfect-end")
            elif a.delivered_key and a.delivered_key == b.delivered_key:
                upgrade(a.word_index, "slant-end")
                upgrade(b.word_index, "slant-end")

    # --- internal: two matching events within the same bar ---
    by_bar: dict[int, list[RhymeEvent]] = {}
    for e in assigned:
        by_bar.setdefault(e.bar_index, []).append(e)
    for bar_events in by_bar.values():
        for i in range(len(bar_events)):
            for j in range(i + 1, len(bar_events)):
                a, b = bar_events[i], bar_events[j]
                match = (a.canonical_key and a.canonical_key == b.canonical_key) or \
                        (a.delivered_key and a.delivered_key == b.delivered_key)
                if match:
                    upgrade(a.word_index, "internal")
                    upgrade(b.word_index, "internal")

    # --- multisyllabic: pairwise within the lookback, vowel run >= 2 ---
    for i in range(len(assigned)):
        for j in range(i + 1, len(assigned)):
            a, b = assigned[i], assigned[j]
            if not _within(a, b):
                continue
            if longest_common_vowel_run(a.vowel_seq, b.vowel_seq) >= 2:
                upgrade(a.word_index, "multisyllabic")
                upgrade(b.word_index, "multisyllabic")

    # --- chain: >= 3 consecutive bars sharing a canonical key ---
    by_key: dict[str, list[RhymeEvent]] = {}
    for e in assigned:
        if e.canonical_key:
            by_key.setdefault(e.canonical_key, []).append(e)
    for key_events in by_key.values():
        ordered = sorted(key_events, key=lambda e: e.bar_index)
        run: list[RhymeEvent] = []
        prev_bar: int | None = None
        for e in ordered:
            if prev_bar is None or e.bar_index - prev_bar <= 1:
                run.append(e)
            else:
                _flush_chain(run, upgrade)
                run = [e]
            prev_bar = e.bar_index
        _flush_chain(run, upgrade)

    return labels
