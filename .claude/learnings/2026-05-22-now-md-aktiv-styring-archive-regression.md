# 2026-05-22 — NOW.md Aktiv styring fields utilsigtet arkiveret af Stop-hook

## Symptom

Session 2026-05-22-M start: NOW.md "Aktiv styring"-sektion var tom — både `🎯 Next action` og `🤖 Working agent` felter (indført Session J for #558/#559) manglede. Felterne dukkede op nederst i `docs/archive/NOW-2026-05-22.md` med en `## Auto-archived 2026-05-22T17:04:24+00:00` header.

## Impact

- Multi-AI claim-mekanismen brudt: andre PCs/AI-sessioner kunne ikke se Working agent-claim ved session-start → race-risiko hvis to AI'er starter samtidigt.
- Cross-device handoff-pointer (Next action) tabt → næste session ville ikke vide hvad der var aktuel kandidat.
- Protokollen blev indført Session J (2 sessioner før), så regressionen ramte tidligt efter feature-rollout.

## Root cause

`scripts/check-now-md.sh` (Stop-hook auto-archive) brugte denne strategi:

```bash
CUT_LINE=$(head -30 "docs/NOW.md" | grep -n '^## ' | tail -1 | cut -d: -f1)
tail -n +$((CUT_LINE + 1)) "docs/NOW.md" >> "$ARCHIVE_FILE"
head -n "$CUT_LINE" "docs/NOW.md" > NOW.md.tmp
```

Intentionen var "hold lines op til sidste `## ` header, arkivér resten". Det virkede da NOW.md kun havde ét slags `## ` header (en eksisterende slice-section). Da `## Aktiv styring` blev tilføjet i Session J (2026-05-22) som NY sektion under session-quotes, blev den til sidste header → cut-boundary → felterne under den blev arkiveret.

Stop-hook fyrede ved close-out af Session L og lavede commit `dfcee56` ("docs(now): trim NOW.md + arkivér session 2026-05-22-L") som fjernede felterne. Det blev opdaget Session M ved session-start (CLAUDE.md trin 1 læser Working agent).

## Hvorfor det ikke blev fanget

Test `scripts/hooks/__tests__/test-stop-hook.sh` testede kun (a) at NOW.md blev trimmet til ≤30 linjer + (b) at archive-dir voksede. Den verificerede IKKE at active-state-felter blev bevaret — for testen brugte ikke `## Aktiv styring` som section-header (den brugte `## Aktiv slice` + `## Tail`, der ikke matchede regression-mønstret).

Session J's commit der indførte `🎯 Next action` + `🤖 Working agent` opdaterede ikke testen til at protege dem. Stop-hook'et's adfærd matched den dokumenterede klipping-strategi i kommentarerne (linje 16-17), så scriptet vidste ikke at den nye sektion var "active state" og ikke "stale aktiv-noter".

## Fix

Commit `82719b4`:

1. **Script:** Find `## Aktiv styring` eksplicit. Arkivér KUN linjer mellem cut-line og Aktiv styring-headerens linje; behold Aktiv styring og alt under intakt i NOW.md. Fallback til legacy-adfærd hvis sektionen mangler.
2. **Test:** Tre nye assertions — sentinel-tekst overlever trim, `## Aktiv styring` header forbliver, og gamle quotes arkiveres stadig. Cleanup snapshotter pre-existing archive-filer byte-for-byte (script appender, så "remove what wasn't there"-strategien lækkede testdata).

5/5 tests pass lokalt.

## Forward-guard

- Test dækker nu regression-mønstret eksplicit. Hvis nogen ændrer cut-strategien igen og bryder protection, fejler `Aktiv styring sentinels preserved`-assertion.
- Script-kommentar nævner regression-incident eksplicit så fremtidige editors forstår invariansen.

## Backwards-check

Søgte efter andre sektioner/felter der kunne være sårbare for samme cut-strategi: ingen andre dokumenter har en "protected last section" struktur. CLAUDE.md, MEMORY.md, FEATURE_STATUS.md har hver deres egne size-budgets uden auto-archive.

Sekundær finding under fix: test-script lækkede testdata til pre-existing archive-filer (cleanup fjernede kun nyoprettede filer, ikke append-modifikationer). Fixet i samme commit.

## Læring

Når man tilføjer en sektion med ny semantik (her: "active state" vs "historical state") til en doc med auto-management, opdatér også test + script så semantikken er enforceret. Indførelses-commit'et (Session J) ramte ikke nogen check fordi Stop-hook'et ikke fyrede før Session L's close-out, og det er hvor regressionen materialiserede sig — 2 sessioner senere.
