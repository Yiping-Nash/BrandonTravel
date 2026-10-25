param([switch]$Install)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
if ($Install) {
    uv sync --frozen
    if ($LASTEXITCODE -ne 0) { throw 'Python dependency installation failed' }
    npm ci --prefix apps/web
    if ($LASTEXITCODE -ne 0) { throw 'Frontend dependency installation failed' }
}
if (-not (Test-Path '.env')) { Copy-Item '.env.example' '.env' }
$apiExe = Join-Path (Get-Location) '.venv/Scripts/python.exe'
$apiProc = Start-Process -FilePath $apiExe -ArgumentList '-m','uvicorn','apps.api.main:app','--host','127.0.0.1','--port','8000' -WindowStyle Hidden -PassThru
try { npm run dev --prefix apps/web -- --port 5173 --strictPort }
finally { if (-not $apiProc.HasExited) { Stop-Process -Id $apiProc.Id } }
