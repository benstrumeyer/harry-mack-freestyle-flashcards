# Freestyle Bar Extraction (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken YouTube-auto-caption + LLM extraction with a free, local, deterministic pipeline that turns Harry Mack freestyle videos into clean, correctly-segmented, labeled rap bars.

**Architecture:** A new native-host Python FastAPI service (`freestyle-extractor/`) does all audio work (yt-dlp → Demucs → WhisperX → pyannote → rhyme+pause segmentation → espeak/spaCy labeling) and returns bars as JSON. The existing .NET API stops calling yt-dlp/VTT/Gemini, calls the sidecar over HTTP, and remains the only DB writer. The DB moves from Postgres-in-Docker to a local **SQLite** file. Docker is removed; everything runs native.

**Tech Stack:** Python 3.11 (FastAPI, uvicorn, faster-whisper/WhisperX, Demucs, pyannote.audio, spaCy, pytest) · .NET 8 (Microsoft.Data.Sqlite) · React 19/Vite · espeak-ng · yt-dlp.

## Global Constraints

- **Free / $0 external cost.** No paid APIs. (HuggingFace + Genius tokens are free-tier; Genius is Phase 2.)
- **Local only.** Runs on the dev machine (RTX 4060 8GB). GPU jobs serial, one at a time.
- **No generative LLM.** Delete `LlmExtractor` and the `OpenAI` nuget. All labeling is deterministic (espeak-ng + spaCy + rules).
- **No Docker.** Delete `docker-compose.yml` and both `Dockerfile`s. Three native processes.
- **Database: SQLite** single file `freestyle.db` via `Microsoft.Data.Sqlite`. GUIDs generated in C# as lowercase strings; array columns stored as JSON text; timestamps as ISO-8601 text.
- **Phase 1 source: Harry Mack freestyles** (pure-ASR path). Juice WRLD + beat-grid timing are Phase 2 — not in this plan.
- **Bar data contract (the seam between sidecar and .NET) — used verbatim by every task that crosses it:**
  ```json
  // POST /extract request
  { "url": "https://youtu.be/XXXX", "artist": "harry_mack", "source_type": "freestyle" }
  // POST /extract response
  { "job_id": "b1c2..." }
  // GET /jobs/{job_id} response
  { "status": "queued|running|done|failed", "stage": "transcribe", "progress": 0.6,
    "error": null,
    "result": {
      "video": { "youtube_id": "XXXX", "title": "...", "duration_seconds": 213.4, "url": "..." },
      "bars": [
        { "text": "I was born in a world where the people don't care",
          "start": 35.1, "end": 38.0,
          "opener": "I was born in a world",
          "rhyme_word": "care", "rhyme_key": "ɛ r",
          "is_freestyle": true, "speaker": "SPEAKER_00" }
      ]
    }
  }
  ```

---

## File Structure

**New — `freestyle-extractor/` (Python service):**
- `freestyle_extractor/__init__.py` — package marker
- `freestyle_extractor/models.py` — Pydantic models: `ExtractRequest`, `Word`, `Bar`, `VideoMeta`, `ExtractResult`, `Job`
- `freestyle_extractor/config.py` — tunables (`PAUSE_THRESHOLD_MS=300`, `MIN_BAR_WORDS=4`, `MAX_BAR_WORDS=12`, model names, dirs)
- `freestyle_extractor/phonetics.py` — espeak-ng rhyme tails + `rhymes()`
- `freestyle_extractor/segment.py` — word list → bars (pause + rhyme)
- `freestyle_extractor/classify.py` — keep rap, drop talking
- `freestyle_extractor/label.py` — opener (spaCy) + rhyme_word/key
- `freestyle_extractor/download.py` — yt-dlp audio + metadata
- `freestyle_extractor/separate.py` — Demucs vocal isolation
- `freestyle_extractor/transcribe.py` — WhisperX word-level transcript
- `freestyle_extractor/diarize.py` — pyannote keep-dominant (graceful fallback)
- `freestyle_extractor/pipeline.py` — orchestrates the stages → `ExtractResult`
- `freestyle_extractor/app.py` — FastAPI app, job queue, warm model loading
- `freestyle_extractor/requirements.txt`
- `freestyle_extractor/tests/` — pytest unit tests + fixtures

**Modified — .NET backend (`backend/HarryMack.Api/`):**
- `HarryMack.Api.csproj` — drop `Npgsql`, `OpenAI`; add `Microsoft.Data.Sqlite`
- `Program.cs` — SQLite connection factory + schema init; remove Gemini client + `LlmExtractor`; register `ExtractorClient`
- `Data/Db.cs` *(new)* — SQLite connection factory + schema bootstrap
- `Services/ExtractorClient.cs` *(new)* — HTTP client for the sidecar
- `Services/PipelineService.cs` — `ProcessUrlAsync(url, artist)` calls sidecar; SQLite upserts
- `Services/TranscriptParser.cs` — delete `ParseVtt`; keep `ParseLocalTxt`
- `Services/LlmExtractor.cs` — **delete**
- `Services/PhoneticService.cs` — unchanged (still used by validate-rhymes)
- `Controllers/*.cs` — port SQL to SQLite; `PipelineController` gains `artist`
- `Models/Dtos.cs` — add `ProcessUrlRequest.Artist`, sidecar bar DTOs

**Modified — frontend:** `frontend/src/services/api.ts` (`processUrl(url, artist)`), `frontend/src/pages/PipelinePage.tsx` (artist selector).

**Deleted:** `docker-compose.yml`, `backend/Dockerfile`, `frontend/Dockerfile`.
**New (root):** `setup.ps1`, `start.ps1`.

---

# Milestone A — The extractor sidecar (Python)

### Task 1: Scaffold the sidecar package + data models

**Files:**
- Create: `freestyle-extractor/freestyle_extractor/__init__.py`, `models.py`, `config.py`, `requirements.txt`
- Create: `freestyle-extractor/tests/__init__.py`, `freestyle-extractor/pytest.ini`

**Interfaces:**
- Produces: `models.Word(text:str, start:float, end:float, score:float=1.0)`, `models.Bar(text, start, end, opener, rhyme_word, rhyme_key, is_freestyle, speaker)`, `models.VideoMeta(youtube_id, title, duration_seconds, url)`, `models.ExtractResult(video:VideoMeta, bars:list[Bar])`, `models.ExtractRequest(url:str, artist:str, source_type:str)`, `models.Job(...)`.

- [ ] **Step 1: Write `requirements.txt`**
```
fastapi==0.115.*
uvicorn[standard]==0.30.*
pydantic==2.*
yt-dlp==2025.*
faster-whisper==1.*
whisperx==3.*
demucs==4.*
pyannote.audio==3.*
spacy==3.*
pytest==8.*
httpx==0.27.*
```

- [ ] **Step 2: Write the failing test** `freestyle-extractor/tests/test_models.py`
```python
from freestyle_extractor.models import Word, Bar, VideoMeta, ExtractResult

def test_bar_roundtrips_to_dict():
    bar = Bar(text="people don't care", start=35.1, end=38.0, opener="people",
              rhyme_word="care", rhyme_key="ɛ r", is_freestyle=True, speaker="SPEAKER_00")
    d = bar.model_dump()
    assert d["rhyme_word"] == "care" and d["is_freestyle"] is True

def test_extract_result_nests_bars():
    res = ExtractResult(video=VideoMeta(youtube_id="x", title="t", duration_seconds=1.0, url="u"),
                        bars=[Bar(text="a", start=0, end=1, opener=None, rhyme_word=None,
                                  rhyme_key=None, is_freestyle=True, speaker=None)])
    assert res.bars[0].text == "a"
```

- [ ] **Step 3: Run it to confirm it fails**
Run: `cd freestyle-extractor && python -m pytest tests/test_models.py -v`
Expected: FAIL with `ModuleNotFoundError: freestyle_extractor`.

- [ ] **Step 4: Write `freestyle_extractor/models.py`**
```python
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
```

- [ ] **Step 5: Write `config.py` and `__init__.py`**
```python
# freestyle_extractor/config.py
import os, tempfile
PAUSE_THRESHOLD_MS = int(os.getenv("PAUSE_THRESHOLD_MS", "300"))
MIN_BAR_WORDS = int(os.getenv("MIN_BAR_WORDS", "4"))
MAX_BAR_WORDS = int(os.getenv("MAX_BAR_WORDS", "12"))
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "large-v3")
DEMUCS_MODEL = os.getenv("DEMUCS_MODEL", "htdemucs_ft")
DEVICE = os.getenv("DEVICE", "cuda")
WORK_DIR = os.getenv("WORK_DIR", os.path.join(tempfile.gettempdir(), "freestyle"))
HF_TOKEN = os.getenv("HF_TOKEN")  # optional; diarization falls back if absent
```
`__init__.py` is empty. `pytest.ini`:
```ini
[pytest]
testpaths = tests
```

