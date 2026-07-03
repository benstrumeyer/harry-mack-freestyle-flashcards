import json, pathlib
from collections import Counter
from freestyle_extractor.models import Word
from freestyle_extractor.segment import segment
from freestyle_extractor.classify import classify
from freestyle_extractor.label import label
from freestyle_extractor import pipeline as P

F = pathlib.Path(__file__).parent / "fixtures"


def test_golden_clip_bar_boundaries():
    words = [Word(**w) for w in json.loads((F / "golden_hm_clip.words.json").read_text())]
    got = [b.text for b in label(classify(segment(words)))]
    expected = json.loads((F / "golden_hm_clip.bars.json").read_text())
    # boundary precision: fraction of produced bars that exactly match a hand-labeled bar
    hits = sum(1 for g in got if g in expected)
    assert hits / max(len(got), 1) >= 0.8


def test_golden_clip_analysis():
    words = [Word(**w) for w in json.loads((F / "golden_hm_clip.words.json").read_text())]
    a = P.analyze(words, segment(words), vocals_path=None, models=None)
    expected = json.loads((F / "golden_hm_clip.analysis.json").read_text())

    # Full transcript preserved and stably analyzed against the golden fixture.
    assert len(a.words) == expected["n_words"] == len(words)
    assert len(a.events) == expected["n_events"]
    assert len(a.groups) == expected["n_groups"]
    assert a.detector_version == expected["detector_version"] == 1
    assert round(a.density, 6) == expected["density"]
    got_counts = dict(sorted(Counter(e.detector for e in a.events).items()))
    assert got_counts == expected["detector_counts"]
