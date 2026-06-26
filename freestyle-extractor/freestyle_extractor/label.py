import functools, re
from .models import Bar
from .phonetics import rhyme_tail

@functools.lru_cache(maxsize=1)
def _nlp():
    import spacy
    return spacy.load("en_core_web_sm")

def _opener(text: str, max_words: int = 7) -> str:
    doc = _nlp()(text)
    out = []
    for tok in doc:
        if tok.pos_ in ("NOUN", "PROPN") and len(out) >= 2:
            break
        out.append(tok.text)
        if len(out) >= max_words:
            break
    return " ".join(out).strip()

def _final_word(text: str) -> str | None:
    words = re.findall(r"[A-Za-z']+", text)
    return words[-1] if words else None

def label(bars: list[Bar]) -> list[Bar]:
    for b in bars:
        rw = _final_word(b.text)
        b.rhyme_word = rw
        b.rhyme_key = rhyme_tail(rw) if rw else None
        b.opener = _opener(b.text)
    return bars
