param(
  [string]$DbUrl = 'postgresql://postgres:rehearsal-pw@127.0.0.1:55433/baseline_test1',
  [int]$ApiPort = 4001,
  [string]$LogName = 'api'
)
$env:DATABASE_URL = $DbUrl
$env:PORT = "$ApiPort"
Start-Process -FilePath 'node' -ArgumentList 'dist/main.js' -WorkingDirectory 'apps/api' -WindowStyle Hidden -RedirectStandardOutput "C:/ghasedak-phase9-recovery-rehearsal/$LogName.log" -RedirectStandardError "C:/ghasedak-phase9-recovery-rehearsal/$LogName.err.log"
Start-Sleep -Seconds 8
Get-Content "C:/ghasedak-phase9-recovery-rehearsal/$LogName.log" -Tail 3
Get-Content "C:/ghasedak-phase9-recovery-rehearsal/$LogName.err.log" -Tail 3
