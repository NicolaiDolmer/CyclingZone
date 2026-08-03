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
Write-Host "PREFLIGHT GRØN — klar til push (husk tests + PR-body-reglerne i headeren)." -ForegroundColor Green
exit 0