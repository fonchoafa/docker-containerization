# smoke-test.ps1 - checks the running Docker Compose stack.
# Usage:  .\scripts\smoke-test.ps1                       (default http://localhost:8080)
#         .\scripts\smoke-test.ps1 -AdminKey <key>       (also tests the protected delete)
param(
  [string]$Url = 'http://localhost:8080',
  [string]$AdminKey = ''
)

$Url = $Url.TrimEnd('/')
$pass = 0; $fail = 0
function Check($name, $ok) {
  if ($ok) { Write-Host "  [PASS] $name"; $script:pass++ } else { Write-Host "  [FAIL] $name"; $script:fail++ }
}

Write-Host "Testing $Url"

try {
  $health = Invoke-RestMethod "$Url/health" -TimeoutSec 10
  Check "health endpoint returns ok (through nginx)" ($health.status -eq 'ok')
  Check "notes are stored in a file (volume)" ($health.storage.notes -eq 'file')
  Check "uploads are stored on disk (volume)" ($health.storage.files -eq 'disk')
} catch {
  Check "health endpoint reachable (is 'docker compose up' running?)" $false
}

try {
  $note = Invoke-RestMethod "$Url/api/notes" -Method Post -ContentType 'application/json' `
    -Body (@{ title = 'smoke test'; body = 'created by smoke-test.ps1' } | ConvertTo-Json)
  Check "can create a note" ([bool]$note.id)

  $list = Invoke-RestMethod "$Url/api/notes"
  Check "note appears in the list" (@($list | Where-Object { $_.id -eq $note.id }).Count -eq 1)

  try {
    Invoke-RestMethod "$Url/api/notes/$($note.id)" -Method Delete | Out-Null
    Check "delete without admin key is refused" $false
  } catch {
    Check "delete without admin key is refused" ($_.Exception.Response.StatusCode.value__ -eq 401)
  }

  if ($AdminKey) {
    try {
      Invoke-WebRequest "$Url/api/notes/$($note.id)" -Method Delete -Headers @{ 'x-admin-key' = $AdminKey } -UseBasicParsing | Out-Null
      Check "delete with the admin key succeeds" $true
    } catch {
      Check "delete with the admin key succeeds" $false
    }
  }
} catch {
  Check "note API works" $false
}

try {
  $direct = Test-NetConnection localhost -Port 3000 -WarningAction SilentlyContinue
  Check "app port 3000 is NOT published to the PC (only nginx is)" (-not $direct.TcpTestSucceeded)
} catch {
  Check "app port 3000 is NOT published to the PC (only nginx is)" $true
}

Write-Host ""
Write-Host "Result: $pass passed, $fail failed"
if ($fail -gt 0) { exit 1 }