- [ ] **Step 6: Run tests to confirm pass**
Run: `cd freestyle-extractor && python -m pytest tests/test_models.py -v`
Expected: PASS (2 passed).

- [ ] **Step 7: Commit**
```bash
git add freestyle-extractor && git commit -m "feat(extractor): scaffold sidecar package + data models"
```

---

### Task 2: `phonetics.py` — espeak-ng rhyme tails (port of the .NET PhoneticService)

**Files:**
- Create: `freestyle_extractor/phonetics.py`, `tests/test_phonetics.py`

**Interfaces:**
- Produces: `rhyme_tail(word:str) -> str | None` (X-SAMPA-ish tail from last vowel), `rhymes(a:str, b:str) -> bool`.
- Consumes: `espeak-ng -q -x "<word>"` via subprocess (same binary the .NET app already uses).

- [ ] **Step 1: Write the failing test** `tests/test_phonetics.py`
```python
from freestyle_extractor.phonetics import rhyme_tail, rhymes

def test_rhyming_pair_matches():
    assert rhymes("care", "air") is True
    assert rhymes("care", "table") is False

def test_identical_words_rhyme():
    assert rhymes("flow", "flow") is True

def test_rhyme_tail_nonempty_for_real_word():
    assert rhyme_tail("side")  # e.g. "aI d"
```

- [ ] **Step 2: Run to confirm it fails**
Run: `cd freestyle-extractor && python -m pytest tests/test_phonetics.py -v`
Expected: FAIL (`ModuleNotFoundError` / `ImportError`).

- [ ] **Step 3: Implement `phonetics.py`** (mirror the .NET vowel set + last-vowel-onward logic)
```python
import subprocess, functools

_VOWELS = {"a","e","i","o","u","A","E","I","O","U","V","Q","@","3","{",
           "aI","aU","OI","eI","@U","I@","e@","U@","3:","A:","O:","i:","u:"}

@functools.lru_cache(maxsize=4096)
def _phonemes(word: str) -> str:
    try:
        out = subprocess.run(["espeak-ng","-q","-x",word], capture_output=True,
                             text=True, timeout=5)
        return out.stdout.strip()
    except Exception:
        return ""

def rhyme_tail(word: str) -> str | None:
    raw = _phonemes(word)
    if not raw:
        return None
    toks = raw.replace("'", " ").replace(",", " ").split()
    last = None
    for i, t in enumerate(toks):
        if any(t.startswith(v) for v in _VOWELS):
            last = i
    if last is None:
        return None
    return " ".join(toks[last:])

def rhymes(a: str, b: str) -> bool:
    if a.lower() == b.lower():
        return True
    ta, tb = rhyme_tail(a), rhyme_tail(b)
    return ta is not None and ta == tb
```

- [ ] **Step 4: Run to confirm pass**
Run: `cd freestyle-extractor && python -m pytest tests/test_phonetics.py -v`
Expected: PASS (requires `espeak-ng` on PATH).

- [ ] **Step 5: Commit**
```bash
git add freestyle-extractor/freestyle_extractor/phonetics.py freestyle-extractor/tests/test_phonetics.py
git commit -m "feat(extractor): espeak-ng rhyme tails + rhymes()"
```

---

### Task 3: `segment.py` — cut the word stream into bars (THE CORE, pure function)

**Files:**
- Create: `freestyle_extractor/segment.py`, `tests/test_segment.py`, `tests/fixtures/words_care_air.json`

**Interfaces:**
- Consumes: `list[Word]` (Task 1), `phonetics.rhyme_tail` (Task 2), `config` thresholds (Task 1).
- Produces: `segment(words: list[Word]) -> list[Bar]` — bars with `text/start/end` set; opener/rhyme/classification filled by later tasks (leaves `is_freestyle=True`, `rhyme_word=None`).

- [ ] **Step 1: Write fixture** `tests/fixtures/words_care_air.json`
```json
[
  {"text":"people","start":34.0,"end":34.3},{"text":"don't","start":34.3,"end":34.6},
  {"text":"care","start":34.6,"end":35.0},
  {"text":"hands","start":35.5,"end":35.8},{"text":"in","start":35.8,"end":35.9},
  {"text":"the","start":35.9,"end":36.0},{"text":"air","start":36.0,"end":36.4}
]
```

- [ ] **Step 2: Write the failing test** `tests/test_segment.py`
```python
import json, pathlib
from freestyle_extractor.models import Word
from freestyle_extractor.segment import segment

def _load(name):
    data = json.loads((pathlib.Path(__file__).parent/"fixtures"/name).read_text())
    return [Word(**w) for w in data]

def test_pause_splits_into_two_bars():
    bars = segment(_load("words_care_air.json"))
    assert len(bars) == 2
    assert bars[0].text == "people don't care"
    assert bars[1].text == "hands in the air"
    assert bars[0].start == 34.0 and bars[1].end == 36.4

def test_empty_input_returns_empty():
    assert segment([]) == []
```

- [ ] **Step 3: Run to confirm it fails**
Run: `cd freestyle-extractor && python -m pytest tests/test_segment.py -v`
Expected: FAIL (`ImportError`).

- [ ] **Step 4: Implement `segment.py`**
```python
from .models import Word, Bar
from . import config
from .phonetics import rhyme_tail

def _split_on_pauses(words: list[Word]) -> list[list[Word]]:
    if not words:
        return []
    lines, cur = [], [words[0]]
    for prev, w in zip(words, words[1:]):
        gap_ms = (w.start - prev.end) * 1000.0
        if gap_ms > config.PAUSE_THRESHOLD_MS:
            lines.append(cur); cur = []
        cur.append(w)
    if cur:
        lines.append(cur)
    return lines

def _split_overlong(line: list[Word]) -> list[list[Word]]:
    # If a line exceeds MAX_BAR_WORDS, split where an internal word rhymes with the final.
    if len(line) <= config.MAX_BAR_WORDS:
        return [line]
    final_tail = rhyme_tail(line[-1].text)
    for i in range(config.MIN_BAR_WORDS, len(line) - config.MIN_BAR_WORDS):
        if final_tail and rhyme_tail(line[i].text) == final_tail:
            return [line[:i+1], line[i+1:]]
    mid = len(line) // 2
    return [line[:mid], line[mid:]]

def _to_bar(line: list[Word]) -> Bar:
    return Bar(text=" ".join(w.text for w in line),
               start=line[0].start, end=line[-1].end)

def segment(words: list[Word]) -> list[Bar]:
    bars: list[Bar] = []
    for line in _split_on_pauses(words):
        for piece in _split_overlong(line):
            if piece:
                bars.append(_to_bar(piece))
    return bars
```

- [ ] **Step 5: Run to confirm pass**
Run: `cd freestyle-extractor && python -m pytest tests/test_segment.py -v`
Expected: PASS (2 passed).

- [ ] **Step 6: Commit**
```bash
git add freestyle-extractor/freestyle_extractor/segment.py freestyle-extractor/tests/test_segment.py freestyle-extractor/tests/fixtures
git commit -m "feat(extractor): pause+rhyme bar segmentation"
```

---

### Task 4: `classify.py` — keep rap bars, drop talking

**Files:**
- Create: `freestyle_extractor/classify.py`, `tests/test_classify.py`

**Interfaces:**
- Consumes: `list[Bar]` (from `segment`), `phonetics.rhyme_tail`, `config`.
- Produces: `classify(bars: list[Bar]) -> list[Bar]` — sets `is_freestyle` on each bar; returns only the kept (rap) bars.

- [ ] **Step 1: Write the failing test** `tests/test_classify.py`
```python
from freestyle_extractor.models import Bar
from freestyle_extractor.classify import classify

def _bar(text): return Bar(text=text, start=0, end=1)

def test_rhyming_neighbors_are_kept_filler_dropped():
    bars = [_bar("people don't care"), _bar("hands in the air"),
            _bar("yeah"), _bar("what's your name")]
    kept = classify(bars)
    texts = [b.text for b in kept]
    assert "people don't care" in texts and "hands in the air" in texts
    assert "yeah" not in texts and "what's your name" not in texts
```

- [ ] **Step 2: Run to confirm it fails**
Run: `cd freestyle-extractor && python -m pytest tests/test_classify.py -v`
Expected: FAIL (`ImportError`).

