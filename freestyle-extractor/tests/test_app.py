from fastapi.testclient import TestClient
from freestyle_extractor.models import ExtractResult, VideoMeta, Bar
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
