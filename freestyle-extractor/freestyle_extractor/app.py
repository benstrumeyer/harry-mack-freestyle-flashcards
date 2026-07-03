import os, queue, threading, uuid
from fastapi import FastAPI, HTTPException
from .models import ExtractRequest, Job, AutoAnnotateRequest, AutoAnnotateResult
from .ensemble import auto_annotate as _ensemble_auto_annotate, DEFAULT_MIN_SIGNALS
from .pipeline import run as _run
from .pipeline import analyze_url as _run_analyze

_jobs: dict[str, Job] = {}
_q: "queue.Queue[tuple[str, ExtractRequest, str]]" = queue.Queue()
_models = None

_RUNNERS = {"extract": lambda req, m, p: _run(req, m, p),
            "analyze": lambda req, m, p: _run_analyze(req, m, p)}

def _load_models():
    from .transcribe import load_models
    return load_models()


# --- auto-annotate (analyze+ensemble draft) --------------------------------
# The `local` engine is model-only (a group forms on a lone local-model vote);
# `ensemble` fuses every independent signal under the precision policy (>= 2 must
# agree). Never calls Claude/Anthropic — key-free, GPU-free, no re-transcription.
_ENGINE_ONLY = {"local": {"model"}}
_DEFAULT_MODEL_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "models", "rhyme_base.pt")


def _load_rhyme_model():
    """Load the pretrained local RhymeModel (models/rhyme_base.pt) if present;
    None when absent or unloadable (the ensemble still runs on other signals)."""
    path = os.getenv("RHYME_MODEL_PATH", _DEFAULT_MODEL_PATH)
    if not path or not os.path.exists(path):
        return None
    try:
        from .rhyme_model import RhymeModel
        return RhymeModel.load(path)
    except Exception:
        return None


def _auto_annotate(req: AutoAnnotateRequest) -> AutoAnnotateResult:
    engine = (req.engine or "ensemble").lower()
    only = _ENGINE_ONLY.get(engine)
    min_signals = 1 if engine == "local" else DEFAULT_MIN_SIGNALS
    model = _load_rhyme_model() if engine in ("local", "ensemble") else None
    ann = _ensemble_auto_annotate(
        req.analysis, ai_draft=req.ai_draft, model=model,
        min_signals=min_signals, only=only)
    return AutoAnnotateResult(groups=ann.groups, confidences=ann.confidences)

def _process(job_id: str, req: ExtractRequest, kind: str = "extract"):
    global _models
    job = _jobs[job_id]; job.status = "running"
    try:
        if _models is None:
            _models = _load_models()
        def prog(stage, p): job.stage, job.progress = stage, p
        job.result = _RUNNERS[kind](req, _models, prog)
        job.status = "done"; job.progress = 1.0
    except Exception as e:
        job.status = "failed"; job.error = str(e)

def drain():  # test helper: run all queued jobs synchronously
    while not _q.empty():
        jid, req, kind = _q.get(); _process(jid, req, kind)

def _worker():
    while True:
        jid, req, kind = _q.get(); _process(jid, req, kind)

def create_app() -> FastAPI:
    app = FastAPI()

    @app.get("/health")
    def health(): return {"ok": True}

    @app.post("/extract")
    def extract(req: ExtractRequest):
        jid = uuid.uuid4().hex
        _jobs[jid] = Job(job_id=jid)
        _q.put((jid, req, "extract"))
        return {"job_id": jid}

    @app.post("/analyze")
    def analyze(req: ExtractRequest):
        jid = uuid.uuid4().hex
        _jobs[jid] = Job(job_id=jid)
        _q.put((jid, req, "analyze"))
        return {"job_id": jid}

    # Synchronous: the ensemble is cheap (no download / transcription / GPU) so
    # it runs inline rather than through the job queue. Returns a DRAFT only.
    @app.post("/auto-annotate", response_model=AutoAnnotateResult)
    def auto_annotate(req: AutoAnnotateRequest):
        return _auto_annotate(req)

    @app.get("/jobs/{jid}")
    def get_job(jid: str):
        if jid not in _jobs:
            raise HTTPException(404, "no such job")
        return _jobs[jid]

    return app

app = create_app()
threading.Thread(target=_worker, daemon=True).start()
