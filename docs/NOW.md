# NOW — Aktuel arbejdsstatus

## Aktiv slice
**Onboarding v2 — Slice 3 leveret (v2.16).** Onboarding v2 multi-slice nu komplet (1a + 1b + 2 + 3).

## Soak-gate
**Aktiv: delvis** — Dark mode ✅ · Discord DM ✅ · Deadline Day S1–S4 code-level ✅ (23/23 invarianter; `is_flash` schema-divergens lukket 2026-05-04) · DD UI-smoke 4 punkter pending. Onboarding v2 1a+1b+2+3: code-level (build/lint grøn); UI-smoke pending.

## Open beta status
**Alle 7 launch-gates ✅** — soft-launch-klar.

## Senest leveret
- 2026-05-03: **Onboarding v2 — Slice 3** (v2.16) — Økonomi-explainer på `/finance`: `FinanceFirstVisitHint.jsx` ved første besøg (sponsor 260K × board-modifier med link til /board, salary 10% af uci*4000, gældsloft D1/D2/D3, kort vs. langt lån). Tour med 3 trin (balance-grid, gældsloft-kort, tx-historik). Trigger via localStorage `cz-finance-hint-shown` (ingen backend-step — finance er en explainer, ikke en aktiv milestone). Lint 0 errors, build grøn.
- 2026-05-03: **Onboarding v2 — Slice 2** (v2.15) — Bestyrelse-explainer: `BoardEmptyState.jsx` øverst på `/board` for managers uden plan (forklarer rolle + 1yr/3yr/5yr + KPI-kategorier + sponsor-modifier-tærskler) med CTA der åbner wizard. Auto-wizard-skip ved første gangs setup. Tour 3 trin på `/board`.
- 2026-05-04: **DD audit follow-up** (v2.14) — `auctions.is_flash` schema-divergens lukket: ny idempotent migration + kolonne tilføjet til schema.sql/supabase_setup.sql/setup.py + regression-test.
- Ældre v2.13 og før → `docs/archive/NOW_HISTORIK_2026-05-03.md`

## Næste session — prioriteter
1. UI-smoke på Onboarding v2 1a+1b+2+3 (samlet — alle fire slices code-level grønne)
2. Deadline Day UI-smoke (DD code-level audit kører som baggrunds-task)
3. Næste post-launch-slice fra backlog (S8.5 import-feedback eller S9 Race Library)

## Kritiske invarianter
- Discord DM-fejl må aldrig blokere transaction (best-effort try/catch i `notifyDiscordDM`)
- `users.discord_dm_enabled=false` skipper DM uden at logge fejl; @mention i kanal sker stadig
- Discord-ID validering: 17-19 cifre, kun tal — håndhævet ved save i ProfilePage
- `/profile` → `ProfilePage` (indstillinger) — `ManagerProfilePage` er read-only view
- Economy v1.76: `SALARY_RATE = 0.10`, sponsor 260K, gældsloft D1/D2/D3 = 1200K/900K/600K
- `applyRaceResults` udbetaler IKKE præmier — kun via `prizePayoutEngine.paySeasonPrizesToDate`
- NOW.md: maks 30 linjer — flyt historik til `docs/archive/` i samme session som arbejdet lukkes
