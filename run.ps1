# Start Travion Backend and Frontend
# NOTE: Backend runs on port 8002 to match frontend/.env (VITE_API_BASE_URL=http://localhost:8002/api/v1)
Write-Host "===============================================" -ForegroundColor Cyan
Write-Host "   Starting Travion AI Travel Platform...      " -ForegroundColor Cyan
Write-Host "===============================================" -ForegroundColor Cyan

$backendProcess = Start-Process python -ArgumentList "-m uvicorn app.main:app --reload --port 8002" -WorkingDirectory "$PSScriptRoot\backend" -PassThru
Write-Host "✓ FastAPI Backend started on http://localhost:8002 (PID: $($backendProcess.Id))" -ForegroundColor Green

$frontendProcess = Start-Process npm -ArgumentList "run dev" -WorkingDirectory "$PSScriptRoot\frontend" -PassThru
Write-Host "✓ React Frontend started on http://localhost:5173 (PID: $($frontendProcess.Id))" -ForegroundColor Green

Write-Host "`nTravion is running!" -ForegroundColor Cyan
Write-Host "Frontend: http://localhost:5173"
Write-Host "Backend API Docs: http://localhost:8002/api/v1/docs"
Write-Host "`nPress any key to stop all servers..." -ForegroundColor Yellow

$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")

Stop-Process -Id $backendProcess.Id -Force -ErrorAction SilentlyContinue
Stop-Process -Id $frontendProcess.Id -Force -ErrorAction SilentlyContinue
Write-Host "Servers stopped." -ForegroundColor Red
