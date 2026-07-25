# Claude Terminal Hub launcher
# - Reuse port if already running, otherwise start server in background.
# - Default opens Edge/Chrome in --app mode (standalone window, no tabs/address bar).
#   Call "claude-hub tab" to open a normal browser tab instead.
$ErrorActionPreference = 'SilentlyContinue'

$Port = if ($env:CLAUDE_HUB_PORT) { [int]$env:CLAUDE_HUB_PORT } else { 4778 }
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Url  = "http://localhost:$Port"
$Mode = if ($args.Count -ge 1) { $args[0] } else { 'app' }   # 'app' (default) | 'tab'

function Test-Hub {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $iar = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
        if (-not $iar.AsyncWaitHandle.WaitOne(1000)) { $client.Close(); return $false }
        $client.EndConnect($iar); $client.Close()
    } catch { return $false }
    try {
        $wc = New-Object System.Net.WebClient; $wc.Proxy = $null
        return ($wc.DownloadString("http://127.0.0.1:$Port/health") -match 'claude-terminal-hub')
    } catch { return $false }
}

function Find-Browser {
    $cands = @(
        "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
        "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"
    )
    foreach ($c in $cands) { if (Test-Path $c) { return $c } }
    return $null
}

function Open-Hub {
    if ($Mode -eq 'tab') { Start-Process $Url; return }
    $browser = Find-Browser
    if ($browser) {
        $prof = "$env:LOCALAPPDATA\claude-hub-appwin"
        Start-Process -FilePath $browser -ArgumentList "--app=$Url", "--window-size=1500,950", "--user-data-dir=`"$prof`""
    } else {
        Start-Process $Url
    }
}

if (Test-Hub) {
    Write-Host "[claude-hub] already running -> reuse port $Port ($Mode)" -ForegroundColor Green
    Open-Hub
    exit 0
}

Write-Host "[claude-hub] starting server on port $Port ..." -ForegroundColor Cyan
$env:CLAUDE_HUB_PORT = "$Port"

# node-pty 는 postinstall 에서 Electron ABI 로 리빌드되므로, 브라우저 모드도 시스템 node 대신
# Electron 의 node 런타임(ELECTRON_RUN_AS_NODE)으로 서버를 띄워 ABI 를 맞춘다.
$ElectronExe = Join-Path $Root 'node_modules\electron\dist\electron.exe'
if (Test-Path $ElectronExe) {
    $env:ELECTRON_RUN_AS_NODE = '1'
    Start-Process -FilePath $ElectronExe -ArgumentList "`"$Root\server.js`"" -WorkingDirectory $Root -WindowStyle Hidden
} else {
    Start-Process -FilePath "node" -ArgumentList "`"$Root\server.js`"" -WorkingDirectory $Root -WindowStyle Hidden
}

$ok = $false
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 500
    if (Test-Hub) { $ok = $true; break }
}

if ($ok) {
    Write-Host "[claude-hub] ready -> $Url ($Mode)" -ForegroundColor Green
    Open-Hub
} else {
    Write-Host "[claude-hub] failed to start. Try manually: node `"$Root\server.js`"" -ForegroundColor Red
    exit 1
}
