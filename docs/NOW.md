# NOW — Aktuel arbejdsstatus

## Aktiv slice
**S7 — Launch readiness** (open beta go-live)

## Gate-checks S7

| # | Check | Status |
|---|---|---|
| 1 | Beta reset koordineret med alle 17 managers | ⬜ |
| 2 | Smoke-test: login, auktion, transfer, finance, bestyrelse | ⬜ |
| 3 | Help + PatchNotes afspejler alle S2–S6 ændringer | ✅ |
| 4 | Deploy verify (`pwsh -File scripts/verify-deploy.ps1`) | ✅ |

## Næste session — INVESTIGATION
**Problem:** dyn_cyclist sync (v1.83) opdaterede kun ~900 ud af 8.699 ryttere.
Synkronisering kørt med: `https://docs.google.com/spreadsheets/d/1Fm56gvH7IZ4Tks9I_tJfP7xP_7PgUjPxBbZgWJGCIf4`

Mulige årsager — undersøg i rækkefølge:
1. **Arket har kun ~900 rækker** — PCM dyn_cyclist er måske kun top-ryttere, ikke alle 8.699
2. **pcm_id mangler på mange ryttere** — tjek `SELECT COUNT(*) FROM riders WHERE pcm_id IS NOT NULL`
3. **IDcyclist-mismatch** — arkets IDcyclist-værdier matcher ikke DB's pcm_id
4. **Import_log** — tjek `import_log` tabellen for `rows_in_sheet` og `rows_matched` fra sidste sync

Relevante filer: `backend/lib/dynCyclistSync.js`, `import_log` tabel i Supabase

## Senest leveret
- v1.83 (2026-05-01): Potentiale-stjerner på alle rytteroversigter — guld/sølv, halvstjerner, filter+sort
- v1.81 (2026-04-30): Nationalitetsflag på alle 8.699 ryttere

## Kritiske invarianter
- `/profile` → `ProfilePage` (indstillinger) — `ManagerProfilePage` er read-only view
- Economy v1.76: `SALARY_RATE = 0.10`, sponsor 260K, gældsloft D1/D2/D3 = 1200K/900K/600K
- `processSeasonEnd` loader teams/riders/board_profiles separat og fejler hårdt på errors
- NOW.md: **maks 30 linjer** — flyt historik til `docs/archive/` i samme session som arbejdet lukkes
