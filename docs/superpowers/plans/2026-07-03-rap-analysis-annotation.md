# Rap Analysis & Annotation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce and persist a full, labeled per-video rap analysis — complete transcript with timestamps, rhyme events, 6 fixed detectors, rhyme groups, per-song + global rhyme dictionaries, and a color-coded annotated transcript UI.

**Architecture:** A new `analyze` stage in the Python `freestyle-extractor` computes per-word phonemes (espeak canonical + wav2vec2 delivered), rhyme events, detectors, groups, and density; the .NET backend persists this to additive SQLite tables and serves it; a new React `/songs/:videoId` page renders the annotated transcript. Dictionaries (per-song derived + global aggregate) are built during ingestion and power the Rhyme Game.

**Tech Stack:** Python 3.12 (`~/rapenv`: torch 2.8+cu128, whisperx, transformers, espeak-ng), .NET 8 (`~/.dotnet`, Microsoft.Data.Sqlite), React 19 + Vite (Node 22).

## Global Constraints

- Isolated env only: use `~/rapenv/bin/python`; NEVER touch the `4D-humans` conda env or `base`.
- Run backend with `DOTNET_ROOT=~/.dotnet` and `~/.dotnet` on PATH; frontend with Node 22 (`nvm use 22`).
- Extractor subprocess tools (`demucs`, `yt-dlp`, `espeak-ng`) must be on PATH — put `~/rapenv/bin` on PATH when running the sidecar.
- Existing tables (`videos, bars, openers, opener_sources, rhyme_words, rhyme_pairs, rhyme_word_bars, sessions, saved_openers`) and the 5 existing pages MUST keep working. All new schema is additive.
- `DETECTOR_VERSION = 1` string stamped on every analysis record.
- Detector taxonomy is fixed and bounded: `perfect-end, slant-end, internal, multisyllabic, chain, none`. No open-ended discovery.
- Prove end-to-end on Harry Mack video `vjb7TegEIYs` (already downloadable; vocal cached in `~/rap-work`).
- All local/free: no LLM, no paid API, no Docker.

---

## File Structure

**Phase 1 — Extractor (`freestyle-extractor/freestyle_extractor/`)**
- Modify `phonetics.py` — add `word_phonemes()`, `vowel_sequence()`, `longest_common_vowel_run()`.
- Create `delivered.py` — wav2vec2 delivered-phoneme keys per word.
- Create `rhyme_events.py` — build rhyme events from words+phonemes+bars.
- Create `detectors.py` — the 6 detectors; `DETECTOR_VERSION`.
- Create `groups.py` — union-find grouping, hues, scheme labels.
- Create `density.py` — Raplyzer density score.
- Modify `models.py` — `WordPhon`, `RhymeEvent`, `RhymeGroup`, `Analysis`, extend `ExtractResult`, `Word` (+phoneme fields).
- Modify `pipeline.py` — `analyze()`; keep full words (bypass freestyle filter for transcript).
- Modify `app.py` — `POST /analyze` route + cache full words/vocal path per job.
- Tests under `freestyle-extractor/tests/`.

**Phase 2 — Persistence (`backend/HarryMack.Api/`)**
- Modify `Data/Db.cs` — additive tables.
- Create `Models/AnalysisDtos.cs` — analysis DTOs.
- Modify `Services/ExtractorClient.cs` — parse `analysis`.
- Modify `Services/PipelineService.cs` — persist analysis + full transcript.
- Create `Controllers/VideosController.cs` — list + analysis endpoints.
- Tests under `backend/HarryMack.Tests/`.

**Phase 3 — Dictionaries (`backend/HarryMack.Api/`)**
- Modify `Data/Db.cs` — `rhyme_dictionary`, `rhyme_dictionary_pairs`.
- Modify `Services/PipelineService.cs` — aggregate dictionary on ingest.
- Modify `Controllers/RhymesController.cs` — dictionary endpoints.
- Modify `Controllers/GameController.cs` — scoped wordlist from dictionary.

