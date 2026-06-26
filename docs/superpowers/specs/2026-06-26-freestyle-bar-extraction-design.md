# Freestyle Bar Extraction — Design Spec

- **Date:** 2026-06-26
- **Status:** Approved (brainstorm complete) — ready for implementation plan
- **Repo:** `harry-mack-freestyle-flashcards`
- **Sub-project:** #1 of 4 (extraction → library → trainer → ML coach). This spec covers **extraction only**.

---

## 1. Problem

The current pipeline downloads YouTube **auto-caption `.vtt`** with yt-dlp, dedupes overlapping cue lines in `TranscriptParser`, then hands everything to a paid **LLM (`LlmExtractor`)** to decide which lines are bars and how to segment them. It is unreliable — bars can't be tracked or cleanly extracted.

**Root cause (not fixable by prompting):** YouTube auto-captions are a *rolling-window* format — each cue repeats the previous line plus one new word, with overlapping timestamps, **no punctuation, no line/bar boundaries, and no reliable per-line timing**, produced by ASR on the **full mix** (the beat drowning the vocals). The LLM is being asked to recover bar structure and timing that were *never present in the input*. No prompt recovers missing information.

**Fix:** generate a real transcript with word-level timing from isolated vocals, then impose bar structure from the audio + rhyme + pauses using deterministic, free, local tools. The LLM is removed entirely.

## 2. Goals / Non-Goals

**Goals (Phase 1):** Given a Harry Mack freestyle YouTube URL, produce clean, accurate, correctly-segmented **bars** (text + approximate timing + opener + rhyme word/key, talking removed) that the existing flashcard / opener-dictionary / rhyme-map UI serves.

**Non-goals (this spec):** the trainer app, the ML coach, beat-locked timing (Phase 2), Juice WRLD (Phase 2), any new UI.

## 3. Constraints (hard)

- **Free** — $0 external cost. No paid APIs.
- **Local** — runs entirely on Ben's machine (RTX 4060 8GB) like ComfyUI.
- **No generative LLM** — fully deterministic. (Whisper/Demucs/pyannote/madmom are free *local task models*, not LLMs, and are the engine. A local Ollama model remains an explicitly-optional future polish, not in v1.)
- **No Docker** — all processes run native; `docker-compose.yml` is removed.
- **SQLite** — single-file `freestyle.db`, no DB server.

## 4. Decisions (from brainstorm)

| Decision | Choice |
|---|---|
| First sub-project | Reliable bar extraction |
| Scope | Whole pipeline, **staged**: Phase 1 clean bars → Phase 2 beat timing |
| Phase-1 source | **Harry Mack freestyles** (pure-ASR path), then Juice (Phase 2) |
| Integration | **Native host FastAPI sidecar** (warm models), .NET calls over HTTP |
| LLM | **Removed entirely** (`LlmExtractor` + OpenAI nuget deleted) |
| Runtime | **No Docker** — 3 native processes |
| Database | **SQLite** (`Microsoft.Data.Sqlite`), replacing Postgres |

## 5. Architecture

All native, all localhost, no containers:

```
  [React (Vite) :5173]  ──►  [.NET 8 API :5000]  ──►  [ freestyle.db (SQLite file) ]
   pnpm dev                   dotnet run                │
                                   │  http://localhost:8900  (enqueue + poll)
                                   ▼
                     [ freestyle-extractor :8900 ]   Python venv + GPU (like ComfyUI)
                      uvicorn app:app  ·  models warm in memory  ·  NO LLM
                      yt-dlp → Demucs → WhisperX → pyannote → segment → label → bars JSON
```

**Key design properties:**
1. **The sidecar is a pure, stateless job service** — URL in, bars JSON out. It never touches the database. The .NET API stays the **sole DB writer**, reusing existing upsert logic. The sidecar is independently testable (feed a URL / fixture, assert JSON).
2. **Job-based (async)** — a video takes ~1–3 min, so `POST /extract` returns a `job_id` immediately; `GET /jobs/{id}` reports progress. Maps onto the existing Pipeline-page progress UI and `/status` endpoint.
3. **One GPU job at a time** — a serial queue in the sidecar prevents GPU contention / OOM.

