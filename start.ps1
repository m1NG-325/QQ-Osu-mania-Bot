$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$nodeExecutable = (Get-Command node -ErrorAction Stop).Source
$restartDelay = 3
while ($true) {
    # Avoid creating a second bot, including when another copy was started manually.
    $botPort = 3210
    if (Test-Path -LiteralPath '.env') {
        $portLine = Get-Content -LiteralPath '.env' | Where-Object { $_ -match '^\s*PORT\s*=\s*(\d+)\s*$' } | Select-Object -Last 1
        if ($portLine -and $portLine -match '(\d+)\s*$') { $botPort = [int]$Matches[1] }
    }
    $probe = [System.Net.Sockets.TcpClient]::new()
    try {
        $connected = $probe.ConnectAsync('127.0.0.1', $botPort).Wait(500)
        if ($connected -and $probe.Connected) {
            Write-Host "Port $botPort is already listening. No second bot will be started."
            break
        }
    } catch { } finally { $probe.Dispose() }
    Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Starting Mania bot"
    $startedAt = Get-Date
    & $nodeExecutable --env-file-if-exists=.env src/server.js
    $botExitCode = $LASTEXITCODE
    if (((Get-Date) - $startedAt).TotalSeconds -ge 60) { $restartDelay = 3 }
    Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Bot exited ($botExitCode). Restarting in $restartDelay seconds."
    Start-Sleep -Seconds $restartDelay
    $restartDelay = [Math]::Min(60, $restartDelay * 2)
}
