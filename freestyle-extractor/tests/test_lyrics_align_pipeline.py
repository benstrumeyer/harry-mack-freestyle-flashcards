# tests/test_lyrics_align_pipeline.py
"""Spec 3 / Phase 6, Task 6.2 — lyrics-align input path.

For artists in {eminem, juice_wrld} the pipeline takes ground-truth lyrics
(passed on the request, or via optional lyricsgenius) and forced-aligns them to
the vocal instead of transcribing, then feeds the SAME analyze() stage. Missing
lyrics / missing lyricsgenius degrade gracefully back to transcription.
"""
import sys

from freestyle_extractor.models import ExtractRequest, VideoMeta, Word
from freestyle_extractor import lyrics as L
from freestyle_extractor import pipeline as P


_ALIGNED = [
    Word(text="people", start=0.0, end=0.3), Word(text="don't", start=0.3, end=0.6),
    Word(text="care", start=0.6, end=1.0),
    Word(text="hands", start=1.5, end=1.8), Word(text="in", start=1.8, end=1.9),
    Word(text="the", start=1.9, end=2.0), Word(text="air", start=2.0, end=2.4),
]


def test_uses_lyrics_align_selects_by_artist():
    assert L.uses_lyrics_align("eminem") is True
    assert L.uses_lyrics_align("juice_wrld") is True
    assert L.uses_lyrics_align("Eminem") is True          # case-insensitive
    assert L.uses_lyrics_align("harry_mack") is False
    assert L.uses_lyrics_align(None) is False


def test_resolve_lyrics_prefers_passed_in(monkeypatch):
    # If lyrics are on the request, we never touch lyricsgenius.
    def _boom(*a, **k):
        raise AssertionError("fetch_lyrics must not be called when lyrics passed in")
    monkeypatch.setattr(L, "fetch_lyrics", _boom)
    req = ExtractRequest(url="u", artist="eminem", lyrics="  people don't care  ")
    meta = VideoMeta(youtube_id="x", title="t", duration_seconds=1.0, url="u")
    assert L.resolve_lyrics(req, meta) == "people don't care"


def test_fetch_lyrics_degrades_when_lyricsgenius_missing(monkeypatch):
    # No token -> None without importing anything.
    monkeypatch.setattr(L.config, "GENIUS_TOKEN", None)
    assert L.fetch_lyrics("eminem", "Lose Yourself") is None
    # Token present but the package is not importable -> None, no crash.
    monkeypatch.setitem(sys.modules, "lyricsgenius", None)
    assert L.fetch_lyrics("eminem", "Lose Yourself", token="tok") is None


def test_run_lyrics_align_path_uses_forced_align_not_transcribe(monkeypatch):
    monkeypatch.setattr(P, "download", lambda url, wd: (
        "a.wav", VideoMeta(youtube_id="x", title="Lose Yourself", duration_seconds=1.0, url=url)))
    monkeypatch.setattr(P, "separate", lambda wav, wd: "vocals.wav")

    calls = {"align": 0}

    def fake_align(vocals, text, aligner=None):
        calls["align"] += 1
        assert text == "people don't care hands in the air"
        return list(_ALIGNED)
    monkeypatch.setattr(P, "align_lyrics", fake_align)

    def _no_transcribe(*a, **k):
        raise AssertionError("transcribe must not run on the lyrics-align path")
    monkeypatch.setattr(P, "transcribe", _no_transcribe)
    monkeypatch.setattr(P, "diarize", lambda v: (_ for _ in ()).throw(
        AssertionError("diarize must not run on the lyrics-align path")))

    req = ExtractRequest(url="u", artist="eminem",
                         lyrics="people don't care hands in the air")
    res = P.run(req, models=(None, None, None), on_progress=lambda *a: None)

    assert calls["align"] == 1
    assert res.analysis is not None
    # analysis was built from the forced-aligned words
    assert [w.text for w in res.analysis.words] == [w.text for w in _ALIGNED]
    assert [b.rhyme_word for b in res.bars] == ["care", "air"]


def test_run_falls_back_to_transcribe_when_no_lyrics(monkeypatch):
    monkeypatch.setattr(P, "download", lambda url, wd: (
        "a.wav", VideoMeta(youtube_id="x", title="t", duration_seconds=1.0, url=url)))
    monkeypatch.setattr(P, "separate", lambda wav, wd: "vocals.wav")
    # eminem artist but no lyrics anywhere -> transcription path.
    monkeypatch.setattr(L, "fetch_lyrics", lambda *a, **k: None)
    monkeypatch.setattr(P, "align_lyrics", lambda *a, **k: (_ for _ in ()).throw(
        AssertionError("align_lyrics must not run without lyrics")))
    monkeypatch.setattr(P, "transcribe", lambda v, m, am, ameta: list(_ALIGNED))
    monkeypatch.setattr(P, "diarize", lambda v: None)

    req = ExtractRequest(url="u", artist="eminem")   # no lyrics
    res = P.run(req, models=(None, None, None), on_progress=lambda *a: None)

    assert res.analysis is not None
    assert [b.rhyme_word for b in res.bars] == ["care", "air"]
