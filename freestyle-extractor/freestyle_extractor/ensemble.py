"""Hybrid, precision-favored rhyme ensemble.

Per candidate word pair we gather up to five INDEPENDENT signals:

    * ``canonical``  — the dictionary rhyme-tail keys match
    * ``vowel_run``  — a multisyllabic contiguous vowel run overlaps
    * ``delivered``  — the as-rapped (wav2vec2) rhyme-tail keys match
    * ``model``      — the local `rhyme_model` P(rhyme) clears a threshold
    * ``ai_draft``   — an (optional) externally-produced AI draft co-groups them

A pair is only proposed as a rhyme when at least ``min_signals`` (default 2) of
the *present* signals vote yes — precision over recall, so a lone signal (even a
confident model or a raw AI-draft guess) never creates a group on its own. A
per-group confidence is the mean agreement of its supporting pairs.

`auto_annotate(analysis, ai_draft=None, model=None)` union-finds the surviving
pairs into groups and returns them in `UserAnnotationDto.groups` shape plus a
confidence per group.

Signals mirror `training.pair_features`; nothing here calls Claude / Anthropic —
the AI draft is a plain dict pushed in by Claude Code, never overwriting labels.
"""
from __future__ import annotations

from dataclasses import dataclass
from itertools import combinations

from .models import RhymeEvent
from .groups import _STOPWORDS, _norm, _find, _union
from .phonetics import longest_common_vowel_run

# --- policy knobs ----------------------------------------------------------
DEFAULT_MIN_SIGNALS = 2      # >= this many independent signals must agree
VOWEL_RUN_MIN = 2            # contiguous shared vowels to count as a real run
MODEL_THRESHOLD = 0.5        # local rhyme_model P(rhyme) cut for a yes vote
WINDOW_BARS = 6              # only pair words within this many bars


def combine(signals: dict[str, bool],
            min_signals: int = DEFAULT_MIN_SIGNALS) -> tuple[bool, float]:
    """Decide a candidate pair from its present signals.

    Returns ``(proposed, confidence)`` where ``proposed`` is ``True`` only when
    at least ``min_signals`` present signals vote yes, and ``confidence`` is the
    fraction of present signals that agreed (0.0 when no signals are present)."""
    total = len(signals)
    if total == 0:
        return False, 0.0
    yes = sum(1 for v in signals.values() if v)
    return (yes >= min_signals), (yes / total)


def _model_seq(e: RhymeEvent):
    """What the local model scores for an event — its vowel run, else the word."""
    return e.vowel_seq if e.vowel_seq else e.text


def pair_signals(a: RhymeEvent, b: RhymeEvent, *,
                 model=None,
                 ai_group_of: dict[int, str] | None = None,
                 vowel_run_min: int = VOWEL_RUN_MIN,
                 model_threshold: float = MODEL_THRESHOLD,
                 only: set[str] | None = None) -> dict[str, bool]:
    """Independent yes/no votes for a candidate pair.

    A signal is OMITTED (abstains) when it has nothing to say — e.g. neither
    word carries a delivered key, or no model was supplied — so it never counts
    against the pair in `combine`. When ``only`` is given, the result is
    restricted to those signal names (e.g. ``{"model"}`` for a model-only
    engine); other signals are dropped even when present."""
    sig: dict[str, bool] = {}

    if a.canonical_key or b.canonical_key:
        sig["canonical"] = bool(a.canonical_key and a.canonical_key == b.canonical_key)

    if a.delivered_key or b.delivered_key:
        sig["delivered"] = bool(a.delivered_key and a.delivered_key == b.delivered_key)

    if a.vowel_seq and b.vowel_seq:
        sig["vowel_run"] = longest_common_vowel_run(a.vowel_seq, b.vowel_seq) >= vowel_run_min

    if model is not None:
        p = model.predict_rhyme(_model_seq(a), _model_seq(b))
        sig["model"] = p >= model_threshold

    if ai_group_of is not None:
        ga, gb = ai_group_of.get(a.word_index), ai_group_of.get(b.word_index)
        sig["ai_draft"] = ga is not None and ga == gb

    if only is not None:
        sig = {k: v for k, v in sig.items() if k in only}

    return sig


