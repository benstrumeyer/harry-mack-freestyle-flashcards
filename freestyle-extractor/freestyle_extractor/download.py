import json, os, re, subprocess
from .models import VideoMeta

_ID = re.compile(r"(?:v=|youtu\.be/|shorts/)([A-Za-z0-9_-]{11})")

def video_id(url: str) -> str | None:
    m = _ID.search(url)
    return m.group(1) if m else None

def download(url: str, work_dir: str) -> tuple[str, VideoMeta]:
    os.makedirs(work_dir, exist_ok=True)
    vid = video_id(url) or "audio"
    wav = os.path.join(work_dir, f"{vid}.wav")
    subprocess.run(["yt-dlp", "-x", "--audio-format", "wav", "--no-progress",
                    "-o", os.path.join(work_dir, f"{vid}.%(ext)s"), url], check=True)
    meta = subprocess.run(["yt-dlp", "--no-progress", "--skip-download",
                           "--print", "%(id)s\t%(title)s\t%(duration)s", url],
                          capture_output=True, text=True, check=True).stdout.strip().split("\t")
    return wav, VideoMeta(youtube_id=meta[0], title=meta[1],
                          duration_seconds=float(meta[2]) if meta[2] not in ("", "NA") else None,
                          url=url)
