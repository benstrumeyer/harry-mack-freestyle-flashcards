from freestyle_extractor.models import Word
from freestyle_extractor.diarize import keep_dominant

def test_keep_dominant_filters_minority_speaker():
    words = [Word(text="a",start=0.0,end=0.4), Word(text="b",start=0.5,end=0.9),
             Word(text="c",start=5.0,end=5.4)]
    turns = [(0.0,1.0,"S0"),(0.0,1.0,"S0"),(4.9,5.5,"S1")]  # S0 dominant
    kept = keep_dominant(words, turns)
    assert [w.text for w in kept] == ["a","b"]

def test_none_turns_keeps_all():
    words = [Word(text="a",start=0,end=1)]
    assert keep_dominant(words, None) == words