- [ ] **Step 3: Implement `classify.py`**
```python
from .models import Bar
from . import config
from .phonetics import rhyme_tail

def _final_word(text: str) -> str | None:
    toks = text.split()
    return toks[-1] if toks else None

def classify(bars: list[Bar]) -> list[Bar]:
    tails = [rhyme_tail(_final_word(b.text) or "") for b in bars]
    kept: list[Bar] = []
    for i, b in enumerate(bars):
        n_words = len(b.text.split())
        # A real bar: plausible length AND its final word rhymes with an adjacent bar's final.
        has_neighbor_rhyme = any(
            tails[i] is not None and tails[i] == tails[j]
            for j in (i - 1, i + 1) if 0 <= j < len(bars)
        )
        is_bar = n_words >= config.MIN_BAR_WORDS and has_neighbor_rhyme
        if is_bar:
            b.is_freestyle = True
            kept.append(b)
    return kept
```

- [ ] **Step 4: Run to confirm pass**
Run: `cd freestyle-extractor && python -m pytest tests/test_classify.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add freestyle-extractor/freestyle_extractor/classify.py freestyle-extractor/tests/test_classify.py
git commit -m "feat(extractor): rhyme-density bar/talk classifier"
```

---

### Task 5: `label.py` — opener (spaCy POS) + rhyme_word/key

**Files:**
- Create: `freestyle_extractor/label.py`, `tests/test_label.py`

**Interfaces:**
- Consumes: `list[Bar]`, `phonetics.rhyme_tail`, spaCy `en_core_web_sm`.
- Produces: `label(bars: list[Bar]) -> list[Bar]` — fills `opener`, `rhyme_word`, `rhyme_key` on each bar.

- [ ] **Step 1: Write the failing test** `tests/test_label.py`
```python
from freestyle_extractor.models import Bar
from freestyle_extractor.label import label

def test_label_sets_rhyme_word_and_opener():
    bars = label([Bar(text="I was born in a world where the people don't care", start=0, end=3)])
    b = bars[0]
    assert b.rhyme_word == "care"
    assert b.rhyme_key  # non-empty espeak tail
    assert b.opener and b.opener.lower().startswith("i was born")
```

- [ ] **Step 2: Run to confirm it fails**
Run: `cd freestyle-extractor && python -m pytest tests/test_label.py -v`
Expected: FAIL (`ImportError`).

- [ ] **Step 3: Implement `label.py`** (opener = leading span up to the first content NOUN/PROPN, capped at 7 words)
```python
import functools, re
from .models import Bar
from .phonetics import rhyme_tail

@functools.lru_cache(maxsize=1)
def _nlp():
    import spacy
    return spacy.load("en_core_web_sm")

def _opener(text: str, max_words: int = 7) -> str:
    doc = _nlp()(text)
    out = []
    for tok in doc:
        if tok.pos_ in ("NOUN", "PROPN") and len(out) >= 2:
            break
        out.append(tok.text)
        if len(out) >= max_words:
            break
    return " ".join(out).strip()

def _final_word(text: str) -> str | None:
    words = re.findall(r"[A-Za-z']+", text)
    return words[-1] if words else None

def label(bars: list[Bar]) -> list[Bar]:
    for b in bars:
        rw = _final_word(b.text)
        b.rhyme_word = rw
        b.rhyme_key = rhyme_tail(rw) if rw else None
        b.opener = _opener(b.text)
    return bars
```

- [ ] **Step 4: Run to confirm pass**
Run: `cd freestyle-extractor && python -m spacy download en_core_web_sm && python -m pytest tests/test_label.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add freestyle-extractor/freestyle_extractor/label.py freestyle-extractor/tests/test_label.py
git commit -m "feat(extractor): opener + rhyme labeling"
```

---

### Task 6: `download.py` — yt-dlp audio + metadata

**Files:**
- Create: `freestyle_extractor/download.py`, `tests/test_download.py`

**Interfaces:**
- Produces: `download(url:str, work_dir:str) -> tuple[str, VideoMeta]` returning `(wav_path, VideoMeta)`.

- [ ] **Step 1: Write the failing test** (mock subprocess + metadata JSON, no network)
```python
# tests/test_download.py
import json
from freestyle_extractor import download as dl

def test_video_id_extracted_from_url():
    assert dl.video_id("https://youtu.be/abc123XYZ_1") == "abc123XYZ_1"
    assert dl.video_id("https://www.youtube.com/watch?v=abc123XYZ_1") == "abc123XYZ_1"
```

- [ ] **Step 2: Run to confirm it fails**
Run: `cd freestyle-extractor && python -m pytest tests/test_download.py -v`
Expected: FAIL (`ImportError`).

- [ ] **Step 3: Implement `download.py`**
```python
import json, os, re, subprocess
from .models import VideoMeta

_ID = re.compile(r"(?:v=|youtu\.be/|shorts/)([A-Za-z0-9_-]{11})")

def video_id(url: str) -> str | None:
    m = _ID.search(url)
    return m.group(1) if m else None

def download(url: str, work_dir: str) -> tuple[str, VideoMeta]:
    os.makedirs(work_dir, exist_ok=True)
    vid = video_id(url) or "audio"
    wav = os.path.join(work_dir, f"{vid}.wav")
    subprocess.run(["yt-dlp", "-x", "--audio-format", "wav", "--no-progress",
                    "-o", os.path.join(work_dir, f"{vid}.%(ext)s"), url], check=True)
    meta = subprocess.run(["yt-dlp", "--no-progress", "--skip-download",
                           "--print", "%(id)s\t%(title)s\t%(duration)s", url],
                          capture_output=True, text=True, check=True).stdout.strip().split("\t")
    return wav, VideoMeta(youtube_id=meta[0], title=meta[1],
                          duration_seconds=float(meta[2]) if meta[2] not in ("", "NA") else None,
                          url=url)
```

- [ ] **Step 4: Run to confirm pass**
Run: `cd freestyle-extractor && python -m pytest tests/test_download.py -v`
Expected: PASS.

- [ ] **Step 5: Manual smoke (real network, run once by hand)**
Run: `python -c "from freestyle_extractor.download import download; print(download('https://youtu.be/<short_hm_clip>', '.work')[1])"`
Expected: prints a `VideoMeta` with title/duration; `<id>.wav` exists.

- [ ] **Step 6: Commit**
```bash
git add freestyle-extractor/freestyle_extractor/download.py freestyle-extractor/tests/test_download.py
git commit -m "feat(extractor): yt-dlp audio download + metadata"
```

---

### Task 7: `separate.py` — Demucs vocal isolation

**Files:** Create `freestyle_extractor/separate.py`, `tests/test_separate.py`.

**Interfaces:** Produces `separate(wav_path:str, work_dir:str) -> str` (path to `vocals.wav`).

- [ ] **Step 1: Write the failing test** (path-shape only; the heavy run is a manual smoke)
```python
# tests/test_separate.py
from freestyle_extractor import separate
def test_vocals_path_shape(tmp_path):
    assert separate.vocals_path("song", str(tmp_path)).endswith("vocals.wav")
```

- [ ] **Step 2: Run to confirm it fails** — `python -m pytest tests/test_separate.py -v` → FAIL.

- [ ] **Step 3: Implement `separate.py`** (per research: `htdemucs_ft --two-stems=vocals`, run on original mix)
```python
import os, subprocess
from . import config

def vocals_path(stem: str, work_dir: str) -> str:
    return os.path.join(work_dir, config.DEMUCS_MODEL, stem, "vocals.wav")

def separate(wav_path: str, work_dir: str) -> str:
    stem = os.path.splitext(os.path.basename(wav_path))[0]
    subprocess.run(["demucs", "-n", config.DEMUCS_MODEL, "--two-stems=vocals",
                    "-o", work_dir, wav_path], check=True)
    out = vocals_path(stem, work_dir)
    if not os.path.exists(out):
        raise RuntimeError(f"Demucs produced no vocals at {out}")
    return out
```

- [ ] **Step 4: Run to confirm pass** — `python -m pytest tests/test_separate.py -v` → PASS.

- [ ] **Step 5: Manual smoke** — run `separate('<id>.wav', '.work')` on the Task 6 clip; confirm `vocals.wav` exists and sounds isolated.

- [ ] **Step 6: Commit**
```bash
git add freestyle-extractor/freestyle_extractor/separate.py freestyle-extractor/tests/test_separate.py
git commit -m "feat(extractor): demucs vocal isolation"
```

---

