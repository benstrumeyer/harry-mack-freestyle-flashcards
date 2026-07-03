"""The CMUdict pretrain script turns `pronouncing` rhyme lookups into training pairs
and pretrains the local Siamese `RhymeModel` into `models/rhyme_base.pt`.

Smoke-scale: build a few hundred rhyme/non-rhyme pairs, train briefly, and require the
model to generalise — held-out AUC >= 0.85 — then round-trip through the saved file.
Kept small/fast so it runs inside the normal extractor pytest suite.
"""
import sys
from pathlib import Path

import pytest

# the script lives at <repo>/scripts (a sibling of freestyle-extractor); make it importable
_REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_REPO_ROOT / "scripts"))

pronouncing = pytest.importorskip("pronouncing")

import pretrain_rhyme_model as prm  # noqa: E402


def test_build_cmudict_pairs_are_balanced_and_labelled():
    pairs = prm.build_cmudict_pairs(n_per_class=60, seed=1)
    assert len(pairs) == 120
    labels = [lbl for _, _, lbl in pairs]
    assert sum(labels) == 60  # balanced positives/negatives
    # every element is (seq_a, seq_b, label) with phoneme-token sequences
    a, b, lbl = pairs[0]
    assert isinstance(a, list) and isinstance(b, list) and lbl in (0, 1)
    assert all(isinstance(t, str) for t in a)


def test_positive_pairs_actually_rhyme_and_negatives_do_not():
    # positives share a CMUdict rhyming part (>= the final phoneme); negatives need not
    pairs = prm.build_cmudict_pairs(n_per_class=40, seed=2)
    positives = [(a, b) for a, b, lbl in pairs if lbl == 1]
    assert positives
    for a, b in positives:
        assert a[-1] == b[-1], f"positive pair should share a phoneme tail: {a} {b}"


def test_pretrain_reaches_held_out_auc_and_saves(tmp_path):
    out = tmp_path / "rhyme_base.pt"
    result = prm.pretrain(out_path=out, n_per_class=150, epochs=80, seed=0)
    assert result["train"]["trained"] is True
    assert result["held_out_auc"] >= 0.85  # generalises to unseen CMUdict pairs
    assert out.exists()


def test_saved_base_model_ranks_rhyme_over_nonrhyme(tmp_path):
    out = tmp_path / "rhyme_base.pt"
    prm.pretrain(out_path=out, n_per_class=150, epochs=80, seed=0)

    from freestyle_extractor.rhyme_model import RhymeModel
    model = RhymeModel.load(out)
    rhyme = model.predict_rhyme(["K", "AE", "T"], ["B", "AE", "T"])
    nonrhyme = model.predict_rhyme(["K", "AE", "T"], ["D", "OW", "G"])
    assert rhyme > nonrhyme
