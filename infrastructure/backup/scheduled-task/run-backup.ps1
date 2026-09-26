# Ghasedak backup task wrapper - ASCII-only (codepage-immune).
# Root-cause fix: the old .cmd embedded the Persian project path; cmd.exe under
# Task Scheduler (ANSI codepage) mangled it -> node MODULE_NOT_FOUND.
# Notes:
#  - project dir resolved at runtime by .NET (Unicode-safe) via package.json marker
#  - EAP=Continue around the native call: node stderr must NOT abort the wrapper
#  - node exit code is the wrapper exit code -> Task Scheduler LastTaskResult
# Args (forwarded by run-backup.cmd): --Url <connection>  --Out <dir>
#   empty --Url = backup script default (daily job target: primary, read-only COPY)
$log = 'C:\ghasedak-tools\backup-cron.log'
function Write-Log([string]$m) {
  Add-Content -Path $log -Value ("[{0}] {1}" -f (Get-Date -Format o), $m) -Encoding UTF8
}

# ---- manual arg parsing (case-insensitive -match)
$Url = ''
$Out = 'C:\ghasedak-backups'
for ($i = 0; $i -lt $args.Count; $i++) {
  if ($args[$i] -match '^--?url=(.+)$') { $Url = $Matches[1] }
  elseif ($args[$i] -match '^--?out=(.+)$') { $Out = $Matches[1] }
  elseif ($args[$i] -match '^--?url$') { $Url = $args[$i + 1]; $i++ }
  elseif ($args[$i] -match '^--?out$') { $Out = $args[$i + 1]; $i++ }
}

# ---- resolve absolute node.exe
$node = 'C:\Program Files\nodejs\node.exe'
if (-not (Test-Path $node)) { $node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source }
if (-not $node -or -not (Test-Path $node)) { Write-Log 'FATAL node.exe not found'; exit 4 }

# ---- resolve project root by marker (ASCII marker match inside package.json)
$desktop = 'C:\Users\milad\OneDrive\Desktop'
$root = $null
foreach ($d in (Get-ChildItem $desktop -Directory -ErrorAction SilentlyContinue)) {
  $pkg = Join-Path $d.FullName 'package.json'
  if (Test-Path $pkg) {
    $raw = [System.IO.File]::ReadAllText($pkg)   # .NET reads UTF-8 correctly
    if ($raw -match '"name"\s*:\s*"ghasedak"') { $root = $d.FullName; break }
  }
}
if (-not $root) { Write-Log 'FATAL project root (ghasedak package.json) not found'; exit 4 }
$script = Join-Path $root 'infrastructure\backup\ghasedak-backup.mjs'
if (-not (Test-Path $script)) { Write-Log 'FATAL backup script missing'; exit 4 }

# ---- run real backup (fail-fast with correct exit code)
$masked = '*default (primary)*'
if ($Url -ne '') { $masked = $Url -replace '(://[^:/@]+):[^:@/]*@', '$1:***@' }
Write-Log ("run start target=" + $masked)
$allArgs = @($script, '--out', $Out)
if ($Url -ne '') { $allArgs += @('--url', $Url) }

$prevEap = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$output = & $node @allArgs 2>&1
$code = $LASTEXITCODE
$ErrorActionPreference = $prevEap

foreach ($line in @($output)) {
  if ($null -ne $line) { Write-Log ("node: " + (($line | Out-String).Trim() -replace "`0", '')) }
}
Write-Log ("run end exit=" + $code)
exit $code
