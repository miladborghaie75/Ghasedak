# راه‌اندازی PostgreSQL محلی بدون نصب سیستم — باینری Zonky در infrastructure/pg/pg
# استفاده:
#   powershell -ExecutionPolicy Bypass -File infrastructure/pg-setup.ps1
# پیش‌فرض: port 5433, user postgres, password ghasedak-dev-pw, db ghasedak

$ErrorActionPreference = "Stop"

$root = if ($env:GHASEDAK_PG_HOME) { $env:GHASEDAK_PG_HOME } else { "C:\ghasedak-pg" }
$src  = Join-Path $PSScriptRoot "pg"

if (-not (Test-Path (Join-Path $root "bin\bin\initdb.exe"))) {
  Write-Host "== کپی باینری‌ها به $root (مسیر ASCII برای جلوگیری از باگ Unicode initdb)"
  New-Item -ItemType Directory -Force -Path $root | Out-Null
  Copy-Item -Recurse -Force $src (Join-Path $root "bin")
}

$data = Join-Path $root "data"
if (-not (Test-Path (Join-Path $data "PG_VERSION"))) {
  Write-Host "== initdb"
  $pw = Join-Path $env:TEMP "gh-pw.txt"
  Set-Content -Path $pw -Value "ghasedak-dev-pw" -NoNewline
  & (Join-Path $root "bin\bin\initdb.exe") -D $data -U postgres --pwfile=$pw -E UTF8 -A scram-sha-256 --locale=C
  Remove-Item $pw
}

$env:PATH = (Join-Path $root "bin\bin") + ";$env:SystemRoot\System32"
Write-Host "== start (port 5433)"
& (Join-Path $root "bin\bin\pg_ctl.exe") -D $data -l (Join-Path $root "logs\pg.log") -o '"-p 5433"' start

Start-Sleep -Seconds 2
Write-Host "== create db (اگر نبود)"
$env:PGPASSWORD = "ghasedak-dev-pw"
$exists = & (Join-Path $root "bin\bin\psql.exe") -h 127.0.0.1 -p 5433 -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='ghasedak'"
if (-not $exists) {
  & (Join-Path $root "bin\bin\createdb.exe") -h 127.0.0.1 -p 5433 -U postgres ghasedak
}
Write-Host "== OK — DATABASE_URL=postgresql://postgres:ghasedak-dev-pw@localhost:5433/ghasedak"