### Task 8: `transcribe.py` — WhisperX word-level transcript

**Files:** Create `freestyle_extractor/transcribe.py`, `tests/test_transcribe.py`.

**Interfaces:** Produces `transcribe(vocals_path:str, model, align_model, align_meta) -> list[Word]`; plus `load_models() -> tuple` for warm reuse.

- [ ] **Step 1: Write the failing test** (parser-only unit test on a fake WhisperX result dict)
```python
# tests/test_transcribe.py
from freestyle_extractor.transcribe import to_words

def test_to_words_flattens_segments():
    result = {"segments": [
        {"words": [{"word":"care","start":1.0,"end":1.4,"score":0.9},
                   {"word":"air","start":1.9,"end":2.3,"score":0.8}]}]}
    ws = to_words(result)
    assert [w.text for w in ws] == ["care","air"]
    assert ws[0].start == 1.0 and ws[1].end == 2.3
```

- [ ] **Step 2: Run to confirm it fails** — `python -m pytest tests/test_transcribe.py -v` → FAIL.

- [ ] **Step 3: Implement `transcribe.py`** (per research: large-v3 text + wav2vec2 align, `language="en"`, VAD on)
```python
from .models import Word
from . import config

def load_models():
    import whisperx
    model = whisperx.load_model(config.WHISPER_MODEL, config.DEVICE, compute_type="float16",
                                language="en")
    align_model, align_meta = whisperx.load_align_model(language_code="en", device=config.DEVICE)
    return model, align_model, align_meta

def to_words(result: dict) -> list[Word]:
    words: list[Word] = []
    for seg in result.get("segments", []):
        for w in seg.get("words", []):
            if "start" in w and "end" in w:   # WhisperX drops timing on un-alignable tokens
                words.append(Word(text=w["word"].strip(), start=float(w["start"]),
                                  end=float(w["end"]), score=float(w.get("score", 1.0))))
    return words

def transcribe(vocals_path: str, model, align_model, align_meta) -> list[Word]:
    import whisperx
    audio = whisperx.load_audio(vocals_path)
    result = model.transcribe(audio, batch_size=16, language="en")
    result = whisperx.align(result["segments"], align_model, align_meta, audio,
                            config.DEVICE, return_char_alignments=False)
    return to_words(result)
```

- [ ] **Step 4: Run to confirm pass** — `python -m pytest tests/test_transcribe.py -v` → PASS.

- [ ] **Step 5: Manual smoke** — transcribe the Task 7 `vocals.wav`; eyeball that words + timings look right.

- [ ] **Step 6: Commit**
```bash
git add freestyle-extractor/freestyle_extractor/transcribe.py freestyle-extractor/tests/test_transcribe.py
git commit -m "feat(extractor): whisperx word-level transcription"
```

---

### Task 9: `diarize.py` — keep dominant speaker, graceful fallback

**Files:** Create `freestyle_extractor/diarize.py`, `tests/test_diarize.py`.

**Interfaces:** Produces `keep_dominant(words:list[Word], turns:list[tuple[float,float,str]]) -> list[Word]` (pure, testable) and `diarize(vocals_path:str) -> list[tuple]|None` (pyannote; `None` on any failure → caller keeps all).

- [ ] **Step 1: Write the failing test** (pure assignment logic, no model)
```python
# tests/test_diarize.py
from freestyle_extractor.models import Word
from freestyle_extractor.diarize import keep_dominant

def test_keep_dominant_filters_minority_speaker():
    words = [Word(text="a",start=0.0,end=0.4), Word(text="b",start=0.5,end=0.9),
             Word(text="c",start=5.0,end=5.4)]
    turns = [(0.0,1.0,"S0"),(0.0,1.0,"S0"),(4.9,5.5,"S1")]  # S0 dominant
    kept = keep_dominant(words, turns)
    assert [w.text for w in kept] == ["a","b"]

def test_none_turns_keeps_all():
    words = [Word(text="a",start=0,end=1)]
    assert keep_dominant(words, None) == words
```

- [ ] **Step 2: Run to confirm it fails** — `python -m pytest tests/test_diarize.py -v` → FAIL.

- [ ] **Step 3: Implement `diarize.py`**
```python
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
```

- [ ] **Step 4: Run to confirm pass** — `python -m pytest tests/test_diarize.py -v` → PASS.

- [ ] **Step 5: Commit**
```bash
git add freestyle-extractor/freestyle_extractor/diarize.py freestyle-extractor/tests/test_diarize.py
git commit -m "feat(extractor): diarization keep-dominant with graceful fallback"
```

---

### Task 10: `pipeline.py` — orchestrate the stages

**Files:** Create `freestyle_extractor/pipeline.py`, `tests/test_pipeline.py`.

**Interfaces:**
- Consumes: every stage module above + a `Models` bundle (warm WhisperX models) injected for testability.
- Produces: `run(req: ExtractRequest, models, on_progress) -> ExtractResult`.

- [ ] **Step 1: Write the failing test** (inject fakes for the heavy stages; assert orchestration + ordering)
```python
# tests/test_pipeline.py
from freestyle_extractor.models import ExtractRequest, Word, VideoMeta
from freestyle_extractor import pipeline as P

def test_run_orders_stages_and_returns_bars(monkeypatch):
    monkeypatch.setattr(P, "download", lambda url, wd: ("a.wav", VideoMeta(youtube_id="x", title="t", duration_seconds=1.0, url=url)))
    monkeypatch.setattr(P, "separate", lambda wav, wd: "vocals.wav")
    monkeypatch.setattr(P, "transcribe", lambda v, m, am, ameta: [
        Word(text="people",start=0.0,end=0.3), Word(text="don't",start=0.3,end=0.6), Word(text="care",start=0.6,end=1.0),
        Word(text="hands",start=1.5,end=1.8), Word(text="in",start=1.8,end=1.9), Word(text="the",start=1.9,end=2.0), Word(text="air",start=2.0,end=2.4)])
    monkeypatch.setattr(P, "diarize", lambda v: None)
    res = P.run(ExtractRequest(url="u", artist="harry_mack"), models=(None,None,None), on_progress=lambda *a: None)
    assert res.video.youtube_id == "x"
    assert [b.rhyme_word for b in res.bars] == ["care","air"]
```

- [ ] **Step 2: Run to confirm it fails** — `python -m pytest tests/test_pipeline.py -v` → FAIL.

- [ ] **Step 3: Implement `pipeline.py`**
```python
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
```

- [ ] **Step 4: Run to confirm pass** — `python -m pytest tests/test_pipeline.py -v` → PASS.

- [ ] **Step 5: Commit**
```bash
git add freestyle-extractor/freestyle_extractor/pipeline.py freestyle-extractor/tests/test_pipeline.py
git commit -m "feat(extractor): stage orchestration pipeline"
```

---

### Task 11: `app.py` — FastAPI service, warm models, serial job queue

**Files:** Create `freestyle_extractor/app.py`, `tests/test_app.py`.

**Interfaces:**
- Produces HTTP: `POST /extract` → `{job_id}`; `GET /jobs/{id}` → `Job`; `GET /health` → `{ok:true}`.
- A single background worker thread runs one job at a time (serial GPU). Models loaded once at startup and passed to `pipeline.run`.

- [ ] **Step 1: Write the failing test** (TestClient; inject a fake `run` so no GPU)
```python
# tests/test_app.py
from fastapi.testclient import TestClient
from freestyle_extractor.models import ExtractResult, VideoMeta, Bar
from freestyle_extractor import app as A

def test_extract_enqueues_and_completes(monkeypatch):
    monkeypatch.setattr(A, "_load_models", lambda: (None,None,None))
    monkeypatch.setattr(A, "_run", lambda req, models, prog: ExtractResult(
        video=VideoMeta(youtube_id="x",title="t",duration_seconds=1.0,url="u"),
        bars=[Bar(text="people don't care",start=0,end=1,rhyme_word="care",rhyme_key="ɛ r")]))
    client = TestClient(A.create_app())
    jid = client.post("/extract", json={"url":"u","artist":"harry_mack"}).json()["job_id"]
    A.drain()  # process the queue synchronously in the test
    job = client.get(f"/jobs/{jid}").json()
    assert job["status"] == "done"
    assert job["result"]["bars"][0]["rhyme_word"] == "care"
```

- [ ] **Step 2: Run to confirm it fails** — `python -m pytest tests/test_app.py -v` → FAIL.

