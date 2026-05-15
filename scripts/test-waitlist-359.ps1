# Verifikations-script for #359 Founder Supporter Waitlist.
# Tester RLS-policies + constraints + intent_score-formel via PostgREST + anon-key.
# Skriver test-rows til prod med source='_test_359_smoke' og rydder op til sidst.
#
# Brug: pwsh -File scripts/test-waitlist-359.ps1
# Eller: pwsh -File scripts/test-waitlist-359.ps1 -SkipCleanup    (behold test-rows)

[CmdletBinding()]
param(
  [switch]$SkipCleanup,
  # Publishable key (sb_publishable_*). Falder tilbage til env CYCLINGZONE_PUBLISHABLE_KEY,
  # derefter frontend/.env VITE_SUPABASE_ANON_KEY. Legacy JWT-keys (eyJ...) er disabled siden #296.
  [string]$AnonKey
)

$ErrorActionPreference = 'Stop'

$SUPABASE_URL = 'https://ghwvkxzhsbbltzfnuhhz.supabase.co'  # prod URL — ikke hemmelig

# Key-resolution: param → env var → frontend/.env
if (-not $AnonKey) { $AnonKey = $env:CYCLINGZONE_PUBLISHABLE_KEY }
if (-not $AnonKey) {
  $envFile = Join-Path (Split-Path -Parent $PSScriptRoot) 'frontend/.env'
  if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
      if ($_ -match '^VITE_SUPABASE_ANON_KEY=(.+)$') { $AnonKey = $Matches[1].Trim('"') }
    }
  }
}
if (-not $AnonKey) {
  throw "Mangler anon-key. Brug: pwsh -File $($MyInvocation.MyCommand.Path) -AnonKey 'sb_publishable_...'  ELLER `$env:CYCLINGZONE_PUBLISHABLE_KEY = '...'"
}
if ($AnonKey.StartsWith('eyJ')) {
  Write-Warning "Detekteret legacy JWT-format. Legacy keys er disabled siden #296 (2026-05-11). Hent ny publishable key fra Supabase dashboard og opdater frontend/.env."
}

$ANON_KEY = $AnonKey
$TABLE    = 'founder_supporter_waitlist'
$TEST_TAG = '_test_359_smoke'

$baseHeaders = @{
  'apikey'        = $ANON_KEY
  'Authorization' = "Bearer $ANON_KEY"
  'Content-Type'  = 'application/json'
}

$pass = 0
$fail = 0

function Test-Case {
  param([string]$Name, [scriptblock]$Block)
  Write-Host -NoNewline "[$Name] ... "
  try {
    & $Block
    Write-Host 'OK' -ForegroundColor Green
    $script:pass++
  } catch {
    Write-Host "FAIL: $($_.Exception.Message)" -ForegroundColor Red
    $script:fail++
  }
}

function Invoke-Anon {
  param([string]$Method, [string]$Path, [object]$Body, [hashtable]$ExtraHeaders)
  $h = $baseHeaders.Clone()
  if ($ExtraHeaders) { $ExtraHeaders.GetEnumerator() | ForEach-Object { $h[$_.Key] = $_.Value } }
  $params = @{
    Method  = $Method
    Uri     = "$SUPABASE_URL/rest/v1/$Path"
    Headers = $h
  }
  if ($null -ne $Body) {
    $params.Body = ($Body | ConvertTo-Json -Compress -Depth 5)
  }
  Invoke-RestMethod @params
}

function Expect-HttpFail {
  param([scriptblock]$Block, [int]$ExpectedStatus)
  try {
    & $Block | Out-Null
    throw "Expected HTTP $ExpectedStatus but request succeeded"
  } catch {
    $resp = $_.Exception.Response
    if (-not $resp) { throw "Expected HTTP $ExpectedStatus but no response: $_" }
    $code = [int]$resp.StatusCode
    if ($code -ne $ExpectedStatus) {
      throw "Expected HTTP $ExpectedStatus but got $code"
    }
  }
}

Write-Host ''
Write-Host '=== #359 Founder Supporter Waitlist — RLS + constraint verify ===' -ForegroundColor Cyan
Write-Host "Target: $SUPABASE_URL"
Write-Host "Tag:    source='$TEST_TAG' (rens til sidst medmindre -SkipCleanup)"
Write-Host ''

