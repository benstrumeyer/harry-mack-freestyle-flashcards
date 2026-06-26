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

class VideoMeta(BaseModel):
    youtube_id: str | None
    title: str | None
    duration_seconds: float | None
    url: str | None

class ExtractResult(BaseModel):
    video: VideoMeta
    bars: list[Bar]

class ExtractRequest(BaseModel):
    url: str
    artist: str = "harry_mack"
    source_type: str = "freestyle"

class Job(BaseModel):
    job_id: str
    status: str = "queued"      # queued | running | done | failed
    stage: str = ""
    progress: float = 0.0
    error: str | None = None
    result: ExtractResult | None = None
