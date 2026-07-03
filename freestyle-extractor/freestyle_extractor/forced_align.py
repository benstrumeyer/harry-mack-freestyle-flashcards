"""Forced alignment of *provided* lyrics text to a vocal wav -> word timings.

Spec 3 (Eminem / Juice WRLD input path): when the ground-truth lyrics for a
track are already known (e.g. scraped from Genius), we don't need WhisperX to
*guess* the words — only to place their time spans. This module aligns known
lyrics text to the isolated vocal with ``torchaudio.functional.forced_align``
over a CTC emission matrix, producing the same ``list[Word]`` shape that
``transcribe.py`` emits, so the downstream ``analyze()`` stage is unchanged.

Consumes: a vocal wav path + the lyrics string for that clip.
Produces:  ``list[Word]`` (text/start/end/score), identical to ``transcribe()``.

Model: ``torchaudio.pipelines.MMS_FA`` (multilingual CTC forced-alignment head,
free/local, no API key). Loaded lazily via :func:`load_aligner` so unit tests
never touch the GPU, download weights, or read audio — they monkeypatch
:func:`_emissions` with a synthetic emission instead.
"""
import functools
import re
from dataclasses import dataclass

import torch

from . import config
from .models import Word

# Keep lowercase letters and intra-word apostrophes (e.g. "it's"); everything
# else is a separator. Characters absent from the model dictionary are dropped
# at tokenization time.
_WORD_CLEAN = re.compile(r"[^a-z']")


@dataclass
class Aligner:
    """Warm-loaded forced-alignment resources.

    ``model`` maps a waveform to CTC log-probs; ``dictionary`` maps a character
    to its emission column (blank == 0); ``sample_rate`` is the rate the model
    expects, used to convert frame indices back to seconds.
    """

    model: object
    dictionary: dict[str, int]
    sample_rate: int


@functools.lru_cache(maxsize=1)
def load_aligner() -> Aligner:
    """Lazily build and cache the MMS_FA aligner (GPU if configured)."""
    import torchaudio

    bundle = torchaudio.pipelines.MMS_FA
    model = bundle.get_model()
    if config.DEVICE == "cuda" and torch.cuda.is_available():
        model = model.to("cuda")
    return Aligner(
        model=model,
        dictionary=bundle.get_dict(),
        sample_rate=bundle.sample_rate,
    )


def normalize_words(lyrics: str) -> list[str]:
    """Lyrics text -> lowercase word tokens with punctuation stripped."""
    words: list[str] = []
    for raw in lyrics.split():
        cleaned = _WORD_CLEAN.sub("", raw.lower())
        if cleaned:
            words.append(cleaned)
    return words


def _tokenize(words: list[str], dictionary: dict[str, int]):
    """words -> (flat token ids, per-kept-word token count, kept words).

    Characters missing from the dictionary are skipped; a word that maps to no
    tokens is dropped entirely (it cannot be aligned).
    """
    tokens: list[int] = []
    counts: list[int] = []
    kept: list[str] = []
    for w in words:
        ids = [dictionary[c] for c in w if c in dictionary]
        if not ids:
            continue
        tokens.extend(ids)
        counts.append(len(ids))
        kept.append(w)
    return tokens, counts, kept


def _emissions(vocals_path: str, aligner: Aligner):
    """Run the CTC model over the vocal -> ``(log_probs[1, T, C], num_samples)``.

    Isolated behind its own function so unit tests monkeypatch it with a
    synthetic emission and never load the model or decode audio. ``num_samples``
    is measured at ``aligner.sample_rate`` so the caller can map frames -> time.
    """
    import torchaudio
    import torchaudio.functional as AF

    waveform, sr = torchaudio.load(vocals_path)
    if waveform.size(0) > 1:  # downmix to mono
        waveform = waveform.mean(dim=0, keepdim=True)
    if sr != aligner.sample_rate:
        waveform = AF.resample(waveform, sr, aligner.sample_rate)
    device = next(aligner.model.parameters()).device
    with torch.inference_mode():
        emission, _ = aligner.model(waveform.to(device))
    return emission.cpu(), waveform.size(1)


def align_lyrics(
    vocals_path: str, lyrics: str, aligner: Aligner | None = None
) -> list[Word]:
    """Align ``lyrics`` to the vocal at ``vocals_path`` -> word timings.

    Returns one :class:`Word` per alignable lyric word, in order, with
    ``start``/``end`` in seconds and ``score`` the mean per-token confidence.
    """
    import torchaudio.functional as AF

    aligner = aligner or load_aligner()
    words = normalize_words(lyrics)
    tokens, counts, kept = _tokenize(words, aligner.dictionary)
    if not tokens:
        return []

    emission, num_samples = _emissions(vocals_path, aligner)
    num_frames = emission.size(1)
    targets = torch.tensor([tokens], dtype=torch.int32)
    aligned, scores = AF.forced_align(emission, targets, blank=0)
    spans = AF.merge_tokens(aligned[0], scores[0].exp())

    # One span per target token, same order -> unflatten by per-word counts.
    seconds_per_frame = num_samples / num_frames / aligner.sample_rate
    out: list[Word] = []
    i = 0
    for text, n in zip(kept, counts):
        word_spans = spans[i : i + n]
        i += n
        start = word_spans[0].start * seconds_per_frame
        end = word_spans[-1].end * seconds_per_frame
        score = sum(float(s.score) for s in word_spans) / n
        out.append(Word(text=text, start=float(start), end=float(end), score=float(score)))
    return out
