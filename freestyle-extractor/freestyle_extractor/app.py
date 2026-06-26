import queue, threading, uuid
from fastapi import FastAPI, HTTPException
from .models import ExtractRequest, Job
from .pipeline import run as _run

_jobs: dict[str, Job] = {}
_q: "queue.Queue[tuple[str, ExtractRequest]]" = queue.Queue()
_models = None

def _load_models():
    from .transcribe import load_models
    return load_models()

def _process(job_id: str, req: ExtractRequest):
    global _models
    job = _jobs[job_id]; job.status = "running"
    try:
        if _models is None:
            _models = _load_models()
        def prog(stage, p): job.stage, job.progress = stage, p
        job.result = _run(req, _models, prog)
        job.status = "done"; job.progress = 1.0
    except Exception as e:
        job.status = "failed"; job.error = str(e)

def drain():  # test helper: run all queued jobs synchronously
    while not _q.empty():
        jid, req = _q.get(); _process(jid, req)

def _worker():
    while True:
        jid, req = _q.get(); _process(jid, req)

def create_app() -> FastAPI:
    app = FastAPI()

    @app.get("/health")
    def health(): return {"ok": True}

    @app.post("/extract")
    def extract(req: ExtractRequest):
        jid = uuid.uuid4().hex
        _jobs[jid] = Job(job_id=jid)
        _q.put((jid, req))
        return {"job_id": jid}

    @app.get("/jobs/{jid}")
    def get_job(jid: str):
        if jid not in _jobs:
            raise HTTPException(404, "no such job")
        return _jobs[jid]

    return app

app = create_app()
threading.Thread(target=_worker, daemon=True).start()
