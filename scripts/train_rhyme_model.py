#!/usr/bin/env python
"""Close the train-as-you-go loop: fine-tune the local rhyme model on the user's own
saved annotations and write `models/rhyme_user.pt`.

This is the counterpart to `scripts/pretrain_rhyme_model.py`. Where that pretrains a
CMUdict base (`rhyme_base.pt`), this pulls every saved annotation from the backend API,
turns the user's rhyme groups into training pairs, and continues training the base into
a personalised `rhyme_user.pt`. Each run makes the local model parse *your* rhymes better.

Key-free / ToS-clean: this never calls Claude/Anthropic and imports no `anthropic` SDK —
it only reads the backend's own REST endpoints. Two kinds of pairs come out of the labels:

  * phoneme-sequence pairs `(seq_a, seq_b, label)` (CMUdict pronunciation of each word,
    same token space as the base) → fine-tune the PyTorch Siamese `RhymeModel`.
  * feature-vector pairs via `training.build_pairs` → a logistic-regression sanity metric
    that reports honestly when there aren't yet enough labels to learn from.

Data flow (all from the .NET backend, no LLM):
    GET /api/videos                     → every ingested video id
    GET /api/videos/{id}/annotation     → the user's saved groups (204 if none → skipped)
    GET /api/videos/{id}/analysis       → per-word text + rhyme events (keys/bar/stress)

Run (from repo root, with the backend up):
    ~/rapenv/bin/python scripts/train_rhyme_model.py \
        --base-model models/rhyme_base.pt --out models/rhyme_user.pt --epochs 60
"""
from __future__ import annotations

import argparse
import json
import random
import re
import sys
import urllib.request
from itertools import combinations
from pathlib import Path

# make the freestyle_extractor package importable when run as a plain script
_REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_REPO_ROOT / "freestyle-extractor"))

from freestyle_extractor.rhyme_model import RhymeModel  # noqa: E402
from freestyle_extractor.training import (  # noqa: E402
    WordFeat, build_pairs, train_eval,
)

# default host of the .NET backend (see backend launchSettings.json + vite proxy)
DEFAULT_BASE_URL = "http://localhost:5007"
# the pretrained CMUdict base we fine-tune, and where the personalised model lands
DEFAULT_BASE_MODEL = _REPO_ROOT / "models" / "rhyme_base.pt"
DEFAULT_OUT = _REPO_ROOT / "models" / "rhyme_user.pt"

_STRESS = re.compile(r"\d")


# --- API access (injectable opener, no LLM) --------------------------------

def _send(method: str, url: str, opener) -> tuple[int, bytes]:
    """Issue one HTTP request via the injectable `opener` (default urlopen)."""
    opener = opener or urllib.request.urlopen
    req = urllib.request.Request(url, method=method)
    resp = opener(req)
    try:
        body = resp.read()
        status = getattr(resp, "status", None)
        if status is None:
            status = resp.getcode()
    finally:
        close = getattr(resp, "close", None)
        if close is not None:
            close()
    return status, body


def list_videos(base_url: str = DEFAULT_BASE_URL, opener=None) -> list[dict]:
    """GET /api/videos → the summary rows (each carries an `id`)."""
    _status, body = _send("GET", f"{base_url.rstrip('/')}/api/videos", opener)
    return json.loads(body) if body else []


def get_annotation(video_id: str, base_url: str = DEFAULT_BASE_URL, opener=None) -> dict | None:
    """GET /api/videos/{id}/annotation → the user's saved annotation, or None (204)."""
    url = f"{base_url.rstrip('/')}/api/videos/{video_id}/annotation"
    status, body = _send("GET", url, opener)
    if status == 204 or not body:
        return None
    return json.loads(body)


def get_analysis(video_id: str, base_url: str = DEFAULT_BASE_URL, opener=None) -> dict:
    """GET /api/videos/{id}/analysis → the annotated-transcript payload."""
    url = f"{base_url.rstrip('/')}/api/videos/{video_id}/analysis"
    _status, body = _send("GET", url, opener)
    return json.loads(body)


def fetch_dataset(base_url: str = DEFAULT_BASE_URL, opener=None) -> list[dict]:
    """Pull ALL saved annotations: for every video with a saved annotation, return a
    record `{"video_id", "analysis", "annotation"}`. Videos without an annotation
    (204) are skipped — only user-labelled songs become training data."""
    dataset: list[dict] = []
    for row in list_videos(base_url, opener):
        vid = row.get("id")
        if not vid:
            continue
        annotation = get_annotation(vid, base_url, opener)
        if not annotation or not annotation.get("groups"):
            continue
        analysis = get_analysis(vid, base_url, opener)
        dataset.append({"video_id": vid, "analysis": analysis, "annotation": annotation})
    return dataset


# --- label → pairs ----------------------------------------------------------

def default_phone_of(text: str) -> list[str] | None:
    """CMUdict pronunciation of a word as stress-stripped phoneme tokens (same token
    space as the base), or None when the word is not in CMUdict."""
    import pronouncing

    w = text.strip(".,?!'\"").lower()
    if not w:
        return None
    phones = pronouncing.phones_for_word(w)
    if not phones:
        return None
    return [_STRESS.sub("", p) for p in phones[0].split() if p]


