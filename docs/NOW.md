# NOW — Aktuel arbejdsstatus

## Aktiv slice
- Docs truth cleanup
- Mål: Ryd færdige/stale backlog-items ud, fjern `blokeret/udskudt` som roadmap-status, og flyt historik til arkiv/statusfiler.

## Status 2026-04-28
- `Slice UCI-R1 — Scraper top 3000 hardening` ✅ FÆRDIG.
- Root cause fundet: PCS pretty URL ignorerede `?offset=100`, så side 2+ returnerede top 1-100 igen.
- Lokal fix er lavet i `scripts/uci_scraper.py`: bruger `rankings.php?p=me&s=uci-individual&offset=...`.
- Lokal dry-run er godkendt: `pages=30`, `total=3000`, `rank_min=1`, `rank_max=3000`, `duplicate_ranks=0`, `complete_ranking=True`.
- Live workflow_dispatch via GitHub Actions run `25053357290` er godkendt: Google Sheets skrev 3000 rækker, Supabase sync kørte, og `rider_uci_history` loggede 1000 historikrækker.
- Supabase safety report: `matched=888`, `not_found=112`, `updates=787`, `restored_from_minimum=787`, `minimum_downgrades=0/100`, `complete_ranking=True`.

## Næste konkrete handling
1. Fortsæt med docs truth cleanup.
2. Lås Slice UCI-R2 i backloggen: lønninger skal genberegnes, når UCI-værdier opdateres.
3. Behold UCI-invarianterne som regressionskrav for fremtidige scraper-ændringer.

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

## Næste slice efter docs truth cleanup
- Afklares efter cleanup mod `docs/PRODUCT_BACKLOG.md`.
