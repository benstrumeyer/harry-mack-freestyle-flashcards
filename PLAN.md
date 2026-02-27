# Harry Mack Freestyle Flashcards

## Context
Freestyle rap training app. Extract patterns from Harry Mack's YouTube freestyles — opener sentences and rhyme dictionaries — persist to PostgreSQL. One-card flashcard UI for drilling openers. Browsable dictionaries with a visual word map for rhymes. Web-based pipeline page to feed YouTube URLs for processing.

## Project: `c:\Users\Gojo\repos\harry-mack-freestyle-flashcards\`

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | Angular 19 + TypeScript (standalone components, Tailwind CSS) |
| Backend | C# / ASP.NET Core 8 Web API |
| Database | PostgreSQL (Docker) |
| Pipeline | Python (yt-dlp + transcript parsing) invoked from C# backend |
| Dev Tools | Playwright MCP (frontend dev loop), `/frontend-design` skill (UI design) |

**No:** audio, metronome, beats, recording, stats, streaks, category filters, Supabase.

---

## Prerequisites

- [ ] **Docker Desktop for Windows** — required for everything
- [ ] **Playwright MCP** — for frontend dev loop

Everything else (.NET SDK, PostgreSQL, Python/yt-dlp, Angular CLI, Node) runs inside Docker containers.

---

## Database Schema (PostgreSQL)

```sql
CREATE TABLE videos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    youtube_id TEXT UNIQUE NOT NULL,
    title TEXT,
    url TEXT NOT NULL,
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
[Angular Frontend :4200]  ←→  [C# ASP.NET API :5000]  ←→  [PostgreSQL :5432]
                                       ↓
                             [Python pipeline scripts]
                                       ↓
                             [yt-dlp → parse → extract]
```

**Flow:**
1. User pastes YouTube URL in web UI → hits "Process"
2. C# API invokes Python pipeline (yt-dlp → parse transcript → extract bars → extract openers + rhymes)
3. Results persisted to PostgreSQL
4. Frontend reads from PostgreSQL via C# API

---

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/pipeline/process` | POST | `{ url: "youtube.com/..." }` → run pipeline |
| `/api/openers` | GET | List all openers (paginated) |
| `/api/openers/random` | GET | Single random opener for flashcard |
| `/api/rhymes` | GET | List all rhyme words |
| `/api/rhymes/{word}` | GET | All words that rhyme with `{word}` |
| `/api/rhymes/map` | GET | Full graph data: nodes + edges for word map |
| `/api/sessions` | POST | Save session (array of opener IDs shown) |
| `/api/sessions` | GET | List past sessions |
| `/api/videos` | GET | List processed videos |

---

## Frontend Pages

### Flashcard Page (`/` — default)
- One card fills viewport. Dark background.
- Starts in **Sentence Start mode** (random openers).
- Tap anywhere → next random card.
- **Mode toggle** switches to Rhyme mode (random rhyme words).
- History button (top-right) → modal with past sessions.
- Empty state when no data: "Add videos via Pipeline to start"

### Opener Dictionary (`/openers`)
- Scrollable list, search bar, tap to expand example completions.

### Rhyme Dictionary (`/rhymes`)
- Scrollable word list. Tap word → see all rhyming words.
- **Word Map** — d3-force graph: nodes = words, edges = "rhymed together", zoomable.

### Pipeline Page (`/pipeline`)
- URL input + "Process" button. Status indicator. List of processed videos.

### History Modal
- Past sessions: date, card count, expandable list of openers.

---

## Getting Started

```bash
docker compose up --build
```

- Frontend: http://localhost:4200
- Backend API: http://localhost:5000
- PostgreSQL: localhost:5432
