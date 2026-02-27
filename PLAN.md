# Harry Mack Freestyle Flashcards

## Context
Freestyle rap training app. Extract patterns from Harry Mack's YouTube freestyles — opener sentences and rhyme dictionaries — persist to PostgreSQL. One-card flashcard UI for drilling openers. Browsable dictionaries with a visual word map for rhymes.

Two data ingestion paths:
1. **Local transcripts** — drop `.txt` files into `transcripts/` directory, click "Parse Transcripts" in the UI
2. **YouTube URL** — paste a URL in the pipeline page, yt-dlp downloads + processes it automatically

## Project: `c:\Users\Gojo\repos\harry-mack-freestyle-flashcards\`

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | React 19 + TypeScript (Vite, React Router, Tailwind CSS) |
| Backend | C# / ASP.NET Core 8 Web API |
| Database | PostgreSQL (Docker) |
| Pipeline | Pure C# — yt-dlp binary for downloads, CMU Pronouncing Dict bundled as embedded resource |
| Dev Tools | Playwright MCP (frontend dev loop), `/frontend-design` skill (UI design) |

**No:** audio, metronome, beats, recording, stats, streaks, category filters, Python, Supabase.

---

## Prerequisites

- [x] **Docker Desktop for Windows** — installed
- [x] **.NET SDK 8** — installed
- [ ] **Playwright MCP** — add to `~/.claude/settings.json`

Everything else (PostgreSQL, Node) runs inside Docker containers.

---

## Database Schema (PostgreSQL)

```sql
CREATE TABLE videos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    youtube_id TEXT,                        -- null if from local transcript
    title TEXT,
    source TEXT NOT NULL DEFAULT 'local',   -- 'local' or 'youtube'
    filename TEXT,                          -- original .txt filename if local
    url TEXT,                               -- YouTube URL if from yt-dlp
    processed_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (youtube_id),
    UNIQUE (filename)
);

CREATE TABLE bars (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    video_id UUID REFERENCES videos(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    timestamp_seconds REAL,
    bar_index INT
);

CREATE TABLE openers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    text TEXT UNIQUE NOT NULL,
    frequency INT DEFAULT 1,
    example_completions TEXT[]
);

CREATE TABLE opener_sources (
    opener_id UUID REFERENCES openers(id) ON DELETE CASCADE,
    bar_id UUID REFERENCES bars(id) ON DELETE CASCADE,
    PRIMARY KEY (opener_id, bar_id)
);

CREATE TABLE rhyme_words (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    word TEXT UNIQUE NOT NULL,
    phonemes TEXT,
    frequency INT DEFAULT 1
);

CREATE TABLE rhyme_pairs (
    word_a_id UUID REFERENCES rhyme_words(id) ON DELETE CASCADE,
    word_b_id UUID REFERENCES rhyme_words(id) ON DELETE CASCADE,
    frequency INT DEFAULT 1,
    PRIMARY KEY (word_a_id, word_b_id)
);

CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    started_at TIMESTAMPTZ DEFAULT NOW(),
    cards_shown UUID[]
);
```

---

## Architecture

```
[React Frontend :5173]  ←→  [C# ASP.NET API :5000]  ←→  [PostgreSQL :5432]
                                      ↓
                            [C# PipelineService]
                                   ↙   ↘
                         [transcripts/]  [yt-dlp binary]
                         (.txt files)    (YouTube URL → VTT)
```

**Local transcript flow:**
1. User drops `.txt` files into `transcripts/` directory (gitignored, mounted into container)
2. User clicks "Parse Transcripts" button in the Pipeline page
3. C# API scans `transcripts/` → `TranscriptParser` processes each unprocessed file
4. Extracts bars → openers + rhymes → upserts into PostgreSQL
5. File marked as processed (tracked in `videos` table by filename)

**YouTube URL flow:**
1. User pastes YouTube URL in Pipeline page → clicks "Process"
2. C# API runs `yt-dlp` binary → downloads `.vtt` subtitle file
3. `TranscriptParser` parses VTT → bars; `PatternExtractor` extracts openers + rhymes
4. Results upserted into PostgreSQL

---

## Project Structure

```
harry-mack-freestyle-flashcards/
├── docker-compose.yml
├── .env
├── transcripts/                       # gitignored — drop .txt files here
│   └── .gitkeep
├── backend/
│   ├── Dockerfile                     # .NET 8 + yt-dlp standalone binary
│   └── HarryMack.Api/
│       ├── Program.cs
│       ├── appsettings.json
│       ├── Resources/
│       │   └── cmudict.dict           # CMU Pronouncing Dictionary (embedded resource)
│       ├── Controllers/
│       │   ├── PipelineController.cs  # POST /process-url, POST /parse-local, GET /status
│       │   ├── OpenersController.cs
│       │   ├── RhymesController.cs
│       │   └── SessionsController.cs
│       ├── Services/
│       │   ├── PipelineService.cs     # Orchestrates download + parse + extract + upsert
│       │   ├── TranscriptParser.cs    # .txt / VTT → bars
│       │   ├── PatternExtractor.cs    # bars → openers + rhymes (CMU dict lookup)
│       │   └── CmuDictService.cs      # Loads cmudict.dict, exposes phoneme + rhyme lookup
│       └── Models/
├── frontend/
│   ├── Dockerfile                     # Node 20 + Vite
│   ├── vite.config.ts
│   ├── package.json
│   └── src/
│       ├── main.tsx
│       ├── App.tsx                    # React Router setup
│       ├── pages/
│       │   ├── FlashcardPage.tsx      # THE card — tap to advance
│       │   ├── OpenerDictionaryPage.tsx
│       │   ├── RhymeDictionaryPage.tsx
│       │   └── PipelinePage.tsx
│       ├── components/
│       │   ├── WordMap.tsx            # d3-force graph
│       │   └── HistoryModal.tsx
│       └── services/
│           └── api.ts
├── db/
│   └── init.sql
└── PLAN.md
```

