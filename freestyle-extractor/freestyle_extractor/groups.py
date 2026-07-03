"""Rhyme groups, hues, and per-bar scheme labels.

A rhyme group is a connected component of RhymeEvents linked by a shared
canonical OR delivered rhyme-tail key (union-find). Only components with two
or more members are groups; a word that rhymes with nothing forms no group.
Each group is assigned an evenly-spaced hue by first-appearance order.

Scheme labels turn the group letters of the bar-final events into classic
quatrain schemes ("AABB", "ABAB", "ABCB", ...) over a 4-bar window.

Consumes: list[RhymeEvent] (from rhyme_events.build_events),
          detectors.bar_final_events.
Produces: build_groups(events) -> list[RhymeGroup],
          scheme_labels(events, groups) -> dict[int, str].
"""

import re

from .models import RhymeEvent, RhymeGroup
from .detectors import bar_final_events, LOOKBACK_BARS

# Function words that are almost never an intentional rhyme payload — they create
# huge spurious groups (e.g. every "a"/"the"/"to"). Content-word rhymes on short
# words (my/by/fly, play/hey/they) are intentionally NOT stopped.
_STOPWORDS = {
    "a", "an", "the", "and", "or", "of", "to", "in", "on", "at", "as", "is", "it",
    "i", "im", "uh", "um", "oh", "hmm", "mm", "ah", "ya", "y'all",
}

# A small, visually distinct hue palette, reused across groups. Far more legible
# than 70 hues spaced 5° apart (which all look identical).
_PALETTE = [8, 205, 130, 45, 280, 165, 95, 320, 235, 58, 300, 185]


def _norm(text: str) -> str:
    """Lowercased word with surrounding punctuation stripped (keeps apostrophes)."""
    return re.sub(r"[^a-z']", "", text.lower())


def _find(parent: dict[int, int], x: int) -> int:
    while parent[x] != x:
        parent[x] = parent[parent[x]]
        x = parent[x]
    return x


def _union(parent: dict[int, int], a: int, b: int) -> None:
    ra, rb = _find(parent, a), _find(parent, b)
    if ra != rb:
        parent[ra] = rb


def build_groups(events: list[RhymeEvent]) -> list[RhymeGroup]:
    """Union-find on shared canonical OR delivered key.

    Returns one RhymeGroup per connected component of size >= 2, ordered by
    first appearance (smallest member word_index). Hue is evenly spaced
    int(360 * i / n) over the n groups. `key` is a representative shared key
    (first canonical key present among the members, else first delivered key).
    """
    by_index = {e.word_index: e for e in events}

    # Only content words carry rhymes: drop stopwords and non-alphabetic tokens.
    def _carrier(e: RhymeEvent) -> bool:
        w = _norm(e.text)
        return bool(w) and w not in _STOPWORDS

    carriers = [e for e in events if _carrier(e)]
    parent = {e.word_index: e.word_index for e in carriers}

    # Link carriers that share a canonical key, then a delivered key.
    for key_attr in ("canonical_key", "delivered_key"):
        buckets: dict[str, list[int]] = {}
        for e in carriers:
            k = getattr(e, key_attr)
            if k:
                buckets.setdefault(k, []).append(e.word_index)
        for members in buckets.values():
            first = members[0]
            for other in members[1:]:
                _union(parent, first, other)

    # Gather components in event order so first-appearance is preserved.
    comps: dict[int, list[int]] = {}
    for e in carriers:
        root = _find(parent, e.word_index)
        comps.setdefault(root, []).append(e.word_index)

    # A real group needs >= 2 DISTINCT words (so "up up up" repetition is not a
    # rhyme), ordered by first appearance.
    def _distinct(wis: list[int]) -> int:
        return len({_norm(by_index[wi].text) for wi in wis})

    ordered = [wis for wis in comps.values() if _distinct(wis) >= 2]
    ordered.sort(key=lambda wis: min(wis))

    n = len(ordered)
    groups: list[RhymeGroup] = []
    for i, wis in enumerate(ordered):
        key = ""
        for wi in wis:
            ck = by_index[wi].canonical_key
            if ck:
                key = ck
                break
        if not key:
            for wi in wis:
                dk = by_index[wi].delivered_key
                if dk:
                    key = dk
                    break
        groups.append(RhymeGroup(
            group_index=i,
            hue=_PALETTE[i % len(_PALETTE)],
            word_indices=sorted(wis),
            key=key,
        ))
    return groups


def scheme_labels(events: list[RhymeEvent],
                  groups: list[RhymeGroup]) -> dict[int, str]:
    """Map bar_index -> scheme string derived from bar-final group letters.

    For each bar that has a bar-final event, the scheme covers a window of up
    to LOOKBACK_BARS (4) consecutive bar-final bars starting at that bar.
    Letters are assigned A, B, C ... in order of first appearance within the
    window; a bar-final word that belongs to no rhyme group gets a fresh,
    unique letter (so an unmatched line reads e.g. as the "C" of "ABCB").
    """
    word_to_group: dict[int, int] = {}
    for g in groups:
        for wi in g.word_indices:
            word_to_group[wi] = g.group_index

    finals = bar_final_events(events)          # sorted by bar_index
    bar_ids = [e.bar_index for e in finals]

    # Stable identity per bar-final: grouped words share a group id; ungrouped
    # words each get a unique singleton id so they never collapse together.
    ident: dict[int, tuple] = {}
    singleton = 0
    for e in finals:
        if e.word_index in word_to_group:
            ident[e.bar_index] = ("g", word_to_group[e.word_index])
        else:
            ident[e.bar_index] = ("s", singleton)
            singleton += 1

    schemes: dict[int, str] = {}
    for i, bidx in enumerate(bar_ids):
        window = bar_ids[i:i + LOOKBACK_BARS]
        letters: dict[tuple, str] = {}
        out = ""
        for b in window:
            gid = ident[b]
            if gid not in letters:
                letters[gid] = chr(ord("A") + len(letters))
            out += letters[gid]
        schemes[bidx] = out
    return schemes
