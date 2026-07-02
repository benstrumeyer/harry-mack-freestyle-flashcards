import json, pathlib
from freestyle_extractor.models import Word
from freestyle_extractor.segment import segment
from freestyle_extractor.classify import classify
from freestyle_extractor.label import label

F = pathlib.Path(__file__).parent / "fixtures"


def test_golden_clip_bar_boundaries():
    words = [Word(**w) for w in json.loads((F / "golden_hm_clip.words.json").read_text())]
    got = [b.text for b in label(classify(segment(words)))]
    expected = json.loads((F / "golden_hm_clip.bars.json").read_text())
    # boundary precision: fraction of produced bars that exactly match a hand-labeled bar
    hits = sum(1 for g in got if g in expected)
    assert hits / max(len(got), 1) >= 0.8
