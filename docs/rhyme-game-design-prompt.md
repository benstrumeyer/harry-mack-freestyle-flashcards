# The Rhyme Game (Artist Edition) — Claude Build Prompt (v2, corrected from real gameplay)

> **v1 was wrong** and has been replaced. v1 modeled a tap-to-select-a-tile puzzle with fill-scoring.
> The actual app is a **beat-timed freestyle teleprompter: you rap OUT LOUD** over a bouncing-ball
> scaffold. This v2 is rebuilt from screenshots of the real app (App Store + the beta livestream demo).
> **What we clone:** the interaction/loop (not copyrightable). **What we never reproduce:** their art,
> copy, beats, or any artist's full verses — the game only surfaces short fragments (single rhyme words,
> opener phrases, one bar of structure).

---

## 0. One-line

*The Rhyme Game*, but the **Word List is a specific rapper's real corpus** — his rhyme-ending words fill
the target tiles, his rhyme pairs define the schemes, his openers seed the bar starts — so you freestyle
over a scaffold built from **Harry Mack's** actual style (any rapper, later).

---

## 1. How the game ACTUALLY plays (verified)

Three screens carry it:

**Setup** → **Play** → **"Good job!"** (replay), with a **Rhyme Dictionary** reachable anytime.

### Play screen (the core)
- A vertical **grid of bars**. Each bar row = **4 beat-rectangles**.
- The **last rectangle of each bar is a pre-filled target rhyme word** (e.g. `date`, `great`, `higher`,
  `inspire`). The other rectangles are empty beat slots.
- Rows are **color-coded by rhyme scheme** — orange = rhyme group A, blue = rhyme group B (so AABB /
  ABAB is *shown*, not described). A short count-in row sits above bar 1.
- A **bouncing ball bounces left-to-right across the 4 rectangles, one per beat**, over a chosen
  instrumental (e.g. *Yucca · 85 BPM · Boom Bap*).
- **You rap out loud**, filling each bar in time with the ball and **landing on the given rhyme word on
  beat 4**. The app does not grade your words — it's a *structured performance aid*, a teleprompter with
  a metronome. (Optional video/audio recording captures the take.)

### Setup screen
- **Rhyme scheme** — the same bar-grid, where you assign the color-coded end-word targets (Simple vs
  "Advanced Setup").
- **Difficulty** — Beginner → Expert (arrows).
- **Word List** — the vocab pack the targets are drawn from (shown: *"The Rappers Toolkit"*). **← this is
  our artist hook.**
- **Beat** — pick the instrumental (BPM · genre · intensity); transport controls; "Tap to change song".
- **Record Video** toggle + big **PLAY**.

### Post-round
- **"Good job!"** → **Replay (same words)** · **Replay (new words)** · **Back to Menu**. "New words"
  regenerates the targets for the same scheme.

### Rhyme Dictionary (its own mode / tap any word)
- Search a word → ranked rhymes, each tagged **match quality (Perfect / Near Rhyme)** and **syllable
  count** (`1 syl`, `2 syl`, `5 syl`). A reference tool while you write/play.

---

## 2. Core loop (moment-to-moment)

```
Setup (scheme · difficulty · word list · beat) → PLAY
  → beat starts, count-in
  → ball bounces rectangle→rectangle, one per beat
  → you rap the bar, hitting the pre-filled rhyme word on beat 4
  → next bar (scheme color tells you which rhyme to hit)
  → end of grid → "Good job!" → Replay (same/new words) or Menu
```
Session hook: "Replay (new words)" is the one-more-round trigger; streaks/achievements sustain it.

---

## 3. Modes (pacing variants of the same scaffold)

- **Classic** — the full grid above, fixed bar count, chosen scheme.
- **Tap Mode** — rhythm variant (tap on beat as the ball lands; lightest-input onboarding).
- **Endless Bars** — the grid never ends; bars stream continuously, tempo/tightness ramps.
- **Generator** — self-paced: reveal the next word/target at a speed you set (practice/warm-up, no fixed grid).
- **Rhyme Dictionary** — the lookup tool as its own mode.

Difficulty (Beginner→Expert) scales: pool size (common→rare target words), single→multi-syllable targets,
tempo, and how much scaffold is given (targets shown vs. only the scheme).

---

## 4. Our wedge — the Word List is a per-artist corpus

Everything above is The Rhyme Game. The **only structural change** is the source of the tiles:

| Game element | Generic app | **Artist Edition (Harry Mack)** |
|---|---|---|
| Word List | "The Rappers Toolkit" | **"Harry Mack"** (his corpus) |
| Target rhyme words (end tiles) | generic dictionary | his `rhyme_words` (words he actually ends bars on) |
| Rhyme scheme colors / pairings | generic rhymes | his `rhyme_pairs` (words he actually rhymed = couplets) |
| Opener tile (optional: pre-fill bar start) | — | his `openers` (his real starting phrases) |
| Rhyme Dictionary | generic | artist-flavored (rank words he uses first) |

