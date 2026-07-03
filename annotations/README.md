# Annotation baselines & the learning loop

This folder holds **machine-generated rhyme annotations** saved as durable baselines
("this is what the machine produced") so you can annotate the truth and measure the gap.

- `*.ai.json` — a Claude-Code AI draft (the powerful first pass, produced on your Max plan).
- The AI draft is ALSO stored in the DB (`user_annotations.ai_draft_json`) and NEVER
  overwrites your saved annotation — annotate freely, the baseline stays.

## The loop

1. **Baseline** — the machine drafts a song (AI / ensemble / local) → saved here + in the DB.
2. **Truth** — you annotate the song in the editor and **Save** (your labels are ground truth).
3. **Score** — measure how close the machine got:

   ```bash
   ~/rapenv/bin/python scripts/compare_annotation.py <video_id> --truth user --pred ai
   ```
   → pairwise rhyme **precision / recall / F1**, bar-boundary agreement, and the specific
   pairs the machine **missed** or **invented** (so you see exactly where it was wrong).

4. **Learn** — fold your corrections into the local model:

   ```bash
   ~/rapenv/bin/python scripts/train_rhyme_model.py    # fine-tune rhyme_base.pt -> rhyme_user.pt
   ```

5. **Repeat** on the next song — the machine's draft should score higher against your
   annotation each round. Track the F1 over songs to see it learning.

## Compare any two sources

`--truth` / `--pred` each ∈ `user | ai | local | ensemble | <path-to-json>`. E.g. compare
the free ensemble against the AI draft: `--truth ai --pred ensemble`.
