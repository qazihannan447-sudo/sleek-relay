$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Convert-ToWslPath {
    param(
        [Parameter(Mandatory = $true)]
        [string] $WindowsPath
    )

    if (Test-Path -LiteralPath $WindowsPath) {
        $resolvedPath = (Resolve-Path -LiteralPath $WindowsPath).Path
    } else {
        $resolvedPath = [System.IO.Path]::GetFullPath($WindowsPath)
    }
    $driveLetter = $resolvedPath.Substring(0, 1).ToLowerInvariant()
    $pathTail = $resolvedPath.Substring(2).Replace('\', '/')

    return "/mnt/$driveLetter$pathTail"
}

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$workerDirWindows = Join-Path $repoRoot "workers\voice"
$workerEnvWindows = Join-Path $repoRoot ".env.voice"
$distroName = "Ubuntu-24.04"

if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) {
    throw "voice worker error: WSL is not installed or wsl.exe is not available on PATH."
}

if (-not (Test-Path -LiteralPath $workerDirWindows -PathType Container)) {
    throw "voice worker error: worker project directory is missing: $workerDirWindows"
}

if (-not (Test-Path -LiteralPath $workerEnvWindows -PathType Leaf)) {
    throw "voice worker error: missing provider configuration file: $workerEnvWindows"
}

& wsl.exe -d $distroName -- bash -lc "exit 0" | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "voice worker error: unable to start WSL distro '$distroName'."
}

$workerDirWsl = Convert-ToWslPath -WindowsPath $workerDirWindows
$workerEnvWsl = Convert-ToWslPath -WindowsPath $workerEnvWindows

$tempDirWindows = "C:\tmp"
if (-not (Test-Path -LiteralPath $tempDirWindows -PathType Container)) {
    [void](New-Item -ItemType Directory -Path $tempDirWindows)
}

$tempScriptWindows = Join-Path $tempDirWindows "sleek-relay-run-voice-worker.sh"
$tempScriptWsl = Convert-ToWslPath -WindowsPath $tempScriptWindows

$bashScript = @(
    "set -euo pipefail"
    "worker_dir='$workerDirWsl'"
    "env_file='$workerEnvWsl'"
    'uv_env="$HOME/.venvs/sleek-relay-voice"'
    'export PATH="$HOME/.local/bin:$PATH"'
    'if [ ! -d "$worker_dir" ]; then printf "%s\n" "voice worker error: worker project directory is missing in WSL: $worker_dir" >&2; exit 1; fi'
    'if [ ! -f "$env_file" ]; then printf "%s\n" "voice worker error: missing provider configuration file in WSL: $env_file" >&2; exit 1; fi'
    'uv_bin="$(command -v uv || true)"'
    'if [ -z "$uv_bin" ] && [ -x "$HOME/.local/bin/uv" ]; then uv_bin="$HOME/.local/bin/uv"; fi'
    'if [ -z "$uv_bin" ]; then printf "%s\n" "voice worker error: uv is not installed in WSL." >&2; exit 1; fi'
    'if [ ! -d "$uv_env" ]; then printf "%s\n" "voice worker error: expected uv environment is missing: $uv_env" >&2; exit 1; fi'
    'if ! "$uv_bin" python find 3.12 >/dev/null 2>&1; then printf "%s\n" "voice worker error: Python 3.12 is not available to uv in WSL." >&2; exit 1; fi'
    'cd "$worker_dir"'
    'export UV_PROJECT_ENVIRONMENT="$uv_env"'
    'printf "%s\n" "voice worker startup: using uv at $uv_bin"'
    'exec "$uv_bin" run --python 3.12 -m app.bot'
) -join "`n"

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($tempScriptWindows, $bashScript, $utf8NoBom)

try {
    & wsl.exe -d $distroName -- bash $tempScriptWsl
    exit $LASTEXITCODE
} finally {
    Remove-Item -LiteralPath $tempScriptWindows -ErrorAction SilentlyContinue
}
