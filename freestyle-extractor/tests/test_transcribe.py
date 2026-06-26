from freestyle_extractor.transcribe import to_words


def test_to_words_flattens_segments():
    result = {"segments": [
        {"words": [{"word": "care", "start": 1.0, "end": 1.4, "score": 0.9},
                   {"word": "air", "start": 1.9, "end": 2.3, "score": 0.8}]}]}
    ws = to_words(result)
    assert [w.text for w in ws] == ["care", "air"]
    assert ws[0].start == 1.0 and ws[1].end == 2.3


def test_to_words_skips_tokens_without_timing():
    result = {"segments": [
        {"words": [{"word": "um"},
                   {"word": "yeah", "start": 0.5, "end": 0.9, "score": 0.7}]}]}
    ws = to_words(result)
    assert len(ws) == 1
    assert ws[0].text == "yeah"


def test_to_words_empty():
    assert to_words({}) == []
    assert to_words({"segments": []}) == []
