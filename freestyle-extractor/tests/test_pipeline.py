# tests/test_pipeline.py
from freestyle_extractor.models import ExtractRequest, Word, VideoMeta
from freestyle_extractor import pipeline as P

def test_run_orders_stages_and_returns_bars(monkeypatch):
    monkeypatch.setattr(P, "download", lambda url, wd: ("a.wav", VideoMeta(youtube_id="x", title="t", duration_seconds=1.0, url=url)))
    monkeypatch.setattr(P, "separate", lambda wav, wd: "vocals.wav")
    monkeypatch.setattr(P, "transcribe", lambda v, m, am, ameta: [
        Word(text="people",start=0.0,end=0.3), Word(text="don't",start=0.3,end=0.6), Word(text="care",start=0.6,end=1.0),
        Word(text="hands",start=1.5,end=1.8), Word(text="in",start=1.8,end=1.9), Word(text="the",start=1.9,end=2.0), Word(text="air",start=2.0,end=2.4)])
    monkeypatch.setattr(P, "diarize", lambda v: None)
    res = P.run(ExtractRequest(url="u", artist="harry_mack"), models=(None,None,None), on_progress=lambda *a: None)
    assert res.video.youtube_id == "x"
    assert [b.rhyme_word for b in res.bars] == ["care","air"]
