-- Harry Mack Freestyle Flashcards - Database Schema

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

CREATE TABLE rhyme_word_bars (
    word_id UUID REFERENCES rhyme_words(id) ON DELETE CASCADE,
    bar_id UUID REFERENCES bars(id) ON DELETE CASCADE,
    PRIMARY KEY (word_id, bar_id)
);

CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    started_at TIMESTAMPTZ DEFAULT NOW(),
    cards_shown UUID[]
);

CREATE TABLE saved_openers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    opener_id UUID REFERENCES openers(id) ON DELETE SET NULL,
    text TEXT NOT NULL,
    saved_at TIMESTAMPTZ DEFAULT NOW()
);
