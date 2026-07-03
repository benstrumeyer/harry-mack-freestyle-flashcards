# Precision Rhyme Engine — build plan (workflow-executed)

> Goal: max-precision automatic rhyme parsing via a HYBRID of a free/local trainable
> model + a powerful LLM pass + our phonetic layer + the user's labels. Every piece
> feeds the annotation editor as an "Auto-annotate" first pass the user corrects;
> corrections train the local model (train-as-you-go). On branch feat/rap-analysis-annotation.

## Constraints (every task)
- Isolated env `~/rapenv` only (torch 2.8). NEVER touch the `4D-humans`/`base` conda envs.
- **No TensorFlow** — the local model is PyTorch (we already have torch). Use CMUdict via
  `pronouncing`/`nltk` for a pretrained base; fine-tune on user annotation pairs.
- LLM path uses the **Anthropic API** (`anthropic` SDK) gated behind `ANTHROPIC_API_KEY`;
  build code + MOCKED tests (no live key needed to build). Model id: `claude-opus-4-8`
  (or `claude-sonnet-5`); use structured output via a tool/`response_format`.
- .NET 8 at `~/.dotnet`; frontend Node 22. Keep existing tests green (extractor 65,
  backend 32, frontend build). TDD per task.

## Phase 1 — Free/local trainable rhyme model (PyTorch)
- `freestyle-extractor/freestyle_extractor/rhyme_model.py`: a phoneme-sequence **Siamese**
  pair scorer → `P(rhyme)` for two words (or phoneme seqs). Char/phoneme embedding + GRU +
  distance head. `predict_rhyme(a, b) -> float`, `train(pairs) -> metrics`, save/load weights.
- `scripts/pretrain_rhyme_model.py`: build rhyme/non-rhyme pairs from CMUdict (`pronouncing`),
  pretrain, save `models/rhyme_base.pt`. Fine-tune hook for user annotation pairs (from
  `training.build_pairs`). TDD: model learns CMUdict rhyme (held-out AUC ≥ 0.9 on a small subset).
- Wire `predict_rhyme` as an extra feature/signal alongside the existing phonetic keys.

## Phase 2 — Powerful LLM auto-annotate (Anthropic)
- `freestyle-extractor/freestyle_extractor/llm_annotate.py`: build a prompt from the transcript
  + our per-word phonetic keys; call Claude with STRUCTURED OUTPUT (tool schema) → rhyme groups
  (keyed by sound), per-bar scheme, types, openers. Gated on `ANTHROPIC_API_KEY`; returns the
  same shape as `UserAnnotationDto`. TDD with a MOCKED anthropic client (no live call).
- Sidecar route `POST /annotate-llm` (reuses cached words); `.NET POST /api/videos/{id}/auto-annotate?engine=llm`
  proxies + returns the draft annotation (does NOT overwrite the user's saved one).

## Phase 3 — Hybrid ensemble (max precision)
- `freestyle-extractor/freestyle_extractor/ensemble.py`: combine signals per candidate pair —
  canonical key match · vowel-run overlap · delivered-phoneme match · local `predict_rhyme` ·
  LLM vote (if available). **Precision policy**: only propose a group when ≥2 independent
  signals agree (configurable), emit a confidence per group. `auto_annotate(analysis, engines)
  -> UserAnnotationDto + confidences`. TDD on synthetic signals (precision favored over recall).
- `.NET .../auto-annotate?engine=ensemble|local|llm` selects the engine.

## Phase 4 — Editor integration + train-as-you-go loop
- Frontend `BarEditor`: an **Auto-annotate** control (engine picker: Local / LLM / Ensemble) that
  fetches the draft and pre-fills bars+groups+types+openers as SUGGESTIONS the user accepts/edits;
  accepted+corrected annotation saves as ground truth (already feeds `rhyme_dictionary`).
- `scripts/train_rhyme_model.py`: pull ALL saved annotations from the API, build pairs
  (`training.build_pairs`), fine-tune `rhyme_base.pt` → `rhyme_user.pt`; report metrics.
  This closes the loop: your corrections make the local model better each run.

## Test gates
extractor pytest green (+ new model/llm/ensemble tests) · backend `dotnet test` green ·
frontend `npm run build` green. Prove auto-annotate returns a plausible draft on `vjb7TegEIYs`.
