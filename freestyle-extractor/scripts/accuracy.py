"""Manual accuracy check for the LLM-free segmenter.

Runs segment -> classify -> label on a golden clip's word stream and reports
boundary precision/recall + a crude word-level WER vs. the hand-labeled bars.
For tracking segmentation quality across clips while tuning config thresholds.

Usage (from freestyle-extractor/):
    python scripts/accuracy.py [words.json] [bars.json]
Defaults to the checked-in golden_hm_clip fixture.
"""
import json, pathlib, sys

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))

from freestyle_extractor.models import Word
from freestyle_extractor.segment import segment
from freestyle_extractor.classify import classify
from freestyle_extractor.label import label


def wer(ref: str, hyp: str) -> float:
    r, h = ref.split(), hyp.split()
    d = [[0] * (len(h) + 1) for _ in range(len(r) + 1)]
    for i in range(len(r) + 1):
        d[i][0] = i
    for j in range(len(h) + 1):
        d[0][j] = j
    for i in range(1, len(r) + 1):
        for j in range(1, len(h) + 1):
            cost = 0 if r[i - 1] == h[j - 1] else 1
            d[i][j] = min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
    return d[len(r)][len(h)] / max(len(r), 1)


def main() -> None:
    F = pathlib.Path(__file__).parent.parent / "tests" / "fixtures"
    words_path = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else F / "golden_hm_clip.words.json"
    bars_path = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else F / "golden_hm_clip.bars.json"

    words = [Word(**w) for w in json.loads(words_path.read_text())]
    got = [b.text for b in label(classify(segment(words)))]
    expected = json.loads(bars_path.read_text())

    tp = len(set(got) & set(expected))
    precision = tp / max(len(got), 1)
    recall = tp / max(len(expected), 1)

    print(f"produced bars : {len(got)}")
    print(f"expected bars : {len(expected)}")
    print(f"exact matches : {tp}")
    print(f"precision     : {precision:.2f}")
    print(f"recall        : {recall:.2f}")
    print(f"WER (word)    : {wer(' '.join(expected), ' '.join(got)):.2f}")


if __name__ == "__main__":
    main()