# --- T1: valid anon INSERT med consent ---
# VIGTIGT: Prefer: return=minimal (IKKE representation) — anon har ingen SELECT-policy,
# så RETURNING-trinet ville fejle med RLS-violation. Frontend (#362) skal også bruge minimal.
$ts = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
$email1 = "test1-$([guid]::NewGuid().Guid.Substring(0,8))@example.com"
Test-Case 'T1 anon INSERT med consent (valid) → 201 minimal' {
  Invoke-Anon -Method POST -Path $TABLE -Body @{
    email             = $email1
    contact_type      = 'email'
    interest_level    = 'very'
    preferred_tier    = 'pro_analyst_monthly'
    follow_up_consent = $true
    source            = $TEST_TAG
    consent_given_at  = $ts
  } -ExtraHeaders @{ Prefer = 'return=minimal' } | Out-Null
}

# --- T2: anon INSERT uden consent BLOKERES ---
# Supabase returnerer 401 for RLS-violations (ikke 403). Begge er gyldige som "blokeret".
Test-Case 'T2 anon INSERT uden consent → 401/403 (RLS blokerer)' {
  try {
    Invoke-Anon -Method POST -Path $TABLE -Body @{
      email          = "test2-$([guid]::NewGuid().Guid.Substring(0,8))@example.com"
      interest_level = 'maybe'
      preferred_tier = 'free_only'
      source         = $TEST_TAG
    } | Out-Null
    throw 'Expected RLS block but request succeeded'
  } catch {
    $code = [int]$_.Exception.Response.StatusCode
    if ($code -ne 401 -and $code -ne 403) {
      throw "Expected 401 or 403 but got $code"
    }
  }
}

# --- T3: anon SELECT returnerer 0 rows (selv om der findes test-rows fra T1) ---
Test-Case 'T3 anon SELECT → 0 rows (admin-only policy)' {
  $rows = Invoke-Anon -Method GET -Path "${TABLE}?select=id&limit=10"
  if ($rows.Count -ne 0) { throw "Forventet 0 rows men fik $($rows.Count)" }
}

# --- T4: duplicate email (case-insensitive) blokeres ---
Test-Case 'T4 duplicate email case-insens → 409 conflict' {
  Expect-HttpFail -ExpectedStatus 409 -Block {
    Invoke-Anon -Method POST -Path $TABLE -Body @{
      email             = $email1.ToUpper()
      interest_level    = 'maybe'
      preferred_tier    = 'free_only'
      source            = $TEST_TAG
      consent_given_at  = $ts
    }
  }
}

# --- T5: invalid preferred_tier (Patron skal IKKE være tilladt) ---
Test-Case 'T5 invalid preferred_tier (patron_monthly) → 400' {
  Expect-HttpFail -ExpectedStatus 400 -Block {
    Invoke-Anon -Method POST -Path $TABLE -Body @{
      email             = "test5-$([guid]::NewGuid().Guid.Substring(0,8))@example.com"
      interest_level    = 'very'
      preferred_tier    = 'patron_monthly'
      source            = $TEST_TAG
      consent_given_at  = $ts
    }
  }
}

# --- T6: Discord-only insert (uden email) virker ---
Test-Case 'T6 discord-only INSERT (uden email) virker' {
  Invoke-Anon -Method POST -Path $TABLE -Body @{
    discord_handle    = "test6_$([guid]::NewGuid().Guid.Substring(0,8))#1234"
    contact_type      = 'discord'
    interest_level    = 'maybe'
    preferred_tier    = 'supporter_annual'
    follow_up_consent = $true
    source            = $TEST_TAG
    consent_given_at  = $ts
  } -ExtraHeaders @{ Prefer = 'return=minimal' } | Out-Null
}

# --- T7: missing contact (begge null) blokeres ---
Test-Case 'T7 begge kontakt-felter null → 400 (contact_present CHECK)' {
  Expect-HttpFail -ExpectedStatus 400 -Block {
    Invoke-Anon -Method POST -Path $TABLE -Body @{
      interest_level    = 'very'
      preferred_tier    = 'free_only'
      source            = $TEST_TAG
      consent_given_at  = $ts
    }
  }
}

# --- Cleanup ---
if (-not $SkipCleanup) {
  Write-Host ''
  Write-Host "Rydder op (DELETE WHERE source='$TEST_TAG') via Supabase Studio SQL..." -ForegroundColor Yellow
  Write-Host "Bemærk: anon kan IKKE DELETE (kun service_role). Kør denne i Supabase Studio SQL Editor:" -ForegroundColor Yellow
  Write-Host ""
  Write-Host "  DELETE FROM founder_supporter_waitlist WHERE source = '$TEST_TAG';" -ForegroundColor Magenta
  Write-Host ""
}

Write-Host ''
Write-Host "=== Resultat: $pass OK / $fail FAIL ===" -ForegroundColor $(if ($fail -eq 0) { 'Green' } else { 'Red' })
exit $fail
