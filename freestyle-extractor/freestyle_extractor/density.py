"""Raplyzer rhyme-density score.

A single scalar summarising how densely a passage rhymes, following the
Raplyzer heuristic (Hirjee & Brown / "Raplyzer" by Malmi et al.): for every
rhyme event, find the longest matching vowel run it shares with any of the
previous N events, sum those matched-vowel lengths, and divide by the total
number of syllables (vowels) in the passage.

    density = sum_e max_{p in prev_N(e)} lcvr(e.vowel_seq, p.vowel_seq)
              / sum_e len(e.vowel_seq)

Dense, repeated multisyllabic rhyming pushes the score up (toward ~1);
non-rhyming text yields ~0. The score can slightly exceed 1 only in
pathological cases, so callers should treat it as roughly 0-1+.

Consumes: list[RhymeEvent] (from rhyme_events.build_events),
          phonetics.longest_common_vowel_run.
Produces: DENSITY_LOOKBACK, rhyme_density(events) -> float.
"""

from .models import RhymeEvent
from .phonetics import longest_common_vowel_run

# Number of preceding events each event is compared against (classic Raplyzer
# uses a sliding window of recent words rather than the whole song).
DENSITY_LOOKBACK = 15


def rhyme_density(events: list[RhymeEvent],
                  lookback: int = DENSITY_LOOKBACK) -> float:
    """Return the Raplyzer rhyme-density score for `events`.

    For each event, the longest common vowel run with any of the previous
    `lookback` events is summed and divided by the total syllable count.
    Returns 0.0 for an empty list or when no event has any vowels.
    """
    total_syllables = sum(len(e.vowel_seq) for e in events)
    if total_syllables == 0:
        return 0.0

    matched = 0
    for i, e in enumerate(events):
        best = 0
        start = max(0, i - lookback)
        for j in range(start, i):
            run = longest_common_vowel_run(e.vowel_seq, events[j].vowel_seq)
            if run > best:
                best = run
        matched += best

    return matched / total_syllables
