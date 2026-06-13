# Game invariants (stabile konstanter)

Stabile rules der sjældent ændrer sig. Hvis du redigerer økonomi-kode, race-resultat-flow eller upload-håndtering — tjek herinde først.

Flyttet fra `NOW.md` 2026-05-14 (Phase 4 af `scalable-wobbling-blossom`) for at holde NOW.md som ren ephemeral status.

## Kritiske invarianter

- **Verificér runtime før claims** — runtime > docs. Doks går stale; koden er sandheden.
- **Economy-konstanter** (backend SSOT: `backend/lib/economyConstants.js`):
  - `DEFAULT_BETA_BALANCE = 800_000`
  - `sponsor = 240_000`
  - `SALARY_RATE = 0.10`
  - **Rytter-værdi (#1101 cutover 2026-06-10):** `market_value = COALESCE(base_value, 1000) + prize_earnings_bonus` — GENERATED i DB (`database/2026-06-10-value-cutover-base-value.sql`). `base_value` skrives KUN af backfill/relaunch-orchestrator (model v3: `riderValuationModel.json`). `uci_points` er afkoblet og må ikke vises player-facing eller indgå i værdi-formler. Fallback-konstanten 1000 spejles i `marketUtils.RIDER_BASE_VALUE_FALLBACK` + frontend `marketValues.js`. Audit: `backend/scripts/auditValuationCutover.js`.
  - **`riders.salary` er FROSSEN ved signering (#1309 cutover 2026-06-13):** kolonnen er IKKE længere GENERATED — den skrives én gang ved erhvervelse (auktion-win, transfer-accept, seed) og ændres ikke automatisk bagefter. Formel ved signering: `max(1, round(market_value × 0.10))`. Kontraktfelter: `contract_length` (1-3 sæsoner, INTEGER) og `contract_end_season` (INTEGER). Invarianter:
    - **Ejede ryttere (team_id != null) har ALTID en kontrakt** (salary != null, contract_length != null, contract_end_season != null) — garanteret af relaunch-seed (#1309) + contract-on-acquire på alle erhvervelsespaths (auktion, transfer, swap).
    - **Free agents (team_id null) har NULL salary** — UI estimerer via `resolveRiderSalary` / `getRiderSalary` (~10% af market_value) udelukkende til visningsformål. *Fuldt realiseret når #1310-markedspakken lander:* erhvervelsessiden garanterer i dag at ejede ryttere altid har salary != null (seed + on-acquire), men frigivelsessiden (squadEnforcement auto-salg til fri-agentur, admin override→null) nulstiller endnu ikke salary — en netop frigivet rytter kan derfor bevare en harmløs frossen løn (identisk med hvad resolveren ville estimere, da base_value er frosset). Release-side-clearing er en del af #1310.
    - **Kontrakt arves uændret ved handel** — salary, contract_length og contract_end_season nulstilles/genberegnes ALDRIG ved transfer eller auktions-ejerskiftssalg; køber overtager eksisterende kontrakt som-er.
    - Contract flows (fornyelse, udløb→auktion, release, re-signing-formel) er fast-follow i markedspakken (#1310).
  - `PRIZE_PER_POINT = 1_500` — race_results.prize_money = points × 1500 i alle resultat-stier (race-motor, PCM-fallback, approve-results). Backend importerer fra `economyConstants.js`; frontend har sin egen kilde (`frontend/src/lib/expectedPrizeCalculator.js`) — de to codebaser kan ikke dele import, så hold dem i sync.
  - **Stjernerytter ([#1205](https://github.com/NicolaiDolmer/CyclingZone/issues/1205)/[#1210](https://github.com/NicolaiDolmer/CyclingZone/issues/1210)):** `STAR_RIDER_MARKET_VALUE = 8_000_000` — en rytter er stjerne når `market_value >= 8M CZ$`. Delt diskriminator for force-sale-beskyttelsen (boardConsequences lag 4, "star riders protected" i help) og `team_star`-achievementet; `transfer_bargain` = købt for `< market_value / 2`. Re-kalibreret 2026-06-10 mod fiktiv launch-population (post-#1209): ≥8M = 12 af 800 (1,5%) = superstjerne-båndets grænse (ejer valgte A på #1210; oprindelig 5M-kalibrering mod PCM-prod ramte 2,5% efter re-tunen). Ændres tærsklen skal player-facing copy følge med (`locales/en+da/achievements.json` + achievements-DB-fallback + denne fil). `uci_points` er frosset og må ikke bruges i nye live paths (eneste rest: `boardIdentity.calculateRiderStarScore`, se #1205 out-of-scope).
  - Gældsloft: D1 = 1.2M · D2 = 900K · D3 = 600K
- **Fri/AI-ryttere & præmie:** præmie optjent af ryttere uden manager-hold tæller med i deres `market_value` (`updateRiderValues` summerer `prize_money` pr. rytter **uden** team-filter via `prize_earnings_bonus`), men **udbetales aldrig** til et hold. Det er bevidst: holdsløse ryttere stiger i værdi, men ingen modtager pengene. **Salary er ikke berørt** — salary er frossen ved signering (#1309) og genberegnes ikke fra præmier; fri/AI-rytteres salary er NULL (resolver estimerer ~10% af market_value til visningsformål).
- **Rytter-værdi genberegnes ved sæson-slut OG ved præmie-udbetaling** (R3, [#895](https://github.com/NicolaiDolmer/CyclingZone/issues/895)). `prize_earnings_bonus` = **progress-vægtet gennemsnit** over de op til 3 nyeste sæsoner: `round(Σ earnings_s / max(Σ w_s, 1))`, hvor en `completed` sæson vejer 1 og den aktive sæson vejer sin fremgang (`race_days_completed / race_days_total`, clamp 0..1). `max(…, 1)`-gulvet forhindrer at en alene-stående aktiv sæson (fx beta-sæson 1 uden completed-anker) annualiserer én tidlig præmie til en oppustet værdi. Uden aktiv sæson reducerer formlen bit-for-bit til den gamle "snit over completed sæsoner". Trigges fra `processDivisionEnd` (sæson-slut) **og** `paySeasonPrizesToDate` (admin-udbetaling). Design: [`docs/slices/prize-money-audit-r3-design.md`](slices/prize-money-audit-r3-design.md).
- **race_results.result_type — kanonisk for endags-løb = `gc`** (ikke `stage`). Matcher XLSX-stien ("general results"→gc) + engine-opslaget `single: {gc: "Klassiker"}`. result_type er kun en label; præmie afhænger af `race_points`-opslaget, ikke result_type.
- **Auction finalization** har parallelle paths i `api.js` og `cron.js`; begge skal delegere til `auctionFinalization.js` — ikke duplikere logik.
- **AI/bank/frozen får aldrig board-state** — board features er manager-only.
- **Admin-resultatupload** — eneste upload-path er PCM-fallbacken `/api/admin/import-results-pcm` (multipart `files[]`, maks 30 filer, Excel-filer i memory med 10 MB loft pr. fil). Excel- og Sheets-import + dyn_cyclist-/UCI-sync er fjernet 2026-06-12 (#1179/#1180/#1207) og må ikke genindføres — forward-guard i `backend/lib/adminRouteOwnership.test.js`.

## Ved ændring

Hvis nogen invariant skal ændres: opdatér både her, relevant kode-fil, og `docs/decisions/` ADR hvis det er en strategisk beslutning (fx sponsor-niveau).
