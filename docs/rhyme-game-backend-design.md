# The Rhyme Game — Backend Design

> The server/data/logic side of the game (UI comes separately). Extends the **existing**
> post-migration stack: **.NET 8 API + SQLite (`Db` factory) + the Python `freestyle-extractor`
> sidecar**. The API stays the sole DB writer; the sidecar stays a stateless GPU extraction service.
> Every game query is scoped by **artist** so new rappers are a data drop-in.

---

## 1. What already exists (reuse, don't rebuild)

- **.NET 8 API** — `Db.Open()` / `Db.InitSchemaAsync`, controllers, `ExtractorClient` (enqueue+poll),
  `PhoneticService` (espeak-ng X-SAMPA rhyme tails), `PipelineService` (calls sidecar → upserts).
- **SQLite tables** — `videos(artist, source_type)`, `bars(text,start,end,rhyme_word,rhyme_key,
  is_freestyle,speaker)`, `openers(text,frequency,example_completions)`, `opener_sources`,
  `rhyme_words(word,phonemes,frequency)`, `rhyme_pairs`, `rhyme_word_bars`, `sessions`, `saved_openers`.
- **Sidecar** — YouTube URL → bars JSON, no LLM.

These are the **tile source**. The game adds a *style layer* + *play layer* on top.

---

## 2. New data model (SQLite additions)

```
artists          id TEXT PK, slug TEXT UNIQUE, display_name TEXT, accent_color TEXT,
                 created_at TEXT
                 -- promotes the current bars.artist string to a first-class registry

style_profiles   artist_id TEXT FK, computed_at TEXT, profile_json TEXT
                 -- the per-artist style vector (see §3); recomputed after each extraction

game_sessions    id TEXT PK, artist_id TEXT FK, mode TEXT, difficulty TEXT,
                 started_at TEXT, ended_at TEXT, score INTEGER, streak_delta INTEGER
                 -- extends today's `sessions`

attempts         id TEXT PK, session_id TEXT FK, opener_id TEXT NULL,
                 target_rhyme_key TEXT, fill TEXT, chosen_word TEXT,
                 on_beat INTEGER, timing_ms INTEGER, score INTEGER, heat REAL,
                 is_authentic INTEGER, created_at TEXT
                 -- one row per bar attempt; is_authentic feeds the style-AUC harness (§6)

streaks          id TEXT PK, current_streak INTEGER, longest_streak INTEGER, last_played_date TEXT
achievements     id TEXT PK, code TEXT UNIQUE, unlocked_at TEXT
beats            id TEXT PK, name TEXT, bpm INTEGER, path TEXT, is_premium INTEGER
```

**Migration:** backfill `artists` from distinct `videos.artist`; add `artist_id` FK where modes need
scoping. Keep it additive — `InitSchemaAsync` already `CREATE TABLE IF NOT EXISTS`.

---

## 3. Style engine (runs in .NET, reads SQLite + espeak)

Keep the sidecar GPU-only. A **`StyleProfileService`** (.NET) computes each artist's profile from the
tables + `PhoneticService`, stored as `profile_json`:

- **Opener distribution** — frequency + top n-grams of starting phrases.
- **Rhyme-key transition matrix** — from each video's bar sequence: `rhyme_key[i] → rhyme_key[i+1]`
  counts → couplet / ABAB rate.
- **Multisyllabic-tail rate** — per rhyme word, espeak tail → strip consonants → longest vowel-run
  (Raplyzer). Share of multi-syllable rhymes.
- **Cadence** — bar length (words) + words/sec from `start`/`end`.
- **Difficulty buckets** — frequency-rank + syllable-count thresholds → Beginner…Expert tiers.

Trigger: after `PipelineService` upserts a video's bars, enqueue `StyleProfileService.Recompute(artistId)`
(cheap: SQL aggregates + espeak on *distinct* words, cached in `rhyme_words.phonemes`).

---

## 4. Round generators + scoring (game logic, .NET)

**`IRoundGenerator` per mode** — all read generic tile keys scoped by `(artistId, difficulty)`, return
a `RoundDto`:
```
RoundDto { mode, artist, difficulty, opener?, targetRhymeKey?, scheme?,
           candidateEndWords[], bpm, beatId }
```
- *Bar Builder / Classic:* pick an opener (weighted by frequency, gated by difficulty) + a target
  rhyme key; candidates = `rhyme_words` sharing that key, filtered to the artist, ranked by frequency.
- *Couplet Chain:* pull a real `rhyme_pairs` edge → two linked targets.
- *Tap / Endless / Ladder:* same primitives, different pacing/reveal params.

**`ScoringService.Score(attempt, profile)`** — scores a fill **relative to the artist's distribution**,
not absolute correctness:
- rhyme-key match (espeak) → base points
- word rarity / frequency-fit → **heat**
- syllable-density percentile vs the artist's band → style bonus
- on-beat timing (from client `timing_ms`) → rhythm multiplier
Returns `{score, heat, feedback, isAuthentic}`.

---

## 5. API surface (new controllers; reuse existing where possible)

| Endpoint | Purpose |
|---|---|
| `GET /api/artists` · `GET /api/artists/{slug}/profile` | registry + style-profile summary |
| `GET /api/game/round?mode=&artist=&difficulty=` | serve the next round (RoundDto) |
| `POST /api/game/attempt` | score a fill → `{score, heat, feedback}` |
| `POST /api/game/sessions` · `GET /api/stats` | session lifecycle, streak, achievements, history |
| `GET /api/dictionary/{word}` | tap-any-word rhyming dictionary (shared rhyme_key) — reuses Rhymes logic |
| `GET /api/beats` · `GET /api/beats/{id}/stream` | beat library + player |

Recording (audio/video) is **client-side**; backend optionally stores blob metadata only. Existing
`Openers/Rhymes/Sessions/SavedOpeners` controllers stay.

---

## 6. Validation harness (not a runtime endpoint)

Mirror the golden-file test: a `scripts/style_auc.py` (or .NET xUnit) that trains a simple classifier
on `style_profiles` features and checks — on **held-out** bars — whether artist-authentic fills are
distinguishable from generic-dictionary fills better than chance (AUC / KL). This is the falsifiable
"teaches his style" gate; ship it, don't assert it in copy.

---

## 7. Multi-artist adapter

- Everything scoped by `artist_id`. Adding a rapper = sidecar on their videos → bars land → profile
  recomputes → modes populate. **Zero mode-code changes.**
- **Open risk to decide (not defer):** a melodic/sung artist (Juice WRLD) may not yield meaningful
  openers/couplets from the freestyle-tuned pipeline. Validate the *same* sidecar output is useful for
  a non-freestyle artist **before** committing the abstraction as universal.

---

## 8. Backend build order

1. **`attempts` table + Bar Builder round generator + `ScoringService`** on the existing fixture data
   (no artist table yet — hardcode `harry_mack`). Smallest slice that makes the core loop playable.
2. **`artists` + `style_profiles` + `StyleProfileService`** (+ recompute trigger).
3. **`GameController` + `DictionaryController`** (round + attempt + dictionary).
4. **sessions / streaks / achievements / stats / beats.**
5. **Multi-artist** scoping + a second artist as the abstraction proof.
6. Swap the golden fixture for a **real HM corpus** (run the deferred GPU extraction smoke).

Sequence chosen so the *fun-core* (step 1) is playable and testable before the surrounding
infrastructure — matches the game design's "prove fun first."
