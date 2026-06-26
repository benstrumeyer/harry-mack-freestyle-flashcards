from .models import Word, Bar
from . import config
from .phonetics import rhyme_tail

def _split_on_pauses(words: list[Word]) -> list[list[Word]]:
    if not words:
        return []
    lines, cur = [], [words[0]]
    for prev, w in zip(words, words[1:]):
        gap_ms = (w.start - prev.end) * 1000.0
        if gap_ms > config.PAUSE_THRESHOLD_MS:
            lines.append(cur); cur = []
        cur.append(w)
    if cur:
        lines.append(cur)
    return lines

def _split_overlong(line: list[Word]) -> list[list[Word]]:
    # If a line exceeds MAX_BAR_WORDS, split where an internal word rhymes with the final.
    if len(line) <= config.MAX_BAR_WORDS:
        return [line]
    final_tail = rhyme_tail(line[-1].text)
    for i in range(config.MIN_BAR_WORDS, len(line) - config.MIN_BAR_WORDS):
        if final_tail and rhyme_tail(line[i].text) == final_tail:
            return [line[:i+1], line[i+1:]]
    mid = len(line) // 2
    return [line[:mid], line[mid:]]

def _to_bar(line: list[Word]) -> Bar:
    return Bar(text=" ".join(w.text for w in line),
               start=line[0].start, end=line[-1].end)

def segment(words: list[Word]) -> list[Bar]:
    bars: list[Bar] = []
    for line in _split_on_pauses(words):
        for piece in _split_overlong(line):
            if piece:
                bars.append(_to_bar(piece))
    return bars