def feats_from_analysis(analysis: dict) -> list[WordFeat]:
    """Build `WordFeat`s for every rhyme-carrying word (one with a rhyme event),
    pulling canonical/delivered keys, bar and stress from the event and the vowel
    sequence from the word. Feeds `training.build_pairs` for the sanity metric."""
    words = {w["wordIndex"]: w for w in analysis.get("words", [])}
    events = {e["wordIndex"]: e for e in analysis.get("events", [])}

    bar_members: dict[int, list[int]] = {}
    for wi, e in events.items():
        bar_members.setdefault(e.get("barIndex", 0), []).append(wi)
    bar_final = {max(members) for members in bar_members.values()}

    feats: list[WordFeat] = []
    for wi, e in events.items():
        w = words.get(wi, {})
        feats.append(WordFeat(
            word_index=wi,
            text=w.get("text", ""),
            canonical=e.get("canonicalKey"),
            delivered=e.get("deliveredKey"),
            vowel_seq=w.get("vowelSeq") or [],
            bar_index=e.get("barIndex", 0),
            stress=e.get("stress", 0),
            is_bar_final=wi in bar_final,
        ))
    return feats


def build_sequence_pairs(dataset: list[dict], phone_of=default_phone_of,
                         seed: int = 0) -> list[tuple[list[str], list[str], int]]:
    """Turn the user's rhyme groups into balanced phoneme-sequence pairs for the
    Siamese `RhymeModel`. Positives = two words the user put in the SAME group;
    negatives = two words in DIFFERENT groups (sampled to balance the positives).
    Words with no CMUdict pronunciation are skipped."""
    rng = random.Random(seed)
    positives: list[tuple[list[str], list[str], int]] = []
    cross: list[tuple[list[str], list[str], int]] = []

    for rec in dataset:
        text_of = {w["wordIndex"]: w.get("text", "")
                   for w in rec.get("analysis", {}).get("words", [])}
        groups = rec.get("annotation", {}).get("groups", {}) or {}

        # sequence per labelled, pronounceable word
        seq_of: dict[int, list[str]] = {}
        group_of: dict[int, str] = {}
        for gid, wis in groups.items():
            for wi in wis:
                if wi in seq_of:
                    continue
                seq = phone_of(text_of.get(wi, ""))
                if seq:
                    seq_of[wi] = seq
                    group_of[wi] = gid

        labelled = list(seq_of)
        for i, j in combinations(labelled, 2):
            pair = (seq_of[i], seq_of[j], 1 if group_of[i] == group_of[j] else 0)
            (positives if pair[2] == 1 else cross).append(pair)

    rng.shuffle(cross)
    negatives = cross[:len(positives)] if positives else cross
    pairs = positives + negatives
    rng.shuffle(pairs)
    return pairs


def _feature_metric(dataset: list[dict]) -> dict:
    """Aggregate `training.build_pairs` feature pairs across all annotations and run
    the logistic-regression `train_eval` — an honest 'do we have enough labels yet?'
    signal that sits alongside the fine-tuned Siamese model."""
    X_all: list[list[float]] = []
    y_all: list[int] = []
    for rec in dataset:
        feats = feats_from_analysis(rec.get("analysis", {}))
        groups = rec.get("annotation", {}).get("groups", {}) or {}
        X, y = build_pairs(feats, groups)
        X_all.extend(X)
        y_all.extend(y)
    return train_eval(X_all, y_all)


# --- fine-tune --------------------------------------------------------------

def finetune(base_model=DEFAULT_BASE_MODEL, out_path=DEFAULT_OUT, dataset=None,
             base_url: str = DEFAULT_BASE_URL, opener=None, epochs: int = 60,
             lr: float = 0.005, phone_of=default_phone_of, seed: int = 0) -> dict:
    """Load the CMUdict base, fine-tune it on the user's annotation pairs, and (only
    if it actually learned something) save `rhyme_user.pt`. Returns a metrics report.

    `dataset` may be passed directly (tests); otherwise it is fetched from the API."""
    if dataset is None:
        dataset = fetch_dataset(base_url, opener)

    seq_pairs = build_sequence_pairs(dataset, phone_of=phone_of, seed=seed)
    feature_model = _feature_metric(dataset)

    model = RhymeModel.load(base_model)
    ft = model.finetune(seq_pairs, epochs=epochs, lr=lr)

    out_str = None
    if ft.get("trained"):
        model.save(out_path)
        out_str = str(out_path)

    return {
        "n_videos": len(dataset),
        "pairs": {"n": len(seq_pairs), "positives": sum(l for _, _, l in seq_pairs)},
        "finetune": ft,
        "feature_model": feature_model,
        "base_model": str(base_model),
        "out": out_str,
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(
        description="Fine-tune the local rhyme model on the user's saved annotations.")
    ap.add_argument("--base-url", default=DEFAULT_BASE_URL, help="backend base URL")
    ap.add_argument("--base-model", default=str(DEFAULT_BASE_MODEL),
                    help="pretrained base weights to fine-tune from")
    ap.add_argument("--out", default=str(DEFAULT_OUT),
                    help="where the fine-tuned model lands")
    ap.add_argument("--epochs", type=int, default=60)
    ap.add_argument("--lr", type=float, default=0.005)
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args(argv)

    result = finetune(base_model=args.base_model, out_path=args.out,
                      base_url=args.base_url, epochs=args.epochs, lr=args.lr,
                      seed=args.seed)
    print(json.dumps(result, indent=2))
    # non-zero when there weren't enough labels to fine-tune (nothing saved)
    return 0 if result["finetune"].get("trained") else 1


if __name__ == "__main__":
    raise SystemExit(main())