## 6. Phasing

| | **Phase 1 — Clean bars (Harry Mack freestyles)** | **Phase 2 — Timing + Juice** |
|---|---|---|
| Goal | Accurate, correctly-split HM bars to study | Beat-locked timing + second artist |
| Pipeline | yt-dlp → Demucs → WhisperX → pyannote → **rhyme+pause** segmentation → heuristic bar/talk classify → espeak+POS labeling | **+ madmom downbeat grid** (snap bars to the 4-beat measure) **+ Juice**: Path A (Genius lyrics + forced-align for released songs) & Path B (Juice freestyles via ASR) |
| Bar output | text, opener, rhyme_word, rhyme_key, ~approx start/end, is_freestyle, speaker | + beat-locked start/end, bar_index, is_beat_locked, artist |

Phase 1 is independently useful ("the clean Harry Mack bars"). Phase 2 layers on precision and the second artist without re-architecting.

## 7. Components

### 7.1 Sidecar (`freestyle-extractor/`) — single-purpose modules, all free/local, no LLM

| Module | Does | Depends on | Phase |
|---|---|---|---|
| `download.py` | YouTube URL → `audio.wav` + metadata (id, title, duration) | yt-dlp | 1 |
| `separate.py` | `audio.wav` → `vocals.wav` (strip the beat) | Demucs `htdemucs_ft` (GPU) | 1 |
| `transcribe.py` | `vocals.wav` → `words[]` = (word, start, end, score) | WhisperX large-v3 + wav2vec2 align, `language="en"`, VAD | 1 |
| `diarize.py` | tag speaker turns, keep dominant voice, drop host/crowd | pyannote (free HF token); **graceful fallback** = keep all | 1 |
| `phonetics.py` | word → rhyme tail (X-SAMPA, last stressed vowel onward) | espeak-ng | 1 |
| `segment.py` | `words[]` → `bars[]` fusing **end-rhyme + pause gap** (+ downbeat in P2) | phonetics, beats(P2) | 1 |
| `classify.py` | keep rap bars, drop talking (**rhyme-density + cadence** heuristic) | phonetics | 1 |
| `label.py` | per bar: opener (POS rule), rhyme_word, rhyme_key | spaCy (local), phonetics | 1 |
| `app.py` | FastAPI: `POST /extract`→job_id, `GET /jobs/{id}`→progress+bars; loads models once at startup; one GPU job at a time | FastAPI, uvicorn, all above | 1 |
| `beats.py` | `audio.wav` → downbeat grid (snap bars to the 4-beat measure) | madmom (CPU) | 2 |
| `lyrics.py` | released song → Genius lyrics → forced-align to audio | lyricsgenius + WhisperX align | 2 |

### 7.2 .NET backend changes

| File | Change |
|---|---|
| `Services/LlmExtractor.cs` | **Delete** + remove `OpenAI` nuget |
| `Services/PipelineService.cs` | Rewrite: `HttpClient` enqueue+poll to sidecar → upsert returned bars (keep upsert logic) |
| `Services/TranscriptParser.cs` | Keep local `.txt` path; **remove the VTT branch** (now dead) |
| `Services/PhoneticService.cs` | Keep for the "Validate Rhymes" button, but simplify — sidecar already returns validated rhyme keys |
| `Controllers/PipelineController.cs` | `process-url` forwards to sidecar; `status` reports job state; request gains `artist` |
| `Models/ExtractedBar.cs`, `Dtos.cs` | Match the sidecar bar shape (opener, rhyme_word, rhyme_key, start, end, is_freestyle, speaker) |
| Data access (all) | **Npgsql → `Microsoft.Data.Sqlite`**; GUIDs generated in C# (`Guid.NewGuid()`); array columns → JSON text |
| `appsettings.json` / `.env` | Add `ExtractorBaseUrl=http://localhost:8900`; **remove `OPENAI_API_KEY` / `GEMINI_API_KEY`** |
| `docker-compose.yml`, backend `Dockerfile`, frontend `Dockerfile` | **Delete** (no Docker) |

### 7.3 Data model (SQLite `freestyle.db`)

Additive vs. the existing schema; arrays become JSON text; UUIDs become app-generated GUID strings; timestamps ISO-8601 text.

