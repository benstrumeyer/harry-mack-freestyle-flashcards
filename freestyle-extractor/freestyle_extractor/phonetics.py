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


@functools.lru_cache(maxsize=4096)
def _phonemes_sep(word: str) -> str:
    # like _phonemes but with espeak's per-phoneme separator so vowel tokens
    # can be split apart (plain -x output has no phoneme boundaries).
    try:
        out = subprocess.run([_espeak_bin(), "-q", "-x", "--sep= ", word],
                             capture_output=True, text=True, timeout=5)
        return out.stdout.strip()
    except Exception:
        return ""


def vowel_sequence(word: str) -> list[str]:
    raw = _phonemes_sep(word)
    if not raw:
        return []
    toks = raw.replace("'", " ").replace(",", " ").split()
    return [t for t in toks if any(t.startswith(v) for v in _VOWELS)]


def word_phonemes(word: str) -> dict:
    ipa = _phonemes(word).strip()
    seq = vowel_sequence(word)
    return {"ipa": ipa, "vowel_seq": seq, "n_syllables": len(seq)}


def longest_common_vowel_run(a: list[str], b: list[str]) -> int:
    # longest common CONTIGUOUS run (classic DP on vowel tokens)
    if not a or not b:
        return 0
    best = 0
    dp = [[0] * (len(b) + 1) for _ in range(len(a) + 1)]
    for i in range(1, len(a) + 1):
        for j in range(1, len(b) + 1):
            if a[i - 1] == b[j - 1]:
                dp[i][j] = dp[i - 1][j - 1] + 1
                best = max(best, dp[i][j])
    return best