@dataclass
class AutoAnnotation:
    """Ensemble output: `UserAnnotationDto.groups` shape + a confidence per group."""
    groups: dict[str, list[int]]        # group id -> sorted word indices
    confidences: dict[str, float]       # same group id -> mean pair confidence


def _ai_group_of(ai_draft) -> dict[int, str] | None:
    """word_index -> AI-draft group id, from a UserAnnotationDto-shaped draft."""
    if not ai_draft:
        return None
    groups = ai_draft.get("groups") if isinstance(ai_draft, dict) else None
    if not groups:
        return None
    out: dict[int, str] = {}
    for gid, wis in groups.items():
        for wi in wis:
            out[int(wi)] = str(gid)
    return out


def _events(analysis) -> list[RhymeEvent]:
    if hasattr(analysis, "events"):
        return list(analysis.events)
    if isinstance(analysis, dict):
        return list(analysis.get("events", []))
    return list(analysis)


def _carrier(e: RhymeEvent) -> bool:
    """A rhyme-bearing content word: non-stopword with some phonetic key."""
    w = _norm(e.text)
    if not w or w in _STOPWORDS:
        return False
    return bool(e.canonical_key or e.delivered_key or e.vowel_seq)


def auto_annotate(analysis, ai_draft=None, *,
                  model=None,
                  min_signals: int = DEFAULT_MIN_SIGNALS,
                  window_bars: int = WINDOW_BARS,
                  vowel_run_min: int = VOWEL_RUN_MIN,
                  model_threshold: float = MODEL_THRESHOLD,
                  only: set[str] | None = None) -> AutoAnnotation:
    """Ensemble auto-annotation: propose rhyme groups + confidences.

    Consumes an `Analysis` (or its `.events` / a raw event list), an optional
    AI draft (UserAnnotationDto-shaped dict) and an optional local `RhymeModel`.
    Only candidate pairs within `window_bars` whose signals clear `min_signals`
    are grouped (union-find). Groups are keyed "0","1",... by first appearance;
    each confidence is the mean confidence of the pairs that supported it."""
    events = [e for e in _events(analysis) if _carrier(e)]
    ai_group_of = _ai_group_of(ai_draft)

    parent = {e.word_index: e.word_index for e in events}
    edge_conf: dict[frozenset[int], float] = {}

    for a, b in combinations(events, 2):
        if abs(a.bar_index - b.bar_index) > window_bars:
            continue
        sig = pair_signals(a, b, model=model, ai_group_of=ai_group_of,
                           vowel_run_min=vowel_run_min, model_threshold=model_threshold,
                           only=only)
        proposed, conf = combine(sig, min_signals=min_signals)
        if proposed:
            _union(parent, a.word_index, b.word_index)
            edge_conf[frozenset((a.word_index, b.word_index))] = conf

    # Gather components (>= 2 distinct words), ordered by first appearance.
    by_index = {e.word_index: e for e in events}
    comps: dict[int, list[int]] = {}
    for e in events:
        comps.setdefault(_find(parent, e.word_index), []).append(e.word_index)

    def _distinct(wis: list[int]) -> int:
        return len({_norm(by_index[wi].text) for wi in wis})

    ordered = [wis for wis in comps.values() if _distinct(wis) >= 2]
    ordered.sort(key=lambda wis: min(wis))

    groups: dict[str, list[int]] = {}
    confidences: dict[str, float] = {}
    for i, wis in enumerate(ordered):
        gid = str(i)
        member_set = set(wis)
        confs = [c for edge, c in edge_conf.items() if edge <= member_set]
        groups[gid] = sorted(wis)
        confidences[gid] = round(sum(confs) / len(confs), 4) if confs else 0.0

    return AutoAnnotation(groups=groups, confidences=confidences)
