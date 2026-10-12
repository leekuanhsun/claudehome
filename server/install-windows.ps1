# 在 Windows 上設定「登入 Windows 後自動啟動」的存錢計畫伺服器（用工作排程器）
# 執行方式（在專案資料夾內）：powershell -ExecutionPolicy Bypass -File server\install-windows.ps1
$ErrorActionPreference = 'Stop'

$projectDir = Split-Path -Parent $PSScriptRoot
$serverFile = Join-Path $projectDir 'server\server.js'
$logDir = Join-Path $projectDir 'server\data\logs'

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) { throw '找不到 node，請先安裝 Node.js 22 以上（https://nodejs.org）' }
$node = $nodeCmd.Source
$version = (& $node -p 'process.versions.node').Trim()
$parts = $version.Split('.') | ForEach-Object { [int]$_ }
if ($parts[0] -lt 22 -or ($parts[0] -eq 22 -and $parts[1] -lt 13)) {
  throw "Node 版本太舊：$version，需要 22.13 以上"
}

New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir 'server.log'

# 透過 cmd 把輸出寫進日誌檔
$arguments = "/c `"`"$node`" `"$serverFile`" >> `"$log`" 2>&1`""
$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument $arguments -WorkingDirectory $projectDir
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask -TaskName 'SavingPlanServer' -Action $action -Trigger $trigger `
  -Settings $settings -Description '存錢計畫伺服器' -Force | Out-Null
Start-ScheduledTask -TaskName 'SavingPlanServer'

Write-Host '伺服器已安裝，並會在登入 Windows 後自動啟動。'
Write-Host '下一步：node server\server.js add-user <帳號>'
Write-Host "日誌：$log"
