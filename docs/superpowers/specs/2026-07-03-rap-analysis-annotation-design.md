---
title: Per-video rap analysis & annotated transcript
date: 2026-07-03
status: draft — awaiting user review
repo: harry-mack-freestyle-flashcards
---

# Per-video rap analysis & annotated transcript

## 1. Goal

Add the missing core feature: for each processed video, produce and **persist a full,
labeled analysis of the rap** — the complete transcript with word timestamps, every
rhyme detected (not just bar-ends), the rhyme scheme, and a color-coded annotated
transcript viewable in the UI. Saved per video, re-viewable, re-runnable.

Today the extractor **discards** most of this: `classify.py` drops any line that doesn't
end-rhyme with a neighbor, and `label.py` keeps only the bar-*end* rhyme key. So the app
persists a filtered subset of bars, not an analyzed transcript. This feature keeps the
full signal.

## 2. Scope (v1) — locked with user

**In:**
- Full word-level transcript per video (all words, `start`/`end`/`score`), persisted.
- Per-word phonemes from **two sources**:
  1. **espeak-on-text** (canonical) — extend existing `phonetics.py`.
  2. **wav2vec2 delivered phonemes** (`facebook/wav2vec2-lv-60-espeak-cv-ft`, Apache-2.0)
     over the isolated Demucs vocal → *how it was actually delivered* (catches slant/bent).
- **Rhyme events**: per word/syllable-span, carrying intra-bar position, syllable span,
  stress, canonical key, delivered key.
- **6 fixed rhyme-pattern detectors** (bounded, versioned): perfect-end · slant-end ·
  internal · multisyllabic · chain/linked · none.
- **Rhyme groups** (connected components of rhyming words) → stable group id → **HSL
  hue per group** for coloring.
- **Scheme labels** per bar group (ABAB / AABB / …) as annotation metadata.
- **Rhyme-density score** (Raplyzer: espeak vowel sequence, longest matching vowel run)
  per video + per-artist aggregate.
- **Rhyme dictionaries — per-song AND global** (see §4d):
  - **Per-song**: each video's rhyme groups = that song's dictionary (word-sets, delivered
    keys, internal-vs-end position, detector type).
  - **Global**: aggregate across all videos, keyed by rhyme key + vowel-run — for any word,
    what rhymes with it, frequency, which songs, per-artist and all-artists. **Supersedes**
    the current bar-end-only `rhyme_words`/`rhyme_pairs`, which miss internal/multisyllabic.
  - **Powers the Rhyme Game**: `GET /api/game/wordlist/{artist}` upgraded to serve from the
    new dictionary, scopeable per-song / per-artist / global, with density-derived difficulty
    and slant rhymes included.
- **Annotated transcript UI**: new per-video page, color-coded transcript, per-rhyme
  detector labels, per-section scheme label, YouTube-timestamped lines, density panel.
- Artist-agnostic: operates on `{words, phonemes, timings, bars}`; proven end-to-end on
  **Harry Mack** (live now).

**Out (deferred, separate specs):**
- **Beat/flow** ("lands on the beat") — user: rappers assumed on-beat.
- **Eminem / Juice WRLD accuracy** via **Genius lyrics + forced-align** input path — its
  own spec; this analysis layer consumes whatever transcript it's given, so that path
  feeds the same analyzer later.

## 3. Non-goals
- No open-ended pattern discovery — the taxonomy is the 6 fixed detectors (council call).
- No LLM, no paid APIs, no cloud, no Docker. All local on the RTX 4060.
- Not changing the existing Flashcards / Openers / Rhymes / Game pages' behavior (they
  keep reading the same tables; we add alongside).

## 4. Architecture (three layers)

### 4a. Extractor — new `analyze` stage (Python, `freestyle-extractor`)
Runs after transcription, on the **full** word list (before the freestyle filter), plus
the isolated vocal.

