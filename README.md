# Harry Mack Freestyle Flashcards

A study tool for freestyle rap technique. Ingests Harry Mack YouTube videos or local transcripts, uses an LLM to extract rap bars, openers, and rhyme patterns, then presents them as interactive flashcards.

---

## Architecture

### System Overview

```mermaid
graph TD
    Browser["Browser\n(React + Vite)"]
    API["ASP.NET Core API\n(:5000)"]
    DB["PostgreSQL 16\n(:5432)"]
    Gemini["Gemini 2.5 Flash\n(Google AI)"]
    eSpeak["espeak-ng\n(local binary)"]
    ytdlp["yt-dlp\n(local binary)"]
    YT["YouTube"]

    Browser -- "REST :5190" --> API
    API -- "Npgsql" --> DB
    API -- "OpenAI-compat API" --> Gemini
    API -- "subprocess" --> eSpeak
    API -- "subprocess" --> ytdlp
    ytdlp -- "download subtitles" --> YT
```

### Pipeline Data Flow

```mermaid
flowchart LR
    subgraph Input
        A1["YouTube URL\n(video or playlist)"]
        A2["Local .txt\ntranscript"]
    end

    subgraph Pipeline ["PipelineService"]
        B["yt-dlp\ndownload .vtt"]
        C["TranscriptParser\nparse lines + timestamps"]
        D["LlmExtractor\nGemini 2.5 Flash\n— classify bars\n— extract openers\n— extract rhyme words"]
        E["UpsertResultsAsync\nwrite to PostgreSQL"]
    end

    subgraph PostProcess ["Post-processing (optional)"]
        F["PhoneticService\nespeak-ng rhyme tail\nvalidation"]
    end

    subgraph Output
        G["Flashcard UI"]
        H["Opener Dictionary"]
        I["Rhyme Map"]
    end

    A1 --> B --> C --> D --> E
    A2 --> C
    E --> F
    E --> G
    E --> H
    E --> I
```

### Database Schema

```mermaid
erDiagram
    videos {
        uuid id PK
        text youtube_id
        text title
        text source
        text filename
        text url
        timestamptz processed_at
    }
    bars {
        uuid id PK
        uuid video_id FK
        text text
        real timestamp_seconds
        int bar_index
    }
    openers {
        uuid id PK
        text text
        int frequency
        text[] example_completions
    }
    opener_sources {
        uuid opener_id FK
        uuid bar_id FK
    }
    rhyme_words {
        uuid id PK
        text word
        text phonemes
        int frequency
    }
    rhyme_pairs {
        uuid word_a_id FK
        uuid word_b_id FK
        int frequency
    }
    rhyme_word_bars {
        uuid word_id FK
        uuid bar_id FK
    }
    saved_openers {
        uuid id PK
        uuid opener_id FK
        text text
        timestamptz saved_at
    }
    sessions {
        uuid id PK
        timestamptz started_at
        uuid[] cards_shown
    }

    videos ||--o{ bars : "has"
    bars }o--o{ openers : "opener_sources"
    bars }o--o{ rhyme_words : "rhyme_word_bars"
    rhyme_words }o--o{ rhyme_words : "rhyme_pairs"
    openers ||--o{ saved_openers : "saved as"
```

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + TypeScript + Vite |
| Backend | ASP.NET Core 8 (C#) |
| Database | PostgreSQL 16 |
| LLM | Gemini 2.5 Flash (via OpenAI-compatible API) |
| Phonetics | espeak-ng (X-SAMPA rhyme tail comparison) |
| Subtitles | yt-dlp (VTT auto-subtitles) |
| Container | Docker Compose |

---

## Features

- **Flashcard mode** — drill opener phrases with spaced repetition, save favourites
- **Opener dictionary** — browse all extracted opener templates by frequency
- **Rhyme map** — interactive force-directed graph of phonetically validated rhyme pairs
- **Pipeline** — ingest YouTube videos, playlists, or local `.txt` transcripts
- **Phonetic validation** — post-processing pass using espeak-ng to remove rhyme pairs that don't actually share a vowel+consonant ending

---

## Setup

### Prerequisites

- Docker + Docker Compose
- Gemini API key ([Google AI Studio](https://aistudio.google.com/)) — **paid tier required** for playlist processing (free tier: 20 RPD)

### Run

```bash
cp .env.example .env          # add your GEMINI_API_KEY
docker compose up -d --build
```

| Service | URL |
|---|---|
| Frontend | http://localhost:5190 |
| API | http://localhost:5000 |
| PostgreSQL | localhost:5432 |

### Ingest content

**YouTube video or playlist** — paste URL in the Pipeline page. Playlists process 5 videos concurrently with serialized LLM calls to stay within API rate limits.

**Local transcripts** — drop `.txt` files into `transcripts/` and click *Parse Transcripts*.

**Validate rhymes** — after ingestion, click *Validate Rhymes* to run the espeak-ng phonetic pass and remove false positives.

---

## How the LLM extraction works

Each video's transcript lines are sent to Gemini 2.5 Flash in a single batch. The model returns a JSON array — one object per line — with:

- `is_freestyle` — whether the line is an actual rap bar (vs filler, crowd talk, etc.)
- `opener` — the reusable template portion of the bar before topic-specific content begins
- `rhyme_words` — words that share the **same vowel sound and following consonants** from the last stressed syllable

Rhyme words are then cross-validated with espeak-ng: pairs that don't share an identical X-SAMPA rhyme tail are deleted.
