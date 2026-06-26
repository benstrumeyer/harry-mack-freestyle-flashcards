import os, tempfile
PAUSE_THRESHOLD_MS = int(os.getenv("PAUSE_THRESHOLD_MS", "300"))
MIN_BAR_WORDS = int(os.getenv("MIN_BAR_WORDS", "4"))
MAX_BAR_WORDS = int(os.getenv("MAX_BAR_WORDS", "12"))
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "large-v3")
DEMUCS_MODEL = os.getenv("DEMUCS_MODEL", "htdemucs_ft")
DEVICE = os.getenv("DEVICE", "cuda")
WORK_DIR = os.getenv("WORK_DIR", os.path.join(tempfile.gettempdir(), "freestyle"))
HF_TOKEN = os.getenv("HF_TOKEN")  # optional; diarization falls back if absent
