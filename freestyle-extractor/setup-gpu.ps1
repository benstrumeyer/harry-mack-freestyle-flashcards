# One-time GPU env for the extractor (Python 3.12 — torch/WhisperX/Demucs/pyannote).
# Kept separate from the 3.14 unit-test venv (.venv). Verbose so it can be monitored.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

Write-Host '=== [1/5] create Python 3.12 venv (.venv312) ==='
py -V:3.12 -m venv .venv312
$py = Join-Path $PSScriptRoot '.venv312\Scripts\python.exe'

Write-Host '=== [2/5] upgrade pip/wheel ==='
& $py -m pip install -U pip wheel setuptools

Write-Host '=== [3/5] torch + torchaudio (CUDA 12.4) ==='
& $py -m pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu124

Write-Host '=== [4/5] extractor requirements ==='
& $py -m pip install -r requirements.txt
# ensure the CUDA torch wins if a dep pulled a CPU build
& $py -m pip install --no-deps --force-reinstall torch torchaudio --index-url https://download.pytorch.org/whl/cu124

Write-Host '=== [5/5] spaCy English model ==='
& $py -m spacy download en_core_web_sm

Write-Host '=== verify ==='
& $py -c "import torch, whisperx, demucs; print('torch', torch.__version__, 'cuda', torch.cuda.is_available())"
Write-Host 'GPU extractor env ready (.venv312).'
