import torch

from freestyle_extractor import forced_align
from freestyle_extractor.forced_align import Aligner


def _synthetic_aligner():
    # tiny CTC vocab: blank=0, then a,b,c,d — enough to align "ab cd"
    dictionary = {"a": 1, "b": 2, "c": 3, "d": 4}
    return Aligner(model=object(), dictionary=dictionary, sample_rate=100)


def _emission_for_abcd():
    # 5 frames, C=5 (blank + a,b,c,d): favour a,b,blank,c,d per frame.
    C, T = 5, 5
    lp = torch.full((1, T, C), -12.0)
    lp[0, 0, 1] = 0.0  # a
    lp[0, 1, 2] = 0.0  # b
    lp[0, 2, 0] = 0.0  # blank (word gap)
    lp[0, 3, 3] = 0.0  # c
    lp[0, 4, 4] = 0.0  # d
    return lp


def test_align_lyrics_produces_word_timings(monkeypatch):
    aligner = _synthetic_aligner()
    lp = _emission_for_abcd()
    # 500 samples / 5 frames / sr=100 -> 1.0 s per frame, 5s clip.
    monkeypatch.setattr(forced_align, "_emissions", lambda p, a: (lp, 500))

    words = forced_align.align_lyrics("x.wav", "ab cd", aligner=aligner)

    assert [w.text for w in words] == ["ab", "cd"]
    # timings monotonically increase and words don't overlap
    assert words[0].start < words[0].end <= words[1].start < words[1].end
    # inside the 5-second clip
    assert words[1].end <= 5.0
    assert all(0.0 <= w.score <= 1.0 for w in words)


def test_normalize_words_strips_punctuation_and_lowercases():
    assert forced_align.normalize_words("Hello, WORLD! it's") == [
        "hello",
        "world",
        "it's",
    ]


def test_align_lyrics_empty_and_skips_model_when_no_alignable_tokens(monkeypatch):
    aligner = _synthetic_aligner()
    calls = {"n": 0}

    def fake_emissions(path, alg):
        calls["n"] += 1
        return (torch.zeros(1, 1, 5), 100)

    monkeypatch.setattr(forced_align, "_emissions", fake_emissions)
    # "xyz" has no chars in the tiny dict -> nothing alignable
    words = forced_align.align_lyrics("x.wav", "xyz", aligner=aligner)

    assert words == []
    assert calls["n"] == 0  # short-circuits before touching the model/audio
