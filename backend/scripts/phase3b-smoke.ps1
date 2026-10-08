<#
  ExamPro Phase 3B — API smoke test (works in Windows PowerShell 5.1 and PowerShell 7).

  Start the backend first (npm run dev), then, from the backend folder:
      powershell -ExecutionPolicy Bypass -File .\scripts\phase3b-smoke.ps1 -AdminEmail you@example.com

  It asks for the admin password (typed hidden), then runs ~45 checks against YOUR running server and
  your real database. It creates clearly named "SMOKE" examinations / centers (stamped with the current
  time) and leaves them in place — delete them later from the admin pages, or ignore them.
  Slots are created ~60 days ahead. The script never deletes anything except the objects it created itself.
#>
param(
  [string]$Base = "http://localhost:5000/api",
  [Parameter(Mandatory = $true)][string]$AdminEmail
)

$ErrorActionPreference = "Stop"
$secure = Read-Host "Admin password" -AsSecureString
$password = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))

$script:pass = 0; $script:fail = 0
$script:token = $null

function Call([string]$Method, [string]$Path, $Body = $null, [string]$Token = $script:token) {
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

$inv = [Globalization.CultureInfo]::InvariantCulture   # always write dates the way the API expects, whatever the PC's regional settings
$stamp = (Get-Date).ToString("yyyyMMdd-HHmmss", $inv)
$slotDay = (Get-Date).AddDays(60).ToString("yyyy-MM-dd", $inv)
$pastDay = (Get-Date).AddDays(-2).ToString("yyyy-MM-dd", $inv)
$earlyDay = (Get-Date).AddDays(10).ToString("yyyy-MM-dd", $inv)   # before registration closes (+30 days)
$regStart = (Get-Date).AddDays(-1).ToString("yyyy-MM-dd", $inv) + " 09:00:00"
$regEnd = (Get-Date).AddDays(30).ToString("yyyy-MM-dd", $inv) + " 23:59:59"

Write-Host "`n== Login ==" -ForegroundColor Cyan
$login = Call "POST" "/auth/login" @{ email = $AdminEmail; password = $password } $null
Check "admin login" $login.Status 200
if ($login.Status -ne 200) { Write-Host "Cannot continue without an admin login." -ForegroundColor Red; exit 1 }
$script:token = $login.Json.data.accessToken

Write-Host "`n== Access control ==" -ForegroundColor Cyan
Check "no token -> 401" (Call "GET" "/admin/examinations" $null $null).Status 401
Check "garbage token -> 401" (Call "GET" "/admin/examinations" $null "not.a.token").Status 401

Write-Host "`n== Examinations ==" -ForegroundColor Cyan
$exam = Call "POST" "/admin/examinations" @{ exam_name = "SMOKE exam $stamp"; registration_start_date = $regStart; registration_end_date = $regEnd; exam_duration_minutes = 180; fee = 500 }
Check "create exam" $exam.Status 201
$examId = $exam.Json.data.examination.id
Check "new exam is draft" $exam.Json.data.examination.status "draft"
Check "fee has two decimals" $exam.Json.data.examination.fee "500.00"
Check "missing name -> 422" (Call "POST" "/admin/examinations" @{ registration_start_date = $regStart; registration_end_date = $regEnd; exam_duration_minutes = 180 }).Status 422
Check "unknown field -> 422" (Call "POST" "/admin/examinations" @{ exam_name = "x y z"; registration_start_date = $regStart; registration_end_date = $regEnd; exam_duration_minutes = 180; status = "registration_open" }).Status 422
Check "window reversed -> 422" (Call "POST" "/admin/examinations" @{ exam_name = "Reversed"; registration_start_date = $regEnd; registration_end_date = $regStart; exam_duration_minutes = 60 }).Status 422
Check "list exams" (Call "GET" "/admin/examinations?limit=5").Status 200
Check "get exam" (Call "GET" "/admin/examinations/$examId").Status 200
Check "get unknown exam -> 404" (Call "GET" "/admin/examinations/99999999").Status 404
Check "edit exam" (Call "PATCH" "/admin/examinations/$examId" @{ description = "Created by the smoke test" }).Status 200
Check "empty edit -> 422" (Call "PATCH" "/admin/examinations/$examId" @{}).Status 422
$noSlots = Call "PATCH" "/admin/examinations/$examId/status" @{ status = "registration_open" }
Check "open without slots -> 409" $noSlots.Status 409
Check "  code NO_SLOTS" $noSlots.Json.code "NO_SLOTS"
$jump = Call "PATCH" "/admin/examinations/$examId/status" @{ status = "completed" }
Check "draft -> completed is refused" $jump.Json.code "INVALID_TRANSITION"

Write-Host "`n== Centers and computers ==" -ForegroundColor Cyan
$center = Call "POST" "/admin/centers" @{ center_name = "SMOKE centre $stamp"; city = "Vijayawada"; state = "Andhra Pradesh"; address = "Test road" }
Check "create center" $center.Status 201
$centerId = $center.Json.data.center.id
Check "new center has no PCs" $center.Json.data.center.total_computers 0
$pcs = Call "POST" "/admin/centers/$centerId/computers" @{ count = 60 }
Check "create 60 PCs" $pcs.Status 201
Check "  first label" $pcs.Json.data.first_label "PC-001"
Check "  last label" $pcs.Json.data.last_label "PC-060"
Check "  working PCs" $pcs.Json.data.center.working_computers 60
$clash = Call "POST" "/admin/centers/$centerId/computers" @{ count = 5; start_number = 58 }
Check "label clash -> 409" $clash.Status 409
Check "  nothing was created" (Call "GET" "/admin/centers/$centerId").Json.data.center.total_computers 60
Check "bad prefix -> 422" (Call "POST" "/admin/centers/$centerId/computers" @{ count = 1; prefix = "A B" }).Status 422
Check "list PCs" (Call "GET" "/admin/centers/$centerId/computers?limit=5").Status 200
Check "list centers" (Call "GET" "/admin/centers?city=Vijayawada").Status 200
Check "edit center" (Call "PATCH" "/admin/centers/$centerId" @{ address = "Updated road" }).Status 200

Write-Host "`n== Slots ==" -ForegroundColor Cyan
$slot = Call "POST" "/admin/examinations/$examId/slots" @{ center_id = $centerId; exam_date = $slotDay; slot_start_time = "09:00"; slot_end_time = "12:30"; capacity = 40 }
Check "create slot (40 of 60 PCs)" $slot.Status 201
$slotId = $slot.Json.data.slot.id
Check "  seats left" $slot.Json.data.slot.seats_left 40
$over = Call "POST" "/admin/examinations/$examId/slots" @{ center_id = $centerId; exam_date = $slotDay; slot_start_time = "11:00"; slot_end_time = "14:30"; capacity = 30 }
Check "overlapping slot that does not fit -> 409" $over.Status 409
Check "  code CAPACITY_EXCEEDED" $over.Json.code "CAPACITY_EXCEEDED"
Check "  seats still available" $over.Json.details.available 20
Check "overlapping slot that fits" (Call "POST" "/admin/examinations/$examId/slots" @{ center_id = $centerId; exam_date = $slotDay; slot_start_time = "11:00"; slot_end_time = "14:30"; capacity = 20 }).Status 201
Check "back-to-back slot of 60" (Call "POST" "/admin/examinations/$examId/slots" @{ center_id = $centerId; exam_date = $slotDay; slot_start_time = "14:30"; slot_end_time = "18:00"; capacity = 60 }).Status 201
Check "duplicate slot -> 409" (Call "POST" "/admin/examinations/$examId/slots" @{ center_id = $centerId; exam_date = $slotDay; slot_start_time = "09:00"; slot_end_time = "13:00"; capacity = 1 }).Json.code "SLOT_EXISTS"
Check "more seats than PCs -> 409" (Call "POST" "/admin/examinations/$examId/slots" @{ center_id = $centerId; exam_date = $slotDay; slot_start_time = "19:00"; slot_end_time = "22:30"; capacity = 61 }).Status 409
Check "too short for the exam -> 422" (Call "POST" "/admin/examinations/$examId/slots" @{ center_id = $centerId; exam_date = $slotDay; slot_start_time = "19:00"; slot_end_time = "20:00"; capacity = 5 }).Json.code "SLOT_TOO_SHORT"
Check "slot in the past -> 422" (Call "POST" "/admin/examinations/$examId/slots" @{ center_id = $centerId; exam_date = $pastDay; slot_start_time = "09:00"; slot_end_time = "12:30"; capacity = 5 }).Json.code "SLOT_IN_PAST"
Check "list slots" (Call "GET" "/admin/examinations/$examId/slots").Json.data.slots.Count 3
Check "change capacity" (Call "PATCH" "/admin/slots/$slotId" @{ capacity = 30 }).Json.data.slot.capacity 30
Check "capacity above PCs -> 409" (Call "PATCH" "/admin/slots/$slotId" @{ capacity = 61 }).Status 409

Write-Host "`n== Publish ==" -ForegroundColor Cyan
Check "open registration" (Call "PATCH" "/admin/examinations/$examId/status" @{ status = "registration_open" }).Json.data.examination.status "registration_open"
Check "close registration" (Call "PATCH" "/admin/examinations/$examId/status" @{ status = "registration_closed" }).Json.data.examination.status "registration_closed"
Check "reopen registration" (Call "PATCH" "/admin/examinations/$examId/status" @{ status = "registration_open" }).Json.data.examination.status "registration_open"
Check "slot before registration closes, exam open -> 201" (Call "POST" "/admin/examinations/$examId/slots" @{ center_id = $centerId; exam_date = $earlyDay; slot_start_time = "09:00"; slot_end_time = "12:30"; capacity = 5 }).Status 201

Write-Host "`n== Deleting ==" -ForegroundColor Cyan
Check "delete a slot" (Call "DELETE" "/admin/slots/$slotId").Status 200
Check "center with slots cannot be deleted -> 409" (Call "DELETE" "/admin/centers/$centerId").Json.code "CENTER_IN_USE"
$spare = Call "POST" "/admin/centers" @{ center_name = "SMOKE spare $stamp"; city = "Guntur"; state = "Andhra Pradesh" }
Check "delete an unused center" (Call "DELETE" "/admin/centers/$($spare.Json.data.center.id)").Status 200

Write-Host "`n== Simultaneous requests ==" -ForegroundColor Cyan
$race = Call "POST" "/admin/centers" @{ center_name = "SMOKE race $stamp"; city = "Guntur"; state = "Andhra Pradesh" }
$raceId = $race.Json.data.center.id
[void](Call "POST" "/admin/centers/$raceId/computers" @{ count = 60 })
$raceExam = Call "POST" "/admin/examinations" @{ exam_name = "SMOKE race exam $stamp"; registration_start_date = $regStart; registration_end_date = $regEnd; exam_duration_minutes = 120 }
$raceExamId = $raceExam.Json.data.examination.id
$jobs = foreach ($start in @("08:00", "08:10", "08:20", "08:30", "08:40", "08:50")) {
  Start-Job -ArgumentList $Base, $script:token, $raceExamId, $raceId, $slotDay, $start -ScriptBlock {
    param($b, $t, $e, $c, $d, $s)
    $body = @{ center_id = $c; exam_date = $d; slot_start_time = $s; slot_end_time = (([datetime]"2000-01-01 $s").AddHours(4).ToString("HH:mm", [Globalization.CultureInfo]::InvariantCulture)); capacity = 20 } | ConvertTo-Json
    try { (Invoke-WebRequest -Uri "$b/admin/examinations/$e/slots" -Method Post -ContentType "application/json" -Body $body -Headers @{ Authorization = "Bearer $t" } -UseBasicParsing).StatusCode }
    catch { [int]$_.Exception.Response.StatusCode }
  }
}
$codes = $jobs | Wait-Job | Receive-Job
$jobs | Remove-Job
Check "6 overlapping slots of 20 on 60 PCs: exactly 3 accepted" (@($codes | Where-Object { $_ -eq 201 }).Count) 3
Check "  the other 3 refused with 409" (@($codes | Where-Object { $_ -eq 409 }).Count) 3

Write-Host "`n==============================" -ForegroundColor Cyan
Write-Host ("Passed: {0}   Failed: {1}" -f $script:pass, $script:fail) -ForegroundColor $(if ($script:fail -eq 0) { "Green" } else { "Red" })
exit $script:fail