Same loop, his content. **Multi-artist = a Word List picker** ("Harry Mack", "Juice WRLD", …). Adding a
rapper = run the extraction sidecar on his videos → his tables fill → he appears in the Word List picker.
Zero gameplay-code changes per artist.

---

## 5. Backend implications (this REPLACES v1's tap-scoring model)

Because the player raps out loud, there is **no fill to score** — so the v1 `ScoringService`/`attempts`
model is largely dropped. The real backend core is **content generation + reference**:

- **`ScaffoldGenerator`** — input `(artist, scheme, difficulty, barCount)` → the grid: per bar, a
  target rhyme word + its scheme color (grouped via `rhyme_pairs` / shared `rhyme_key`), optional opener
  tile, beat count. "Replay (new words)" = regenerate targets for the same scheme.
- **`RhymeDictionaryService`** — word → ranked rhymes with **Perfect/Near** (espeak X-SAMPA tail match
  strength) + **syllable count** (vowel-run count). We already have `PhoneticService` (espeak) for both.
- **Beat library** — id, name, BPM, genre, intensity, file; a beat player + BPM drives the ball's tempo.
- **Word List = the per-artist corpus** already in SQLite (`openers`, `rhyme_words`, `rhyme_pairs`),
  scoped by artist. (Keep the artist-scoping fix from the backend doc — per-artist frequency, not global.)
- Optional: recording is client-side; streaks/achievements/stats as before.

No mic analysis, no fill-grading in v1 — the app's own model doesn't grade either.

---

## 6. Animation (corrected — the bouncing ball is the whole feel)

- **Bouncing ball** — arcs rectangle→rectangle, **one bounce per beat**, quantized to BPM. This is *the*
  signature motion; it IS the metronome. Everything else is quiet around it.
- **Active beat-rectangle** lights on the ball's landing; the **target end-tile pulses** as its beat
  approaches so you know the rhyme is coming.
- **Scheme colors** (orange/blue/…): steady, high-contrast; the color tells you which rhyme to hit.
- **Count-in row** ticks before bar 1.
- **"Good job!"** resolves on the final downbeat.
- **Reduced-motion:** replace the ball's travel with a per-beat lit/unlit rectangle step — same timing
  information, no continuous motion. Honor `prefers-reduced-motion`; visible focus on all controls.
- **Refuse** (reads as AI-slop / fights the beat): floating particles, confetti, idle tile bounce,
  gradient-hero splash, arrhythmic eased transitions.
- Palette can stay in The Rhyme Game's family (deep purple stage, warm-white logo, orange/blue scheme
  chips) or the existing app tokens — the UI is being designed separately; this doc governs behavior.

---

## 7. What changed from v1 → v2 (so nothing is silently wrong)

1. **Not a tap/multiple-choice/type puzzle.** It's a rap-out-loud teleprompter over a beat.
2. **The tiles are a scaffold, not inputs** — the end tiles are *given* rhyme targets; you supply the bar.
3. **No fill-scoring backend.** Replaced by `ScaffoldGenerator` + `RhymeDictionaryService` + beat clock.
4. **The bouncing ball is the core mechanic**, not decoration.
5. **Our wedge is the Word List**, cleanly — the corpus feeds targets/schemes/openers; it doesn't require
   a different game.

---

## 8. Build order (fun-gate reframed for the real mechanic)

1. **Fun-gate (M0):** a minimal **Play screen** — bar grid + bouncing ball on a beat + Harry-Mack target
   rhyme words (from the fixture) + one scheme. Test: does rapping over an *HM-word* scaffold feel good /
   help you freestyle *like him* vs a generic word list? (Still cheap; no scoring, no GPU.)
2. **Corpus-smoke (M0, parallel):** one real HM video through the sidecar — do his `rhyme_words` /
   `openers` / `rhyme_pairs` look like him? (targets are only as good as the corpus.)
3. **M1:** `ScaffoldGenerator` (artist-scoped), `RhymeDictionaryService`, beat clock/BPM, the real Play +
   Setup + Post-round screens on the fixture. Lock artist-scoping before any per-artist frequency use.
4. Then: difficulty, word-list picker (multi-artist), Endless/Tap/Generator, beats library, recording,
   streaks/achievements, stats.
5. Swap the golden fixture for a real HM corpus (GPU extraction smoke).

> **Linear:** the M1 tickets change accordingly — replace "ScoringService / score-a-fill" with
> "ScaffoldGenerator + RhymeDictionaryService + beat clock." M0 (fun-gate + corpus-smoke) stands as-is.
