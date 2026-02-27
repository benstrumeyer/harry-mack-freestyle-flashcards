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
| Pipeline | Python (yt-dlp + transcript parsing) invoked from C# backend |
| Dev Tools | Playwright MCP (frontend dev loop), `/frontend-design` skill (UI design) |

**No:** audio, metronome, beats, recording, stats, streaks, category filters, Supabase.

---

## Prerequisites

- [x] **Docker Desktop for Windows** — installed
- [x] **.NET SDK 8** — installed
- [ ] **Playwright MCP** — add to `~/.claude/settings.json`

Everything else (PostgreSQL, Python/yt-dlp, Node) runs inside Docker containers.

---

## Database Schema (PostgreSQL)

```sql
CREATE TABLE videos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    youtube_id TEXT,                        -- null if from local transcript
    title TEXT,
    source TEXT NOT NULL,                   -- 'local' or 'youtube'
    filename TEXT,                          -- original .txt filename if local
    url TEXT,                               -- YouTube URL if from yt-dlp
    processed_at TIMESTAMPTZ DEFAULT NOW()
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
                            [Python pipeline scripts]
                                    ↙   ↘
                         [transcripts/]  [yt-dlp]
                         (.txt files)    (YouTube URL)
```

**Local transcript flow:**
1. User drops `.txt` files into `transcripts/` directory (gitignored)
2. User clicks "Parse Transcripts" button in the Pipeline page
3. C# API scans `transcripts/` → runs `parse_transcript.py` on each unprocessed file
4. Extracts bars → openers + rhymes → upserts into PostgreSQL
5. File marked as processed (tracked in `videos` table by filename)

**YouTube URL flow:**
1. User pastes YouTube URL in Pipeline page → clicks "Process"
2. C# API runs `download_transcript.py` (yt-dlp) → then `parse_transcript.py` → extract
3. Results upserted into PostgreSQL

---

## Project Structure

```
harry-mack-freestyle-flashcards/
├── docker-compose.yml
├── .env
├── transcripts/                       # gitignored — drop .txt files here
│   └── .gitkeep
├── backend/
│   ├── Dockerfile                     # .NET 8 + Python (for pipeline)
│   └── HarryMack.Api/
│       ├── Program.cs
│       ├── appsettings.json
│       ├── Controllers/
│       │   ├── PipelineController.cs  # POST /process-url, POST /parse-local, GET /status
│       │   ├── OpenersController.cs
│       │   ├── RhymesController.cs
│       │   └── SessionsController.cs
│       ├── Services/
│       │   └── PipelineService.cs
│       └── Models/
├── pipeline/
│   ├── requirements.txt               # yt-dlp, webvtt-py, pronouncing
│   ├── download_transcript.py         # YouTube URL → VTT file
│   ├── parse_transcript.py            # .txt or VTT → bars JSON
│   └── extract_patterns.py            # bars → openers + rhymes JSON
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

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
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

The parser will handle the same format as `transcript.txt` already in the repo:

```
--- SEGMENT 1: Topic label ---

[FREESTYLE - "Topic"]
[1:35] bar text here / second part of bar
[1:41] next bar
```

Conversation lines (short, no rhythm) are automatically filtered out. Only `[FREESTYLE - ...]` sections are parsed into bars.

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
