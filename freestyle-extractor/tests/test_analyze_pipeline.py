"""Task 1.7: analyze() stage wiring on a tiny fixture word list."""

from freestyle_extractor.models import Word, Bar, Analysis, RhymeEvent, RhymeGroup
from freestyle_extractor.detectors import DETECTOR_VERSION
from freestyle_extractor import pipeline as P


def _words() -> list[Word]:
    # Two 4-word bars; "explore"/"core"/"more" share the espeak rhyme tail.
    return [
        Word(text="i", start=0.0, end=0.1),
        Word(text="explore", start=0.1, end=0.5),
        Word(text="the", start=0.6, end=0.7),
        Word(text="core", start=0.7, end=1.0),
        Word(text="give", start=1.2, end=1.4),
        Word(text="me", start=1.4, end=1.5),
        Word(text="you", start=1.5, end=1.6),
        Word(text="more", start=1.6, end=2.0),
    ]


def _bars() -> list[Bar]:
    return [
        Bar(text="i explore the core", start=0.0, end=1.0),
        Bar(text="give me you more", start=1.2, end=2.0),
    ]


def test_analyze_returns_populated_analysis():
    words, bars = _words(), _bars()
    a = P.analyze(words, bars, vocals_path=None, models=None)

    assert isinstance(a, Analysis)
    assert a.detector_version == DETECTOR_VERSION == 1
    # Full transcript is preserved (one event per word).
    assert len(a.words) == len(words)
    assert len(a.events) == len(words)
    assert all(isinstance(e, RhymeEvent) for e in a.events)
    # Every event carries a detector label from the fixed taxonomy.
    taxonomy = {"perfect-end", "slant-end", "internal", "multisyllabic", "chain", "none"}
    assert all(e.detector in taxonomy for e in a.events)
    # "explore" / "core" / "more" rhyme -> at least one real group + a non-none label.
    assert len(a.groups) >= 1
    assert all(isinstance(g, RhymeGroup) for g in a.groups)
    assert any(e.detector != "none" for e in a.events)
    # group_index back-references are consistent with the produced groups.
    valid = {g.group_index for g in a.groups}
    for e in a.events:
        if e.group_index is not None:
            assert e.group_index in valid
    assert isinstance(a.density, float) and a.density >= 0.0
    assert isinstance(a.scheme, dict)
    assert isinstance(a.bar_labels, dict)


def test_analyze_delivered_disabled_gives_none_keys():
    # With delivered disabled (default) no GPU model is loaded and delivered
    # keys stay None even when a vocals_path is supplied.
    words, bars = _words(), _bars()
    a = P.analyze(words, bars, vocals_path="/nonexistent/vocals.wav", models=None)
    assert all(e.delivered_key is None for e in a.events)


def test_run_keeps_full_words_in_analysis(monkeypatch):
    from freestyle_extractor.models import ExtractRequest, VideoMeta

    full = _words()
    monkeypatch.setattr(P, "download", lambda url, wd: ("a.wav", VideoMeta(
        youtube_id="x", title="t", duration_seconds=1.0, url=url)))
    monkeypatch.setattr(P, "separate", lambda wav, wd: "vocals.wav")
    monkeypatch.setattr(P, "transcribe", lambda v, m, am, ameta: full)
    monkeypatch.setattr(P, "diarize", lambda v: None)

    res = P.run(ExtractRequest(url="u", artist="harry_mack"),
                models=(None, None, None), on_progress=lambda *a: None)

    assert res.analysis is not None
    # Analysis carries the FULL word list, not the classify-filtered bar subset.
    assert len(res.analysis.words) == len(full)
    assert res.analysis.detector_version == 1
