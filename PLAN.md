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
| Pipeline | Pure C# — yt-dlp binary for downloads, OpenAI API for LLM extraction |
| Dev Tools | Playwright MCP (frontend dev loop), `/frontend-design` skill (UI design) |

**No:** audio, metronome, beats, recording, stats, streaks, category filters, Python, Supabase.

---

## Prerequisites

- [x] **Docker Desktop for Windows** — installed
- [x] **.NET SDK 8** — installed
- [x] **OpenAI API key** — add to `.env` as `OPENAI_API_KEY`
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
                               ↙           ↘
                    [TranscriptParser]   [yt-dlp binary]
                          ↓              (YouTube URL → VTT)
                    [LlmExtractor]
                    (OpenAI API — batch bars, get structured JSON back)
                          ↓
                    [PostgreSQL upsert]
```

**Local transcript flow:**
1. User drops `.txt` files into `transcripts/` directory (gitignored, mounted into container)
2. User clicks "Parse Transcripts" button in the Pipeline page
3. C# API scans `transcripts/` → `TranscriptParser` reads structural format → raw timestamped lines
4. `LlmExtractor` sends batches of lines to OpenAI → structured bar data back
5. Upsert into PostgreSQL; file marked processed

**YouTube URL flow:**
1. User pastes YouTube URL in Pipeline page → clicks "Process"
2. C# API runs `yt-dlp` binary → downloads `.vtt` subtitle file
3. `TranscriptParser` parses VTT → raw lines; `LlmExtractor` extracts patterns
4. Results upserted into PostgreSQL

---

## Project Structure

```
harry-mack-freestyle-flashcards/
├── docker-compose.yml
├── .env                               # DB creds + OPENAI_API_KEY
├── .env.example
├── transcripts/                       # gitignored — drop .txt files here
│   └── .gitkeep
├── backend/
│   ├── Dockerfile                     # .NET 8 + yt-dlp standalone binary
│   └── HarryMack.Api/
│       ├── Program.cs
│       ├── appsettings.json
│       ├── Controllers/
│       │   ├── PipelineController.cs  # POST /process-url, POST /parse-local, GET /status
│       │   ├── OpenersController.cs
│       │   ├── RhymesController.cs
│       │   └── SessionsController.cs
│       ├── Services/
│       │   ├── PipelineService.cs     # Orchestrates parse → LLM extract → upsert
│       │   ├── TranscriptParser.cs    # Structural parsing: .txt / VTT → raw lines
│       │   └── LlmExtractor.cs        # OpenAI batch call → structured bar JSON
│       └── Models/
│           ├── Bar.cs
│           ├── ExtractedBar.cs        # LLM output shape
│           └── RhymeMap.cs
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

### TranscriptParser
- **Local `.txt`**: detect `[FREESTYLE - "..."]` section markers, extract `[timestamp] bar text` lines
- **VTT**: strip timing/cue headers, deduplicate overlapping caption lines, reassemble into lines
- Output: `List<RawLine>` with text + timestamp — no semantic processing here

### LlmExtractor
Sends batches of raw lines to OpenAI (gpt-4o-mini for cost, gpt-4o for quality if needed).

**Prompt (system):**
```
You are a freestyle rap analyst. Given raw timestamped lines from a Harry Mack freestyle rap transcript,
classify each line and extract patterns. Return a JSON array — one object per line.
```

**Prompt (user):**
```
Lines:
[0:35] I was born in a world where the people don't care
[0:38] I'ma take it to the top, got my hands in the air
[0:40] Yeah
[0:41] What's your name bro?

Return JSON array:
[
  {
    "index": 0,
    "is_freestyle": true,
    "opener": "I was born in a world",
    "rhyme_word": "care",
    "rhyme_key": "EH R"
  },
  ...
]

Rules:
- is_freestyle: true only for actual rap bars (has rhythm, rhyme intent, lyrical structure). False for filler ("Yeah", "Uh"), conversation, or questions.
- opener: first 3–7 words of the bar that form a natural sentence start. Exclude trailing filler.
- rhyme_word: the word at the end of the bar that carries the rhyme. Usually the last meaningful word.
- rhyme_key: phonetic rhyme group — the vowel + consonant suffix sound that groups this word with its rhymes (e.g. "EH R" groups care/air/there/bear). Use ARPABET notation.
```

**Batching:** 20–30 lines per API call to minimize cost.

**Output model (`ExtractedBar`):**
```csharp
record ExtractedBar(
    int Index,
    bool IsFreestyle,
    string Opener,
    string RhymeWord,
    string RhymeKey
);
```

### PipelineService
1. `TranscriptParser.Parse(source)` → `List<RawLine>`
2. `LlmExtractor.ExtractAsync(lines)` → `List<ExtractedBar>`
3. Filter to `IsFreestyle == true`
4. Upsert via Npgsql:
   - `videos` row (source + title)
   - `bars` rows (full text + timestamp)
   - `openers` rows (upsert by text, increment frequency)
   - `opener_sources` rows (opener ↔ bar)
   - `rhyme_words` rows (upsert by word, increment frequency)
   - `rhyme_pairs` rows (bars sharing same `rhyme_key` within same video = pair)

---

## NuGet Packages
- `Npgsql` — direct PostgreSQL access
- `OpenAI` — official OpenAI .NET client (v2.x)
- `Microsoft.AspNetCore.Cors` — CORS for React dev server

---

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/pipeline/process-url` | POST | `{ url }` → yt-dlp download + LLM parse |
| `/api/pipeline/parse-local` | POST | Scan `transcripts/` dir + LLM parse all new `.txt` files |
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
- Progress indicator during parsing (LLM calls take a few seconds)
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

`TranscriptParser` extracts lines inside `[FREESTYLE - ...]` sections. The LLM then decides which are actual bars vs. filler.

---

## Getting Started

```bash
# 1. Add your OpenAI API key to .env
echo "OPENAI_API_KEY=sk-your-key-here" >> .env

# 2. Drop your .txt transcript files into transcripts/

# 3. Start everything
docker compose up --build

# 4. Open the app and click "Parse Transcripts" on the Pipeline page
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:5000
- PostgreSQL: localhost:5432
