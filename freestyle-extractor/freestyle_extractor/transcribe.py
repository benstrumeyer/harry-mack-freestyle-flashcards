from .models import Word
from . import config


def _enable_full_checkpoint_load():
    """torch>=2.6 defaults torch.load to weights_only=True; whisperx/pyannote
    VAD + align checkpoints carry omegaconf globals and fail to unpickle.
    These checkpoints are trusted (whisperx/pyannote releases) -> load fully."""
    import torch
    try:
        from omegaconf.listconfig import ListConfig
        from omegaconf.dictconfig import DictConfig
        from omegaconf.base import ContainerMetadata, Metadata
        torch.serialization.add_safe_globals([ListConfig, DictConfig, ContainerMetadata, Metadata])
    except Exception:
        pass
    if getattr(torch.load, "_full_ckpt_patch", False):
        return
    _orig = torch.load
    def _patched(*a, **k):
        k["weights_only"] = False
        return _orig(*a, **k)
    _patched._full_ckpt_patch = True
    torch.load = _patched


def load_models():
    _enable_full_checkpoint_load()
    import whisperx
    model = whisperx.load_model(
        config.WHISPER_MODEL, config.DEVICE, compute_type="float16", language="en"
    )
    align_model, align_meta = whisperx.load_align_model(
        language_code="en", device=config.DEVICE
    )
    return model, align_model, align_meta


def to_words(result: dict) -> list[Word]:
    words: list[Word] = []
    for seg in result.get("segments", []):
        for w in seg.get("words", []):
            if "start" in w and "end" in w:   # WhisperX drops timing on un-alignable tokens
                words.append(Word(
                    text=w["word"].strip(),
                    start=float(w["start"]),
                    end=float(w["end"]),
                    score=float(w.get("score", 1.0)),
                ))
    return words


def transcribe(vocals_path: str, model, align_model, align_meta) -> list[Word]:
    import whisperx
    audio = whisperx.load_audio(vocals_path)
    result = model.transcribe(audio, batch_size=16, language="en")
    result = whisperx.align(
        result["segments"], align_model, align_meta, audio,
        config.DEVICE, return_char_alignments=False,
    )
    return to_words(result)