New/changed modules:
- `phonetics.py` — add `word_phonemes(word) -> {ipa, vowel_seq, syllables}` (full string +
  vowel sequence + syllable/stress split), keeping existing `rhyme_tail`.
- `delivered.py` (new) — load `wav2vec2-lv-60-espeak-cv-ft`; emit phonemes over the vocal;
  align phoneme spans to WhisperX word timings → delivered key per word. GPU, warm-loaded
  once, ~+20–35 s / 4-min video.
- `rhyme_events.py` (new) — build rhyme events (position, span, stress, canonical +
  delivered key) from words + phonemes.
- `detectors.py` (new) — the 6 detectors as pure functions over rhyme events; versioned
  (`DETECTOR_VERSION`).
- `groups.py` (new) — union-find over rhyme events → rhyme groups; assign group ids; scheme
  labels per bar window.
- `density.py` (new) — Raplyzer density score.
- `pipeline.py` — add `analyze(...)`; `ExtractResult` gains an `analysis` object.
- New sidecar route `POST /analyze` (re-run analysis for an already-downloaded video from
  cached vocal+words in `WORK_DIR`, no re-download/re-transcribe) alongside `/extract`.

### 4b. Persistence — .NET backend + SQLite
New tables (additive; existing tables untouched):
- `transcript_words(id, video_id, word_index, text, start_seconds, end_seconds, score,
  ipa, vowel_seq, delivered_ipa)`
- `rhyme_events(id, video_id, word_id, bar_index, intra_bar_index, syllable_span,
  stress, canonical_key, delivered_key, group_id)`
- `rhyme_groups(id, video_id, group_index, hue, size)`
- `rhyme_annotations(id, video_id, detector_version, scheme_json, density REAL,
  created_at)` — one analysis record per video (latest wins; re-run replaces).
- `bar_labels(bar_id, detector, scheme)` — per-bar detector + scheme label.
- All keep full transcript regardless of the `is_freestyle` filter (the filter becomes a
  display flag, not a data-loss step).

New endpoints:
- `POST /api/pipeline/analyze/{videoId}` — trigger (re)analysis via sidecar `/analyze`.
- `GET  /api/videos` — list processed videos (title, artist, counts, density).
- `GET  /api/videos/{id}/analysis` — full annotation payload for the transcript view.
- Ingestion (`PipelineService.UpsertResultsAsync`) extended to persist the analysis in the
  same transaction as bars/openers/rhymes.

### 4d. Rhyme dictionaries (per-song + global) — powers the Rhyme Game
- **Per-song dictionary**: derived view over `rhyme_events`/`rhyme_groups` for one
  `video_id` → groups of rhyming words with delivered key, position (internal/end),
  detector type. Endpoint `GET /api/videos/{id}/rhyme-dictionary`.
- **Global dictionary**: aggregate table `rhyme_dictionary(id, key, vowel_run, artist,
  word, frequency, song_count, is_multisyllabic, is_internal)` rolled up across all videos
  during ingestion; plus `rhyme_dictionary_pairs(word_a, word_b, key, frequency, artist)`.
  Endpoints `GET /api/rhymes/dictionary?scope=global|artist&artist=…` and
  `GET /api/rhymes/dictionary/{word}` (everything that rhymes with a word).
- **Rhyme Game integration**: `GameController` `GET /api/game/wordlist/{artist}` reworked
  to read `rhyme_dictionary` (params: `scope=song|artist|global`, `videoId?`,
  `difficulty?` from density buckets). Existing game page keeps working; gains deeper,
  slant-inclusive word banks. The old `rhyme_words`/`rhyme_pairs` tables remain for the
  legacy Rhymes dictionary page until migrated.

### 4c. UI — new annotated transcript page (React)
- Route `/songs` (list) and `/songs/:videoId` (annotated view). Nav link "Songs".
- Annotated transcript: full transcript rendered line-by-line; each rhyming token wrapped
  in a span tinted with its group's **HSL hue**; hover/legend shows group + delivered key;
  each line carries its timestamp linking to `youtube.com/watch?v=…&t=…s`.
