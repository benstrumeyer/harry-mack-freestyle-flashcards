#!/usr/bin/env python3
"""Score one rhyme annotation against another — the learning-loop scorecard.

Turns each annotation's rhyme groups into a set of unordered rhyming word-pairs,
then measures how well the PREDICTION (machine draft) matches the TRUTH (your
saved annotation): pairwise precision / recall / F1, plus bar-boundary agreement.
Run it after you annotate a song to see exactly how close the machine got — that
gap is what train_rhyme_model.py then learns from.

Sources: user (your saved annotation) · ai (Claude-Code AI draft) · local · ensemble
(sidecar-computed) · a path to a saved snapshot JSON (e.g. annotations/<id>.ai.json).

    python scripts/compare_annotation.py <video_id> --truth user --pred ai
    python scripts/compare_annotation.py <video_id> --pred annotations/<id>.ai.json
"""
import argparse, json, sys, urllib.request
from itertools import combinations

DEFAULT_BASE = "http://localhost:5007"


def _fetch(base, path):
    try:
        with urllib.request.urlopen(base + path) as r:
            if r.status == 204:
                return None
            return json.load(r)
    except urllib.error.HTTPError as e:
        if e.code in (204, 404):
            return None
        raise


def load_source(base, video_id, src):
    if src in ("user",):
        return _fetch(base, f"/api/videos/{video_id}/annotation")
    if src in ("ai",):
        return _fetch(base, f"/api/videos/{video_id}/ai-draft")
    if src in ("local", "ensemble"):
        return _fetch(base, f"/api/videos/{video_id}/auto-annotate?engine={src}")
    # otherwise treat as a file path
    with open(src) as f:
        return json.load(f)


def pairs(ann):
    """Unordered rhyming word-index pairs implied by the groups."""
    out = set()
    for wis in (ann.get("groups") or {}).values():
        for a, b in combinations(sorted(set(wis)), 2):
            out.add((a, b))
    return out


def bar_of(bars):
    m = {}
    for bi, b in enumerate(bars or []):
        for w in b:
            m[w] = bi
    return m


def bar_agreement(truth, pred):
    """Of adjacent grouped-word pairs, fraction where 'same bar?' agrees."""
    tb, pb = bar_of(truth.get("bars")), bar_of(pred.get("bars"))
    common = sorted(set(tb) & set(pb))
    if len(common) < 2:
        return None
    agree = tot = 0
    for a, b in zip(common, common[1:]):
        tot += 1
        agree += int((tb[a] == tb[b]) == (pb[a] == pb[b]))
    return agree / tot if tot else None


def main(argv=None):
    ap = argparse.ArgumentParser(description="Score a rhyme annotation against the truth.")
    ap.add_argument("video_id")
    ap.add_argument("--truth", default="user", help="user|ai|local|ensemble|<file> (default user)")
    ap.add_argument("--pred", default="ai", help="user|ai|local|ensemble|<file> (default ai)")
    ap.add_argument("--base-url", default=DEFAULT_BASE)
    a = ap.parse_args(argv)

    truth = load_source(a.base_url, a.video_id, a.truth)
    pred = load_source(a.base_url, a.video_id, a.pred)
    if truth is None:
        print(f"no '{a.truth}' annotation for {a.video_id} yet — annotate + Save first.", file=sys.stderr)
        return 2
    if pred is None:
        print(f"no '{a.pred}' annotation for {a.video_id}.", file=sys.stderr)
        return 2

    T, P = pairs(truth), pairs(pred)
    tp = len(T & P)
    precision = tp / len(P) if P else 0.0
    recall = tp / len(T) if T else 0.0
    f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) else 0.0
    ba = bar_agreement(truth, pred)

    print(f"=== {a.pred}  vs  {a.truth}  (truth) — video {a.video_id} ===")
    print(f"rhyme pairs: truth={len(T)}  pred={len(P)}  matched={tp}")
    print(f"precision={precision:.3f}  recall={recall:.3f}  F1={f1:.3f}")
    if ba is not None:
        print(f"bar-boundary agreement={ba:.3f}")
    # a couple of concrete misses to guide correction
    missed = list(T - P)[:8]
    extra = list(P - T)[:8]
    if missed:
        print(f"pairs the machine MISSED (you grouped, it didn't): {missed}")
    if extra:
        print(f"pairs the machine INVENTED (it grouped, you didn't): {extra}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
