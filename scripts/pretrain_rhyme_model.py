#!/usr/bin/env python
"""Pretrain the local rhyme model on CMUdict rhymes and save `models/rhyme_base.pt`.

We use `pronouncing` (CMUdict) as a free, offline source of ground-truth rhyme:
two words rhyme iff they share a *rhyming part* (stressed vowel to end of word).
That gives us thousands of labelled pairs with zero human effort — a pretrained base
that `training.build_pairs` (user annotation pairs) later fine-tunes.

Pairs feed the PyTorch Siamese scorer in `freestyle_extractor.rhyme_model.RhymeModel`
as `(seq_a, seq_b, label)` where each seq is a phoneme-token list (stress stripped):

    positive: two distinct words that share a CMUdict rhyming part  -> label 1
    negative: two words with different rhyming parts                -> label 0

Run:
    ~/rapenv/bin/python scripts/pretrain_rhyme_model.py \
        --out models/rhyme_base.pt --n-per-class 2000 --epochs 200

Keep training SMALL/fast — CMUdict rhyme is a highly separable phoneme-tail signal,
so the encoder learns it quickly and generalises to held-out pairs (AUC well above 0.85).
"""
from __future__ import annotations

import argparse
import json
import random
import re
import sys
from collections import defaultdict
from pathlib import Path

# make the freestyle_extractor package importable when run as a plain script
_REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_REPO_ROOT / "freestyle-extractor"))

from freestyle_extractor.rhyme_model import RhymeModel, _auc  # noqa: E402

_STRESS = re.compile(r"\d")

# where the pretrained base weights land by default (repo-relative)
DEFAULT_OUT = _REPO_ROOT / "models" / "rhyme_base.pt"


def _strip_stress(phones: str) -> list[str]:
    """`"K AE1 T"` -> `["K", "AE", "T"]` — drop stress digits, keep phoneme tokens."""
    return [_STRESS.sub("", p) for p in phones.split() if p]


def _clean_word_phones(word_limit: int, rng: random.Random) -> dict[str, str]:
    """Sample up to `word_limit` alphabetic CMUdict words -> their first pronunciation."""
    import pronouncing

    pronouncing.init_cmu()  # populate `pronouncing.pronunciations` (lazy None otherwise)
    seen: dict[str, str] = {}
    for word, phones in pronouncing.pronunciations:
        w = word.lower()
        if not w.isalpha():
            continue
        seen.setdefault(w, phones)  # first (canonical) pronunciation wins
    words = list(seen)
    rng.shuffle(words)
    if word_limit and len(words) > word_limit:
        words = words[:word_limit]
    return {w: seen[w] for w in words}


def build_cmudict_pairs(n_per_class: int = 2000, seed: int = 0,
                        word_limit: int = 6000) -> list:
    """Build `2 * n_per_class` balanced `(seq_a, seq_b, label)` pairs from CMUdict.

    Positives share a CMUdict rhyming part; negatives do not. Each seq is a phoneme
    token list (stress stripped) ready for `RhymeModel`."""
    import pronouncing

    rng = random.Random(seed)
    phones = _clean_word_phones(word_limit, rng)
    words = list(phones)

    # index words by their rhyming part so positives are cheap to sample
    by_part: dict[str, list[str]] = defaultdict(list)
    part_of: dict[str, str] = {}
    for w in words:
        part = pronouncing.rhyming_part(phones[w]) or phones[w]
        part_of[w] = part
        by_part[part].append(w)

    rhyme_groups = [ws for ws in by_part.values() if len(ws) >= 2]
    if not rhyme_groups:
        raise RuntimeError("no rhyming groups found — is the CMUdict corpus available?")

    def seq(w: str) -> list[str]:
        return _strip_stress(phones[w])

    positives = []
    guard = 0
    while len(positives) < n_per_class and guard < n_per_class * 50:
        guard += 1
        a, b = rng.sample(rng.choice(rhyme_groups), 2)
        positives.append((seq(a), seq(b), 1))

    negatives = []
    guard = 0
    while len(negatives) < n_per_class and guard < n_per_class * 50:
        guard += 1
        a, b = rng.sample(words, 2)
        if part_of[a] != part_of[b]:
            negatives.append((seq(a), seq(b), 0))

    pairs = positives + negatives
    rng.shuffle(pairs)
    return pairs


def _stratified_split(pairs: list, val_frac: float, rng: random.Random) -> tuple[list, list]:
    """Split into (train, val) keeping both classes present in the held-out set."""
    pos = [p for p in pairs if p[2] == 1]
    neg = [p for p in pairs if p[2] == 0]
    rng.shuffle(pos)
    rng.shuffle(neg)

    def cut(lst):
        k = max(1, int(round(len(lst) * val_frac))) if lst else 0
        return lst[k:], lst[:k]

    tr_p, va_p = cut(pos)
    tr_n, va_n = cut(neg)
    train, val = tr_p + tr_n, va_p + va_n
    rng.shuffle(train)
    rng.shuffle(val)
    return train, val


def _held_out_auc(model: RhymeModel, val_pairs: list) -> float:
    """Mann-Whitney AUC of `predict_rhyme` over held-out pairs (reuses model AUC)."""
    if not val_pairs:
        return float("nan")
    labels = [int(lbl) for _, _, lbl in val_pairs]
    scores = [model.predict_rhyme(a, b) for a, b, _ in val_pairs]
    return round(_auc(labels, scores), 4)


def pretrain(out_path=DEFAULT_OUT, n_per_class: int = 2000, epochs: int = 200,
             seed: int = 0, val_frac: float = 0.2, word_limit: int = 6000) -> dict:
    """Build CMUdict pairs, pretrain the Siamese scorer, save weights, report metrics.

    Returns `{"train": <train metrics>, "held_out_auc": float, "n_pairs": int,
    "out": str}`. The held-out AUC measures generalisation to unseen rhyme pairs."""
    rng = random.Random(seed)
    pairs = build_cmudict_pairs(n_per_class=n_per_class, seed=seed, word_limit=word_limit)
    train_pairs, val_pairs = _stratified_split(pairs, val_frac, rng)

    model = RhymeModel(seed=seed)
    metrics = model.train(train_pairs, epochs=epochs)
    held_out_auc = _held_out_auc(model, val_pairs)
    model.save(out_path)

    return {
        "train": metrics,
        "held_out_auc": held_out_auc,
        "n_pairs": len(pairs),
        "n_train": len(train_pairs),
        "n_val": len(val_pairs),
        "out": str(out_path),
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Pretrain the local rhyme model on CMUdict.")
    ap.add_argument("--out", default=str(DEFAULT_OUT), help="output weights path")
    ap.add_argument("--n-per-class", type=int, default=2000,
                    help="rhyme pairs AND non-rhyme pairs to build (each)")
    ap.add_argument("--epochs", type=int, default=200)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--val-frac", type=float, default=0.2)
    ap.add_argument("--word-limit", type=int, default=6000,
                    help="cap distinct CMUdict words sampled (speed)")
    args = ap.parse_args(argv)

    result = pretrain(out_path=args.out, n_per_class=args.n_per_class,
                      epochs=args.epochs, seed=args.seed, val_frac=args.val_frac,
                      word_limit=args.word_limit)
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
