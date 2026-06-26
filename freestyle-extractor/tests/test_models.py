from freestyle_extractor.models import Word, Bar, VideoMeta, ExtractResult

def test_bar_roundtrips_to_dict():
    bar = Bar(text="people don't care", start=35.1, end=38.0, opener="people",
              rhyme_word="care", rhyme_key="ɛ r", is_freestyle=True, speaker="SPEAKER_00")
    d = bar.model_dump()
    assert d["rhyme_word"] == "care" and d["is_freestyle"] is True

def test_extract_result_nests_bars():
    res = ExtractResult(video=VideoMeta(youtube_id="x", title="t", duration_seconds=1.0, url="u"),
                        bars=[Bar(text="a", start=0, end=1, opener=None, rhyme_word=None,
                                  rhyme_key=None, is_freestyle=True, speaker=None)])
    assert res.bars[0].text == "a"
