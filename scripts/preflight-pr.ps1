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

  Write-Host "== maybesingle-unique-scope-guard (.maybeSingle() uden fuldt UNIQUE-scope, #4496) ==" -ForegroundColor Cyan
  node scripts/check-maybesingle-unique-scope.mjs
  if ($LASTEXITCODE -ne 0) { $failed += "maybesingle-unique-scope-guard" }

  Write-Host "== schema-column-guard (select mod ukendt kolonne, #3586) ==" -ForegroundColor Cyan
  node scripts/lint-schema-columns.mjs
  if ($LASTEXITCODE -ne 0) { $failed += "schema-column-guard" }

  # WARN, ikke FAIL — refresh kraever infisical+prod-adgang, som preflight ikke
  # har, og som ikke skal blokere en usaerlig PR (#4142).
  Write-Host "== schema-snapshot-staleness (migrationer nyere end snapshot, #4142) ==" -ForegroundColor Cyan
  node scripts/check-schema-snapshot-staleness.mjs

  # WARN, ikke FAIL — samme grund som ovenfor: refresh af database.types.ts
  # kraever `npm run types:gen` (Supabase-projekt-login), som preflight ikke
  # har og ikke skal blokere paa (#4326).
  Write-Host "== database-types-drift (schema-snapshot.json vs database.types.ts, #4326) ==" -ForegroundColor Cyan
  node scripts/check-database-types-drift.mjs

  # FAIL, i modsaetning til de to ovenfor: dette er et rent fil-tjek uden
  # DB-adgang. Backup-relationer maa ikke sive tilbage i de genererede typer
  # efter en `npm run types:gen` uden strip-trinnet (#4333).
  Write-Host "== backup-tables-out-of-types (backup-relationer i database.types.ts, #4333) ==" -ForegroundColor Cyan
  node scripts/strip-backup-tables-from-types.mjs --check
  if ($LASTEXITCODE -ne 0) { $failed += "backup-tables-out-of-types" }

  Write-Host "== constraint-form-guard (drop/recreate der taber DEFERRABLE, #4163) ==" -ForegroundColor Cyan
  node scripts/lint-constraint-form.mjs
  if ($LASTEXITCODE -ne 0) { $failed += "constraint-form-guard" }

  # #2858: CI-vagten koerer kun paa AENDREDE SQL-filer (hele database/ har historiske
  # fund der ikke afspejler live-tilstanden, se scriptets header) - spejler samme
  # afgraensning her, ellers fanger preflight ikke det CI faktisk spaerrer paa.
  # origin/main skal vaere fetchet for at diffen er retvisende (samme forudsaetning
  # som resten af scriptet, der antager en frisk `git fetch origin`).
  Write-Host "== secdef-revoke-lint (SECURITY DEFINER uden REVOKE i aendrede SQL-filer, #2858) ==" -ForegroundColor Cyan
  $changedSql = @()
  try {
    $diffOutput = & git --no-pager diff --name-only origin/main...HEAD -- database 2>$null
    if ($LASTEXITCODE -eq 0 -and $diffOutput) {
      $changedSql = @($diffOutput | Where-Object { $_ -match '\.sql$' -and (Test-Path $_) })
    }
  } catch {
    # git diff kan fejle hvis origin/main ikke findes lokalt - spring tjekket over
    # i stedet for at fejle preflight paa git-infrastruktur.
  }
  if ($changedSql.Count -gt 0) {
    node scripts/check-secdef-revoke-lint.mjs $changedSql
    if ($LASTEXITCODE -ne 0) { $failed += "secdef-revoke-lint" }
  } else {
    Write-Host "  (ingen aendrede .sql-filer mod origin/main - sprunget over)" -ForegroundColor DarkGray
  }

  Write-Host "== workflow-output-guard (vagt der gaar groen uden at maale, #4463) ==" -ForegroundColor Cyan
  node scripts/lint-workflow-output-masking.mjs
  if ($LASTEXITCODE -ne 0) { $failed += "workflow-output-guard" }

  Write-Host "== dependabot-exceptions-guard (ignores/allowlists uden issue+review-dato, #4551) ==" -ForegroundColor Cyan
  node scripts/check-dependabot-exceptions.mjs
  if ($LASTEXITCODE -ne 0) { $failed += "dependabot-exceptions-guard" }

  Write-Host "== t2-container-guard (DataTable in a T1 max-w-4xl container, #3454) ==" -ForegroundColor Cyan
  node scripts/lint-t2-container-guard.mjs
  if ($LASTEXITCODE -ne 0) { $failed += "t2-container-guard" }

  # #4330: fanger et required check-navn der forsvinder i en workflow-refaktor.
  # Uden den venter branch protection i al evighed paa et check der aldrig
  # rapporterer, og symptomet rammer foerst NAESTE PR.
  Write-Host "== required-ci-jobs-guard (tabte required check-navne, #4330) ==" -ForegroundColor Cyan
  node scripts/check-required-ci-jobs.mjs
  if ($LASTEXITCODE -ne 0) { $failed += "required-ci-jobs-guard" }

  Write-Host "== frontend eslint ==" -ForegroundColor Cyan
  Push-Location (Join-Path $root "frontend")
  npm run lint
  if ($LASTEXITCODE -ne 0) { $failed += "frontend-lint" }
  Pop-Location

  # #4783: 4/9 aften blev PR #4780 merget med preflight GRØN, men CI's
  # riders-column-grant-guard og warning-budget-job blev røde for de to
  # EFTERFØLGENDE PR'er (#4779, #4781) - ingen af de to var i preflight, saa
  # en worker der fulgte "preflight grøn -> push" kunne ikke se fejlene
  # lokalt. Begge kører HELT UBETINGET i CI (ingen paths-filter paa
  # workflow-niveau, se .github/workflows/ci.yml) - saa de koeres ubetinget
  # her ogsaa, ellers er "lokal groen" stadig ikke det samme som "CI groen".
  Write-Host "== riders-column-grant-guard (kolonne-privilegier paa riders/rider_derived_abilities, #2241/#4783) ==" -ForegroundColor Cyan
  node --test scripts/lint-riders-column-grant.test.mjs
  if ($LASTEXITCODE -ne 0) { $failed += "riders-column-grant-guard (selvtest)" }
  node scripts/lint-riders-column-grant.mjs
  if ($LASTEXITCODE -ne 0) { $failed += "riders-column-grant-guard" }

  # Spejler CI's "warning-budget"-job praecis (backend + frontend, max 0
  # advarsler). Kan tage et minuts tid (kører eslint to gange paa frontend,
  # én gang via npm run lint ovenfor, én gang her via warning-budget-scriptet
  # for advarsels-tal) - det er prisen for at fange samme fejlklasse lokalt
  # som kostede en ekstra PR (#4782) 4/9.
  Write-Host "== eslint-warning-budget (backend + frontend, max 0 advarsler, #4783) ==" -ForegroundColor Cyan
  node scripts/check-eslint-warning-budget.mjs
  if ($LASTEXITCODE -ne 0) { $failed += "eslint-warning-budget" }
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