from collections import defaultdict
from .models import Word
from . import config

def _speaker_at(t: float, turns) -> str | None:
    for start, end, spk in turns:
        if start <= t <= end:
            return spk
    return None

def keep_dominant(words: list[Word], turns) -> list[Word]:
    if not turns:
        return words
    dur = defaultdict(float)
    for start, end, spk in turns:
        dur[spk] += (end - start)
    dominant = max(dur, key=dur.get)
    out = []
    for w in words:
        spk = _speaker_at((w.start + w.end) / 2, turns)
        if spk is None or spk == dominant:
            w.speaker = dominant
            out.append(w)
    return out

def diarize(vocals_path: str):
    if not config.HF_TOKEN:
        return None  # graceful fallback: caller keeps all speech
    try:
        from pyannote.audio import Pipeline
        pipe = Pipeline.from_pretrained("pyannote/speaker-diarization-3.1",
                                        use_auth_token=config.HF_TOKEN)
        ann = pipe(vocals_path)
        return [(seg.start, seg.end, spk) for seg, _, spk in ann.itertracks(yield_label=True)]
    except Exception:
        return None
