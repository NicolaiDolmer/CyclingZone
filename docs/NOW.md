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
- Live read-only Supabase-verifikation er kørt med credentials fra `backend/.env` uden at ekko secrets.
- Fund: live DB har sæson 6 som aktiv, men `races`, `race_results` og `season_standings` er tomme for alle sæsoner; seneste `import_log` for `race_results_sheets` behandlede 709 rækker, men skrev 0 fordi alle løb blev skipped/unmatched.
- Fund lukket: season-end preview trak aktive lånerenter fra kontant `balance_after`, mens runtime `processLoanInterest` lægger renter på lånets restgæld. Preview viser stadig renter, men nød-lånsbehov følger nu runtime-kontantbalancen efter løn.
- `Slice UI-M1 — Mobile beta-critical flows` ✅ FÆRDIG (2026-04-28). Rytterliste, rytterside-market actions, auktioner, transfers, indbakke og admin beta quick actions er mobiltilpasset, så primære handlinger ikke kræver horisontal scroll. Frontend build passerer.

## Næste konkrete handling
1. Fyld/opret live `races` for aktiv sæson eller kør en kontrolleret smoke-sæson med test-races, før admin xlsx/sheets-resultatimport kan verificeres end-to-end.
2. Verificér live season-flow igen: admin xlsx/sheets import → `race_results` → standings → finance/prizes.
3. Verificér deployed season-end preview/end mod løn, lånerente som gæld, sponsor og board-side effects.

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
