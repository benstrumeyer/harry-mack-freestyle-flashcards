# One-time setup. Requires: Python 3.11, .NET 8 SDK, Node + pnpm, espeak-ng + yt-dlp on PATH.
Push-Location freestyle-extractor
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m spacy download en_core_web_sm
Pop-Location

Push-Location frontend; pnpm install; Pop-Location
Push-Location backend; dotnet restore; Pop-Location

Write-Host "Setup done. SQLite freestyle.db is created on first API run."
