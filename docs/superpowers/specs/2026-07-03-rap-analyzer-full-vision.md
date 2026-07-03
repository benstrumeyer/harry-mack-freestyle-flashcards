# Rap Analyzer — full vision (everything requested)

> Consolidated spec of every requirement given for the Harry Mack / multi-artist
> rap analyzer, in one place. Living doc. Status marks what's built on branch
> `feat/rap-analysis-annotation`.

## 1. Core product
A per-video **analyzed, annotated rap transcript**, saved per video, that shows
exactly how the rap is constructed — the whole reason the app exists.

- ✅ Full transcript with **word-level timestamps**, persisted per video.
- ✅ **YouTube video embedded** at the top of the analysis page.
- ✅ **Actual bars**: one bar per line, each ending on its rhyme; **scheme letters
  (A/B/C…) in a gutter** read vertically; end-rhyme **bold**, internal rhymes
  **underlined**; rhyme families share a color (research-backed: RHYMEBOOK /
  RapAnalysis conventions).
- ✅ **Rhyme density** score; **6 fixed detectors** (perfect/slant end · internal ·
  multisyllabic · chain · none); HSL color-per-rhyme-group.

## 2. The accuracy problem (why v1/v2 were "all wrong")
Real rap rhymes are **multi-word and multisyllabic**, and the rhyme lives in the
**delivery** — Harry changes **timing, speed, and enunciation** to *make* rhymes.
Concrete failing case: *"...get your **stereo hype** / ...that is not no **stereotype**"* —
"stereo hype" (2 words) rhymes with "stereotype" (1 word).

Root cause: the single-word, stress-delimited "rhyme tail" key is inconsistent
(`hype`→`aɪp` vs `stereotype`→`oʊtaɪp`) and single-word only → true rhymes never match.

### Detection roadmap
- 🔧 **Raplyzer vowel-run matching ACROSS word boundaries** — reduce the verse to a
  vowel stream and match longest common vowel runs. Prototype proved it catches
  `stereo hype` = `stereotype` (5-vowel run). Must be **tuned** so it doesn't
  over-merge (link only actual matched spans, run-length gating, coda check for
  single-syllable end rhymes). *In progress.*
- **Delivered wav2vec2 phonemes** — how it was *actually said* (catches bent/slant).
  Built; needs to feed matching (currently over-merges → gated off; tune).
- **Timing / duration / stress** signal — elongation & landing as rhyme evidence.
- ⚠️ Honest caveat (from the ML survey): *every* rhyme/phoneme tool was validated on
  read speech, not rapped delivery. No detector is reliably right on freestyle →
  automation is a **first-pass assist only**, never the final word.

## 3. Human-in-the-loop annotation (the real answer to accuracy)
The user annotates directly; the machine assists; the user's labels win.

- ✅ **Markdown-style bar editing**: click a word, **Enter splits the bar there**,
  **Backspace** at a bar start joins up. Persisted per video (`user_annotations`),
  reloaded. The user's bars are the source of truth.
- 🔧 **Click-to-group rhyme labeling**: click words to put them in the same rhyme
  group (auto-colored); correct/merge/split the machine's suggestions. Persisted.
  *Building now.*
- The analysis view renders the **user's** bars + groups when present (override).

## 4. Train-as-you-go (active learning)
Every edit = a labeled example. As labels accumulate:
- Features per candidate pair: vowel-run overlap + delivered-phoneme match +
  syllable duration/stress.
- Train a classifier that learns *what the user hears*; retrain as labels grow;
  its predictions become the first-pass suggestions the user corrects.
- Honest sequencing: the model only beats heuristics after enough labels, so the
  **annotation UI comes first** (it collects the training set).

## 5. Dictionaries + game
- ✅ **Per-song + global rhyme dictionaries** (aggregate across videos) — powers the
  Rhyme Game (scoped song / artist / global).
- ✅ **Rhyme Game opener mode** — given an opener, the player inputs the rhymes;
  validated against the dictionary.

## 6. Multi-artist
- **Harry Mack** (articulate freestyle) → ASR path (built).
- **Eminem** (studio, dense multisyllabic) & **Juice WRLD** (melodic/sung) → need a
  **Genius-lyrics + forced-align** input path (torchaudio `forced_align`, built as a
  seam) feeding the same analyzer; ASR degrades on these.

## Build order (current)
1. ✅ Analysis engine + persistence + annotated bars UI + dictionaries + game + iframe.
2. ✅ Editable bars (Enter to split), persisted.
3. 🔧 **Tune vowel-run detector** (multi-word/multisyllabic, no over-merge).
4. 🔧 **Click-to-group rhyme labeling** (user labels, persisted, override machine).
5. Train-as-you-go model on accumulated labels.
6. Eminem / Juice WRLD lyrics + forced-align path.
