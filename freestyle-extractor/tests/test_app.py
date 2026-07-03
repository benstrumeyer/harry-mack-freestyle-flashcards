from fastapi.testclient import TestClient
from freestyle_extractor.models import ExtractResult, VideoMeta, Bar, Analysis, RhymeEvent
from freestyle_extractor import app as A

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
