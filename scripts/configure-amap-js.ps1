param()
$ErrorActionPreference = 'Stop'
$taskRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$taskRuntime = Join-Path $taskRoot '.runtime'
$taskFile = Join-Path $taskRuntime 'amap-js.json'
if (-not [IO.Path]::GetFullPath($taskFile).StartsWith($taskRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw '配置路径越界' }
$taskKey = Read-Host 'Web端(JS API) Key（不是Web服务Key）'
$taskSecure = Read-Host '对应安全密钥securityJsCode（不回显）' -AsSecureString
$taskPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($taskSecure)
try {
  $taskCode = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($taskPointer)
  if ($taskKey -notmatch '^[a-zA-Z0-9]{16,100}$' -or $taskCode -notmatch '^[a-zA-Z0-9_-]{16,100}$') { throw '凭据格式不符合要求' }
  New-Item -ItemType Directory -Path $taskRuntime -Force | Out-Null
  if (-not (Test-Path -LiteralPath $taskFile)) { [IO.File]::WriteAllText($taskFile, '{}', (New-Object Text.UTF8Encoding($false))) }
  $taskAcl = Get-Acl -LiteralPath $taskFile
  $taskAcl.SetAccessRuleProtection($true, $false)
  foreach ($taskRule in @($taskAcl.Access)) { [void]$taskAcl.RemoveAccessRuleAll($taskRule) }
  $taskIdentity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  $taskAcl.SetAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($taskIdentity, 'FullControl', 'Allow')))
  Set-Acl -LiteralPath $taskFile -AclObject $taskAcl
  [IO.File]::WriteAllText($taskFile, (@{key=$taskKey;securityJsCode=$taskCode} | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding($false)))
  Write-Output 'JS地图配置已写入本地受限文件。未校验服务平台、权限或真实底图；请按验收指南验证。'
} finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($taskPointer); $taskCode = $null; $taskSecure.Dispose() }
