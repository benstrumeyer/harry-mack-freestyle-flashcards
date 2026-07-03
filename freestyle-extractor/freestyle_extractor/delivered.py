"""Delivered (as-rapped) phoneme keys per word via wav2vec2 phoneme recognition.

Where ``phonetics.py`` produces *canonical* dictionary phonemes for a word
(what espeak says the word "should" sound like), this module produces the
*delivered* phonemes — what the artist actually sang — by running the isolated
vocal track through a phoneme-level ASR model and aligning the recognized
phonemes to each word's time span.

Model: ``facebook/wav2vec2-lv-60-espeak-cv-ft`` (outputs eSpeak-style IPA
phonemes with char-level timestamps). Loaded lazily so unit tests never touch
the GPU or download weights.
"""
import functools

from . import config
from .models import Word

# Vowel tokens the wav2vec2 eSpeak model may emit (IPA), plus the eSpeak ASCII
# vowels used elsewhere in the extractor so shared helpers stay consistent.
_IPA_VOWELS = {
    "a", "e", "i", "o", "u", "y",
    "ɛ", "ɔ", "ɪ", "ʊ", "ə", "ɑ", "æ", "ʌ", "ɒ", "ɜ", "ɐ", "ɚ", "ɝ",
    "ø", "œ", "ɯ", "ɤ", "ɵ", "ɘ", "ɞ", "ɶ", "ʏ", "ɨ", "ʉ", "ɿ",
    # eSpeak ASCII fallbacks
    "A", "E", "I", "O", "U", "V", "Q", "@", "3", "{",
}


def _is_vowel_token(tok: str) -> bool:
    return bool(tok) and tok[0] in _IPA_VOWELS


@functools.lru_cache(maxsize=1)
def load_delivered_model():
    """Lazily build and cache the wav2vec2 phoneme-recognition pipeline."""
    from transformers import pipeline
    device = 0 if config.DEVICE == "cuda" else -1
    return pipeline(
        "automatic-speech-recognition",
        model="facebook/wav2vec2-lv-60-espeak-cv-ft",
        device=device,
        return_timestamps="char",
    )


def _phoneme_frames(vocals_path: str, model):
    """Run the model and return list of (phoneme, start_s, end_s) frames."""
    out = model(vocals_path)
    frames = []
    for ch in out.get("chunks", []):
        ts = ch.get("timestamp") or (None, None)
        tok = (ch.get("text") or "").strip()
        if tok and ts[0] is not None:
            end = ts[1] if ts[1] is not None else ts[0]
            frames.append((tok, float(ts[0]), float(end)))
    return frames


def _tail_key(phonemes: list[str]) -> str | None:
    """Delivered rhyme-tail key: last vowel token of the span plus its coda."""
    last = None
    for i, p in enumerate(phonemes):
        if _is_vowel_token(p):
            last = i
    return "".join(phonemes[last:]) if last is not None else None


def delivered_keys(vocals_path: str, words: list[Word], model=None) -> list[str | None]:
    """One delivered rhyme-tail key per word.

    For each word, take the phoneme frames whose time span overlaps the word's
    ``[start, end]`` interval and reduce them to a tail key (last vowel + coda).
    Returns ``None`` for a word whose span contains no phonemes.
    """
    model = model or load_delivered_model()
    frames = _phoneme_frames(vocals_path, model)
    keys: list[str | None] = []
    for w in words:
        span = [p for (p, s, e) in frames if e >= w.start and s <= w.end]
        keys.append(_tail_key(span))
    return keys
