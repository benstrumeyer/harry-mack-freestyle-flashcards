import json, pathlib
from freestyle_extractor.models import Word
from freestyle_extractor.segment import segment

def _load(name):
    data = json.loads((pathlib.Path(__file__).parent/"fixtures"/name).read_text())
    return [Word(**w) for w in data]

def test_pause_splits_into_two_bars():
    bars = segment(_load("words_care_air.json"))
    assert len(bars) == 2
    assert bars[0].text == "people don't care"
    assert bars[1].text == "hands in the air"
    assert bars[0].start == 34.0 and bars[1].end == 36.4

def test_empty_input_returns_empty():
    assert segment([]) == []
