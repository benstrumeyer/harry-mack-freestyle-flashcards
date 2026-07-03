from freestyle_extractor.models import Word, Bar
from freestyle_extractor.rhyme_events import build_events


def test_events_assign_bar_and_intrabar_index():
    words = [Word(text="i", start=0.0, end=0.1, score=1.0),
             Word(text="explore", start=0.1, end=0.5, score=1.0),
             Word(text="give", start=1.0, end=1.2, score=1.0),
             Word(text="more", start=1.2, end=1.5, score=1.0)]
    bars = [Bar(text="i explore", start=0.0, end=0.5),
            Bar(text="give more", start=1.0, end=1.5)]
    ev = build_events(words, bars, delivered=[None, "o", None, "o"])
    assert [e.bar_index for e in ev] == [0, 0, 1, 1]
    assert [e.intra_bar_index for e in ev] == [0, 1, 0, 1]
    assert ev[1].canonical_key == ev[3].canonical_key   # explore / more share canonical tail


def test_events_carry_word_metadata():
    words = [Word(text="explore", start=0.1, end=0.5, score=0.9)]
    bars = [Bar(text="explore", start=0.0, end=0.6)]
    ev = build_events(words, bars, delivered=["or"])
    assert len(ev) == 1
    e = ev[0]
    assert e.word_index == 0
    assert e.text == "explore"
    assert e.start == 0.1 and e.end == 0.5
    assert e.delivered_key == "or"
    assert e.vowel_seq == ["E", "o@"]
    assert e.stress >= 1                 # espeak marks a primary stress


def test_events_unassigned_bar_when_no_container():
    words = [Word(text="floating", start=5.0, end=5.4, score=1.0)]
    bars = [Bar(text="i explore", start=0.0, end=0.5)]
    ev = build_events(words, bars, delivered=[None])
    assert ev[0].bar_index == -1
    assert ev[0].intra_bar_index == 0
