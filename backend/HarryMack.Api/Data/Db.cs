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
            text TEXT NOT NULL, saved_at TEXT DEFAULT (datetime('now')));
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
        CREATE TABLE IF NOT EXISTS rhyme_dictionary (
            id TEXT PRIMARY KEY, key TEXT, vowel_run INTEGER,
            artist TEXT, word TEXT, frequency INTEGER DEFAULT 1, song_count INTEGER DEFAULT 1,
            is_multisyllabic INTEGER DEFAULT 0, is_internal INTEGER DEFAULT 0,
            UNIQUE (artist, word, key));
        CREATE TABLE IF NOT EXISTS rhyme_dictionary_pairs (
            word_a TEXT, word_b TEXT, key TEXT, artist TEXT, frequency INTEGER DEFAULT 1,
            PRIMARY KEY (word_a, word_b, artist));
        -- Human-in-the-loop annotation: the user's own bar boundaries + rhyme
        -- groups (source of truth + future training labels). bars_json = int[][]
        -- word indices per bar; groups_json = { groupId: int[] } word indices.
        CREATE TABLE IF NOT EXISTS user_annotations (
            video_id TEXT PRIMARY KEY REFERENCES videos(id) ON DELETE CASCADE,
            bars_json TEXT, groups_json TEXT,
            updated_at TEXT DEFAULT (datetime('now')));";
        await cmd.ExecuteNonQueryAsync();
    }
}
