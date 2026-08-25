# preflight-pr.ps1 — kør CI's billige vagter LOKALT før push/PR.
#
# Baggrund (3/8 nat-batch): 4 PRs fejlede i CI på vagter der kunne være fanget
# lokalt på under et minut (tone-em-dash i player-copy, swallowed-catch-guard,
# dropped-supabase-error-guard). Hver miss koster en fuld CI-runde (~15-20 min)
# + en ekstra worker-runde. Dette script spejler de vagter i én kommando.
#
# Brug (fra repo-/worktree-rod):
#   pwsh -File scripts/preflight-pr.ps1
#
# Dækker IKKE: backend-/frontend-tests og playwright (kør dem separat, de er
# tunge), CodeRabbit, samt check-verification (PR-body-regel: mindst én "- [x]"
# i Brugerverifikation-sektionen ELLER label docs-only/backend-only).
# Husk også: ingen em-dash i PR-bodies og issue-kommentarer (samme tone-regel).

$ErrorActionPreference = "Stop"
$root = (& git rev-parse --show-toplevel).Trim()
Push-Location $root
$failed = @()
try {
  Write-Host "== check:i18n (keys/ICU/duplicates + tone-em-dash i player-copy) ==" -ForegroundColor Cyan
  npm run check:i18n
  if ($LASTEXITCODE -ne 0) { $failed += "check:i18n" }

  Write-Host "== swallowed-catch-guard ==" -ForegroundColor Cyan
  node scripts/lint-swallowed-catches.mjs
  if ($LASTEXITCODE -ne 0) { $failed += "swallowed-catch-guard" }

  Write-Host "== dropped-supabase-error-guard ==" -ForegroundColor Cyan
  node scripts/lint-dropped-supabase-error.mjs
  if ($LASTEXITCODE -ne 0) { $failed += "dropped-supabase-error-guard" }

  # CI's job "dropped-supabase-error-guard" kører TO scripts; preflight kørte kun det første,
  # så preflight kunne melde grønt mens netop det jobnavn fejlede i CI (bidt på PR #3599).
  # Søsterguarden (#2974) rammer fire-and-forget-mutationer uden `data`-binding, som den
  # første guard per design er blind for.
  Write-Host "== unchecked-supabase-mutation-guard (#2974, samme CI-job) ==" -ForegroundColor Cyan
  node scripts/lint-unchecked-supabase-mutation.mjs
  if ($LASTEXITCODE -ne 0) { $failed += "unchecked-supabase-mutation-guard" }

  # fetch() rejecter ved netvaerksudfald: et bart `await fetch` efter setLoading(true)
  # springer oprydningen over og laaser knappen i "Gemmer...". Ratchet pr. fil (#3628).
  Write-Host "== unguarded-fetch-guard (await fetch uden try/catch i frontend, #3628) ==" -ForegroundColor Cyan
  node scripts/lint-unguarded-fetch-in-handler.mjs
  if ($LASTEXITCODE -ne 0) { $failed += "unguarded-fetch-guard" }

  Write-Host "== pagination-guard (PostgREST 1000-row cap, #3331) ==" -ForegroundColor Cyan
  node scripts/lint-pagination-guard.mjs
  if ($LASTEXITCODE -ne 0) { $failed += "pagination-guard" }

  Write-Host "== fetchallrows-order-guard (fetchAllRows(...) missing .order(), #3391) ==" -ForegroundColor Cyan
  node scripts/check-fetchallrows-order.mjs
  if ($LASTEXITCODE -ne 0) { $failed += "fetchallrows-order-guard" }

  Write-Host "== schema-column-guard (select mod ukendt kolonne, #3586) ==" -ForegroundColor Cyan
  node scripts/lint-schema-columns.mjs
  if ($LASTEXITCODE -ne 0) { $failed += "schema-column-guard" }

  Write-Host "== constraint-form-guard (drop/recreate der taber DEFERRABLE, #4163) ==" -ForegroundColor Cyan
  node scripts/lint-constraint-form.mjs
  if ($LASTEXITCODE -ne 0) { $failed += "constraint-form-guard" }

  Write-Host "== t2-container-guard (DataTable in a T1 max-w-4xl container, #3454) ==" -ForegroundColor Cyan
  node scripts/lint-t2-container-guard.mjs
  if ($LASTEXITCODE -ne 0) { $failed += "t2-container-guard" }

  Write-Host "== frontend eslint ==" -ForegroundColor Cyan
  Push-Location (Join-Path $root "frontend")
  npm run lint
  if ($LASTEXITCODE -ne 0) { $failed += "frontend-lint" }
  Pop-Location
}
finally {
  Pop-Location
}

if ($failed.Count -gt 0) {
  Write-Host ("PREFLIGHT RØD: {0}" -f ($failed -join ", ")) -ForegroundColor Red
  exit 1
}

# Stamp: markér at preflight kørte grønt på DENNE arbejdstræ-tilstand.
# check-preflight-before-push.sh sammenligner stamp'ens mtime mod de ændrede
# filers mtime ved `git push` og advarer hvis preflight er forældet.
# Ligger under .git/ (ikke i repoet) og er worktree-specifik via --git-path.
try {
  $stamp = (& git rev-parse --git-path preflight-ok).Trim()
  if ($stamp) {
    Set-Content -Path $stamp -Value "preflight groen $(Get-Date -Format o)" -Encoding utf8
  }
} catch {
  # Stamp er en bekvemmelighed, ikke en gate. Fejler den, så fejler preflight ikke.
}

Write-Host "PREFLIGHT GRØN — klar til push (husk tests + PR-body-reglerne i headeren)." -ForegroundColor Green
exit 0