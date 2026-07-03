from freestyle_extractor.models import Word
from freestyle_extractor import delivered


def test_delivered_keys_aligns_by_time(monkeypatch):
    # fake phoneme frames: (phoneme, start_s, end_s)
    fake = [("ɛ", 0.0, 0.1), ("k", 0.1, 0.2), ("s", 0.2, 0.3),   # "ex"
            ("o", 1.0, 1.1), ("ɹ", 1.1, 1.2)]                      # "more"
    monkeypatch.setattr(delivered, "_phoneme_frames", lambda p, m: fake)
    words = [Word(text="explore", start=0.0, end=0.35, score=1.0),
             Word(text="more", start=1.0, end=1.25, score=1.0)]
    keys = delivered.delivered_keys("x.wav", words, model=object())
    assert len(keys) == 2
    assert keys[0] and keys[1]           # both spans had phonemes


def test_delivered_keys_none_when_no_phonemes_in_span(monkeypatch):
    fake = [("o", 5.0, 5.1)]
    monkeypatch.setattr(delivered, "_phoneme_frames", lambda p, m: fake)
    words = [Word(text="silent", start=0.0, end=0.5, score=1.0)]
    keys = delivered.delivered_keys("x.wav", words, model=object())
    assert keys == [None]


def test_tail_key_returns_last_vowel_plus_coda():
    # last vowel is "o" at index 3, coda "ɹ" -> "oɹ"
    assert delivered._tail_key(["ɛ", "k", "s", "o", "ɹ"]) == "oɹ"
    # no vowel -> None
    assert delivered._tail_key(["k", "s"]) is None
