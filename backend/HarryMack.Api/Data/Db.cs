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