- [ ] **Step 3: Implement `app.py`** (queue + worker; `_run`/`_load_models` are module-level so tests can patch them; `drain()` for tests)
```python
import queue, threading, uuid
from fastapi import FastAPI, HTTPException
from .models import ExtractRequest, Job
from .pipeline import run as _run

_jobs: dict[str, Job] = {}
_q: "queue.Queue[tuple[str, ExtractRequest]]" = queue.Queue()
_models = None

def _load_models():
    from .transcribe import load_models
    return load_models()

def _process(job_id: str, req: ExtractRequest):
    global _models
    job = _jobs[job_id]; job.status = "running"
    try:
        if _models is None:
            _models = _load_models()
        def prog(stage, p): job.stage, job.progress = stage, p
        job.result = _run(req, _models, prog)
        job.status = "done"; job.progress = 1.0
    except Exception as e:
        job.status = "failed"; job.error = str(e)

def drain():  # test helper: run all queued jobs synchronously
    while not _q.empty():
        jid, req = _q.get(); _process(jid, req)

def _worker():
    while True:
        jid, req = _q.get(); _process(jid, req)

def create_app() -> FastAPI:
    app = FastAPI()

    @app.get("/health")
    def health(): return {"ok": True}

    @app.post("/extract")
    def extract(req: ExtractRequest):
        jid = uuid.uuid4().hex
        _jobs[jid] = Job(job_id=jid)
        _q.put((jid, req))
        return {"job_id": jid}

    @app.get("/jobs/{jid}")
    def get_job(jid: str):
        if jid not in _jobs:
            raise HTTPException(404, "no such job")
        return _jobs[jid]

    return app

app = create_app()
threading.Thread(target=_worker, daemon=True).start()
```

- [ ] **Step 4: Run to confirm pass** — `python -m pytest tests/test_app.py -v` → PASS.

- [ ] **Step 5: Manual smoke** — `uvicorn freestyle_extractor.app:app --port 8900`, then `curl -X POST localhost:8900/extract -d '{"url":"https://youtu.be/<clip>","artist":"harry_mack"}' -H "Content-Type: application/json"`; poll `/jobs/{id}` to `done`; eyeball bars.

- [ ] **Step 6: Commit**
```bash
git add freestyle-extractor/freestyle_extractor/app.py freestyle-extractor/tests/test_app.py
git commit -m "feat(extractor): FastAPI service with serial GPU job queue"
```

---

# Milestone B — .NET: migrate Postgres → SQLite (no behavior change)

### Task 12: Add SQLite, a connection factory, and schema bootstrap

**Files:**
- Modify: `backend/HarryMack.Api/HarryMack.Api.csproj`
- Create: `backend/HarryMack.Api/Data/Db.cs`
- Modify: `backend/HarryMack.Api/Program.cs:1-60` (DI + startup migration)
- Create: `backend/HarryMack.Api.Tests/` xUnit project with `DbTests.cs`

**Interfaces:**
- Produces: `Data.Db` with `SqliteConnection Open()` and `static Task InitSchemaAsync(string connString)`; DI registers `Db` singleton (built from `ConnectionStrings:Default`, default `Data Source=freestyle.db`).

- [ ] **Step 1: Edit `HarryMack.Api.csproj`** — replace the `ItemGroup`:
```xml
  <ItemGroup>
    <PackageReference Include="Microsoft.Data.Sqlite" Version="8.0.*" />
  </ItemGroup>
```

- [ ] **Step 2: Create the xUnit test project + failing test**
```bash
cd backend && dotnet new xunit -n HarryMack.Api.Tests && \
  dotnet add HarryMack.Api.Tests reference HarryMack.Api/HarryMack.Api.csproj && \
  dotnet add HarryMack.Api.Tests package Microsoft.Data.Sqlite
```
`backend/HarryMack.Api.Tests/DbTests.cs`:
```csharp
using HarryMack.Api.Data;
using Microsoft.Data.Sqlite;
using Xunit;

public class DbTests
{
    [Fact]
    public async Task InitSchema_CreatesVideosTable()
    {
        var cs = "Data Source=file:memdb1?mode=memory&cache=shared";
        await using var keepAlive = new SqliteConnection(cs);
        await keepAlive.OpenAsync();
        await Db.InitSchemaAsync(cs);
        await using var conn = new SqliteConnection(cs);
        await conn.OpenAsync();
        var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT name FROM sqlite_master WHERE type='table' AND name='videos'";
        Assert.Equal("videos", await cmd.ExecuteScalarAsync());
    }
}
```

- [ ] **Step 3: Run to confirm it fails** — `cd backend && dotnet test` → FAIL (`Db` not found).

- [ ] **Step 4: Create `Data/Db.cs`** (SQLite schema; UUID→TEXT, arrays→JSON text, timestamps→TEXT)
```csharp
using Microsoft.Data.Sqlite;

namespace HarryMack.Api.Data;

public sealed class Db(string connectionString)
{
    public SqliteConnection Open()
    {
        var c = new SqliteConnection(connectionString);
        c.Open();
        return c;
    }

    public static async Task InitSchemaAsync(string connectionString)
    {
        await using var conn = new SqliteConnection(connectionString);
        await conn.OpenAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
        CREATE TABLE IF NOT EXISTS videos (
            id TEXT PRIMARY KEY, youtube_id TEXT UNIQUE, title TEXT,
            source TEXT NOT NULL DEFAULT 'local', filename TEXT UNIQUE, url TEXT,
            artist TEXT, source_type TEXT, processed_at TEXT DEFAULT (datetime('now')));
        CREATE TABLE IF NOT EXISTS bars (
            id TEXT PRIMARY KEY,
            video_id TEXT REFERENCES videos(id) ON DELETE CASCADE,
            text TEXT NOT NULL, timestamp_seconds REAL, end_seconds REAL,
            bar_index INTEGER, is_freestyle INTEGER DEFAULT 1, speaker TEXT);
        CREATE TABLE IF NOT EXISTS openers (
            id TEXT PRIMARY KEY, text TEXT UNIQUE NOT NULL,
            frequency INTEGER DEFAULT 1, example_completions TEXT DEFAULT '[]');
        CREATE TABLE IF NOT EXISTS opener_sources (
            opener_id TEXT REFERENCES openers(id) ON DELETE CASCADE,
            bar_id TEXT REFERENCES bars(id) ON DELETE CASCADE,
            PRIMARY KEY (opener_id, bar_id));
        CREATE TABLE IF NOT EXISTS rhyme_words (
            id TEXT PRIMARY KEY, word TEXT UNIQUE NOT NULL,
            phonemes TEXT, frequency INTEGER DEFAULT 1);
        CREATE TABLE IF NOT EXISTS rhyme_pairs (
            word_a_id TEXT REFERENCES rhyme_words(id) ON DELETE CASCADE,
            word_b_id TEXT REFERENCES rhyme_words(id) ON DELETE CASCADE,
            frequency INTEGER DEFAULT 1, PRIMARY KEY (word_a_id, word_b_id));
        CREATE TABLE IF NOT EXISTS rhyme_word_bars (
            word_id TEXT REFERENCES rhyme_words(id) ON DELETE CASCADE,
            bar_id TEXT REFERENCES bars(id) ON DELETE CASCADE,
            PRIMARY KEY (word_id, bar_id));
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY, started_at TEXT DEFAULT (datetime('now')),
            cards_shown TEXT DEFAULT '[]');
        CREATE TABLE IF NOT EXISTS saved_openers (
            id TEXT PRIMARY KEY, opener_id TEXT REFERENCES openers(id) ON DELETE SET NULL,
            text TEXT NOT NULL, saved_at TEXT DEFAULT (datetime('now')));";
        await cmd.ExecuteNonQueryAsync();
    }
}
```

- [ ] **Step 5: Rewrite `Program.cs` DI + startup** (remove Npgsql + Gemini; add `Db` + schema init; keep CORS/controllers)
```csharp
using HarryMack.Api.Data;
using HarryMack.Api.Services;

var builder = WebApplication.CreateBuilder(args);

var connectionString = builder.Configuration.GetConnectionString("Default")
    ?? "Data Source=freestyle.db";
builder.Services.AddSingleton(new Db(connectionString));

builder.Services.AddSingleton<TranscriptParser>();
builder.Services.AddSingleton<PhoneticService>();
builder.Services.AddHttpClient<ExtractorClient>(c =>
    c.BaseAddress = new Uri(builder.Configuration["ExtractorBaseUrl"] ?? "http://localhost:8900"));
builder.Services.AddScoped<PipelineService>();

builder.Services.AddControllers();
builder.Services.AddCors(o => o.AddDefaultPolicy(p =>
    p.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader()));

var app = builder.Build();
await Db.InitSchemaAsync(connectionString);
app.UseCors();
app.MapControllers();
app.Run();
```
> NOTE: this references `ExtractorClient` (Task 14) and the SQLite-ported `PipelineService` (Task 15). Build will not be green until those land — that's expected; this milestone's green gate is the `DbTests` schema test plus the per-controller tests in Task 13.

