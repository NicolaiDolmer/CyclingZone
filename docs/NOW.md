# NOW — Aktuel arbejdsstatus

## Aktiv slice
**Onboarding v2 — Slice 2 leveret (v2.15).** Næste sub-slice: Slice 3 (økonomi-explainer på `/finance`).

## Soak-gate
**Aktiv: delvis** — Dark mode ✅ · Discord DM ✅ · Deadline Day S1–S4 code-level ✅ (23/23 invarianter; `is_flash` schema-divergens lukket 2026-05-04) · DD UI-smoke 4 punkter pending. Onboarding v2 1a+1b+2: code-level (build/lint grøn); UI-smoke pending.

## Open beta status
**Alle 7 launch-gates ✅** — soft-launch-klar.

## Senest leveret
- 2026-05-03: **Onboarding v2 — Slice 2** (v2.15) — Bestyrelse-explainer: `BoardEmptyState.jsx` øverst på `/board` for managers uden plan (forklarer rolle + 1yr/3yr/5yr + KPI-kategorier + sponsor-modifier-tærskler) med CTA der åbner wizard. Auto-wizard-skip ved første gangs setup — vises kun ved sekventiel fortsættelse. `OnboardingTour pageKey="board"` med 3 trin der peger på empty-state-sektionerne. `TOUR_PAGE_BY_STEP` udvidet med `board_plan_set: "board"`. Lint 0 errors, build grøn.
- 2026-05-04: **DD audit follow-up** (v2.14) — `auctions.is_flash` schema-divergens lukket: ny idempotent migration + kolonne tilføjet til schema.sql/supabase_setup.sql/setup.py + regression-test. Patch notes v2.14 noterer fix under "Under motorhjelmen" (no-op for managers; live DB var allerede ok).
- 2026-05-03: **Onboarding v2 — Slice 1b** (v2.13) — Guided squad-builder: `RidersEmptyState` på `/riders`, `AuctionsFirstBidHint` på `/auctions`, `OnboardingTour` peg-pil-overlay startet fra "💡 Vis mig hvordan"-knap.
- Ældre v2.12 og før → `docs/archive/NOW_HISTORIK_2026-05-03.md`

## Næste session — prioriteter
1. **Onboarding v2 — Slice 3** — økonomi-explainer på `/finance` (sponsor/salary/debt loft-forklaring)
2. UI-smoke på Onboarding v2 1a+1b+2 (samlet, når der er overskud)
3. Deadline Day UI-smoke (DD code-level audit kører som baggrunds-task)

## Kritiske invarianter
- Discord DM-fejl må aldrig blokere transaction (best-effort try/catch i `notifyDiscordDM`)
- `users.discord_dm_enabled=false` skipper DM uden at logge fejl; @mention i kanal sker stadig
- Discord-ID validering: 17-19 cifre, kun tal — håndhævet ved save i ProfilePage
- `/profile` → `ProfilePage` (indstillinger) — `ManagerProfilePage` er read-only view
- Economy v1.76: `SALARY_RATE = 0.10`, sponsor 260K, gældsloft D1/D2/D3 = 1200K/900K/600K
- `applyRaceResults` udbetaler IKKE præmier — kun via `prizePayoutEngine.paySeasonPrizesToDate`
- NOW.md: maks 30 linjer — flyt historik til `docs/archive/` i samme session som arbejdet lukkes