**Phase 4 — UI (`frontend/src/`)**
- Modify `services/api.ts` — analysis + dictionary types/methods.
- Create `pages/SongsListPage.tsx`, `pages/SongAnalysisPage.tsx`.
- Create `components/AnnotatedTranscript.tsx`, `components/RhymeToken.tsx`, `components/SchemeBadge.tsx`, `components/DetectorLegend.tsx`, `components/DensityPanel.tsx`.
- Modify `App.tsx` — routes + nav link.

**Deferred (own plans):** Phase 5 = Rhyme Game opener mode (spec 2); Phase 6 = Eminem/Juice WRLD lyrics+forced-align (spec 3).

---

## Phase 1 — Extractor analysis stage

### Task 1.1: Per-word phonemes + vowel utilities

**Files:**
- Modify: `freestyle-extractor/freestyle_extractor/phonetics.py`
- Test: `freestyle-extractor/tests/test_phonetics_words.py`

**Interfaces:**
- Consumes: existing `_phonemes(word)`, `_VOWELS`, `rhyme_tail(word)`.
- Produces:
  - `word_phonemes(word: str) -> dict` → `{"ipa": str, "vowel_seq": list[str], "n_syllables": int}`
  - `vowel_sequence(word: str) -> list[str]` (espeak vowels in order)
  - `longest_common_vowel_run(a: list[str], b: list[str]) -> int`

- [ ] **Step 1: Write failing tests**
```python
# tests/test_phonetics_words.py
from freestyle_extractor.phonetics import word_phonemes, vowel_sequence, longest_common_vowel_run

def test_vowel_sequence_multisyllabic():
    seq = vowel_sequence("explorations")
    assert len(seq) >= 3            # e-plo-ra-tions -> multiple vowels
    assert all(isinstance(v, str) and v for v in seq)

def test_word_phonemes_shape():
    wp = word_phonemes("explore")
    assert set(wp) == {"ipa", "vowel_seq", "n_syllables"}
    assert wp["ipa"]
    assert wp["n_syllables"] == len(wp["vowel_seq"])

def test_longest_common_vowel_run_matches_multisyllabic():
    a, b = vowel_sequence("creations"), vowel_sequence("explorations")
    assert longest_common_vowel_run(a, b) >= 2   # ...eIS@nz shared tail

def test_longest_common_vowel_run_single():
    a, b = vowel_sequence("explore"), vowel_sequence("more")
    assert longest_common_vowel_run(a, b) >= 1
```

- [ ] **Step 2: Run tests, verify fail** — `~/rapenv/bin/python -m pytest tests/test_phonetics_words.py -v` → FAIL (functions undefined).

- [ ] **Step 3: Implement**
```python
# append to phonetics.py
def vowel_sequence(word: str) -> list[str]:
    raw = _phonemes(word)
    if not raw:
        return []
    toks = raw.replace("'", " ").replace(",", " ").split()
    return [t for t in toks if any(t.startswith(v) for v in _VOWELS)]

def word_phonemes(word: str) -> dict:
    ipa = _phonemes(word).strip()
    seq = vowel_sequence(word)
    return {"ipa": ipa, "vowel_seq": seq, "n_syllables": len(seq)}

def longest_common_vowel_run(a: list[str], b: list[str]) -> int:
    # longest common CONTIGUOUS suffix-agnostic run (classic DP on vowel tokens)
    if not a or not b:
        return 0
    best = 0
    dp = [[0] * (len(b) + 1) for _ in range(len(a) + 1)]
    for i in range(1, len(a) + 1):
        for j in range(1, len(b) + 1):
            if a[i - 1] == b[j - 1]:
                dp[i][j] = dp[i - 1][j - 1] + 1
                best = max(best, dp[i][j])
    return best
```

- [ ] **Step 4: Run tests, verify pass.**
- [ ] **Step 5: Commit** — `feat(extractor): per-word phonemes + vowel-run utilities`

### Task 1.2: Delivered phonemes (wav2vec2)

**Files:**
- Create: `freestyle-extractor/freestyle_extractor/delivered.py`
- Test: `freestyle-extractor/tests/test_delivered.py`

