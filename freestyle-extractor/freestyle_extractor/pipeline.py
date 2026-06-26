from .models import ExtractRequest, ExtractResult
from . import config
from .download import download
from .separate import separate
from .transcribe import transcribe
from .diarize import diarize, keep_dominant
from .segment import segment
from .classify import classify
from .label import label

def run(req: ExtractRequest, models, on_progress) -> ExtractResult:
    model, align_model, align_meta = models
    on_progress("download", 0.1)
    wav, meta = download(req.url, config.WORK_DIR)
    on_progress("separate", 0.3)
    vocals = separate(wav, config.WORK_DIR)
    on_progress("transcribe", 0.6)
    words = transcribe(vocals, model, align_model, align_meta)
    on_progress("diarize", 0.8)
    words = keep_dominant(words, diarize(vocals))
    on_progress("segment", 0.9)
    bars = label(classify(segment(words)))
    on_progress("done", 1.0)
    return ExtractResult(video=meta, bars=bars)
