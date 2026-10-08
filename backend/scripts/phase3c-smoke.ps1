<#
  ExamPro Phase 3C — student API smoke test (Windows PowerShell 5.1 and PowerShell 7).

  Start the backend first (npm run dev), then, from the backend folder:
      powershell -ExecutionPolicy Bypass -File .\scripts\phase3c-smoke.ps1 -AdminEmail admin@example.com -StudentEmail student@example.com

  You need an existing ADMIN account and an existing, email-VERIFIED STUDENT account. It asks for both passwords
  (typed hidden). It uses the admin account to create a clearly named "SMOKE-3C" exam, center, 20 PCs and a slot
  (2 seats, about 60 days ahead), opens registration, then exercises every student endpoint as the student.
  At the end the student's registration is cancelled again so the script can be re-run. The SMOKE objects stay in
  your database (ignore them or delete them later). Nothing else is changed or deleted.

  The simultaneous-registration (overbooking) test needs many students, so it lives in the real-database tests:
  npm run test:db
#>
param(
  [string]$Base = "http://localhost:5000/api",
  [Parameter(Mandatory = $true)][string]$AdminEmail,
  [Parameter(Mandatory = $true)][string]$StudentEmail
)

$ErrorActionPreference = "Stop"
function Read-Secret([string]$Prompt) {
  $s = Read-Host $Prompt -AsSecureString
  return [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
}
$adminPassword = Read-Secret "Admin password"
$studentPassword = Read-Secret "Student password"

$script:pass = 0; $script:fail = 0

function Call([string]$Method, [string]$Path, $Body = $null, [string]$Token = "") {
  $headers = @{}
  if ($Token) { $headers["Authorization"] = "Bearer $Token" }
  $req = @{ Uri = "$Base$Path"; Method = $Method; Headers = $headers; UseBasicParsing = $true }
  if ($null -ne $Body) { $req["ContentType"] = "application/json"; $req["Body"] = ($Body | ConvertTo-Json -Depth 6) }
  try {
    $r = Invoke-WebRequest @req
    return [pscustomobject]@{ Status = [int]$r.StatusCode; Json = ($r.Content | ConvertFrom-Json) }
  } catch {
    $resp = $_.Exception.Response
    $status = if ($resp) { [int]$resp.StatusCode } else { 0 }
    $text = $_.ErrorDetails.Message
    if (-not $text -and $resp) { try { $text = (New-Object IO.StreamReader($resp.GetResponseStream())).ReadToEnd() } catch {} }
    $json = $null
    try { $json = $text | ConvertFrom-Json } catch {}
    return [pscustomobject]@{ Status = $status; Json = $json }
  }
}

function Check([string]$Name, $Actual, $Expected) {
  if ("$Actual" -eq "$Expected") { $script:pass++; Write-Host "  PASS  $Name" -ForegroundColor Green }
  else { $script:fail++; Write-Host "  FAIL  $Name  (expected '$Expected', got '$Actual')" -ForegroundColor Red }
}
function CheckMatch([string]$Name, [string]$Actual, [string]$Pattern) {
  if ($Actual -match $Pattern) { $script:pass++; Write-Host "  PASS  $Name" -ForegroundColor Green }
  else { $script:fail++; Write-Host "  FAIL  $Name  ('$Actual' does not match $Pattern)" -ForegroundColor Red }
}

$inv = [Globalization.CultureInfo]::InvariantCulture
$stamp = (Get-Date).ToString("yyyyMMdd-HHmmss", $inv)
$slotDay = (Get-Date).AddDays(60).ToString("yyyy-MM-dd", $inv)
$regStart = (Get-Date).AddDays(-1).ToString("yyyy-MM-dd", $inv) + " 09:00:00"
$regEnd = (Get-Date).AddDays(30).ToString("yyyy-MM-dd", $inv) + " 23:59:59"

Write-Host "`n== Logins ==" -ForegroundColor Cyan
$a = Call "POST" "/auth/login" @{ email = $AdminEmail; password = $adminPassword; account_type = "staff" }
Check "admin login" $a.Status 200
$s = Call "POST" "/auth/login" @{ email = $StudentEmail; password = $studentPassword; account_type = "student" }
Check "student login" $s.Status 200
if ($a.Status -ne 200 -or $s.Status -ne 200) { Write-Host "Cannot continue without both logins." -ForegroundColor Red; exit 1 }
$admin = $a.Json.data.accessToken
$student = $s.Json.data.accessToken

Write-Host "`n== Setup as admin (SMOKE-3C exam, center, 20 PCs, slot of 2 seats) ==" -ForegroundColor Cyan
$exam = Call "POST" "/admin/examinations" @{ exam_name = "SMOKE-3C exam $stamp"; description = "Created by the Phase 3C smoke test"; instructions = "Smoke test"; registration_start_date = $regStart; registration_end_date = $regEnd; exam_duration_minutes = 180; fee = 0 } $admin
Check "create exam" $exam.Status 201
$examId = $exam.Json.data.examination.id
$center = Call "POST" "/admin/centers" @{ center_name = "SMOKE-3C centre $stamp"; city = "Vijayawada"; state = "Andhra Pradesh"; address = "Test road" } $admin
Check "create center" $center.Status 201
$centerId = $center.Json.data.center.id
Check "create 20 PCs" (Call "POST" "/admin/centers/$centerId/computers" @{ count = 20 } $admin).Status 201
$slot = Call "POST" "/admin/examinations/$examId/slots" @{ center_id = $centerId; exam_date = $slotDay; slot_start_time = "09:00"; slot_end_time = "12:30"; capacity = 2 } $admin
Check "create slot (2 seats)" $slot.Status 201
$slotId = $slot.Json.data.slot.id
$draftDetail = Call "GET" "/exam/$examId" $null $student
Check "a draft exam is hidden from students (404)" $draftDetail.Status 404
Check "open registration" (Call "PATCH" "/admin/examinations/$examId/status" @{ status = "registration_open" } $admin).Status 200

Write-Host "`n== Access control ==" -ForegroundColor Cyan
foreach ($ep in @(@("GET", "/exam"), @("GET", "/exam/$examId"), @("GET", "/exam/$examId/slots"), @("GET", "/registration/mine"), @("POST", "/registration"), @("DELETE", "/registration/1"))) {
  $body = if ($ep[0] -eq "POST") { @{ slot_id = $slotId } } else { $null }
  Check "$($ep[0]) $($ep[1]) without a token -> 401" (Call $ep[0] $ep[1] $body "").Status 401
  Check "$($ep[0]) $($ep[1]) with a garbage token -> 401" (Call $ep[0] $ep[1] $body "not.a.token").Status 401
  Check "$($ep[0]) $($ep[1]) as admin -> 403" (Call $ep[0] $ep[1] $body $admin).Status 403
}

Write-Host "`n== Exam discovery ==" -ForegroundColor Cyan
$list = Call "GET" "/exam?q=SMOKE-3C%20exam%20$stamp" $null $student
Check "list exams (search finds the smoke exam)" $list.Json.data.total 1
Check "  can_register" $list.Json.data.examinations[0].can_register $true
Check "  registration_state" $list.Json.data.examinations[0].registration_state "open"
Check "list with paging" (Call "GET" "/exam?page=1&limit=5" $null $student).Status 200
Check "bad limit -> 422" (Call "GET" "/exam?limit=1000" $null $student).Status 422
Check "bad page -> 422" (Call "GET" "/exam?page=abc" $null $student).Status 422
$detail = Call "GET" "/exam/$examId" $null $student
Check "exam details" $detail.Status 200
Check "  no registration yet" ($null -eq $detail.Json.data.examination.my_registration) $true
Check "bad exam id -> 422" (Call "GET" "/exam/abc" $null $student).Status 422
Check "unknown exam -> 404" (Call "GET" "/exam/99999999" $null $student).Status 404
$slots = Call "GET" "/exam/$examId/slots" $null $student
Check "list slots" $slots.Status 200
Check "  seats left" $slots.Json.data.slots[0].seats_left 2
Check "  center city" $slots.Json.data.slots[0].city "Vijayawada"
Check "slots filtered by center" (Call "GET" "/exam/$examId/slots?center_id=$centerId&date=$slotDay" $null $student).Json.data.slots.Count 1
Check "slots filtered by another date" (Call "GET" "/exam/$examId/slots?date=2099-01-01" $null $student).Json.data.slots.Count 0
Check "bad date -> 422" (Call "GET" "/exam/$examId/slots?date=14-12-2026" $null $student).Status 422

Write-Host "`n== Registration validation ==" -ForegroundColor Cyan
Check "empty body -> 422" (Call "POST" "/registration" @{} $student).Status 422
Check "slot_id as text -> 422" (Call "POST" "/registration" @{ slot_id = "5" } $student).Status 422
Check "client-supplied student_id -> 422" (Call "POST" "/registration" @{ slot_id = $slotId; student_id = 1 } $student).Status 422
Check "unknown slot -> 404" (Call "POST" "/registration" @{ slot_id = 99999999 } $student).Status 404

Write-Host "`n== Register, duplicate, my registrations, cancel ==" -ForegroundColor Cyan
$reg = Call "POST" "/registration" @{ slot_id = $slotId } $student
Check "register -> 201" $reg.Status 201
CheckMatch "  registration code" "$($reg.Json.data.registration.registration_id)" '^EXP\d{4}\d{6}$'
CheckMatch "  application code" "$($reg.Json.data.registration.application_id)" '^APP\d{4}\d{6}$'
Check "  status (fee 0)" $reg.Json.data.registration.status "completed"
Check "  center in the answer" $reg.Json.data.registration.center.id $centerId
$regId = $reg.Json.data.registration.id
$dup = Call "POST" "/registration" @{ slot_id = $slotId } $student
Check "register again -> 409" $dup.Status 409
Check "  code" $dup.Json.code "DUPLICATE_REGISTRATION"
Check "seats left is now 1" (Call "GET" "/exam/$examId/slots" $null $student).Json.data.slots[0].seats_left 1
Check "exam details show my registration" (Call "GET" "/exam/$examId" $null $student).Json.data.examination.my_registration.id $regId
$mine = Call "GET" "/registration/mine?limit=50" $null $student
Check "my registrations" $mine.Status 200
Check "  includes the new one" (@($mine.Json.data.registrations | Where-Object { $_.id -eq $regId }).Count) 1
Check "  can_cancel" (@($mine.Json.data.registrations | Where-Object { $_.id -eq $regId })[0].can_cancel) $true
Check "cancel with a bad id -> 422" (Call "DELETE" "/registration/abc" $null $student).Status 422
Check "cancel an unknown registration -> 404" (Call "DELETE" "/registration/99999999" $null $student).Status 404
$cancel = Call "DELETE" "/registration/$regId" $null $student
Check "cancel -> 200" $cancel.Status 200
Check "  status" $cancel.Json.data.registration.status "cancelled"
$twice = Call "DELETE" "/registration/$regId" $null $student
Check "cancel twice -> 409" $twice.Status 409
Check "  code" $twice.Json.code "ALREADY_CANCELLED"
Check "seats left is back to 2" (Call "GET" "/exam/$examId/slots" $null $student).Json.data.slots[0].seats_left 2
$again = Call "POST" "/registration" @{ slot_id = $slotId } $student
Check "register again after cancelling -> 201" $again.Status 201
Check "  a fresh registration" ($again.Json.data.registration.id -ne $regId) $true
Check "cancel it again (tidy up)" (Call "DELETE" "/registration/$($again.Json.data.registration.id)" $null $student).Status 200

Write-Host "`n== When registration is closed ==" -ForegroundColor Cyan
Check "admin closes registration" (Call "PATCH" "/admin/examinations/$examId/status" @{ status = "registration_closed" } $admin).Status 200
$closed = Call "POST" "/registration" @{ slot_id = $slotId } $student
Check "register on a closed exam -> 409" $closed.Status 409
Check "  code" $closed.Json.code "REGISTRATION_NOT_OPEN"
Check "exam still visible, but can_register is false" (Call "GET" "/exam/$examId" $null $student).Json.data.examination.can_register $false

Write-Host "`n==============================" -ForegroundColor Cyan
Write-Host ("Passed: {0}   Failed: {1}" -f $script:pass, $script:fail) -ForegroundColor $(if ($script:fail -eq 0) { "Green" } else { "Red" })
exit $script:fail
