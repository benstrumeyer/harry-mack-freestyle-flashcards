from .models import Bar
from .phonetics import rhyme_tail


def _final_word(text: str) -> str | None:
    toks = text.split()
    return toks[-1] if toks else None


def classify(bars: list[Bar]) -> list[Bar]:
    tails = [rhyme_tail(_final_word(b.text) or "") for b in bars]
    kept: list[Bar] = []
    for i, b in enumerate(bars):
        n_words = len(b.text.split())
        # A real bar: at least 2 words AND its final word rhymes with an adjacent bar's final.
        # (MIN_BAR_WORDS=4 is the segment guard; here we only need ≥ 2 words — single-word
        # exclamations like "yeah" or "ok" are filler even if espeak happens to match them.)
        has_neighbor_rhyme = any(
            tails[i] is not None and tails[i] == tails[j]
            for j in (i - 1, i + 1) if 0 <= j < len(bars)
        )
        is_bar = n_words >= 2 and has_neighbor_rhyme
        if is_bar:
            b.is_freestyle = True
            kept.append(b)
    return kept
