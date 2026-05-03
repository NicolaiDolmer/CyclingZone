# NOW — Aktuel arbejdsstatus

## Aktiv slice
**Onboarding v2 — Slice 1b leveret (v2.13).** Næste sub-slice: Slice 2 (bestyrelse-explainer på `/board`).

## Soak-gate
**Aktiv: delvis** — Dark mode ✅ · Discord DM ✅ · Deadline Day S1–S4 code-level ✅ (23/23 invarianter; `is_flash` schema-divergens lukket 2026-05-04) · DD UI-smoke 4 punkter pending. Onboarding v2 1a+1b: code-level (build/lint grøn); UI-smoke pending.

## Open beta status
**Alle 7 launch-gates ✅** — soft-launch-klar.

## Senest leveret
- 2026-05-03: **Onboarding v2 — Slice 1b** (v2.13) — Guided squad-builder: `RidersEmptyState` på `/riders` (filtre + balance vs. division-min, CTA filtrerer ≤ balance), `AuctionsFirstBidHint` på `/auctions` (+10%-overbud + 10-min auto-forlængelse, dismiss via `cz-first-bid-shown`), `OnboardingTour` peg-pil-overlay startet fra "💡 Vis mig hvordan"-knap på `OnboardingProgressCard`. Tour-trin på `/riders` (filtre→liste→ønskeliste) og `/auctions` (bud-input→countdown). State i `cz-onboarding-tour-step`. Genbruger eksisterende `/api/me/onboarding-progress` for `first_rider_owned`/`first_bid_placed`-flags. Lint 0 errors, build grøn.
- 2026-05-04: **DD audit follow-up** (v2.14) — `auctions.is_flash` schema-divergens lukket: ny idempotent migration + kolonne tilføjet til schema.sql/supabase_setup.sql/setup.py + regression-test. Audit-rapport opdateret 22✅+1❌ → 23✅+0❌. Patch notes v2.14 noterer fix under "Under motorhjelmen" (no-op for managers; live DB var allerede ok).
- 2026-05-03: **Onboarding v2 — Slice 1a** (v2.12) — Dashboard kom-i-gang-kort, 4 trin + backend `GET /api/me/onboarding-progress`, `OnboardingProgressCard.jsx` med dismiss + auto-skjul.
- Ældre v2.11 og før → `docs/archive/NOW_HISTORIK_2026-05-03.md`

## Næste session — prioriteter
1. **Onboarding v2 — Slice 2** — bestyrelse-explainer på `/board` (tour + inline-empty-state for managers uden plan)
2. **Slice 3** (senere) — økonomi-explainer på `/finance`
3. Deadline Day UI-smoke når brugeren har overskud (DD code-level audit kører som baggrunds-task)

## Kritiske invarianter
- Discord DM-fejl må aldrig blokere transaction (best-effort try/catch i `notifyDiscordDM`)
- `users.discord_dm_enabled=false` skipper DM uden at logge fejl; @mention i kanal sker stadig
- Discord-ID validering: 17-19 cifre, kun tal — håndhævet ved save i ProfilePage
- `/profile` → `ProfilePage` (indstillinger) — `ManagerProfilePage` er read-only view
- Economy v1.76: `SALARY_RATE = 0.10`, sponsor 260K, gældsloft D1/D2/D3 = 1200K/900K/600K
- `applyRaceResults` udbetaler IKKE præmier — kun via `prizePayoutEngine.paySeasonPrizesToDate`
- NOW.md: maks 30 linjer — flyt historik til `docs/archive/` i samme session som arbejdet lukkes
