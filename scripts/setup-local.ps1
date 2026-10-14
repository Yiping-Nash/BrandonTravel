param([ValidateSet('all','tools')][string]$Scope='all')
$ErrorActionPreference='Stop'
$taskRoot=Split-Path $PSScriptRoot -Parent
$taskDownloads=Join-Path $taskRoot '.tools/downloads'
New-Item -ItemType Directory $taskDownloads -Force | Out-Null
$taskTools=@(
 @{Name='bun';Uri='https://github.com/oven-sh/bun/releases/download/bun-v1.4.2/bun-windows-x64.zip';Zip='bun.zip';Dest='bun';Exe='bun/bun-windows-x64/bun.exe'},
 @{Name='postgresql';Uri='https://get.enterprisedb.com/postgresql/postgresql-17.6-1-windows-x64-binaries.zip';Zip='postgresql.zip';Dest='postgresql';Exe='postgresql/pgsql/bin/postgres.exe'}
)
foreach($taskTool in $taskTools){
 if(!(Test-Path (Join-Path $taskRoot ('.tools/'+$taskTool.Exe)))){
  $taskZip=Join-Path $taskDownloads $taskTool.Zip
  Invoke-WebRequest $taskTool.Uri -OutFile $taskZip -TimeoutSec 120
  Expand-Archive -LiteralPath $taskZip -DestinationPath (Join-Path $taskRoot ('.tools/'+$taskTool.Dest)) -Force
 }
}
$taskBun=Join-Path $taskRoot '.tools/bun/bun-windows-x64/bun.exe'
& $taskBun --version
if($Scope -eq 'all'){
 $env:BUN_INSTALL_CACHE_DIR=Join-Path $taskRoot '.tools/cache/bun'
 $env:npm_config_cache=Join-Path $taskRoot '.tools/cache/npm'
 $env:TEMP=$taskDownloads;$env:TMP=$taskDownloads
 Push-Location $taskRoot
 try{& $taskBun install --frozen-lockfile;if($LASTEXITCODE -ne 0){throw 'Dependency install failed'}}finally{Pop-Location}
}