---

## C# Pipeline — Key Services

### CmuDictService
- Loads `cmudict.dict` from embedded resource at startup
- Parses into `Dictionary<string, string[]>` (word → phoneme array)
- `GetPhonemes(word)` → phoneme array
- `GetRhymeKey(word)` → suffix starting from last stressed vowel phoneme (same as Python `pronouncing` rhyme logic)
- `FindRhymes(word)` → all words sharing the same rhyme key

### TranscriptParser
- **Local `.txt`**: detect `[FREESTYLE - "..."]` section markers, extract `[timestamp] bar text` lines
- **VTT**: strip timing/cue headers, deduplicate overlapping caption lines, reassemble into bars
- Filter out conversation lines (heuristic: short lines, no end-rhyme potential, no rhythm markers)
- Output: `List<Bar>` with text + timestamp

### PatternExtractor
- **Openers**: first 3–8 words of each bar, normalized (lowercase, stripped punctuation), fuzzy-deduplicated by Levenshtein distance
- **Rhymes**: extract end word of each bar → lookup phonemes → compute rhyme key → group bars that share rhyme key into pairs

### PipelineService
- Receives source (URL or filepath)
- For YouTube: `Process.Start("yt-dlp", "--write-auto-sub --sub-lang en --skip-download --sub-format vtt ...")`
- Calls `TranscriptParser` → `PatternExtractor`
- Upserts `videos`, `bars`, `openers`, `opener_sources`, `rhyme_words`, `rhyme_pairs` via Npgsql

---

## NuGet Packages
- `Npgsql` — direct PostgreSQL access (no EF Core overhead needed)
- `Microsoft.AspNetCore.Cors` — CORS for React dev server

CMU Pronouncing Dictionary (`cmudict.dict`) bundled as embedded resource — no external package needed.

---

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------:|
| `/api/pipeline/process-url` | POST | `{ url }` → yt-dlp download + parse |
| `/api/pipeline/parse-local` | POST | Scan `transcripts/` dir + parse all new `.txt` files |
| `/api/pipeline/status` | GET | List all processed sources (local + YouTube) |
| `/api/openers` | GET | List all openers (paginated) |
| `/api/openers/random` | GET | Single random opener for flashcard |
| `/api/rhymes` | GET | List all rhyme words |
| `/api/rhymes/{word}` | GET | All words that rhyme with `{word}` |
| `/api/rhymes/map` | GET | Full graph data: nodes + edges for word map |
| `/api/sessions` | POST | Save session (array of opener IDs shown) |
| `/api/sessions` | GET | List past sessions |

---

## Frontend Pages

### Flashcard Page (`/` — default)
- One card fills viewport. Dark background.
- Starts in **Sentence Start mode** (random openers).
- Tap anywhere → next random card.
- **Mode toggle** switches to Rhyme mode (random rhyme words).
- History button (top-right) → modal with past sessions.
- Empty state when no data: "Add transcripts or YouTube URLs via Pipeline"

### Opener Dictionary (`/openers`)
- Scrollable list, search bar, tap to expand example completions.

### Rhyme Dictionary (`/rhymes`)
- Scrollable word list. Tap word → see all rhyming words.
- **Word Map** — d3-force graph: nodes = words, edges = "rhymed together", zoomable.

### Pipeline Page (`/pipeline`)
Two sections:

**Local Transcripts**
- Shows count of `.txt` files found in `transcripts/` directory
- "Parse Transcripts" button → calls `POST /api/pipeline/parse-local`
- Progress indicator during parsing
- List of already-parsed local files

**YouTube URL**
- URL input + "Process" button → calls `POST /api/pipeline/process-url`
- Status indicator

### History Modal
- Past sessions: date, card count, expandable list of openers.

---

## Transcript Format (`.txt` files)

```
--- SEGMENT 1: Topic label ---

[FREESTYLE - "Topic"]
[1:35] bar text here / second part of bar
[1:41] next bar
```

Only `[FREESTYLE - ...]` sections are parsed into bars. Conversation lines are filtered.

---

## Getting Started

```bash
# 1. Drop your .txt transcript files into transcripts/
# 2. Start everything
docker compose up --build

# 3. Open the app and click "Parse Transcripts" on the Pipeline page
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:5000
- PostgreSQL: localhost:5432