- [ ] **Step 6: Run the schema test** — `cd backend && dotnet test --filter DbTests` → PASS.

- [ ] **Step 7: Commit**
```bash
git add backend/HarryMack.Api/HarryMack.Api.csproj backend/HarryMack.Api/Data backend/HarryMack.Api/Program.cs backend/HarryMack.Api.Tests
git commit -m "feat(db): add SQLite Db factory + schema bootstrap"
```

---

### Task 13: Port all raw SQL from Npgsql/Postgres to SQLite

**Files:** Modify every data-access call in `Services/PipelineService.cs`, `Controllers/OpenersController.cs`, `RhymesController.cs`, `SessionsController.cs`, `SavedOpenersController.cs`. Create `Data/Json.cs` helper. Test: `backend/HarryMack.Api.Tests/SqlPortTests.cs`.

**Interfaces:**
- Consumes: `Db.Open()` (Task 12).
- Produces: every query uses `SqliteCommand`, `$id`-style named params, C#-generated GUID strings (`Guid.NewGuid().ToString("N")`), JSON for array columns via `Data.Json`.

**Porting rules (apply mechanically to each query):**
- `NpgsqlConnection`/`NpgsqlCommand` → `SqliteConnection`/`SqliteCommand`; `dataSource.OpenConnectionAsync()` → `db.Open()`.
- Positional `$1,$2` → named `$p1,$p2`; `cmd.Parameters.AddWithValue("$p1", val)`.
- `gen_random_uuid()` removed — generate `var id = Guid.NewGuid().ToString("N")` in C# and insert it.
- `RETURNING id` → keep (SQLite ≥3.35 via Microsoft.Data.Sqlite supports it); read with `ExecuteScalarAsync`. (For inserts where we generate the id, just use the generated id and skip RETURNING.)
- `ON CONFLICT (col) DO UPDATE SET x = table.x + 1` → `ON CONFLICT(col) DO UPDATE SET x = x + 1` (drop the table-qualified name).
- `example_completions TEXT[]` + `array_append(...)` → read JSON, append in C#, write JSON (`Data.Json`).
- `cards_shown UUID[]` → JSON text array of id strings.
- `NOW()` → `datetime('now')`; timestamps read as TEXT.

- [ ] **Step 1: Create `Data/Json.cs`**
```csharp
using System.Text.Json;
namespace HarryMack.Api.Data;
public static class Json
{
    public static string[] ToArray(string? json) =>
        string.IsNullOrWhiteSpace(json) ? Array.Empty<string>()
        : JsonSerializer.Deserialize<string[]>(json) ?? Array.Empty<string>();
    public static string Append(string? json, string item)
    {
        var list = new List<string>(ToArray(json)) { item };
        return JsonSerializer.Serialize(list);
    }
    public static string Of(IEnumerable<string> items) => JsonSerializer.Serialize(items);
}
```

- [ ] **Step 2: Write the failing test** `SqlPortTests.cs` (opener upsert round-trip on a shared in-memory DB)
```csharp
using HarryMack.Api.Data;
using Microsoft.Data.Sqlite;
using Xunit;

public class SqlPortTests
{
    [Fact]
    public async Task OpenerUpsert_IncrementsFrequency_AndAppendsCompletion()
    {
        var cs = "Data Source=file:memdb2?mode=memory&cache=shared";
        await using var keep = new SqliteConnection(cs); await keep.OpenAsync();
        await Db.InitSchemaAsync(cs);
        var db = new Db(cs);
        async Task Upsert(string completion)
        {
            await using var c = db.Open();
            var cmd = c.CreateCommand();
            cmd.CommandText = @"INSERT INTO openers (id, text, frequency, example_completions)
                VALUES ($id,$t,1,json_array($c))
                ON CONFLICT(text) DO UPDATE SET frequency = frequency + 1";
            cmd.Parameters.AddWithValue("$id", System.Guid.NewGuid().ToString("N"));
            cmd.Parameters.AddWithValue("$t", "I was born");
            cmd.Parameters.AddWithValue("$c", completion);
            await cmd.ExecuteNonQueryAsync();
        }
        await Upsert("in a world"); await Upsert("on the block");
        await using var conn = db.Open();
        var q = conn.CreateCommand();
        q.CommandText = "SELECT frequency FROM openers WHERE text='I was born'";
        Assert.Equal(2L, (long)(await q.ExecuteScalarAsync())!);
    }
}
```

- [ ] **Step 3: Run to confirm it fails** — `cd backend && dotnet test --filter SqlPortTests` → FAIL (compile or assertion).

- [ ] **Step 4: Port `PipelineService` SQL** — apply the porting rules to every query in `UpsertResultsAsync`, `ProcessLocalAsync`, `ResetAllAsync`, `ValidateRhymePairsAsync`, `GetStatusAsync`, `FileAlreadyProcessedAsync`. Example — the opener upsert becomes:
```csharp
var openerId = Guid.NewGuid().ToString("N");
var op = conn.CreateCommand();
op.CommandText = @"INSERT INTO openers (id, text, frequency, example_completions)
    VALUES ($id,$t,1,json_array($c))
    ON CONFLICT(text) DO UPDATE SET frequency = frequency + 1
    RETURNING id";
op.Parameters.AddWithValue("$id", openerId);
op.Parameters.AddWithValue("$t", bar.Opener!);
op.Parameters.AddWithValue("$c", bar.Text);
var existingId = (string)(await op.ExecuteScalarAsync())!;
// append completion on conflict path:
var upd = conn.CreateCommand();
upd.CommandText = "UPDATE openers SET example_completions = json_insert(example_completions, '$[#]', $c) WHERE id=$id";
upd.Parameters.AddWithValue("$c", bar.Text);
upd.Parameters.AddWithValue("$id", existingId);
await upd.ExecuteNonQueryAsync();
```
Replicate the rule-driven port for `bars`, `rhyme_words`, `rhyme_word_bars`, `rhyme_pairs`, `videos`. Build a `rhyme_pairs` row for each pair of bars in the same video sharing a non-null `rhyme_key` (canonical order: `string.CompareOrdinal(a,b) < 0`).

- [ ] **Step 5: Port the four controllers' SQL** — `OpenersController` (read `example_completions` via `Data.Json.ToArray`), `RhymesController` (graph query unchanged structurally; params renamed), `SessionsController` (`cards_shown` as JSON via `Data.Json`), `SavedOpenersController`. Each `DateTimeOffset` reads from a TEXT column via `DateTimeOffset.Parse(reader.GetString(n))`.

- [ ] **Step 6: Run to confirm pass** — `cd backend && dotnet test --filter SqlPortTests` → PASS, then `dotnet build` (the controllers compile against SQLite).

- [ ] **Step 7: Commit**
```bash
git add backend/HarryMack.Api backend/HarryMack.Api.Tests
git commit -m "feat(db): port all raw SQL from Npgsql/Postgres to SQLite"
```

---

# Milestone C — Wire .NET to the sidecar, remove the LLM

### Task 14: `ExtractorClient` — HTTP client (enqueue + poll)

**Files:** Create `backend/HarryMack.Api/Services/ExtractorClient.cs`, add bar DTOs to `Models/Dtos.cs`. Test: `backend/HarryMack.Api.Tests/ExtractorClientTests.cs`.

**Interfaces:**
- Produces: `Task<ExtractResultDto> ExtractAsync(string url, string artist, CancellationToken ct)` — POSTs `/extract`, polls `/jobs/{id}` until `done|failed`, throws on `failed`.
- DTOs (match the §Data Contract): `ExtractResultDto(VideoMetaDto Video, List<SidecarBarDto> Bars)`, `SidecarBarDto(string Text, double Start, double End, string? Opener, string? RhymeWord, string? RhymeKey, bool IsFreestyle, string? Speaker)`, `VideoMetaDto(string? YoutubeId, string? Title, double? DurationSeconds, string? Url)`, `JobDto(string Status, string Stage, double Progress, string? Error, ExtractResultDto? Result)`.

