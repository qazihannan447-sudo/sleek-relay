param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('build', 'dev', 'start')]
  [string]$Mode
)

$ErrorActionPreference = 'Stop'

$appRoot = Split-Path -Parent $PSScriptRoot
$nextOutputPath = Join-Path $appRoot '.next'
$nextBinPath = Join-Path $appRoot 'node_modules\next\dist\bin\next'
$normalizedAppRoot = $appRoot.ToLowerInvariant()

function Get-PortalNextProcesses {
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object {
      $_.CommandLine `
        -and $_.CommandLine.ToLowerInvariant().Contains($normalizedAppRoot) `
        -and $_.CommandLine.ToLowerInvariant().Contains('next')
    }
}

function Stop-PortalNextProcesses {
  $processes = @(Get-PortalNextProcesses)

  foreach ($process in $processes) {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
  }

  if ($processes.Count -gt 0) {
    Start-Sleep -Milliseconds 750
  }
}

function Remove-NextOutput {
  if (-not (Test-Path -LiteralPath $nextOutputPath)) {
    return
  }

  for ($attempt = 1; $attempt -le 3; $attempt += 1) {
    try {
      Remove-Item -Recurse -Force -LiteralPath $nextOutputPath
      return
    } catch {
      if ($attempt -eq 3) {
        throw
      }

      Stop-PortalNextProcesses
      Start-Sleep -Seconds 1
    }
  }
}

if (-not (Test-Path -LiteralPath $nextBinPath)) {
  throw "Next.js is not installed at '$nextBinPath'. Run 'npm install' in apps/portal first."
}

if ($Mode -eq 'dev' -or $Mode -eq 'build') {
  Stop-PortalNextProcesses
  Remove-NextOutput
}

Set-Location -LiteralPath $appRoot
& node $nextBinPath $Mode
exit $LASTEXITCODE
