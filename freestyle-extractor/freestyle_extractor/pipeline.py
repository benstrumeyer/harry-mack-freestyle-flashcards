import os

from .models import ExtractRequest, ExtractResult, Analysis, Word, Bar
from . import config
from .download import download, video_id
from .separate import separate, vocals_path
from .transcribe import transcribe
from .diarize import diarize, keep_dominant
from .segment import segment
from .classify import classify
from .label import label
from .delivered import delivered_keys
from .rhyme_events import build_events
from .detectors import label_events, bar_final_events, DETECTOR_VERSION
from .groups import build_groups, scheme_labels
from .density import rhyme_density


def _delivered_for(full_words: list[Word], vocals: str | None) -> list[str | None]:
    """Delivered rhyme keys per word, or all-None when delivery analysis is
    disabled or unavailable. Gated behind config.ENABLE_DELIVERED so the stage
    never touches the GPU/downloads weights by default (and unit tests stay
    deterministic)."""
    none = [None] * len(full_words)
    if not (vocals and config.ENABLE_DELIVERED and os.path.exists(vocals)):
        return none
    try:
        return delivered_keys(vocals, full_words)
    except Exception:
        return none


def analyze(full_words: list[Word], bars: list[Bar],
            vocals_path: str | None, models) -> Analysis:
    """Build a full Analysis from the FULL (unfiltered) word list.

    Assigns every word to a bar, computes canonical + (optional) delivered rhyme
    keys, labels each event with one of the 6 fixed detectors, groups rhyming
    words (hues), and scores rhyme density. Per-event detector and group_index
    are stamped onto the events so downstream persistence can read them
    directly."""
    delivered = _delivered_for(full_words, vocals_path)
    events = build_events(full_words, bars, delivered)

    labels = label_events(events)                 # word_index -> detector
    groups = build_groups(events)
    scheme = scheme_labels(events, groups)
    density = rhyme_density(events)

    word_to_group = {wi: g.group_index for g in groups for wi in g.word_indices}
    for e in events:
        e.detector = labels.get(e.word_index, "none")
        e.group_index = word_to_group.get(e.word_index)

    # Per-bar label = the detector of that bar's final event.
    bar_labels: dict[int, str] = {
        e.bar_index: labels.get(e.word_index, "none")
        for e in bar_final_events(events)
    }

    return Analysis(
        words=full_words,
        events=events,
        groups=groups,
        bar_labels=bar_labels,
        scheme=scheme,
        density=density,
        detector_version=DETECTOR_VERSION,
    )


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
    seg_bars = segment(words)
    bars = label(classify(seg_bars))                 # existing filtered behavior
    on_progress("analyze", 0.95)
    analysis = analyze(words, seg_bars, vocals, models)   # FULL word list
    on_progress("done", 1.0)
    return ExtractResult(video=meta, bars=bars, analysis=analysis)


def analyze_url(req: ExtractRequest, models, on_progress) -> ExtractResult:
    """POST /analyze path: produce an Analysis for a URL, reusing any cached
    wav/vocal in WORK_DIR so an already-ingested video is not re-downloaded or
    re-separated. Returns an ExtractResult with empty bars and analysis set."""
    model, align_model, align_meta = models
    vid = video_id(req.url) or "audio"
    wav = os.path.join(config.WORK_DIR, f"{vid}.wav")

    on_progress("download", 0.1)
    if os.path.exists(wav):
        from .models import VideoMeta
        meta = VideoMeta(youtube_id=vid, title=None, duration_seconds=None, url=req.url)
    else:
        wav, meta = download(req.url, config.WORK_DIR)

    on_progress("separate", 0.3)
    cached_vocals = vocals_path(vid, config.WORK_DIR)
    vocals = cached_vocals if os.path.exists(cached_vocals) else separate(wav, config.WORK_DIR)

    on_progress("transcribe", 0.6)
    words = transcribe(vocals, model, align_model, align_meta)
    on_progress("diarize", 0.8)
    words = keep_dominant(words, diarize(vocals))
    on_progress("analyze", 0.95)
    analysis = analyze(words, segment(words), vocals, models)
    on_progress("done", 1.0)
    return ExtractResult(video=meta, bars=[], analysis=analysis)
