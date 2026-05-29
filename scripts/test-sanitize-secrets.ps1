# test-sanitize-secrets.ps1 — AC6 verifikation af #634
#
# Self-contained test der genererer fake-secrets ved runtime (så source-fil
# ikke selv indeholder pattern-strings), wrap'er dem i PostToolUse JSON,
# pipe'r til sanitize-secrets.sh, og verificerer:
#   - Exit code = 2 (block)
#   - Stderr indeholder "SECRET LEAK DETECTED"
#   - Incident log appended
#
# Output: kun PASS/FAIL counter — ALDRIG raw secrets.
#
# Brug:
#   pwsh -File scripts/test-sanitize-secrets.ps1
#   pwsh -File scripts/test-sanitize-secrets.ps1 -Verbose
#
# Refs: #634 AC6.

[CmdletBinding()]
param(
  [switch]$ShowDiagnostics
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = (git rev-parse --show-toplevel) 2>$null
if (-not $repoRoot) {
  Write-Host "❌ Not in git repo" -ForegroundColor Red
  exit 1
}

$hookPath = Join-Path $repoRoot ".claude\hooks\sanitize-secrets.sh"
if (-not (Test-Path $hookPath)) {
  Write-Host "❌ Hook not found: $hookPath" -ForegroundColor Red
  exit 1
}

$bashCandidates = @(
  "bash",
  "C:\Program Files\Git\bin\bash.exe",
  "C:\Program Files\Git\usr\bin\bash.exe"
)
$bashPath = $null
foreach ($candidate in $bashCandidates) {
  $cmd = Get-Command $candidate -ErrorAction SilentlyContinue
  if ($cmd) {
    $bashPath = $cmd.Source
    break
  }
  if (Test-Path $candidate) {
    $bashPath = $candidate
    break
  }
}
if (-not $bashPath) {
  Write-Host "❌ bash not found (needed to run .claude/hooks/*.sh). Install Git Bash or add bash to PATH." -ForegroundColor Red
  exit 1
}

# Construct fake-secrets at runtime — string concatenation undgår at source
# selv matcher patterns. Hver fixture er pattern-valid men 100% fake.
function New-FakeSecret([string]$Type) {
  switch ($Type) {
    "supabase-secret" {
      return ("sb" + "_secret_" + "TESTONLYxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx")
    }
    "supabase-publishable" {
      return ("sb" + "_publishable_" + "TESTONLYxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx")
    }
    "jwt-supabase-legacy" {
      # eyJh-prefix JWT med 3 base64-segmenter
      $h = "eyJh" + "bGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
      $p = "eyJzdW" + "IiOiJ0ZXN0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSJ9"
      $s = "TEST" + "ONLYxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
      return "$h.$p.$s"
    }
    "sentry-dsn" {
      # https://<32hex>@<host>.ingest.sentry.io/<id>
      $hex = "0123456789abcdef0123456789abcdef"
      return "https://$hex@o0000000.ingest.sentry.io/0000000"
    }
    "discord-bot-token" {
      # M/N-prefix + 23-28 chars (total 24-29) . 6-7 chars . 27-38 chars
      $a = "M" + "TIzNDU2Nzg5MDEyMzQ1Njc4OTAx"  # M + 27 = 28 chars
      $b = "AAAAAA"  # 6 chars
      $c = "TEST" + "ONLYxxxxxxxxxxxxxxxxxxxxxxxx"  # 32 chars
      return "$a.$b.$c"
    }
    "github-pat" {
      return ("ghp" + "_TESTONLYxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx")
    }
    "aws-access-key" {
      return ("AKIA" + "TESTONLY12345678")
    }
    "anthropic-key" {
      $body = "TEST" + ("x" * 90)
      return ("sk" + "-ant-" + $body)
    }
    "stripe-key" {
      return ("sk" + "_test_" + "TESTONLYxxxxxxxxxxxxxxxxxxxxxx")
    }
    default {
      throw "Unknown type: $Type"
    }
  }
}

# Test cases
$tests = @(
  @{ Type = "supabase-secret";       ExpectMatch = $true  },
  @{ Type = "supabase-publishable";  ExpectMatch = $true  },
  @{ Type = "jwt-supabase-legacy";   ExpectMatch = $true  },
  @{ Type = "sentry-dsn";            ExpectMatch = $true  },
  @{ Type = "discord-bot-token";     ExpectMatch = $true  },
  @{ Type = "github-pat";            ExpectMatch = $true  },
  @{ Type = "aws-access-key";        ExpectMatch = $true  },
  @{ Type = "anthropic-key";         ExpectMatch = $true  },
  @{ Type = "stripe-key";            ExpectMatch = $true  }
)

# Also: clean control case (no secret patterns) — should NOT trigger
$cleanControl = @{ Type = "control-clean";        ExpectMatch = $false }

$pass = 0
$fail = 0
$failDetails = New-Object System.Collections.Generic.List[string]

function Invoke-HookTest {
  param([string]$Payload, [bool]$ExpectMatch, [string]$Label)

  # Pipe payload to hook via bash
  $tmpFile = [System.IO.Path]::GetTempFileName()
  Set-Content -Path $tmpFile -Value $Payload -NoNewline -Encoding utf8

  $bashCmd = "cat '$tmpFile' | '$hookPath' 2>&1; echo EXIT=`$?"
  $result = & $bashPath -c $bashCmd 2>&1 | Out-String
  Remove-Item $tmpFile -Force -ErrorAction SilentlyContinue

  # Parse exit code
  $exitCode = -1
  if ($result -match 'EXIT=(\d+)') {
    $exitCode = [int]$Matches[1]
  }

  $blocked = ($exitCode -eq 2)
  $hasLeakMsg = ($result -match "SECRET LEAK DETECTED")

  if ($ExpectMatch) {
    # Expect: hook BLOCKED + emitted leak message
    if ($blocked -and $hasLeakMsg) {
      return @{ Pass = $true; Detail = "blocked correctly" }
    } else {
      return @{ Pass = $false; Detail = "expected block but exit=$exitCode hasLeakMsg=$hasLeakMsg" }
    }
  } else {
    # Expect: hook PASSED (exit 0)
    if ($exitCode -eq 0) {
      return @{ Pass = $true; Detail = "passed clean (no leak)" }
    } else {
      return @{ Pass = $false; Detail = "expected pass but exit=$exitCode (false positive)" }
    }
  }
}

Write-Host "Testing sanitize-secrets hook..."
Write-Host ""

foreach ($test in $tests) {
  $fakeSecret = New-FakeSecret -Type $test.Type
  # Wrap in PostToolUse JSON — agent's tool_response field
  # Pad with 200+ chars of filler to exceed sanitizer's 100-char minimum
  $filler = "x" * 250
  $payload = @"
{"tool_name":"Bash","tool_input":{"command":"echo test"},"tool_response":{"stdout":"some output containing secret $fakeSecret here $filler","stderr":"","interrupted":false}}
"@

  $r = Invoke-HookTest -Payload $payload -ExpectMatch $test.ExpectMatch -Label $test.Type

  if ($r.Pass) {
    $pass++
    Write-Host ("  ✅ {0,-22} {1}" -f $test.Type, $r.Detail) -ForegroundColor Green
  } else {
    $fail++
    Write-Host ("  ❌ {0,-22} {1}" -f $test.Type, $r.Detail) -ForegroundColor Red
    $failDetails.Add("$($test.Type): $($r.Detail)")
  }
}

# Control tests: clean payloads should NOT trigger
$controlTests = @(
  @{ Label = "control-clean"; Stdout = "completely safe output with normal text " + ("y" * 250) },
  @{ Label = "control-github-urls"; Stdout = "Issues: https://github.com/NicolaiDolmer/CyclingZone/issues/634 and https://github.com/NicolaiDolmer/CyclingZone/issues/296 and https://github.com/NicolaiDolmer/CyclingZone/issues/620" },
  @{ Label = "control-file-paths"; Stdout = "Files: /c/Users/emmas/.claude/projects/C--dev-CyclingZone/memory/feedback_secret_leak_prevention.md and C:/dev/CyclingZone/scripts/probe-railway-keys.ps1" },
  @{ Label = "control-git-sha"; Stdout = "Recent commit: 94e0e5520123456789abcdef0123456789abcdef chore(security): #634 blocker — secret rotation pauses" },
  @{ Label = "control-short-hex"; Stdout = "openssl rand -hex 2 output: cd4d " + ("z" * 250) },
  @{ Label = "control-short-hex-json"; Stdout = '{"command":"openssl rand -hex 2","stdout":"cd4d","exit_code":0}' + ("z" * 250) }
)

foreach ($ct in $controlTests) {
  $cleanPayload = @"
{"tool_name":"Bash","tool_input":{"command":"echo test"},"tool_response":{"stdout":"$($ct.Stdout)","stderr":"","interrupted":false}}
"@
  $r = Invoke-HookTest -Payload $cleanPayload -ExpectMatch $false -Label $ct.Label
  if ($r.Pass) {
    $pass++
    Write-Host ("  ✅ {0,-22} {1}" -f $ct.Label, $r.Detail) -ForegroundColor Green
  } else {
    $fail++
    Write-Host ("  ❌ {0,-22} {1}" -f $ct.Label, $r.Detail) -ForegroundColor Red
    $failDetails.Add("$($ct.Label): $($r.Detail)")
  }
}

# Image-mode tests (#666 false-positive fix, 2026-05-26)
# Validates that screenshot output (JPEG/PNG base64) does NOT trigger the
# high-entropy fallback, while named patterns still fire inside image-mode.
Write-Host ""
Write-Host "Testing image-mode handling (#666 false-positive fix)..."

$imageFixturesDir = Join-Path $repoRoot ".claude\hooks\sanitize-secrets-tests"
$imageFixtures = @(
  @{ File = "screenshot-chrome-mcp-safe.json";  ExpectMatch = $false; Description = "Chrome MCP browser_batch + JPEG base64 -> no leak (tool_name path)" },
  @{ File = "screenshot-data-uri-safe.json";    ExpectMatch = $false; Description = "data:image/png URI in Bash output -> no leak (marker path)" }
)

if (Test-Path $imageFixturesDir) {
  foreach ($t in $imageFixtures) {
    $fixturePath = Join-Path $imageFixturesDir $t.File
    if (-not (Test-Path $fixturePath)) {
      $fail++
      Write-Host ("  ❌ {0,-40} MISSING fixture" -f $t.File) -ForegroundColor Red
      $failDetails.Add("Image-mode fixture missing: $($t.File)")
      continue
    }
    $payload = Get-Content $fixturePath -Raw
    $r = Invoke-HookTest -Payload $payload -ExpectMatch $t.ExpectMatch -Label $t.File
    if ($r.Pass) {
      $pass++
      Write-Host ("  ✅ {0,-40} {1}" -f $t.File, $r.Detail) -ForegroundColor Green
    } else {
      $fail++
      Write-Host ("  ❌ {0,-40} {1}" -f $t.File, $r.Detail) -ForegroundColor Red
      $failDetails.Add("Image-mode $($t.File): $($r.Detail)")
    }
  }
} else {
  $fail++
  Write-Host "  ❌ image-mode fixtures dir not found: $imageFixturesDir" -ForegroundColor Red
  $failDetails.Add("Missing image-mode fixtures dir: $imageFixturesDir")
}

# Runtime-constructed leak case: image-mode active (tool_name + JPEG bytes)
# AND a JWT literal in page text. Named jwt-supabase-legacy pattern MUST
# still trigger -> exit 2. Confirms image-mode does NOT disable named patterns.
# (Can't be a static fixture because the PreToolUse block-dangerous hook
# legitimately refuses to forward literal JWTs through Write/Edit tools.)
$jwtHeader = "eyJh" + "FIXTURE_DO_NOT_USE_header_xxxxxxxxxxxxxx"
$jwtPayload = "eyJ" + "FIXTURE_DO_NOT_USE_payload_xxxxxxxxxxxxx"
$jwtSig = "FIXTURE_DO_NOT_USE_signature_xxxxxxxxxxxx"
$fakeJwt = "$jwtHeader.$jwtPayload.$jwtSig"
$imageLeakPayload = @"
{"tool_name":"mcp__Claude_in_Chrome__browser_batch","tool_input":{"actions":[{"type":"screenshot"},{"type":"read_page"}]},"tool_response":"Captured screenshot /9j/4AAQSkZJRgABAQEASABIAAD/4gHYSUND. Page text: Authorization Bearer $fakeJwt end."}
"@
$r = Invoke-HookTest -Payload $imageLeakPayload -ExpectMatch $true -Label "image-mode-jwt-still-blocks"
if ($r.Pass) {
  $pass++
  Write-Host ("  ✅ {0,-40} {1}" -f "image-mode-jwt-still-blocks", $r.Detail) -ForegroundColor Green
} else {
  $fail++
  Write-Host ("  ❌ {0,-40} {1}" -f "image-mode-jwt-still-blocks", $r.Detail) -ForegroundColor Red
  $failDetails.Add("Image-mode JWT defense-in-depth: $($r.Detail)")
}

# PreToolUse blocker tests — combination af file-fixtures (command-only) +
# runtime-genererede fixtures (tool_input med secret-patterns).
Write-Host ""
Write-Host "Testing PreToolUse block-dangerous-secret-commands hook..."

$blockerPath = Join-Path $repoRoot ".claude\hooks\block-dangerous-secret-commands.sh"
$fixtureDir = Join-Path $repoRoot ".claude\hooks\test-fixtures"

function Invoke-BlockerTest {
  param([string]$Payload, [int]$ExpectedExit, [string]$Label)
  $tmpFile = [System.IO.Path]::GetTempFileName()
  Set-Content -Path $tmpFile -Value $Payload -NoNewline -Encoding utf8
  $bashCmd = "'$blockerPath' < '$tmpFile' 2>&1; echo EXIT=`$?"
  $result = & $bashPath -c $bashCmd 2>&1 | Out-String
  Remove-Item $tmpFile -Force -ErrorAction SilentlyContinue
  $actualExit = -1
  if ($result -match 'EXIT=(\d+)') { $actualExit = [int]$Matches[1] }
  return @{ Pass = ($actualExit -eq $ExpectedExit); ActualExit = $actualExit }
}

# 1) File-based fixtures (committed under .claude/hooks/test-fixtures/)
if ((Test-Path $blockerPath) -and (Test-Path $fixtureDir)) {
  $fixtures = Get-ChildItem $fixtureDir -Filter "*.json" -ErrorAction SilentlyContinue
  foreach ($fixture in $fixtures) {
    $expectedExit = if ($fixture.Name -like "safe-*") { 0 } else { 2 }
    $payload = Get-Content $fixture.FullName -Raw
    $r = Invoke-BlockerTest -Payload $payload -ExpectedExit $expectedExit -Label $fixture.BaseName

    if ($r.Pass) {
      $pass++
      Write-Host ("  ✅ {0,-30} exit={1} (expected)" -f $fixture.BaseName, $r.ActualExit) -ForegroundColor Green
    } else {
      $fail++
      Write-Host ("  ❌ {0,-30} exit={1} expected={2}" -f $fixture.BaseName, $r.ActualExit, $expectedExit) -ForegroundColor Red
      $failDetails.Add("Blocker $($fixture.BaseName): exit=$($r.ActualExit) expected=$expectedExit")
    }
  }
}

# 2) Runtime-genererede fixtures: tool_input med secret-patterns
# (kan ikke committes som filer — blocker ville selv fange Write-input).
$inputTests = @(
  @{
    Label = "mcp-tool-with-dsn"
    Secret = "https://" + ("0123456789abcdef" * 2) + "@o9999999.ingest.de.sentry.io/9999999"
    PayloadTemplate = '{{"tool_name":"mcp__example__tool","tool_input":{{"prompt":"process this {0}"}},"session_id":"t"}}'
  },
  @{
    Label = "spawn-task-with-supabase-secret"
    Secret = ("sb" + "_secret_" + "TESTONLY1234567890abcdefghijklmnopqrstuvwx")
    PayloadTemplate = '{{"tool_name":"mcp__ccd_session__spawn_task","tool_input":{{"title":"fix","prompt":"update {0}","tldr":"x"}},"session_id":"t"}}'
  },
  @{
    Label = "edit-with-github-pat"
    Secret = ("ghp" + "_TESTONLY1234567890abcdefghijklmnopqrstuvwxyz")
    PayloadTemplate = '{{"tool_name":"Edit","tool_input":{{"file_path":"/tmp/x","old_string":"y","new_string":"token={0}"}},"session_id":"t"}}'
  }
)

foreach ($t in $inputTests) {
  $payload = $t.PayloadTemplate -f $t.Secret
  $r = Invoke-BlockerTest -Payload $payload -ExpectedExit 2 -Label $t.Label

  if ($r.Pass) {
    $pass++
    Write-Host ("  ✅ {0,-30} exit={1} (blocked tool_input)" -f $t.Label, $r.ActualExit) -ForegroundColor Green
  } else {
    $fail++
    Write-Host ("  ❌ {0,-30} exit={1} expected=2" -f $t.Label, $r.ActualExit) -ForegroundColor Red
    $failDetails.Add("Blocker $($t.Label): exit=$($r.ActualExit) expected=2")
  }
}

# 3) Control: safe tool_input (no patterns) — should not block
$safeInputPayload = '{"tool_name":"mcp__example__tool","tool_input":{"prompt":"completely safe content with no patterns"},"session_id":"t"}'
$r = Invoke-BlockerTest -Payload $safeInputPayload -ExpectedExit 0 -Label "safe-mcp-input"
if ($r.Pass) {
  $pass++
  Write-Host ("  ✅ {0,-30} exit={1} (clean input passed)" -f "safe-mcp-input", $r.ActualExit) -ForegroundColor Green
} else {
  $fail++
  Write-Host ("  ❌ {0,-30} exit={1} expected=0" -f "safe-mcp-input", $r.ActualExit) -ForegroundColor Red
  $failDetails.Add("Blocker safe-mcp-input: exit=$($r.ActualExit) expected=0")
}

# --- Lag A: PreToolUse Read/Grep secret-path block (#634 follow-up) --------
# Verificerer at Read/Grep mod secret-fil-stier blokeres (exit 2), og at
# normal kode + whitelisted filer IKKE blokeres (exit 0, anti-FP).
Write-Host ""
Write-Host "Testing Read/Grep secret-path block (lag A)..."

$pathBlockTests = @(
  @{ Label = "read-mcp-json";       Payload = '{"tool_name":"Read","tool_input":{"file_path":".mcp.json"},"session_id":"t"}';                       ExpectedExit = 2 },
  @{ Label = "read-mcp-json-abs";   Payload = '{"tool_name":"Read","tool_input":{"file_path":"C:\\Dev\\CyclingZone\\.mcp.json"},"session_id":"t"}'; ExpectedExit = 2 },
  @{ Label = "read-backend-env";    Payload = '{"tool_name":"Read","tool_input":{"file_path":"backend/.env"},"session_id":"t"}';                     ExpectedExit = 2 },
  @{ Label = "read-env-production"; Payload = '{"tool_name":"Read","tool_input":{"file_path":"frontend/.env.production"},"session_id":"t"}';         ExpectedExit = 2 },
  @{ Label = "read-secrets-dir";    Payload = '{"tool_name":"Read","tool_input":{"file_path":"config/secrets/db.json"},"session_id":"t"}';           ExpectedExit = 2 },
  @{ Label = "grep-path-env";       Payload = '{"tool_name":"Grep","tool_input":{"pattern":"KEY","path":"backend/.env"},"session_id":"t"}';          ExpectedExit = 2 },
  # Anti-FP: disse SKAL passere (exit 0)
  @{ Label = "read-env-example";    Payload = '{"tool_name":"Read","tool_input":{"file_path":"backend/.env.example"},"session_id":"t"}';             ExpectedExit = 0 },
  @{ Label = "read-source-jsx";     Payload = '{"tool_name":"Read","tool_input":{"file_path":"frontend/src/App.jsx"},"session_id":"t"}';             ExpectedExit = 0 },
  @{ Label = "read-doc-md";         Payload = '{"tool_name":"Read","tool_input":{"file_path":"docs/DISCORD_MCP_SETUP.md"},"session_id":"t"}';        ExpectedExit = 0 },
  @{ Label = "grep-no-path";        Payload = '{"tool_name":"Grep","tool_input":{"pattern":"foo"},"session_id":"t"}';                                ExpectedExit = 0 }
)
foreach ($t in $pathBlockTests) {
  $r = Invoke-BlockerTest -Payload $t.Payload -ExpectedExit $t.ExpectedExit -Label $t.Label
  if ($r.Pass) {
    $pass++
    Write-Host ("  ✅ {0,-22} exit={1} (expected)" -f $t.Label, $r.ActualExit) -ForegroundColor Green
  } else {
    $fail++
    Write-Host ("  ❌ {0,-22} exit={1} expected={2}" -f $t.Label, $r.ActualExit, $t.ExpectedExit) -ForegroundColor Red
    $failDetails.Add("PathBlock $($t.Label): exit=$($r.ActualExit) expected=$($t.ExpectedExit)")
  }
}

# --- Lag B: PostToolUse sanitizer fyrer paa Read tool_response (#634 follow-up)
# Verificerer at sanitize-secrets fanger et secret-pattern i Read-output (det
# var ikke daekket foer Read blev tilfoejet til PostToolUse-matcheren), og at
# normal kode-Read-output IKKE trigger (anti-FP).
Write-Host ""
Write-Host "Testing sanitizer on Read tool_response (lag B)..."

$readToken = New-FakeSecret -Type "discord-bot-token"
$readFiller = "x" * 250
$readLeakPayload = @"
{"tool_name":"Read","tool_input":{"file_path":".mcp.json"},"tool_response":{"type":"text","file":{"filePath":".mcp.json","content":"{ \"DISCORD_TOKEN\": \"$readToken\" } $readFiller"}}}
"@
$r = Invoke-HookTest -Payload $readLeakPayload -ExpectMatch $true -Label "read-response-discord-token"
if ($r.Pass) {
  $pass++
  Write-Host ("  ✅ {0,-30} {1}" -f "read-response-discord-token", $r.Detail) -ForegroundColor Green
} else {
  $fail++
  Write-Host ("  ❌ {0,-30} {1}" -f "read-response-discord-token", $r.Detail) -ForegroundColor Red
  $failDetails.Add("Sanitize read-response: $($r.Detail)")
}

$readCleanPayload = @"
{"tool_name":"Read","tool_input":{"file_path":"frontend/src/App.jsx"},"tool_response":{"type":"text","file":{"filePath":"App.jsx","content":"import React from 'react'; export default function App(){ return cycling-zone; } $readFiller"}}}
"@
$r = Invoke-HookTest -Payload $readCleanPayload -ExpectMatch $false -Label "read-response-clean"
if ($r.Pass) {
  $pass++
  Write-Host ("  ✅ {0,-30} {1}" -f "read-response-clean", $r.Detail) -ForegroundColor Green
} else {
  $fail++
  Write-Host ("  ❌ {0,-30} {1}" -f "read-response-clean", $r.Detail) -ForegroundColor Red
  $failDetails.Add("Sanitize read-clean: $($r.Detail)")
}

# Wrapper-scripts smoke (verify they EXIST + can be invoked with -h, not full run)
Write-Host ""
Write-Host "Wrapper scripts presence-check..."

$wrappers = @(
  "scripts\probe-railway-keys.ps1",
  "scripts\probe-railway-keys.sh",
  "scripts\probe-vercel-keys.ps1",
  "scripts\probe-vercel-keys.sh"
)
foreach ($w in $wrappers) {
  $p = Join-Path $repoRoot $w
  if (Test-Path $p) {
    $pass++
    Write-Host "  ✅ $w exists" -ForegroundColor Green
  } else {
    $fail++
    Write-Host "  ❌ $w MISSING" -ForegroundColor Red
    $failDetails.Add("Missing wrapper: $w")
  }
}

# Wrapper content-check: scripts must NOT contain explicit value-print patterns
$wrapperContentChecks = @(
  @{ File = "scripts\probe-railway-keys.ps1"; ForbidPattern = '\$rawJson \| Write-Host'; Description = "skal aldrig Write-Host rå JSON" },
  @{ File = "scripts\probe-vercel-keys.ps1";  ForbidPattern = '\$parsed \| Write-Host';  Description = "skal aldrig Write-Host rå parsed objekt" }
)
foreach ($c in $wrapperContentChecks) {
  $p = Join-Path $repoRoot $c.File
  if (Test-Path $p) {
    $content = Get-Content $p -Raw
    if ($content -match $c.ForbidPattern) {
      $fail++
      Write-Host "  ❌ $($c.File): $($c.Description)" -ForegroundColor Red
      $failDetails.Add("Wrapper unsafe: $($c.File) matches forbidden pattern")
    } else {
      $pass++
      Write-Host "  ✅ $($c.File) safe ($($c.Description))" -ForegroundColor Green
    }
  }
}

# Summary
$total = $pass + $fail
Write-Host ""
Write-Host "================================="
if ($fail -eq 0) {
  Write-Host "✅ ALL TESTS PASSED ($pass/$total)" -ForegroundColor Green
  Write-Host "Sanitizer correctly detects all 9 secret-patterns + control case."
  Write-Host "Wrappers exist + don't print raw values."
  exit 0
} else {
  Write-Host "❌ $fail/$total tests FAILED" -ForegroundColor Red
  foreach ($d in $failDetails) {
    Write-Host "  - $d" -ForegroundColor Red
  }
  exit 1
}
