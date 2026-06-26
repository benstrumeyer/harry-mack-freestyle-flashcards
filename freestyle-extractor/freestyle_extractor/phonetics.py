import subprocess, functools, shutil, os

_VOWELS = {"a","e","i","o","u","A","E","I","O","U","V","Q","@","3","{",
           "aI","aU","OI","eI","@U","I@","e@","U@","3:","A:","O:","i:","u:"}

def _espeak_bin() -> str:
    return (shutil.which("espeak-ng")
            or os.environ.get("ESPEAK_BIN")
            or r"C:\Program Files\eSpeak NG\espeak-ng.exe")

@functools.lru_cache(maxsize=4096)
def _phonemes(word: str) -> str:
    try:
        out = subprocess.run([_espeak_bin(), "-q", "-x", word], capture_output=True,
                             text=True, timeout=5)
        return out.stdout.strip()
    except Exception:
        return ""

def rhyme_tail(word: str) -> str | None:
    raw = _phonemes(word)
    if not raw:
        return None
    toks = raw.replace("'", " ").replace(",", " ").split()
    last = None
    for i, t in enumerate(toks):
        if any(t.startswith(v) for v in _VOWELS):
            last = i
    if last is None:
        return None
    return " ".join(toks[last:])

def rhymes(a: str, b: str) -> bool:
    if a.lower() == b.lower():
        return True
    ta, tb = rhyme_tail(a), rhyme_tail(b)
    return ta is not None and ta == tb