- **`videos`**: existing cols + `artist TEXT` (`harry_mack`|`juice_wrld`) + `source_type TEXT` (`freestyle`|`song`).
- **`bars`**: existing (`text`, `timestamp_seconds` = start, `bar_index`) + `end_seconds REAL`, `is_freestyle INTEGER`, `speaker TEXT` (P1); `is_beat_locked INTEGER` (P2).
- **`openers`** (`example_completions` as JSON text), **`opener_sources`**, **`rhyme_words`**, **`rhyme_pairs`**, **`saved_openers`**, **`sessions`** (`cards_shown` as JSON text): structurally unchanged, ported to SQLite types.
- Schema created/migrated on API startup (file auto-creates).

## 8. Data flow (Phase 1, one HM video)

```
1. Paste HM url + artist=harry_mack          → POST /api/pipeline/process-url
2. .NET checks "already processed?" (UNIQUE youtube_id); if new → POST sidecar /extract → job_id
3. .NET polls GET /jobs/{id}; frontend Pipeline page shows progress
4. Sidecar (warm models, no LLM):
     download → audio.wav
     separate → vocals.wav             (Demucs strips the beat)
     transcribe → words[(w,start,end)] (WhisperX, lang=en)
     diarize → keep Harry, drop crowd/host  (fallback: keep all)
     segment → bars[]                  (the algorithm, §9)
     classify → drop talking
     label → opener, rhyme_word, rhyme_key per bar
   → returns bars JSON
5. .NET upserts videos/bars/openers/rhyme_words/rhyme_pairs (existing logic)
6. Flashcards + dictionaries serve clean HM bars
```

## 9. The segmentation algorithm (LLM-free core)

Input: `words[] = [(word, start, end), …]` for the kept speaker. Three free signals:
- **Pause** — gap `next.start - cur.end > ~300ms` = breath / line break.
- **End-rhyme** — rhymes land at bar ends; compare each candidate final word's espeak rhyme tail to recent finals.
- **Downbeat** *(Phase 2)* — word onset near a madmom downbeat = bar boundary.

**Phase 1 (pause + rhyme, no beats):**
```
1. Split the word stream on pauses (>~300ms) → candidate lines
2. For each candidate, compute the last word's rhyme tail (espeak X-SAMPA)
3. Refine:
     • two short adjacent lines whose finals RHYME → keep as a couplet pair
     • a line too long for one breath with an internal rhyme → split there
     • target ~one breath-group per bar (~4–12 words)
4. classify: a real BAR = plausible length AND its final word rhymes with a neighbor.
   No rhyme + short + isolated → talking/filler → drop.
5. Emit { text, start, end, rhyme_word, rhyme_key } per bar
```
Worked example:
```
words: …"people" "don't" "care" [420ms] "hands" "in" "the" "air" [510ms] "yeah" [900ms] "what's" "your" "name"…
 bar 1: "…people don't care"   tail=ɛr ┐ rhyme → COUPLET    "yeah" → filler, drop
 bar 2: "…hands in the air"    tail=ɛr ┘                    "what's your name" → talk, drop
```
**Couplets fall out for free** (adjacent bars sharing a rhyme key) — the "couplet tell" the later coach wants. **Phase 2** replaces the pause-only first split with: `boundary = near-downbeat + end-rhyme + pause; 2 of 3 = confident cut`, yielding beat-locked bars.

Tunable parameters (config, with defaults): `PAUSE_THRESHOLD_MS=300`, `MIN_BAR_WORDS=4`, `MAX_BAR_WORDS=12`, rhyme-tail match strictness.

## 10. Error handling

| Failure | Behavior |
|---|---|
| Sidecar not running | .NET returns clear message ("extractor offline — run `start.ps1`"); UI shows it |
| yt-dlp fails (unavailable/age-gated) | job `failed` + reason string, surfaced to Pipeline page |
| GPU OOM (Demucs/Whisper) | one-job-at-a-time queue prevents contention; caught → `failed` + reason |
| No vocals / empty transcript / 0 bars | job `done`, empty result + reason — never a crash |
| Diarization unavailable (no HF token) | **graceful fallback: keep all speech**, warn, continue |
| Already processed | skip on UNIQUE `youtube_id` |
| Upsert fails | wrapped in a transaction; video not marked processed → re-runnable |

