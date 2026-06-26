import os, subprocess
from . import config


def vocals_path(stem: str, work_dir: str) -> str:
    return os.path.join(work_dir, config.DEMUCS_MODEL, stem, "vocals.wav")


def separate(wav_path: str, work_dir: str) -> str:
    stem = os.path.splitext(os.path.basename(wav_path))[0]
    subprocess.run(["demucs", "-n", config.DEMUCS_MODEL, "--two-stems=vocals",
                    "-o", work_dir, wav_path], check=True)
    out = vocals_path(stem, work_dir)
    if not os.path.exists(out):
        raise RuntimeError(f"Demucs produced no vocals at {out}")
    return out
