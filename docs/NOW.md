# NOW — Aktuel arbejdsstatus

## Aktiv slice
- Live season flow verification med admin xlsx som primær resultater-kilde
- Mål: Verificér at admin-import af resultater, standings, finance og season-end hænger sammen i runtime.

## Status 2026-04-28
- `Slice UCI-R1 — Scraper top 3000 hardening` ✅ FÆRDIG.
- Done proof er flyttet til `docs/archive/UCI_R1_SCRAPER_TOP_3000_DONE_PROOF.md`.
- Docs truth cleanup er gennemført i `docs/PRODUCT_BACKLOG.md`: roadmap er kortet ned, gamle pause-/ventestatusser er fjernet, og UCI-R2 er nu lukket efter runtime-verifikation.
- `Slice UCI-R2 — Løn følger værdi efter UCI-sync` ✅ FÆRDIG i runtime.
- Done proof: `.github/workflows/uci_sync.yml` kører `node backend/scripts/recalculateRiderSalaries.js` efter `python scripts/uci_scraper.py`; `backend/scripts/recalculateRiderSalaries.js` kalder `updateRiderValues`; `backend/lib/economyEngine.test.js` dækker genberegning med `prize_earnings_bonus`.
- Live season-flow verification er startet statisk/lokalt: xlsx-import og approve deler `applyRaceResults`; backend-tests bekræfter `race_results` → prize finance rows → `season_standings`.
- Fund lukket: season-end preview brugte en lokal board/sponsor-regel, som kunne afvige fra `processSeasonEnd`/season-start. Preview bruger nu `buildSeasonEndPreviewRows` i `backend/lib/economyEngine.js` og er dækket af regressionstest.
- Live read-only Supabase-verifikation er ikke kørt i denne session, fordi `.codex.local/supabase-readonly.env` ikke findes i repo-root.

## Næste konkrete handling
1. Verificér live season-flow med credentials: admin xlsx import → `race_results` → standings → finance/prizes.
2. Verificér deployed season-end preview/end mod løn, renter, sponsor og board-side effects.
3. Notér evt. resterende drift som konkrete P1/P2-fund før ny implementering.

## Kommandoer
PowerShell skal stå i repo-root:

```powershell
cd "C:\Users\ndmh3\OneDrive\Skrivebord\cycling-manager"
$env:PYTHONIOENCODING='utf-8'
# Sæt også credentials i samme session. Ekko dem aldrig i chat eller docs.
python scripts\uci_scraper.py --dry-run
python scripts\uci_scraper.py
```

## Vigtige invarianter
- Workflow-success alene er ikke bevis på datakvalitet.
- `--dry-run` må aldrig skrive Sheets eller Supabase.
- Pagination skal dække rank 1-3000 eller fejle før writes.
- Mass-nedskrivning til 5 UCI-point skal stoppes af safety-gate.
- UCI-sync må ikke nulstille eller ignorere eksisterende `prize_earnings_bonus`.
- Salary update kører efter godkendt UCI-sync i GitHub Actions workflowet og bruger eksisterende `updateRiderValues`-regel.
- En afsluttet slice må ikke blive stående som aktiv/næste handling; tjek runtime/test/patch notes før samme opgave startes igen.

## Næste slice efter live season verification
- Review hardening: race-result path, `/profile` redirect, window_pending, auction invariants og sidebar active-state.