- [ ] **Step 1: Add the DTOs to `Models/Dtos.cs`** (camelCase JSON to match FastAPI):
```csharp
public record VideoMetaDto(string? YoutubeId, string? Title, double? DurationSeconds, string? Url);
public record SidecarBarDto(string Text, double Start, double End, string? Opener,
    string? RhymeWord, string? RhymeKey, bool IsFreestyle, string? Speaker);
public record ExtractResultDto(VideoMetaDto Video, List<SidecarBarDto> Bars);
public record JobDto(string Status, string Stage, double Progress, string? Error, ExtractResultDto? Result);
```

- [ ] **Step 2: Write the failing test** (a stub `HttpMessageHandler` returning enqueue then done)
```csharp
using System.Net;
using System.Text;
using HarryMack.Api.Services;
using Xunit;

public class ExtractorClientTests
{
    class StubHandler : HttpMessageHandler
    {
        int _polls;
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage r, CancellationToken ct)
        {
            string body = r.RequestUri!.AbsolutePath.EndsWith("/extract")
                ? "{\"job_id\":\"j1\"}"
                : (_polls++ == 0
                    ? "{\"status\":\"running\",\"stage\":\"transcribe\",\"progress\":0.6,\"error\":null,\"result\":null}"
                    : "{\"status\":\"done\",\"stage\":\"done\",\"progress\":1.0,\"error\":null,\"result\":{\"video\":{\"youtubeId\":\"x\",\"title\":\"t\",\"durationSeconds\":1.0,\"url\":\"u\"},\"bars\":[{\"text\":\"people don't care\",\"start\":0,\"end\":1,\"opener\":\"people\",\"rhymeWord\":\"care\",\"rhymeKey\":\"e r\",\"isFreestyle\":true,\"speaker\":null}]}}");
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
                { Content = new StringContent(body, Encoding.UTF8, "application/json") });
        }
    }

    [Fact]
    public async Task ExtractAsync_PollsToDone_ReturnsBars()
    {
        var http = new HttpClient(new StubHandler()) { BaseAddress = new Uri("http://localhost:8900") };
        var client = new ExtractorClient(http) { PollDelayMs = 0 };
        var res = await client.ExtractAsync("u", "harry_mack", default);
        Assert.Single(res.Bars);
        Assert.Equal("care", res.Bars[0].RhymeWord);
    }
}
```

- [ ] **Step 3: Run to confirm it fails** — `cd backend && dotnet test --filter ExtractorClientTests` → FAIL.

- [ ] **Step 4: Implement `ExtractorClient.cs`**
```csharp
using System.Net.Http.Json;
using System.Text.Json;
using HarryMack.Api.Models;

namespace HarryMack.Api.Services;

public class ExtractorClient(HttpClient http)
{
    public int PollDelayMs { get; set; } = 1500;
    private static readonly JsonSerializerOptions J = new(JsonSerializerDefaults.Web);

    public async Task<ExtractResultDto> ExtractAsync(string url, string artist, CancellationToken ct)
    {
        var enq = await http.PostAsJsonAsync("/extract",
            new { url, artist, source_type = "freestyle" }, ct);
        enq.EnsureSuccessStatusCode();
        var jobId = (await enq.Content.ReadFromJsonAsync<JsonElement>(cancellationToken: ct))
            .GetProperty("job_id").GetString()!;
        while (true)
        {
            var job = await http.GetFromJsonAsync<JobDto>($"/jobs/{jobId}", J, ct)
                ?? throw new InvalidOperationException("null job");
            if (job.Status == "failed")
                throw new InvalidOperationException($"extractor failed: {job.Error}");
            if (job.Status == "done")
                return job.Result ?? throw new InvalidOperationException("done with no result");
            await Task.Delay(PollDelayMs, ct);
        }
    }
}
```

- [ ] **Step 5: Run to confirm pass** — `cd backend && dotnet test --filter ExtractorClientTests` → PASS.

- [ ] **Step 6: Commit**
```bash
git add backend/HarryMack.Api/Services/ExtractorClient.cs backend/HarryMack.Api/Models/Dtos.cs backend/HarryMack.Api.Tests/ExtractorClientTests.cs
git commit -m "feat(api): ExtractorClient (enqueue + poll sidecar)"
```

---

### Task 15: Rewrite `PipelineService.ProcessUrlAsync`; delete `LlmExtractor` + VTT

**Files:** Modify `Services/PipelineService.cs`; delete `Services/LlmExtractor.cs`, `Models/ExtractedBar.cs`; modify `Services/TranscriptParser.cs` (remove `ParseVtt`).

**Interfaces:**
- Consumes: `ExtractorClient.ExtractAsync` (Task 14), the SQLite upserts (Task 13).
- Produces: `Task<PipelineResultDto> ProcessUrlAsync(string url, string artist)`.

- [ ] **Step 1: Write the failing test** (a fake `ExtractorClient` returning one bar → assert a row lands in SQLite). `backend/HarryMack.Api.Tests/PipelineServiceTests.cs`:
```csharp
using HarryMack.Api.Data;
using HarryMack.Api.Models;
using HarryMack.Api.Services;
using Microsoft.Data.Sqlite;
using Xunit;

public class PipelineServiceTests
{
    [Fact]
    public async Task ProcessUrl_PersistsBars()
    {
        var cs = "Data Source=file:memdb3?mode=memory&cache=shared";
        await using var keep = new SqliteConnection(cs); await keep.OpenAsync();
        await Db.InitSchemaAsync(cs);
        var db = new Db(cs);
        var fake = new FakeExtractor();   // returns one bar: care
        var svc = new PipelineService(db, fake, /* parser */ new TranscriptParser(), new PhoneticService());
        var res = await svc.ProcessUrlAsync("https://youtu.be/abc123XYZ_1", "harry_mack");
        Assert.True(res.BarsExtracted >= 1);
        await using var c = db.Open();
        var cmd = c.CreateCommand(); cmd.CommandText = "SELECT COUNT(*) FROM bars";
        Assert.True((long)(await cmd.ExecuteScalarAsync())! >= 1);
    }
}
```
(Define a small `FakeExtractor : ExtractorClient` by extracting an `IExtractorClient` interface, or make `ExtractAsync` `virtual` and override. Use whichever the codebase style prefers; the interface is cleaner.)

- [ ] **Step 2: Run to confirm it fails** — `cd backend && dotnet test --filter PipelineServiceTests` → FAIL.

- [ ] **Step 3: Rewrite `ProcessUrlAsync`** (replace yt-dlp+VTT+LLM with the sidecar call; reuse the SQLite `UpsertResultsAsync` from Task 13, mapping `SidecarBarDto` → the upsert)
```csharp
public async Task<PipelineResultDto> ProcessUrlAsync(string url, string artist)
{
    var vid = ExtractVideoId(url);
    if (vid is not null && await YoutubeAlreadyProcessedAsync(vid))
        return new PipelineResultDto("Already processed", 0, 0, 0);

    var result = await _extractor.ExtractAsync(url, artist, CancellationToken.None);
    var bars = result.Bars.Where(b => b.IsFreestyle).ToList();
    var (openers, rhymes) = await UpsertResultsAsync(result.Video, artist, bars);
    return new PipelineResultDto($"Extracted {bars.Count} bars", bars.Count, openers, rhymes);
}
```
Constructor + fields change from `LlmExtractor _extractor` (Gemini) to `ExtractorClient _extractor` and `Db _db`. `UpsertResultsAsync` now takes `(VideoMetaDto video, string artist, List<SidecarBarDto> bars)` and writes `videos.artist/source_type`, `bars.end_seconds/is_freestyle/speaker`, `bars.timestamp_seconds = bar.Start`.

- [ ] **Step 4: Delete dead code** — remove `Services/LlmExtractor.cs`, `Models/ExtractedBar.cs`, and the `ParseVtt` method (+ its private helpers) from `TranscriptParser.cs`. Remove now-unused `using OpenAI...` lines anywhere they remain.

- [ ] **Step 5: Run to confirm pass** — `cd backend && dotnet test --filter PipelineServiceTests` and then full `dotnet build` → PASS / green build.

- [ ] **Step 6: Commit**
```bash
git rm backend/HarryMack.Api/Services/LlmExtractor.cs backend/HarryMack.Api/Models/ExtractedBar.cs
git add backend/HarryMack.Api backend/HarryMack.Api.Tests
git commit -m "feat(api): pipeline calls sidecar; delete LLM + VTT paths"
```

---

### Task 16: Controller + frontend: thread `artist` through

**Files:** Modify `Controllers/PipelineController.cs`, `Models/Dtos.cs` (`ProcessUrlRequest`), `frontend/src/services/api.ts`, `frontend/src/pages/PipelinePage.tsx`.

