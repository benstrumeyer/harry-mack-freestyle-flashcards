"""The local PyTorch Siamese scorer learns rhyme from tiny synthetic phoneme pairs.

Rhyme here is "shares the same phoneme tail". We build words as [onset] + tail and
label a pair positive iff the tails match. A working Siamese model should learn the
tail signal, score same-tail pairs high, and round-trip through save/load unchanged.
"""
import random

from freestyle_extractor.rhyme_model import RhymeModel


# a handful of distinct tails; each word is a random onset + one of these tails
_ONSETS = [["K"], ["HH"], ["B"], ["M"], ["S"], ["F"], ["R"], ["L"], ["P"], ["T"]]
_TAILS = [["AE", "T"], ["OW", "G"], ["IY", "N"], ["AY", "P"], ["UW", "M"]]


def _synthetic_pairs(n=240, seed=0):
    rng = random.Random(seed)

    def word():
        return rng.choice(_ONSETS) + rng.choice(_TAILS)[:]  # tail carries the rhyme

    pairs = []
    for _ in range(n):
        a = word()
        if rng.random() < 0.5:  # force a positive: same tail, (usually) different onset
            b = rng.choice(_ONSETS) + a[1:]
            label = 1
        else:
            b = word()
            label = 1 if a[1:] == b[1:] else 0
        pairs.append((a, b, label))
    return pairs


def test_train_learns_the_tail_signal():
    pairs = _synthetic_pairs(seed=1)
    model = RhymeModel(seed=0)
    metrics = model.train(pairs, epochs=120)
    assert metrics["trained"] is True
    assert metrics["n"] == len(pairs)
    assert metrics["accuracy"] >= 0.9  # the tail is highly separable -> model learns it
    assert metrics["auc"] >= 0.9


def test_predict_rhyme_ranks_same_tail_above_different_tail():
    model = RhymeModel(seed=0)
    model.train(_synthetic_pairs(seed=2), epochs=120)
    same = model.predict_rhyme(["K", "AE", "T"], ["B", "AE", "T"])
    diff = model.predict_rhyme(["K", "AE", "T"], ["M", "OW", "G"])
    assert 0.0 <= same <= 1.0 and 0.0 <= diff <= 1.0
    assert same > 0.5 > diff
    assert same > diff


def test_predict_accepts_whitespace_phoneme_strings():
    model = RhymeModel(seed=0)
    model.train(_synthetic_pairs(seed=3), epochs=120)
    # "K AE T" (whitespace-separated phonemes) tokenizes the same as the list form
    assert model.predict_rhyme("K AE T", "B AE T") > 0.5


def test_save_load_roundtrip_preserves_predictions(tmp_path):
    model = RhymeModel(seed=0)
    model.train(_synthetic_pairs(seed=4), epochs=80)
    before = model.predict_rhyme(["K", "AE", "T"], ["B", "AE", "T"])

    path = tmp_path / "rhyme_base.pt"
    model.save(path)
    assert path.exists()

    reloaded = RhymeModel.load(path)
    after = reloaded.predict_rhyme(["K", "AE", "T"], ["B", "AE", "T"])
    assert abs(before - after) < 1e-5
