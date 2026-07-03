from fastapi.testclient import TestClient
from freestyle_extractor.models import ExtractResult, VideoMeta, Bar, Analysis, RhymeEvent
from freestyle_extractor import app as A


class _StubModel:
    """Fixed-P(rhyme) stand-in for a trained RhymeModel (no torch)."""
    def __init__(self, prob=1.0):
        self.prob = prob
        self.calls = []
    def predict_rhyme(self, a, b):
        self.calls.append((a, b))
        return self.prob

def test_extract_enqueues_and_completes(monkeypatch):
    monkeypatch.setattr(A, "_load_models", lambda: (None,None,None))
    monkeypatch.setattr(A, "_run", lambda req, models, prog: ExtractResult(
        video=VideoMeta(youtube_id="x",title="t",duration_seconds=1.0,url="u"),
        bars=[Bar(text="people don't care",start=0,end=1,rhyme_word="care",rhyme_key="ɛ r")]))
    client = TestClient(A.create_app())
    jid = client.post("/extract", json={"url":"u","artist":"harry_mack"}).json()["job_id"]
    A.drain()  # process the queue synchronously in the test
    job = client.get(f"/jobs/{jid}").json()
    assert job["status"] == "done"
    assert job["result"]["bars"][0]["rhyme_word"] == "care"


def test_analyze_enqueues_and_returns_analysis(monkeypatch):
    monkeypatch.setattr(A, "_load_models", lambda: (None, None, None))
    monkeypatch.setattr(A, "_run_analyze", lambda req, models, prog: ExtractResult(
        video=VideoMeta(youtube_id="x", title="t", duration_seconds=1.0, url="u"),
        bars=[],
        analysis=Analysis(
            detector_version=1,
            density=0.5,
            words=[],
            events=[RhymeEvent(word_index=0, text="explore", bar_index=0,
                               intra_bar_index=1, start=0.0, end=0.5,
                               detector="perfect-end", group_index=0)],
        )))
    client = TestClient(A.create_app())
    jid = client.post("/analyze", json={"url": "u", "artist": "harry_mack"}).json()["job_id"]
    A.drain()  # process the queue synchronously in the test
    job = client.get(f"/jobs/{jid}").json()
    assert job["status"] == "done"
    assert job["result"]["analysis"]["detector_version"] == 1
    assert job["result"]["analysis"]["events"][0]["detector"] == "perfect-end"
    assert job["result"]["bars"] == []


def _analysis_two_rhymes():
    """Two content words sharing canonical + delivered keys (two independent
    signals) so the ENSEMBLE engine groups them without any local model."""
    return Analysis(events=[
        RhymeEvent(word_index=1, text="explore", bar_index=0, intra_bar_index=1,
                   start=0.1, end=0.5, canonical_key="o@", delivered_key="or",
                   stress=1, detector="perfect-end"),
        RhymeEvent(word_index=3, text="before", bar_index=1, intra_bar_index=1,
                   start=1.2, end=1.5, canonical_key="o@", delivered_key="or",
                   stress=1, detector="perfect-end"),
    ])


def _analysis_model_only():
    """Two content words with NO shared canonical/delivered and non-overlapping
    vowel runs: no pair of phonetic signals agrees, so only a local-model vote
    can group them (used to prove the `local` engine is model-driven)."""
    return Analysis(events=[
        RhymeEvent(word_index=0, text="kaleidoscope", bar_index=0, intra_bar_index=0,
                   start=0.0, end=0.4, vowel_seq=["a"], stress=1),
        RhymeEvent(word_index=2, text="envelope", bar_index=1, intra_bar_index=0,
                   start=1.0, end=1.4, vowel_seq=["e"], stress=1),
    ])


def test_auto_annotate_ensemble_groups_by_signal_agreement(monkeypatch):
    monkeypatch.setattr(A, "_load_rhyme_model", lambda: None)
    client = TestClient(A.create_app())
    body = {"analysis": _analysis_two_rhymes().model_dump(), "engine": "ensemble"}
    res = client.post("/auto-annotate", json=body).json()
    assert res["groups"] == {"0": [1, 3]}
    assert res["confidences"]["0"] == 1.0


def test_auto_annotate_local_is_model_driven(monkeypatch):
    # A hot local model groups a pair that the ensemble (no phonetic agreement)
    # would never propose on its own — proving `local` is model-only.
    model = _StubModel(0.99)
    monkeypatch.setattr(A, "_load_rhyme_model", lambda: model)
    client = TestClient(A.create_app())

    analysis = _analysis_model_only().model_dump()
    local = client.post("/auto-annotate", json={"analysis": analysis, "engine": "local"}).json()
    assert local["groups"] == {"0": [0, 2]}
    assert model.calls  # the local model was actually consulted

    # The same input under the ensemble engine yields no group (one lone signal).
    ens = client.post("/auto-annotate", json={"analysis": analysis, "engine": "ensemble"}).json()
    assert ens["groups"] == {}


def test_auto_annotate_ai_draft_supplies_second_signal(monkeypatch):
    # An AI draft co-grouping two words is an INDEPENDENT signal that, alongside
    # a shared canonical key, clears the ensemble's two-signal bar.
    monkeypatch.setattr(A, "_load_rhyme_model", lambda: None)
    client = TestClient(A.create_app())
    analysis = Analysis(events=[
        RhymeEvent(word_index=0, text="cat", bar_index=0, intra_bar_index=0,
                   canonical_key="AE_T", vowel_seq=["ae"], start=0.0, end=0.1),
        RhymeEvent(word_index=1, text="rat", bar_index=1, intra_bar_index=0,
                   canonical_key="AE_T", vowel_seq=["ae"], start=1.0, end=1.1),
    ]).model_dump()
    body = {"analysis": analysis, "engine": "ensemble",
            "ai_draft": {"groups": {"g": [0, 1]}}}
    res = client.post("/auto-annotate", json=body).json()
    assert res["groups"] == {"0": [0, 1]}