**Interfaces:**
- Produces: `POST /api/pipeline/process-url` body `{ url, artist }`; `api.processUrl(url, artist)`.

- [ ] **Step 1: Update the request DTO** in `Models/Dtos.cs`:
```csharp
public record ProcessUrlRequest(string Url, string Artist = "harry_mack");
```

- [ ] **Step 2: Update `PipelineController.process-url`** to pass artist:
```csharp
[HttpPost("process-url")]
public async Task<ActionResult<PipelineResultDto>> ProcessUrl([FromBody] ProcessUrlRequest req)
    => Ok(await _pipeline.ProcessUrlAsync(req.Url, req.Artist));
```

- [ ] **Step 3: Update `api.ts`**:
```typescript
processUrl: (url: string, artist = 'harry_mack') =>
  post<PipelineResultDto>('/pipeline/process-url', { url, artist }),
```

- [ ] **Step 4: Add an artist selector to `PipelinePage.tsx`** (a `<select>` bound to local state `artist`, default `harry_mack`, options `harry_mack`/`juice_wrld`; pass it: `api.processUrl(ytUrl, artist)`).

- [ ] **Step 5: Manual verification** — `pnpm dev` + `dotnet run` + sidecar up; paste a short HM URL, confirm bars appear in the flashcard/opener views.

- [ ] **Step 6: Commit**
```bash
git add backend/HarryMack.Api/Controllers/PipelineController.cs backend/HarryMack.Api/Models/Dtos.cs frontend/src/services/api.ts frontend/src/pages/PipelinePage.tsx
git commit -m "feat: thread artist through process-url end to end"
```

---

# Milestone D — Remove Docker, add run scripts, update docs

### Task 17: De-Docker + `setup.ps1` / `start.ps1` + README

**Files:** Delete `docker-compose.yml`, `backend/Dockerfile`, `frontend/Dockerfile`. Create `setup.ps1`, `start.ps1`. Modify `.env.example`, `README.md`.

- [ ] **Step 1: Delete Docker files**
```bash
git rm docker-compose.yml backend/Dockerfile frontend/Dockerfile
```

- [ ] **Step 2: Write `setup.ps1`**
```powershell
# One-time setup. Requires: Python 3.11, .NET 8 SDK, Node + pnpm, espeak-ng on PATH.
Push-Location freestyle-extractor
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m spacy download en_core_web_sm
Pop-Location
Push-Location frontend; pnpm install; Pop-Location
Push-Location backend; dotnet restore; Pop-Location
Write-Host "Setup done. SQLite freestyle.db is created on first API run."
```

- [ ] **Step 3: Write `start.ps1`**
```powershell
# Launches all three services in separate windows. No Docker.
Start-Process pwsh -ArgumentList '-NoExit','-Command','cd backend/HarryMack.Api; dotnet run'
Start-Process pwsh -ArgumentList '-NoExit','-Command','cd frontend; pnpm dev'
Start-Process pwsh -ArgumentList '-NoExit','-Command','cd freestyle-extractor; .\.venv\Scripts\Activate.ps1; uvicorn freestyle_extractor.app:app --port 8900'
Write-Host "API :5000  ·  Frontend :5173  ·  Extractor :8900"
```

- [ ] **Step 4: Rewrite `.env.example`**
```
# .NET backend
ConnectionStrings__Default=Data Source=freestyle.db
ExtractorBaseUrl=http://localhost:8900
# Extractor sidecar (optional)
HF_TOKEN=            # optional; enables speaker diarization (free HuggingFace token). Blank = keep all speech.
```

- [ ] **Step 5: Update `README.md`** — replace the Docker "Run" section with the no-Docker setup/start story (point at `setup.ps1` / `start.ps1`), update the Stack table (SQLite, the extractor sidecar, no Gemini), and the architecture diagram (sidecar + SQLite, no containers).

- [ ] **Step 6: Verify clean checkout runs** — fresh `setup.ps1` then `start.ps1`; the three services come up; `/health` on :8900 returns ok; the app loads on :5173.

- [ ] **Step 7: Commit**
```bash
git add setup.ps1 start.ps1 .env.example README.md
git commit -m "chore: remove Docker; native run scripts + docs"
```

---

# Milestone E — Accuracy harness (success-criteria gate)

### Task 18: Golden-file + hand-labeled accuracy check

**Files:** Create `freestyle-extractor/tests/fixtures/golden_hm_clip.words.json`, `golden_hm_clip.bars.json`, `tests/test_golden.py`, and `freestyle-extractor/scripts/accuracy.py`.

**Interfaces:** Consumes `segment`+`classify`+`label`. Produces a regression test + a manual accuracy report (boundary precision/recall vs. hand labels).

- [ ] **Step 1: Capture a real word stream** — run Task 11's smoke on one short HM clip; save the WhisperX `words` JSON to `golden_hm_clip.words.json`. By hand, write the *correct* bars to `golden_hm_clip.bars.json`.

- [ ] **Step 2: Write the golden test** `tests/test_golden.py`
```python
import json, pathlib
from freestyle_extractor.models import Word
from freestyle_extractor.segment import segment
from freestyle_extractor.classify import classify
from freestyle_extractor.label import label

F = pathlib.Path(__file__).parent/"fixtures"

def test_golden_clip_bar_boundaries():
    words = [Word(**w) for w in json.loads((F/"golden_hm_clip.words.json").read_text())]
    got = [b.text for b in label(classify(segment(words)))]
    expected = json.loads((F/"golden_hm_clip.bars.json").read_text())
    # boundary precision: fraction of produced bars that exactly match a hand-labeled bar
    hits = sum(1 for g in got if g in expected)
    assert hits / max(len(got), 1) >= 0.8
```

- [ ] **Step 3: Run; tune thresholds** — `python -m pytest tests/test_golden.py -v`. If <0.8, adjust `config.PAUSE_THRESHOLD_MS` / `MIN_BAR_WORDS` and re-run until it passes. Record final values.

- [ ] **Step 4: Write `scripts/accuracy.py`** — prints boundary precision/recall + a WER estimate vs. the hand-labeled bars (for manual tracking across clips).

- [ ] **Step 5: Commit**
```bash
git add freestyle-extractor/tests/test_golden.py freestyle-extractor/tests/fixtures freestyle-extractor/scripts/accuracy.py
git commit -m "test(extractor): golden-file + accuracy harness for HM bars"
```

---

## Self-Review (spec coverage)

- **Root-cause fix (replace VTT):** Tasks 6–10 (real audio → WhisperX) + Task 15 (delete VTT). ✓
- **No LLM:** Tasks 3–5 deterministic labeling; Task 15 deletes `LlmExtractor`; Task 12 drops the Gemini client + OpenAI nuget. ✓
- **Free/local:** all tools local; Task 17 `.env` makes HF token optional with fallback (Task 9). ✓
- **No Docker:** Task 17 deletes compose + Dockerfiles, adds native run scripts. ✓
- **SQLite:** Tasks 12–13 (factory, schema, full SQL port). ✓
- **Sidecar = pure stateless job service; .NET sole DB writer:** Task 11 (no DB in sidecar), Tasks 13–15 (.NET upserts). ✓
- **Job-based async + progress:** Task 11 (`/jobs/{id}` + progress), Task 14 (poll). ✓
- **One GPU job at a time:** Task 11 single worker + queue. ✓
- **Segmentation (pause+rhyme), couplets fall out:** Task 3 + Task 5 (shared rhyme_key). ✓
- **HM freestyles first / artist field:** Task 16 threads `artist`; default `harry_mack`. ✓
- **Bar contract (opener, rhyme_word, rhyme_key, start/end, is_freestyle, speaker):** §Data Contract, Tasks 1/5/14. ✓
- **Error handling (sidecar down, yt-dlp fail, OOM serial, 0 bars, diarize fallback, idempotency):** Tasks 9, 11, 14, 15. ✓
- **Testing (unit core, golden, contract, e2e smoke):** Tasks 2–11, 13–15, 18. ✓
- **Phase-1 success criteria (≥80% boundary precision):** Task 18 golden gate. ✓

**Out of scope (Phase 2, correctly excluded):** madmom beat grid, Juice WRLD Path A/B, the trainer app, the ML coach.

**Type-consistency check:** `SidecarBarDto`/`Bar` field names match across §Data Contract → Task 1 (Python) → Task 14 (C# DTO). `Db.Open()` / `Db.InitSchemaAsync` consistent across Tasks 12–15. `ExtractorClient.ExtractAsync(url, artist, ct)` consistent Tasks 14–15. ✓
