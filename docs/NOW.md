# NOW — Aktuel arbejdsstatus

## Aktiv slice
**UCI name-match permanent fix (v2.27).** Mandags-cron'en kan ikke længere nulle compound-surname-ryttere som Tobias Lund Andresen. Token-set-match + æ/ø/å-normalisering + high-value safety-gate (popularity ≥ 70 OR uci_points ≥ 100) i `scripts/uci_scraper.py` + `backend/lib/sheetsSync.js`. 14 ryttere fixed via `database/2026-05-04-fix-uci-points-token-mismatch.sql` (anvendt + registreret). 21/21 tests passerer.

## Soak-gate
**Aktiv: nej** — kvitteret 2026-05-04.

## Open beta status
**Alle 7 launch-gates ✅** — soft-launch-klar. **Launch-dato: åben** (kvalitet > deadline besluttet 2026-05-04).

## Senest leveret
- 2026-05-04: **UCI name-match fix (v2.27)** — token-set + æ/ø/å-norm + safety-gate; 14 ryttere restitueret (Tobias Lund Andresen 2.514, Halland Johannessen 2.393 m.fl.); `sheetsSync.js` synkroniseret. **S-04 Admin-cancel (v2.26)** + **S-01 prod-smoke ✅** (8699/8699 matcher 10%-formel)
- 2026-05-04: **S-01 (v2.25)** + **S-01.1 Auto-migrate** + **Roadmap-leverance** + **Lint (v2.24.1)** + **S8.5 (v2.24)** + **S9b (v2.23)** + **S9a (v2.22)**
- Ældre → `docs/archive/NOW_HISTORIK_2026-05-03.md`

## Næste session — prioriteter
1. **Bruger:** tilføj `SUPABASE_DB_URL` GitHub secret så auto-migrate workflow ikke længere fejler ved push
2. **S-06 Webhook-smoke** (kort P0) — derefter **S-03 Trupstørrelse-håndhævelse** (se `docs/LAUNCH_ROADMAP.md`)

## Kritiske invarianter
- **Verificér runtime FØR claim** (etableret 2026-05-04) — grep koden før du listet noget som TODO/bug
- Discord DM-fejl må aldrig blokere transaction (best-effort try/catch i `notifyDiscordDM`)
- `/profile` → `ProfilePage` (indstillinger) — `ManagerProfilePage` er read-only view
- Economy v1.76 + v2.25: `SALARY_RATE = 0.10` (nu i DB-formel), sponsor 260K, gældsloft D1/D2/D3 = 1200K/900K/600K
- **`riders.salary` er GENERATED** — kan IKKE skrives fra application-kode efter v2.25-deploy; DB beregner fra `uci_points` + `prize_earnings_bonus`
- **UCI-sync må aldrig nulle high-value ryttere** — popularity ≥ 70 OR uci_points ≥ 100 er auto-protected; token-set-match + æ/ø/å-norm i `scripts/uci_scraper.py` + `backend/lib/sheetsSync.js` skal forblive byte-equivalent
- `applyRaceResults` udbetaler IKKE præmier — kun via `prizePayoutEngine.paySeasonPrizesToDate`
- Squad limits: D1 20-30, D2 14-20, D3 8-10 — håndhæves S-03
- NOW.md: maks 30 linjer — flyt historik til `docs/archive/` i samme session som arbejdet lukkes