- Per-line/section **scheme label** (ABAB/AABB…) and per-rhyme **detector chips**
  (perfect/slant/internal/multisyllabic/chain).
- Density panel (video score + per-artist aggregate). Legend for the 6 detectors + colors.
- Reuses existing dark theme + `api.ts` client pattern. Component boundaries:
  `SongsListPage`, `AnnotatedTranscript`, `RhymeToken`, `SchemeBadge`, `DetectorLegend`,
  `DensityPanel`.

## 5. The 6 detectors (definitions, versioned)
Operate on rhyme events within a lookback window:
1. **perfect-end** — bar-final words, identical rhyme key (canonical == canonical).
2. **slant-end** — bar-final words, delivered keys match but canonical differ (bent rhyme).
3. **internal** — two rhyming events within the *same* bar.
4. **multisyllabic** — matching **vowel run ≥ 2** (Raplyzer longest-vowel-run) across events.
5. **chain/linked** — ≥ 3 events sharing a group across consecutive bars.
6. **none** — event with no match in window.
Precedence + tie-breaks specified in `detectors.py`; each label carries `DETECTOR_VERSION`.

## 6. Testing
- Unit tests per detector on synthetic rhyme-event fixtures.
- Extend golden-file harness (`tests/fixtures/golden_hm_clip.*`) with an
  `golden_hm_clip.analysis.json` snapshot.
- Validation task (from survey): hand-label ~30 bars/artist by ear; measure detector
  agreement + delivered-vs-canonical delta. This is where the wav2vec2 layer earns its keep.
- Backend xUnit for new endpoints + persistence round-trip. Frontend render test of
  `AnnotatedTranscript` with a fixture annotation.

## 7. Build approach
Phased via workflows (autobots-roll-out style — parallel spec→plan→review per feature):
1. Extractor analysis stage (phonetics ext, delivered, events, detectors, groups, density).
2. Persistence (schema + endpoints + ingestion).
3. UI (songs list + annotated transcript).
Each phase: (spec, plan) → implement → 3-lens review before merge. Prove on Harry Mack
(`vjb7TegEIYs`) end-to-end after phase 3.

## 7b. Follow-on specs (captured, not built here)
This spec is the **data foundation**. Two downstream subsystems consume it and get their
own specs so this one stays focused:

- **Spec 2 — Rhyme Game modes.** Upgrades to the existing `/game` page:
  - **Opener mode** — game presents an **opener** (from `openers`, filterable by
    artist/song); the player **inputs the rhymes**; the app validates each input against
    the **rhyme dictionary** (espeak canonical + delivered keys) and scores. Target rhyme
    sound comes from the opener's **source bar rhyme word** (`opener_sources` → `bars` →
    rhyme key). *Open mechanic Q for user: validate the player's rhymes against the
    original bar's rhyme sound (target), or just that the player's words rhyme with each
    other (free)? — proposed: target, with a free/practice toggle.*
  - Scoped word banks (song / artist / global) + density-derived difficulty.
  - **Dependency this spec must honor:** the dictionary + openers must expose, per opener,
    the target rhyme key and a set of valid rhyming words — §4d + `opener_sources` already
    provide this.
- **Spec 3 — Eminem / Juice WRLD input path.** Genius lyrics + forced-align (MFA /
  torchaudio `forced_align`) to produce accurate transcripts for studio/melodic vocals,
  feeding the same analyzer.

## 8. Open questions
- Exact HSL hue assignment (evenly spaced by group index vs stable hash of key) — propose
  evenly spaced by group index, sorted by first appearance.
- Syllable splitting source for multisyllabic spans (espeak stress marks vs a syllabifier)
  — propose espeak stress marks first, revisit if noisy.
- Re-analysis storage: keep only latest vs version history — propose latest-wins for v1.
