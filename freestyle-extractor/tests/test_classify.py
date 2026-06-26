from freestyle_extractor.models import Bar
from freestyle_extractor.classify import classify

def _bar(text): return Bar(text=text, start=0, end=1)

def test_rhyming_neighbors_are_kept_filler_dropped():
    bars = [_bar("people don't care"), _bar("hands in the air"),
            _bar("yeah"), _bar("what's your name")]
    kept = classify(bars)
    texts = [b.text for b in kept]
    assert "people don't care" in texts and "hands in the air" in texts
    assert "yeah" not in texts and "what's your name" not in texts
