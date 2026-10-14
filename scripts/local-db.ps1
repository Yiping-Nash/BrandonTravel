param([ValidateSet('init','start','stop','backup','restore')][string]$Action='start', [string]$BackupFile, [string]$TargetDatabase)
$ErrorActionPreference='Stop'
$taskRoot=Split-Path $PSScriptRoot -Parent
$taskBin=Join-Path $taskRoot '.tools/postgresql/pgsql/bin'
$taskRuntime=Join-Path $taskRoot '.runtime'
$taskData=Join-Path $taskRuntime 'postgres-data'
New-Item -ItemType Directory $taskRuntime -Force | Out-Null
$taskConfig=Join-Path $taskRuntime 'config.json'
if (!(Test-Path $taskConfig)) {
 $taskBytes=New-Object byte[] 32
 $taskRng=[System.Security.Cryptography.RandomNumberGenerator]::Create()
 try {
  $taskRng.GetBytes($taskBytes)
  $taskPassword=[BitConverter]::ToString($taskBytes).Replace('-','')
  $taskRng.GetBytes($taskBytes)
  @{databasePassword=$taskPassword;jwtSecret=[BitConverter]::ToString($taskBytes).Replace('-','')} | ConvertTo-Json | Set-Content $taskConfig -Encoding utf8
 } finally { $taskRng.Dispose() }
}
$taskSettings=Get-Content $taskConfig -Raw | ConvertFrom-Json
$env:PGPASSWORD=$taskSettings.databasePassword
try {
 if ($Action -eq 'init') {
  if (!(Test-Path (Join-Path $taskData 'PG_VERSION'))) {
   $taskPw=Join-Path $taskRuntime 'pg-init-password'
   [System.IO.File]::WriteAllText($taskPw,$taskSettings.databasePassword,(New-Object System.Text.UTF8Encoding($false)))
   try { & "$taskBin/initdb.exe" -D $taskData -U brandon --auth=scram-sha-256 --pwfile=$taskPw --encoding=UTF8 --locale=C; if ($LASTEXITCODE -ne 0) { throw 'initdb failed' } }
   finally { Remove-Item -LiteralPath $taskPw -Force }
   Add-Content (Join-Path $taskData 'postgresql.conf') "`nlisten_addresses='127.0.0.1'`nport=54329" -Encoding utf8
  }
  exit 0
 }
 if ($Action -eq 'start') {
  & "$taskBin/pg_ctl.exe" -D $taskData status *> $null
  if ($LASTEXITCODE -ne 0) { & "$taskBin/pg_ctl.exe" -D $taskData -l (Join-Path $taskRuntime 'postgres.log') -w start; if ($LASTEXITCODE -ne 0) { throw 'Postgres start failed' } }
  $taskExists=& "$taskBin/psql.exe" -h 127.0.0.1 -p 54329 -U brandon -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='brandontravel'"
  if ($taskExists -ne '1') { & "$taskBin/createdb.exe" -h 127.0.0.1 -p 54329 -U brandon brandontravel; if ($LASTEXITCODE -ne 0) { throw 'createdb failed' } }
 } elseif ($Action -eq 'stop') { & "$taskBin/pg_ctl.exe" -D $taskData -w stop }
 elseif ($Action -eq 'backup') {
  New-Item -ItemType Directory (Join-Path $taskRuntime 'backups') -Force | Out-Null
  $taskBackup=Join-Path $taskRuntime ('backups/'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'.dump')
  & "$taskBin/pg_dump.exe" -h 127.0.0.1 -p 54329 -U brandon -Fc -f $taskBackup brandontravel
 }
 if ($Action -eq 'restore') {
  if (!$BackupFile -or !(Test-Path -LiteralPath $BackupFile) -or !$TargetDatabase -or $TargetDatabase -notmatch '^[a-z][a-z0-9_]+$' -or $TargetDatabase -in @('postgres','template0','template1')) { throw 'Provide valid BackupFile and explicit TargetDatabase' }
  & "$taskBin/pg_restore.exe" -h 127.0.0.1 -p 54329 -U brandon -d $TargetDatabase --clean --if-exists --single-transaction $BackupFile
 }
 if ($LASTEXITCODE -ne 0) { throw "Database action failed: $Action" }
} finally { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
