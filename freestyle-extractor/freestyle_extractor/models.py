from pydantic import BaseModel

class Word(BaseModel):
    text: str
    start: float
    end: float
    score: float = 1.0
    speaker: str | None = None

class Bar(BaseModel):
    text: str
    start: float
    end: float
    opener: str | None = None
    rhyme_word: str | None = None
    rhyme_key: str | None = None
    is_freestyle: bool = True
    speaker: str | None = None

class WordPhon(BaseModel):
    ipa: str
    vowel_seq: list[str]
    n_syllables: int

class RhymeEvent(BaseModel):
    word_index: int
    text: str
    bar_index: int
    intra_bar_index: int
    start: float
    end: float
    canonical_key: str | None = None
    delivered_key: str | None = None
    vowel_seq: list[str] = []
    stress: int = 0
    detector: str | None = None
    group_index: int | None = None

class RhymeGroup(BaseModel):
    group_index: int
    hue: int
    word_indices: list[int]
    key: str

class VideoMeta(BaseModel):
    youtube_id: str | None
    title: str | None
    duration_seconds: float | None
    url: str | None

class Analysis(BaseModel):
    words: list[Word] = []
    events: list[RhymeEvent] = []
    groups: list[RhymeGroup] = []
    bar_labels: dict[int, str] = {}
    scheme: dict[int, str] = {}
    density: float = 0.0
    detector_version: int = 0

class ExtractResult(BaseModel):
    video: VideoMeta
    bars: list[Bar]
    analysis: Analysis | None = None

class ExtractRequest(BaseModel):
    url: str
    artist: str = "harry_mack"
    source_type: str = "freestyle"
    # Spec 3 / Phase 6: ground-truth lyrics for the lyrics-align input path.
    # When set (or fetchable via lyricsgenius) for a lyrics-align artist, the
    # pipeline forced-aligns these instead of transcribing.
    lyrics: str | None = None

class Job(BaseModel):
    job_id: str
    status: str = "queued"      # queued | running | done | failed
    stage: str = ""
    progress: float = 0.0
    error: str | None = None
    result: ExtractResult | None = None