## 11. Testing

- **Sidecar unit tests** (pytest, no GPU): `segment` / `classify` / `label` / `phonetics` fed fixture word-lists → assert exact bars, openers, rhyme keys. Pure functions, deterministic.
- **Golden-file test**: a checked-in HM word-stream fixture → expected bars; guards the segmenter against regressions.
- **Accuracy harness**: hand-label ~2 HM videos' true bars; measure boundary precision/recall + WER while tuning thresholds.
- **.NET contract test**: HTTP client against a stub returning canned bars JSON → assert correct SQLite upserts.
- **E2E smoke**: one short real HM clip end-to-end, eyeball the bars.

Determinism (no LLM) makes all tests stable — compatible with TDD.

## 12. Run story (no Docker)

```
setup.ps1 (once): python -m venv .venv; pip install whisperx demucs pyannote.audio spacy fastapi uvicorn;
                  python -m spacy download en_core_web_sm; install espeak-ng;
                  pnpm install (frontend); dotnet restore (backend); (SQLite file auto-creates on first API run)
start.ps1: launches 3 windows →  dotnet run (:5000) · pnpm dev (:5173) · uvicorn app:app --port 8900
```

## 13. Phase-1 success criteria ("done")

Given a Harry Mack freestyle URL, the app produces bars that are:
1. **Accurate** — text materially better than YouTube auto-captions (WER on hand-checked clips clearly beats the VTT baseline).
2. **Correctly segmented** — split at real bar boundaries with rhymes at the ends (~≥80% boundary precision on the hand-labeled set).
3. **Clean** — crowd/host/between-bars talking dropped.
4. **Labeled** — opener + rhyme_word + rhyme_key each; couplets identifiable by shared rhyme key.
5. **Free · local · no LLM · no Docker** — $0, on Ben's machine, no generative LLM, no containers.

…and the existing flashcard/opener/rhyme UI serves them.

## 14. Future (out of scope here)

- **Phase 2:** madmom beat-grid timing; Juice WRLD (Path A released-song forced-alignment via Genius; Path B freestyle ASR).
- **Sub-project #3 — Trainer app:** the 10-rung ladder + drills + beats + record/review (UI-heavy → design UI before building).
- **Sub-project #4 — ML coach (north star):** detect the freestyle "tells" (rhyme density / multis via the Raplyzer algorithm on the existing espeak stack; word-association via Datamuse/ConceptNet; couplets from shared rhyme keys) and coach Ben — all free/local, no paid LLM.

## 15. References (research-grounded)

- **Transcription/separation:** [WhisperX](https://github.com/m-bain/whisperX) (word-level forced alignment) · [Demucs](https://github.com/facebookresearch/demucs) · ["Exploiting Music Source Separation for Lyrics Transcription with Whisper" (arXiv 2506.15514)](https://arxiv.org/abs/2506.15514) — Demucs-before-Whisper helps rap-over-beat; force `language="en"` to dodge language-hallucination.
- **Beat/downbeat:** [madmom DBNDownBeatTracker](https://madmom.readthedocs.io/en/v0.16/modules/features/downbeats.html) · [librosa beat_track](https://librosa.org/doc/main/generated/librosa.beat.beat_track.html).
- **Lyrics path (Phase 2):** [LyricsGenius](https://github.com/johnwmillr/LyricsGenius) + WhisperX `align()` / [ctc-forced-aligner](https://github.com/MahmoudAshraf97/ctc-forced-aligner).
- **Rhyme/phonetics (already in repo via espeak-ng):** [Raplyzer / DopeLearning rhyme-density](https://github.com/ekQ/raplysaattori) — espeak → strip consonants → longest vowel-run = multisyllabic detection (the future coach's scoring core).
- **VTT failure mode:** [yt-dlp rolling-caption issue #1734](https://github.com/yt-dlp/yt-dlp/issues/1734).
- **.NET ↔ Python:** native sidecar via `HttpClient` (existing pattern: app already subprocesses yt-dlp + espeak-ng).
