# NOW — Aktuel arbejdsstatus

## Aktiv slice
**Onboarding v2 — Slice 1a leveret (v2.12).** Næste sub-slice: 1b (RidersPage empty-state + AuctionsPage first-bid hint + opt-in tour).

## Soak-gate
**Aktiv: delvis** — Dark mode ✅ · Discord DM ✅ · Deadline Day S1–S4 code-level ✅ (23/23 invarianter; `is_flash` schema-divergens lukket 2026-05-04) · DD UI-smoke 4 punkter pending. Onboarding v2 1a: code-level (build/lint grøn); UI-smoke pending.

## Open beta status
**Alle 7 launch-gates ✅** — soft-launch-klar.

## Senest leveret
- 2026-05-04: **DD audit follow-up** — `auctions.is_flash` schema-divergens lukket: ny migration `database/2026-05-04-auctions-is-flash.sql` (idempotent) + kolonne tilføjet til schema.sql/supabase_setup.sql/setup.py + regression-test i `auctionSchemaContract.test.js`. Live Supabase havde allerede kolonnen; ren source-fix (ikke user-facing → ingen patch notes-bump). Audit-rapport opdateret 22✅+1❌ → 23✅+0❌.
- 2026-05-03: **Onboarding v2 — Slice 1a** (v2.12) — Dashboard kom-i-gang-kort, 4 trin (`team_named`/`first_rider_owned`/`first_bid_placed`/`board_plan_set`), backend `GET /api/me/onboarding-progress`, `OnboardingProgressCard.jsx` med dismiss + auto-skjul.
- 2026-05-03: **JSX react-rules sanitering** (v2.11) — react-regelsæt løftet til `.{js,jsx}`; 71 pre-eks. issues saneret.
- Ældre v2.10 og før → `docs/archive/NOW_HISTORIK_2026-05-03.md`

## Næste session — prioriteter
1. **Onboarding v2 — Slice 1b** — RidersPage empty-state for nye managers + AuctionsPage first-bid hint + opt-in tour-mekanik
2. **Slice 2** (senere) — bestyrelse-explainer på `/board`; **Slice 3** (senere) — økonomi-explainer på `/finance`
3. Deadline Day UI-smoke når brugeren har overskud (DD code-level audit kører som baggrunds-task)

## Kritiske invarianter
- Discord DM-fejl må aldrig blokere transaction (best-effort try/catch i `notifyDiscordDM`)
- `users.discord_dm_enabled=false` skipper DM uden at logge fejl; @mention i kanal sker stadig
- Discord-ID validering: 17-19 cifre, kun tal — håndhævet ved save i ProfilePage
- `/profile` → `ProfilePage` (indstillinger) — `ManagerProfilePage` er read-only view
- Economy v1.76: `SALARY_RATE = 0.10`, sponsor 260K, gældsloft D1/D2/D3 = 1200K/900K/600K
- `applyRaceResults` udbetaler IKKE præmier — kun via `prizePayoutEngine.paySeasonPrizesToDate`
- NOW.md: maks 30 linjer — flyt historik til `docs/archive/` i samme session som arbejdet lukkes