**Interfaces:**
- Consumes: isolated `vocals_path` (str), `words: list[Word]` (has `.start/.end`).
- Produces:
  - `load_delivered_model()` → cached HF pipeline (lazy; `facebook/wav2vec2-lv-60-espeak-cv-ft`).
  - `delivered_keys(vocals_path: str, words: list[Word], model=None) -> list[str | None]` — one delivered rhyme-tail key per word (last vowel+coda of the phonemes overlapping that word's time span), `None` if no phonemes in span.

- [ ] **Step 1: Write failing test (uses monkeypatched frames — no GPU in unit test)**
```python
# tests/test_delivered.py
from freestyle_extractor.models import Word
from freestyle_extractor import delivered

def test_delivered_keys_aligns_by_time(monkeypatch):
    # fake phoneme frames: (phoneme, start_s, end_s)
    fake = [("ɛ", 0.0, 0.1), ("k", 0.1, 0.2), ("s", 0.2, 0.3),   # "ex"
            ("o", 1.0, 1.1), ("ɹ", 1.1, 1.2)]                      # "more"
    monkeypatch.setattr(delivered, "_phoneme_frames", lambda p, m: fake)
    words = [Word(text="explore", start=0.0, end=0.35, score=1.0),
             Word(text="more", start=1.0, end=1.25, score=1.0)]
    keys = delivered.delivered_keys("x.wav", words, model=object())
    assert len(keys) == 2
    assert keys[0] and keys[1]           # both spans had phonemes
```

- [ ] **Step 2: Run test, verify fail.**

- [ ] **Step 3: Implement**
```python
# delivered.py
import functools
from .models import Word
from . import config
from .phonetics import _VOWELS

@functools.lru_cache(maxsize=1)
def load_delivered_model():
    from transformers import pipeline
    device = 0 if config.DEVICE == "cuda" else -1
    return pipeline("automatic-speech-recognition",
                    model="facebook/wav2vec2-lv-60-espeak-cv-ft",
                    device=device, return_timestamps="char")

def _phoneme_frames(vocals_path: str, model):
    # returns list of (phoneme, start_s, end_s)
    out = model(vocals_path)
    frames = []
    for ch in out.get("chunks", []):
        ts = ch.get("timestamp") or (None, None)
        tok = (ch.get("text") or "").strip()
        if tok and ts[0] is not None:
            frames.append((tok, float(ts[0]), float(ts[1] if ts[1] is not None else ts[0])))
    return frames

def _tail_key(phonemes: list[str]) -> str | None:
    last = None
    for i, p in enumerate(phonemes):
        if any(p.startswith(v) for v in _VOWELS) or p in _VOWELS:
            last = i
    return "".join(phonemes[last:]) if last is not None else None

def delivered_keys(vocals_path: str, words: list[Word], model=None) -> list[str | None]:
    model = model or load_delivered_model()
    frames = _phoneme_frames(vocals_path, model)
    keys: list[str | None] = []
    for w in words:
        span = [p for (p, s, e) in frames if e >= w.start and s <= w.end]
        keys.append(_tail_key(span))
    return keys
```

- [ ] **Step 4: Run test, verify pass.**
- [ ] **Step 5: GPU smoke (manual, gated)** — Run: `URL vocal at ~/rap-work/htdemucs/vjb7TegEIYs/vocals.wav`; `~/rapenv/bin/python -c "from freestyle_extractor.delivered import load_delivered_model,delivered_keys; ..."`. Expected: non-empty keys. (This downloads ~1.2GB once.)
- [ ] **Step 6: Commit** — `feat(extractor): wav2vec2 delivered-phoneme keys per word`

### Task 1.3: Rhyme events

**Files:**
- Create: `freestyle-extractor/freestyle_extractor/rhyme_events.py`
- Modify: `freestyle-extractor/freestyle_extractor/models.py` (add `WordPhon`, `RhymeEvent`)
- Test: `freestyle-extractor/tests/test_rhyme_events.py`

**Interfaces:**
- Consumes: `words: list[Word]`, `bars: list[Bar]` (have start/end), canonical `rhyme_tail`, `delivered_keys` output.
- Produces:
  - `models.RhymeEvent(word_index:int, text:str, bar_index:int, intra_bar_index:int, start:float, end:float, canonical_key:str|None, delivered_key:str|None, vowel_seq:list[str], stress:int)`
  - `build_events(words, bars, delivered: list[str|None]) -> list[RhymeEvent]` — assigns each word to the bar whose [start,end] contains its midpoint (−1 if none), computes intra_bar_index and keys.

- [ ] **Step 1: Failing test**
```python
# tests/test_rhyme_events.py
from freestyle_extractor.models import Word, Bar
from freestyle_extractor.rhyme_events import build_events

def test_events_assign_bar_and_intrabar_index():
    words = [Word(text="i", start=0.0, end=0.1, score=1.0),
             Word(text="explore", start=0.1, end=0.5, score=1.0),
             Word(text="give", start=1.0, end=1.2, score=1.0),
             Word(text="more", start=1.2, end=1.5, score=1.0)]
    bars = [Bar(text="i explore", start=0.0, end=0.5),
            Bar(text="give more", start=1.0, end=1.5)]
    ev = build_events(words, bars, delivered=[None, "o", None, "o"])
    assert [e.bar_index for e in ev] == [0, 0, 1, 1]
    assert [e.intra_bar_index for e in ev] == [0, 1, 0, 1]
    assert ev[1].canonical_key == ev[3].canonical_key   # explore / more share canonical tail
```

- [ ] **Step 2–5:** implement `models.RhymeEvent`/`WordPhon`, `build_events` (midpoint→bar assignment, `phonetics.rhyme_tail`/`vowel_sequence` for canonical + vowel_seq, delivered passthrough, stress from espeak `'` marker count), run tests, commit `feat(extractor): rhyme-event representation`.

### Task 1.4: The 6 detectors

**Files:**
- Create: `freestyle-extractor/freestyle_extractor/detectors.py`
- Test: `freestyle-extractor/tests/test_detectors.py`

**Interfaces:**
- Consumes: `list[RhymeEvent]`, `phonetics.longest_common_vowel_run`.
- Produces:
  - `DETECTOR_VERSION = 1`
  - `LOOKBACK_BARS = 4`
  - `label_events(events: list[RhymeEvent]) -> dict[int, str]` — map `word_index → one of {"perfect-end","slant-end","internal","multisyllabic","chain","none"}`. Precedence: chain > multisyllabic > internal > perfect-end > slant-end > none.
  - helper `bar_final_events(events) -> list[RhymeEvent]`.

- [ ] **Step 1: Failing tests (one per detector)**
```python
# tests/test_detectors.py
from freestyle_extractor.models import RhymeEvent
from freestyle_extractor.detectors import label_events

def _ev(wi, bi, ii, ck, dk=None, vs=None, last=False, **kw):
    return RhymeEvent(word_index=wi, text=str(wi), bar_index=bi, intra_bar_index=ii,
                      start=float(wi), end=float(wi)+0.1, canonical_key=ck, delivered_key=dk,
                      vowel_seq=vs or [ck or ""], stress=0)

def test_perfect_end():
    # two bars, each final word same canonical key
    evs = [_ev(0,0,0,"a"), _ev(1,0,1,"o@"), _ev(2,1,0,"b"), _ev(3,1,1,"o@")]
    lab = label_events(evs)
    assert lab[1] == "perfect-end" and lab[3] == "perfect-end"

def test_slant_end():
    evs = [_ev(0,0,0,"a"), _ev(1,0,1,"o@", dk="or"), _ev(2,1,0,"b"), _ev(3,1,1,"OO", dk="or")]
    lab = label_events(evs)
    assert lab[1] == "slant-end" and lab[3] == "slant-end"

def test_internal():
    evs = [_ev(0,0,0,"aI"), _ev(1,0,1,"aI"), _ev(2,0,2,"z")]
    lab = label_events(evs)
    assert lab[0] == "internal" or lab[1] == "internal"

def test_multisyllabic():
    evs = [_ev(0,0,0,"x", vs=["eI","S","@","nz"]), _ev(1,1,0,"y", vs=["eI","S","@","nz"])]
    lab = label_events(evs)
    assert "multisyllabic" in (lab[0], lab[1])

def test_chain():
    evs = [_ev(0,0,1,"o@"), _ev(1,1,1,"o@"), _ev(2,2,1,"o@")]
    lab = label_events(evs)
    assert list(lab.values()).count("chain") >= 3

def test_none():
    evs = [_ev(0,0,0,"q"), _ev(1,1,0,"z")]
    lab = label_events(evs)
    assert lab[0] == "none" and lab[1] == "none"
```

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** `label_events` with the precedence rules above (pairwise within `LOOKBACK_BARS`; multisyllabic when `longest_common_vowel_run(vowel_seq) >= 2`; chain when ≥3 events across consecutive bars share a canonical key; internal when two matching events in same bar; perfect-end/slant-end on bar-final events by canonical/delivered).
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `feat(extractor): 6 fixed rhyme-pattern detectors (v1)`

### Task 1.5: Groups + hues + scheme labels

**Files:**
- Create: `freestyle-extractor/freestyle_extractor/groups.py`
- Test: `freestyle-extractor/tests/test_groups.py`

**Interfaces:**
- Produces:
  - `build_groups(events) -> list[RhymeGroup]` where `RhymeGroup(group_index:int, hue:int, word_indices:list[int], key:str)`; union-find on shared canonical OR delivered key; hue evenly spaced `int(360*i/n)` by first-appearance order.
  - `scheme_labels(events, groups) -> dict[int, str]` → `bar_index → scheme` (e.g. "AABB","ABAB","ABCB") derived from the group letters of bar-final events over a 4-bar window.

- [ ] **Steps:** failing tests (two rhyming words → same group & equal hue formula; four bars ABAB pattern → "ABAB"), implement union-find + letter-assignment, run, commit `feat(extractor): rhyme groups, hues, scheme labels`.

### Task 1.6: Density score

**Files:**
- Create: `freestyle-extractor/freestyle_extractor/density.py`
- Test: `freestyle-extractor/tests/test_density.py`

**Interfaces:**
- Produces: `rhyme_density(events) -> float` — Raplyzer: for each event, longest matching vowel run with any of the previous N events, summed / total syllables. Range ~0–1+.

- [ ] **Steps:** failing test (dense repeated multis > sparse), implement, run, commit `feat(extractor): Raplyzer rhyme-density score`.

### Task 1.7: Pipeline integration + `/analyze` route + models

**Files:**
- Modify: `freestyle-extractor/freestyle_extractor/models.py` (`Analysis`, extend `ExtractResult`)
- Modify: `freestyle-extractor/freestyle_extractor/pipeline.py`
- Modify: `freestyle-extractor/freestyle_extractor/app.py`
- Test: `freestyle-extractor/tests/test_analyze_pipeline.py`, extend `tests/test_app.py`

**Interfaces:**
- Consumes: all of 1.1–1.6, existing `download/separate/transcribe`.
- Produces:
  - `models.Analysis(words: list[Word], events: list[RhymeEvent], groups: list[RhymeGroup], bar_labels: dict[int,str], scheme: dict[int,str], density: float, detector_version: int)`
  - `ExtractResult.analysis: Analysis | None`
  - `pipeline.analyze(full_words, bars, vocals_path, models) -> Analysis`
  - `pipeline.run(...)` returns `ExtractResult` with BOTH filtered `bars` (existing behavior) AND `analysis` built from the FULL word list (not the classify-filtered subset).
  - `app.py`: `POST /analyze {url}` → job returning `Analysis` only, reusing cached `~/rap-work` wav/vocal when present.

- [ ] **Steps:** failing test on a tiny fixture word list → `analyze()` returns populated `Analysis` with events/groups/density and `detector_version==1`; wire into `run()` keeping full words; add `/analyze` route + Job handling mirroring `/extract`; extend golden test with `tests/fixtures/golden_hm_clip.analysis.json`; run `~/rapenv/bin/python -m pytest -q` (all green, incl. existing 19); commit `feat(extractor): analyze stage + /analyze route + ExtractResult.analysis`.

**Phase 1 gate:** `~/rapenv/bin/python -m pytest -q` all pass. Manual: run `/analyze` on `vjb7TegEIYs`, confirm non-empty events/groups/density.

---

## Phase 2 — Backend persistence

### Task 2.1: Additive schema

**Files:**
- Modify: `backend/HarryMack.Api/Data/Db.cs:19-52` (append tables inside the same `CommandText`)
- Test: `backend/HarryMack.Tests/SchemaTests.cs`

**Interfaces:**
- Produces tables: `transcript_words`, `rhyme_events`, `rhyme_groups`, `rhyme_annotations`, `bar_labels` (exact DDL below).

- [ ] **Step 1: Failing test** — open in-memory-ish temp db, `InitSchemaAsync`, assert each new table exists via `SELECT name FROM sqlite_master`.
- [ ] **Step 2: Verify fail.**
- [ ] **Step 3: Implement** — append to the DDL string:
```sql
CREATE TABLE IF NOT EXISTS transcript_words (
    id TEXT PRIMARY KEY, video_id TEXT REFERENCES videos(id) ON DELETE CASCADE,
    word_index INTEGER, text TEXT, start_seconds REAL, end_seconds REAL,
    score REAL, ipa TEXT, vowel_seq TEXT, delivered_ipa TEXT);
CREATE TABLE IF NOT EXISTS rhyme_groups (
    id TEXT PRIMARY KEY, video_id TEXT REFERENCES videos(id) ON DELETE CASCADE,
    group_index INTEGER, hue INTEGER, size INTEGER, key TEXT);
CREATE TABLE IF NOT EXISTS rhyme_events (
    id TEXT PRIMARY KEY, video_id TEXT REFERENCES videos(id) ON DELETE CASCADE,
    word_index INTEGER, bar_index INTEGER, intra_bar_index INTEGER,
    canonical_key TEXT, delivered_key TEXT, detector TEXT,
    group_index INTEGER, stress INTEGER);
CREATE TABLE IF NOT EXISTS rhyme_annotations (
    video_id TEXT PRIMARY KEY REFERENCES videos(id) ON DELETE CASCADE,
    detector_version INTEGER, scheme_json TEXT, density REAL,
    created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS bar_labels (
    bar_id TEXT REFERENCES bars(id) ON DELETE CASCADE,
    detector TEXT, scheme TEXT, PRIMARY KEY (bar_id));
```
- [ ] **Step 4: Verify pass.** **Step 5: Commit** — `feat(db): additive analysis tables`.

### Task 2.2: Analysis DTOs + ExtractorClient parse

**Files:**
- Create: `backend/HarryMack.Api/Models/AnalysisDtos.cs`
- Modify: `backend/HarryMack.Api/Services/ExtractorClient.cs:17-39`
- Test: `backend/HarryMack.Tests/ExtractorClientTests.cs`

**Interfaces:**
- Produces: `AnalysisDto { WordDto[] Words; RhymeEventDto[] Events; RhymeGroupDto[] Groups; Dictionary<int,string> BarLabels; Dictionary<int,string> Scheme; double Density; int DetectorVersion }` with `JsonPropertyName` snake_case matching the sidecar; `ExtractResultDto.Analysis`.

- [ ] **Steps:** failing test deserializing a sample sidecar JSON (with `analysis`) into `ExtractResultDto`; add DTOs + `[JsonPropertyName]`; ensure existing snake_case options (ExtractorClient.cs:17-20) cover it; run `dotnet test`; commit `feat(api): analysis DTOs`.

### Task 2.3: Persist analysis in ingestion

**Files:**
- Modify: `backend/HarryMack.Api/Services/PipelineService.cs:250-407` (`UpsertResultsAsync` — add analysis persistence inside the same transaction; accept `AnalysisDto?`)
- Test: `backend/HarryMack.Tests/PersistenceTests.cs`

**Interfaces:**
- Consumes: `AnalysisDto`. Produces: rows in the 5 new tables; full transcript stored even for non-freestyle words.

- [ ] **Steps:** failing test → process a fixture `ExtractResultDto` with analysis, assert `transcript_words` count == words, `rhyme_events` present, `rhyme_annotations.detector_version==1`; implement inserts (follow the existing parameterized `cmd` pattern at PipelineService.cs:282-296); run `dotnet test`; commit `feat(api): persist analysis + full transcript`.

### Task 2.4: Videos endpoints

**Files:**
- Create: `backend/HarryMack.Api/Controllers/VideosController.cs`
- Test: `backend/HarryMack.Tests/VideosControllerTests.cs`

**Interfaces:**
- Produces:
  - `GET /api/videos` → `VideoSummaryDto[] { id,title,artist,barCount,wordCount,density }`
  - `GET /api/videos/{id}/analysis` → `VideoAnalysisDto { video, words[], events[], groups[], scheme, density }`
  - `POST /api/pipeline/analyze/{videoId}` (in PipelineController) → triggers sidecar `/analyze` for an existing video and re-persists.

- [ ] **Steps:** failing WebApplicationFactory test hitting `GET /api/videos` on a seeded db; implement controller reading the new tables (mirror `OpenersController` querying style); run `dotnet test`; commit `feat(api): videos list + analysis endpoints`.

**Phase 2 gate:** `dotnet test` green; `POST /api/pipeline/analyze/{id}` on the ingested Harry Mack video populates the new tables; `GET /api/videos/{id}/analysis` returns the payload.

---

## Phase 3 — Rhyme dictionaries

### Task 3.1: Dictionary tables + aggregation

**Files:**
- Modify: `backend/HarryMack.Api/Data/Db.cs` (add `rhyme_dictionary`, `rhyme_dictionary_pairs`)
- Modify: `backend/HarryMack.Api/Services/PipelineService.cs` (roll up during ingest)
- Test: `backend/HarryMack.Tests/DictionaryTests.cs`

**Interfaces:**
- Tables: `rhyme_dictionary(id, key, vowel_run INTEGER, artist, word, frequency, song_count, is_multisyllabic INTEGER, is_internal INTEGER)`, `rhyme_dictionary_pairs(word_a, word_b, key, artist, frequency, PRIMARY KEY(word_a,word_b,artist))`.
- Aggregation: from persisted `rhyme_events`+`rhyme_groups`, upsert per (artist, word, key), increment `frequency`; `song_count` counts distinct videos; pairs from co-grouped words.

- [ ] **Steps:** failing test → after ingesting two fixture videos sharing a rhyme, `rhyme_dictionary` frequency and `song_count` reflect both; implement upserts (ON CONFLICT increment, like openers at PipelineService.cs:306-318); run `dotnet test`; commit `feat(api): per-song + global rhyme dictionary aggregation`.

### Task 3.2: Dictionary endpoints

**Files:**
- Modify: `backend/HarryMack.Api/Controllers/RhymesController.cs`
- Test: `backend/HarryMack.Tests/DictionaryEndpointTests.cs`

**Interfaces:**
- `GET /api/videos/{id}/rhyme-dictionary` → per-song groups.
- `GET /api/rhymes/dictionary?scope=global|artist&artist=…` → aggregate entries.
- `GET /api/rhymes/dictionary/{word}?artist=…` → everything that rhymes with `word`.

- [ ] **Steps:** failing tests per endpoint on seeded db; implement queries; run `dotnet test`; commit `feat(api): rhyme dictionary endpoints`.

### Task 3.3: Game wordlist upgrade

**Files:**
- Modify: `backend/HarryMack.Api/Controllers/GameController.cs`
- Test: `backend/HarryMack.Tests/GameWordlistTests.cs`

**Interfaces:**
- `GET /api/game/wordlist/{artist}?scope=song|artist|global&videoId=&difficulty=` → same shape as today (`{ words: [word,freq,key,links][], openers: [] }`) but sourced from `rhyme_dictionary`; **backward-compatible default** (`scope=artist`, no params) returns the same contract the current game consumes.

- [ ] **Steps:** failing test asserting default call still returns the legacy shape AND a `scope=global` call returns more words; implement; run `dotnet test`; commit `feat(api): game wordlist from rhyme dictionary (scoped)`.

**Phase 3 gate:** `dotnet test` green; existing `/game` page still loads; `scope=global` yields a larger word bank.

---

## Phase 4 — Annotated transcript UI

### Task 4.1: API client types + methods

**Files:**
- Modify: `frontend/src/services/api.ts` (add interfaces + methods after line 105/150)
- Test: `frontend/src/services/api.test.ts`

**Interfaces:**
- Produces: `VideoSummaryDto`, `VideoAnalysisDto`, `TranscriptWordDto`, `RhymeEventDto`, `RhymeGroupDto`, and `api.getVideos()`, `api.getVideoAnalysis(id)`, `api.getSongDictionary(id)`.

- [ ] **Steps:** failing test (mock fetch → `getVideoAnalysis` returns typed object); add interfaces + methods (mirror existing `get<T>` pattern at api.ts:107-151); `npm test`; commit `feat(web): analysis api client`.

### Task 4.2: RhymeToken (HSL coloring) + DetectorLegend

**Files:**
- Create: `frontend/src/components/RhymeToken.tsx`, `frontend/src/components/DetectorLegend.tsx`
- Test: `frontend/src/components/RhymeToken.test.tsx`

**Interfaces:**
- `RhymeToken({ text, hue, detector }) ` → `<span>` styled `background: hsl(hue 70% 45% / .35)` when hue present; title = detector.
- `DetectorLegend()` → static legend of the 6 detectors + swatches.

- [ ] **Steps:** failing render test (token with hue=120 has an hsl background; plain word has none), implement, `npm test`, commit `feat(web): rhyme token + detector legend`.

### Task 4.3: AnnotatedTranscript + SchemeBadge + DensityPanel

**Files:**
- Create: `frontend/src/components/AnnotatedTranscript.tsx`, `components/SchemeBadge.tsx`, `components/DensityPanel.tsx`
- Test: `frontend/src/components/AnnotatedTranscript.test.tsx`

**Interfaces:**
- `AnnotatedTranscript({ analysis })` → renders words grouped into bars; each rhyme-event word wrapped in `RhymeToken` with its group hue; each bar prefixed by a timestamp link (`youtube.com/watch?v=…&t=Ns`) and a `SchemeBadge`.
- `DensityPanel({ density, artistDensity })`.

- [ ] **Steps:** failing render test on a fixture `VideoAnalysisDto` (asserts colored token for "explore" and a bar timestamp link), implement, `npm test`, commit `feat(web): annotated transcript`.

### Task 4.4: Songs pages + routing

**Files:**
- Create: `frontend/src/pages/SongsListPage.tsx`, `pages/SongAnalysisPage.tsx`
- Modify: `frontend/src/App.tsx:44-50` (add routes `/songs`, `/songs/:videoId`; nav link "Songs")
- Test: `frontend/src/pages/SongAnalysisPage.test.tsx`

**Interfaces:**
- `/songs` lists `getVideos()`; row → `/songs/:videoId`.
- `/songs/:videoId` fetches `getVideoAnalysis` → `AnnotatedTranscript` + `DensityPanel` + `DetectorLegend`.

- [ ] **Steps:** failing test (route renders transcript from mocked api), implement pages + routes + nav, `npm run build` (tsc — do not introduce new errors beyond the 2 known pre-existing), `npm test`, commit `feat(web): songs list + analysis page`.

**Phase 4 gate:** `npm run build` succeeds (≤ the 2 pre-existing tsc errors); with all services running, `/songs/<id>` shows the color-annotated Harry Mack transcript with timestamps, scheme labels, and density.

---

## Deferred phases (separate plans)
- **Phase 5 (spec 2): Rhyme Game opener mode** — new `/game` mode: present opener → player inputs rhymes → validate against `rhyme_dictionary` + `opener_sources` target key; scoped banks; density difficulty.
- **Phase 6 (spec 3): Eminem / Juice WRLD input path** — Genius lyrics + forced-align (torchaudio `forced_align` / MFA) producing a transcript fed to the same `analyze()` stage.

## Self-Review notes
- Spec coverage: §2 in-scope items map to Tasks 1.1–4.4; §4d dictionaries → Phase 3; §7b opener mode/Eminem → deferred phases (explicitly out of this plan). ✎
- Backward-compat: game wordlist default contract preserved (Task 3.3); existing pages untouched (additive schema).
- Type consistency: `RhymeEvent`/`RhymeGroup`/`Analysis` names identical across extractor (1.3–1.7), DTOs (2.2), and web (4.1).
- No placeholders: detector precedence, DDL, and hue formula are concrete; ML unit tests avoid GPU via monkeypatch, with a gated manual smoke.
