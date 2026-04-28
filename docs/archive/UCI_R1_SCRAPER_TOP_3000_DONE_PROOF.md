# UCI-R1 — Scraper top 3000 hardening done proof

Status: FÆRDIG 2026-04-28.

## Scope
- Mål: Gør UCI scraperen sikker og dækkende for alle PCS-tilgængelige ryttere op til 3000, så workflow-success ikke kan skjule manglende top 101-3000 data.
- Manager-værdi: Korrekte UCI-point, rytterpriser og historik uden masse-nedskrivning til minimum 5 point.
- Berørt runtime-path: `scripts/uci_scraper.py` → Google Sheets → Supabase `riders` + `rider_uci_history`.

## Root cause
PCS pretty URL `rankings/me/uci-individual?offset=100` ignorerede offset og returnerede top 1-100 igen. Fungerende route er `rankings.php?p=me&s=uci-individual&offset=...`.

## Leverancer
1. Pagination rank-guards: side 1 starter ved 1, side 2 ved 101, side 3 ved 201 osv.
2. Coverage-gate før writes: default top 3000 kræver realistisk dækning og tydelig page/rank/match-rapport.
3. Fail fast ved tom side, rank-gap, dublet-ranks eller gentaget top-100.
4. `--dry-run` skriver hverken Sheets eller Supabase.
5. Ufuldstændige scrapes må aldrig masse-nedskrive ikke-matchede DB-ryttere til 5 UCI-point.
6. Safety-gate stopper production-write, hvis for mange ryttere ville blive nedskrevet til minimum 5 point.
7. Live write med GitHub Actions secrets og godkendt Supabase safety report.

## Done proof
- Scraper-hardening er implementeret og merged til `main`.
- Live workflow_dispatch `25053357290` skrev 3000 rækker til Google Sheets, synkroniserede Supabase og loggede 1000 `rider_uci_history` rækker.
- Production logs viste `Skriver til Google Sheets...`, `Synkroniserer til Supabase...`, coverage `pages=30`, `total=3000`, `rank_min=1`, `rank_max=3000`, `duplicate_ranks=0`.
- Supabase safety report viste `matched=888`, `not_found=112`, `updates=787`, `restored_from_minimum=787`, `minimum_downgrades=0/100`, `complete_ranking=True`.

## Data policy
Fixet blev kørt fremad via valideret sync. Workflow-success alene er fortsat ikke datakvalitetsbevis.
