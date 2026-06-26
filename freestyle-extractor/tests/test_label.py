from freestyle_extractor.models import Bar
from freestyle_extractor.label import label

def test_label_sets_rhyme_word_and_opener():
    bars = label([Bar(text="I was born in a world where the people don't care", start=0, end=3)])
    b = bars[0]
    assert b.rhyme_word == "care"
    assert b.rhyme_key  # non-empty espeak tail
    assert b.opener and b.opener.lower().startswith("i was born")
