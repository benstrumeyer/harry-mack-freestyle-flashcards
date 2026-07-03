"""Train-as-you-go rhyme model.

The user's annotations are labels: words the user put in the SAME rhyme group are
positive pairs; rhyme-eligible words in the same window that were NOT grouped are
hard negatives. We turn each candidate word pair into a feature vector (from the
phonetic layer we already compute) and train a classifier that predicts P(rhyme).

Its predictions become the auto-suggestions — so the more you annotate, the better
the machine parses on its own. Needs a modest number of labeled pairs before it
beats the heuristics; until then it reports that honestly.

Consumes: per video, the analysis words+events (canonical/delivered keys, vowel_seq,
bar_index, stress) and the user's groups (word-index lists keyed by rhyme sound).
"""
from __future__ import annotations

from dataclasses import dataclass
from itertools import combinations

from .phonetics import longest_common_vowel_run

FEATURES = [
    "same_canonical", "same_delivered", "vowel_run_overlap",
    "bar_distance", "both_bar_final", "stress_match", "same_word",
]


@dataclass
class WordFeat:
    word_index: int
    text: str
    canonical: str | None
    delivered: str | None
    vowel_seq: list[str]
    bar_index: int
    stress: int
    is_bar_final: bool


def pair_features(a: WordFeat, b: WordFeat) -> list[float]:
    return [
        1.0 if a.canonical and a.canonical == b.canonical else 0.0,
        1.0 if a.delivered and a.delivered == b.delivered else 0.0,
        float(longest_common_vowel_run(a.vowel_seq, b.vowel_seq)),
        float(abs(a.bar_index - b.bar_index)),
        1.0 if a.is_bar_final and b.is_bar_final else 0.0,
        1.0 if a.stress == b.stress else 0.0,
        1.0 if a.text.strip(".,?!'").lower() == b.text.strip(".,?!'").lower() else 0.0,
    ]


def build_pairs(feats: list[WordFeat], groups: dict[str, list[int]],
                window_bars: int = 6) -> tuple[list[list[float]], list[int]]:
    """Positive = same user group; negative = rhyme-eligible (has a key), within
    `window_bars`, but NOT co-grouped. Only pairs where at least one side is a
    rhyme carrier are considered (skip pure filler)."""
    by_index = {f.word_index: f for f in feats}
    group_of: dict[int, str] = {}
    for gid, wis in groups.items():
        for wi in wis:
            group_of[wi] = gid

    X: list[list[float]] = []
    y: list[int] = []
    ids = [f.word_index for f in feats if f.canonical or f.delivered]
    for i, j in combinations(ids, 2):
        a, b = by_index[i], by_index[j]
        if abs(a.bar_index - b.bar_index) > window_bars:
            continue
        gi, gj = group_of.get(i), group_of.get(j)
        # skip pairs with no signal at all
        if not (a.canonical or a.delivered) and not (b.canonical or b.delivered):
            continue
        label = 1 if (gi is not None and gi == gj) else 0
        # only keep negatives that were plausible (share some sound) — hard negatives
        if label == 0:
            feat = pair_features(a, b)
            if feat[0] == 0 and feat[1] == 0 and feat[2] < 1:
                continue
        X.append(pair_features(a, b))
        y.append(label)
    return X, y


def train_eval(X: list[list[float]], y: list[int]) -> dict:
    """Train a logistic-regression rhyme classifier; return metrics + weights.
    Reports honestly when there aren't enough labels to learn."""
    n, pos = len(y), sum(y)
    if n < 40 or pos < 5 or pos == n:
        return {"trained": False, "n": n, "positives": pos,
                "message": f"need more labeled pairs (have {n}, {pos} positive) — annotate a few more songs"}
    import numpy as np
    from sklearn.linear_model import LogisticRegression
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler
    from sklearn.model_selection import cross_val_score

    Xa, ya = np.array(X, dtype=float), np.array(y)
    clf = make_pipeline(StandardScaler(), LogisticRegression(max_iter=1000, class_weight="balanced"))
    folds = min(5, pos, n - pos)
    auc = cross_val_score(clf, Xa, ya, cv=folds, scoring="roc_auc").mean() if folds >= 2 else float("nan")
    acc = cross_val_score(clf, Xa, ya, cv=folds, scoring="accuracy").mean() if folds >= 2 else float("nan")
    clf.fit(Xa, ya)
    weights = dict(zip(FEATURES, clf.named_steps["logisticregression"].coef_[0].round(3).tolist()))
    return {"trained": True, "n": n, "positives": pos, "cv_auc": round(float(auc), 3),
            "cv_accuracy": round(float(acc), 3), "weights": weights}
