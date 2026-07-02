# Launches all three services in separate windows. No Docker.
Start-Process pwsh -ArgumentList '-NoExit', '-Command', 'cd backend/HarryMack.Api; dotnet run --no-launch-profile --urls http://localhost:5007'
Start-Process pwsh -ArgumentList '-NoExit', '-Command', 'cd frontend; pnpm dev'
Start-Process pwsh -ArgumentList '-NoExit', '-Command', 'cd freestyle-extractor; .\.venv\Scripts\Activate.ps1; uvicorn freestyle_extractor.app:app --port 8900'
Write-Host "API :5007  .  Frontend :5173  .  Extractor :8900"
