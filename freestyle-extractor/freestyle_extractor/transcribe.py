from .models import Word
from . import config


def load_models():
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
