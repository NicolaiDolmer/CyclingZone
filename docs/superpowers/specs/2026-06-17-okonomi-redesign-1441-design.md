# Økonomi-redesign (#1441) — gold sinks, anti-inflation, forhandlbare sponsorer

> Design-doc · 2026-06-17 · ejer-direktiv ([#1441](https://github.com/NicolaiDolmer/CyclingZone/issues/1441)): fuldt økonomi-redesign, deadline 2-4 dage. Brainstorm-session i beslutnings-rækkefølge, ejer-godkendt 2026-06-17. Adversarisk verificeret mod live-kode samme dag (4 blockers + majors rettet ind).
> Efterfølger til korrektheds-passet [2026-06-15-okonomi-korrekthed-design.md](2026-06-15-okonomi-korrekthed-design.md) (E1 værdi-gate ✅, E2 balance-retune ✅ PR #1438, #1439 sponsor-de-inflation ✅ PR #1440). Dette er det **strukturelle redesign** som de to band-aids udskød.

## 1. Problem

Økonomien inflaterer strukturelt. Verificeret mod prod-ledgeren (`finance_transactions` + `teams`, kun menneskehold):

- Kilder 156,0M vs. sinks 118,9M → **+37,1M akkumuleret**
- Gennemsnitssaldo **2,17M mod 800k start** (2,7×); **0 hold i minus**
- De to store tilbagevendende haner — præmiepenge (`points × 1500`, største tap) og sponsor — møder kun løn + nogle bittesmå sinks

E2 (#1438) og #1439/#1440 stoppede løn-krisen og fjernede den flade 2,5M sæson-2-injektion, men tilføjede **0 nye sinks**. Pengene har stadig ingen vej UD. Begge PR'er beskriver sig selv som "det billige, reversible interim-skridt". Dette redesign er den rigtige model.

*Caveat: de +37,1M er kumulative og ligger i vid udstrækning før E2 vaskede igennem, så de overdriver post-E2-steady-state. Den strukturelle form holder dog — de to største haner dværger ethvert ægte tilbagevendende sink, og intet nyt sink blev tilføjet.*

## 2. Designprincipper (ejer-godkendt 2026-06-17)

Fem beslutninger, taget i afhængigheds-rækkefølge:

### 2.1 Pengemængdens form — langsom kontrolleret vækst
Et holds median-saldo må vokse **mildt og loft-bundet**, med én hård invariant: **kontant-vækst holdes altid under rytter-værdi-vækst**. Penge overhaler aldrig hvad de kan købe. Operationaliserer ejer-principperne "ingen auto-eskalering" + "lav inflation tidligt".
- **Start-kandidat-mål:** median-saldo ≤ **1,3× start ved sæson 5** (≈ 1,04M), monotont aftagende vækstrate. Kalibreres (§6.0).
- **Caveat (se §6.7):** denne invariant er kun falsificérbar hvis rytter-værdier bevæger sig. Med `SEASON_VALUE_RECALC_ENABLED=false` (§8) er værdier ~statiske → §2.1-gaten måles mod *projiceret* værdi-vækst, ikke live.

### 2.2 Fordeling — progressiv
Net-cashflow pr. sæson fordeles progressivt: **stærke hold (top/D1) net ≈ 0 eller let negativ**, **svage hold (bund/D3) lille positiv buffer**. Anti-snowball; hjælper nye/oprykkede hold.
- Dagens form (post-E2, illustrativt): D1 ≈ −10k, D2 +34,5k, D3 +77,3k. Problemet i dag er **magnituden** (alt undtagen D1 kører overskud → akkumulerer fordi der ingen sinks er), ikke fordelingen.
- **Start-kandidat-net-mål (kalibreres):** D1 = 0 (±5%), D2 = 0..+20k, D3 = 0..+30k — **i den konfiguration der gælder ved Fase-1-relaunch, dvs. UDEN frivillige engangs-investeringer** (de er Fase 2). Se §2.4 / blocker-fix i §3.2.

### 2.3 Sinks — løbende upkeep (rygrad) + frivillige engangs-investeringer
Blanding af løbende og engangs, kalibreret efter holdstørrelse. Se §3.

### 2.4 Sources — re-tune nu + forhandlbare sponsorer (faset)
Re-tune af beregnet model nu; forhandlbare kontrakter oven på. Se §4.

### 2.5 Håndhævelse — hårde lofter på de to kendte huller, blød tuning på resten
Clamp 900k-loftet + hård gældsbund (#97); alt andet scorecard-drevet. Se §5.

### 2.6 Kanonisk "billable real team"-filter (gælder hele redesignet)
Tre uensartede filtre findes i de stier redesignet rør: `processSeasonStart` bruger `is_ai=false AND is_frozen=false` (`economyEngine.js:188-189`, **mangler `is_test_account`**); kapacitets-logik bruger 3-vejs (`economyEngine.js:1482-1484`); economy-health bruger `user_id IS NOT NULL AND is_ai=false AND is_bank=false` (`routes/api.js:6536-6538`).
**Beslutning:** ét kanonisk filter for hvad der er et "billable real team" som nye sinks + gældsbund + scorecard ALLE bruger: `is_ai=false AND is_test_account=false AND is_frozen=false`. `processSeasonStart` alignes til dette i Fase 1, ellers rammer upkeep/gældsbund test-accounts og forurener scorecardet. *(MEMORY: feedback_match_ui_filter_for_capacity_logic — bidt 2x.)*

## 3. Sinks (afløb)

### 3.1 Løbende upkeep (ny rygrad)
Stab + facilitets-vedligehold som en per-sæson-omkostning der **skalerer i diskrete tiers** (facilitets-niveau / division), **ikke** med live roster-`market_value`-sum.

- **Hvorfor tier, ikke værdi-sum:** hvis upkeep skalerede med live roster-værdi, ville den auto-eskalere når rytter-værdier stiger — det bryder samme "ingen auto-eskalering"-princip §4.1 påberåber. En lille heltals-ladder (fx facilitets-tier 1-5 × division-faktor) giver progressiv skalering uden feedback-loop. *(Hvis værdi senere ønskes som input: kræver lag/smoothing + en §6-assertion om at upkeep ikke auto-eskalerer — se §8.)*
- **Form:** konveks "blød bund" — lavt tier betaler lidt, raten klatrer for højere tiers. Små hold bløder ikke; den stejle top bærer anti-inflations-lasten.
- **Hvorfor det virker trods blød bund:** små hold *tjener* lidt (D3-sponsor + lav præmie), så **kilde-re-tunen (§4.1) — ikke upkeep — er den primære løftestang der lukker D3-loopet i Fase 1** (jf. blocker-fix §3.2). Upkeep rammer der hvor pengene løber løbsk (toppen).
- **Integration:** nyt debit-step i `processSeasonStart` (`economyEngine.js`, samme orkestrering som løn-debit ~`:436-488`), kun for billable real teams (§2.6).
- **SKAL skrive en `finance_transactions`-row** via `incrementBalanceWithAudit`/`creditTeam` med en **ny `reason_code`/`actor_type`-enum-værdi** (mod CHECK-constraints, `economyConstants.js:96-98`). En balance-justering uden ledger-row bryder selve konserverings-invarianten (§6.6). → kræver migration (§7).
- **Reuse:** academy-drift-debittet (`economyEngine.js:520-553`, mønster: per-sæson debit gated på en count) er et godt **plumbing-mønster** at kopiere — men upkeep skal have **egne konstanter + eget (eller intet) flag**, ikke kobles til academy-flagets livscyklus (`academyFlag.js`, DRIFT 5000/slot er sim-placeholders bundet til academy-flag).
- **Tal:** rate-ladder + loft fastsættes empirisk (§6.0).

### 3.2 Engangs-investeringer (ny, frivillig — Fase 2)
Valgfrie facilitets-/infrastruktur-opgraderinger et hold køber for at vokse.

- **Rolle:** små holds største *frivillige* post — aspirerende, aldrig ødelæggende. Giver et attraktivt sted at lægge penge i stedet for at hamstre.
- **KRITISK afgrænsning (blocker-fix):** engangs er **frivillig + tørrer ud**, så den er **IKKE** den løftestang der gør Fase-1-økonomien ikke-inflationær. **Fase 1 SKAL lukke D3-loopet via kilde-re-tunen (§4.1)** så D3 median-net ≤ §2.2-målet i en *no-engangs*-konfiguration. Engangs er rent additiv agency i Fase 2 — et lille hold der hamstrer i stedet for at investere må stadig ende på ≤ §2.2-mål alene pga. re-tunet indkomst + blød upkeep.
- **Livscyklus-skift:** engangs tørrer ud (når alt er købt), afløses af løbende upkeep (§3.1) når holdet vokser. Sink-sammensætning skifter "mest frivillig engangs (lille hold)" → "mest løbende upkeep (stort hold)".

### 3.3 Ingen transfer-skat (bevidst fravalg)
Ejer valgte A+B, ikke C. **Risiko:** det dominerende *reelle* sink i dag er køb fra AI/bank-puljen (−89,1M auktions-debits vs. +0,5M til menneske-sælgere). Hvis et dybt menneske-til-menneske-marked udvikler sig, kollapser det sink. **Overvåges i scorecardet (§6); en lille levy kan tilføjes senere hvis kurven kræver det.**

### 3.4 Eksisterende sinks (bevares)
- **Løn** — frossen ved signering (`= round(market_value × 0.067)`), rate i `economyConstants.js:93`, debit i `economyEngine.js:436-488`.
- Lån-rente, negativ-balance-rente, squad-bøder — uændrede medmindre §5 rører dem.
- **Squad auto-sale** (`squadEnforcement.js:209-233`) skriver en `finance_transactions`-row (`auto_squad_sale`, +market_value) — så den driver *ikke* balance-vs-ledger-drift, men den **minter market_value uden modpart** (inflations-problem, ikke drift-problem). Asymmetrisk vs. auto-purchase (`squadEnforcement.js:149-207`, markup 1,5× `:61`). Fanges af aggregat-konserverings-tjekket (§6.6), ikke per-team-drift.

## 4. Sources + sponsor (kilde-siden)

### 4.1 Re-tune (skal ske uanset — Fase 1, den primære anti-inflations-løftestang for bunden)
Sponsor + præmiepenge er de to store kilder. Når nye sinks lægges ind, **re-tunes kilderne** så hver division rammer sit progressive net-mål (§2.2) i no-engangs-konfigurationen:

- **Sponsor-base** (`economyConstants.js:15`, i dag D1 600k / D2 400k / D3 260k) — justeres mod målet.
- **Præmiepenge** (`economyConstants.js:35`, `points × 1500` — dagens største hane) — justeres.
- **Performance-puljen** (`sponsorEngine.js:11,45-84`, 0-150k capped, S2+) forbliver **capped → ingen auto-eskalering**.
- **Frontend co-SSOT'er skal opdateres i SAMME PR (ikke passive spejle):** `frontend/src/lib/expectedPrizeCalculator.js:10` erklærer sig selv SSOT for `PRIZE_PER_POINT`; `frontend/src/lib/marketValues.getRiderSalary` for løn. Verificér desuden om Finance-forecast (**#986**) hardcoder sponsor-base — hvis ja, tilføj til sync-listen.

### 4.2 Forhandlbare sponsorer (Fase 2-3)
Erstatter den abstrakte beregnede base ved at **omfordele inden for den capped per-division-konvolut** — forhandling ændrer *sammensætningen* (sikker base vs. performance-bonus), ikke det samlede beløb. Kan derfor aldrig bryde pengemængde-kurven.

**Konvolut + clamp-rækkefølge (præcisering):** konvolutten defineres på **pre-modifier gross**. Den endelige udbetaling = `gross × board_modifier (0,80-1,20) × pullout` og **clampes på FINAL payout** (§5.1), så board-modifieren ikke kan presse en forhandlet kontrakt forbi loftet. Board-modifier og forhandlet komposition former begge samme payout og må ikke double-counte (§8 board-interaktion).

**Kontrakt-model:**
- **Arketyper** (ejer-eksempler): *Sikker* (høj base, lav bonus, 3 sæsoner, ingen krav) · *Ambitiøs* (lav base, høj resultat-udløst bonus, 1 sæson) · *Prestige* (høj base+bonus, adgangs-gated på top-3 sidste sæson, falder ved exit af top-5).
- **Kerne-akse:** risiko/reward (garanteret base vs. ambitiøs performance-bonus).
- **Lag:** varighed (1-3 sæsoner) + prestige/adgangskrav.

**Mekanik (faset):**
- **Fase 2:** *vælg-blandt-tilbud* — 3-4 genererede tilbud ved kontrakt-udløb, spilleren vælger ét.
- **Fase 3:** *modbuds-forhandling* — modbyd på base↔bonus / varighed / beløb mod hårdere krav.

**Data-model (ny tabel, Fase 2 — migration → ejer merger):**
- `sponsor_contracts`: UUID PK, `team_id` FK ON DELETE CASCADE, `archetype` TEXT, `base_income` INT, `bonus_max` INT, `bonus_objectives` jsonb NOT NULL DEFAULT, `duration_seasons` INT, `signed_season` INT, `eligibility` jsonb, `status` TEXT CHECK, COMMENT på tabel+kolonner.
- **Access-model (skal besluttes nu):** player-facing → **RLS + authenticated-policy keyed på team-ownership** (mønster: `database/player-events.sql:28-43`) + `GRANT SELECT` på player-læste kolonner (jf. MEMORY column-privilege-grant). Backend-only → `board_consequences`-mønster (ingen RLS, service_role).
- **Offer-model (vælg nu, ikke Fase 3):** persistér tilbud/draft i en `sponsor_offers`-row (eller draft-kolonne) **frem for** ren deterministisk regenerering — Fase-3-modbud kræver persisteret draft-state, og "ingen tabel"-valg i Fase 2 ville tvinge en migration-redo i Fase 3.

**Transition (Fase 2, eksisterende hold — skal specificeres):** `sponsor_contracts` lander efter relaunch på en population uden contract-rows. Plan: **behold den beregnede model som aktiv kilde indtil hvert holds næste kontrakt-udløb**, og generér første tilbuds-runde der; alternativt backfill hvert billable hold med en default-archetype-kontrakt der matcher dets nuværende division-konvolut. Vælg backfill-variant + definér `signed_season`/varighed ved mid-season-introduktion. Opdatér samtidig fallback-stien (`sponsorEngine.js:114-124`) så den ikke divergerer fra konvolutten.
**Board-interaktion (#8):** board-profiler snapshotter `plan_start_sponsor_income` (`economyEngine.js:846,870`) og dømmer performance mod det → renegotiering mid-board-plan kan spuriøst opfylde/bryde en plan. Beslut: frys board-baseline ved plan-start uanset kontrakt-ændring, ELLER recompute board-target ved ny kontrakt.

## 5. Håndhævelse

### 5.1 Clamp sponsor-loftet (Fase 1)
- **Loftet er division/sæson-afhængigt, ikke fast 900k:** 900k = D1 S2+ gross (600k base + 150k pool) × 1,20. Ved **S1/intro** capper D1 gross ved 600k → 600k × 1,20 = **720k**, så clampen rører intet ved relaunch.
- **Clampen er en forward-guard** mod fremtidige re-tunes/board-modifier-bypass, ikke en present-bug-fix. Billig; beholdes i Fase 1.
- **Clamp på FINAL payout** (`gross × board_modifier × pullout`), ikke på gross — i dag findes ingen clamp i `computeSponsorForSeason`/`processSeasonStart` (modifier anvendt `economyEngine.js:230`).

### 5.2 Hård gældsbund #97 (Fase 1)
**Problem (#97):** når et hold ikke kan betale sin lønregning ved sæson-start, auto-udsteder spillet et nødlån (`loanEngine.js:326` `createEmergencyLoan`). Den **soft** check (`loanEngine.js:344-353`) håndhæver ikke et hårdt loft → et insolvent hold låner mere hver sæson, renter (20%) compounder, frisk balance mintes uden bund.

**Løsning:** gør den soft check **hard**: nægt/cap nødlåns-udstedelse så `currentDebt + newLoan ≤ debt_ceiling`. **Afklar loft-kilden:** `createEmergencyLoan` læser `emergency`-typens ceiling = **1,5M flat på tværs af divisioner** (`database/seed-relaunch-rehearsal.sql:78-80`), IKKE short/long 1,2M/900k/600k. At køre 1,2M hard floor + 1,5M emergency-cap samtidig er selvmodsigende (nødlån kan lovligt minte 300k forbi bunden). → align emergency-ceiling til division-loftet i samme pass.

**Konsekvens ved bunden = eskalerende:**
1. **Transfer-fryse** — kan ikke købe/byde før gæld < bund.
2. **Tvunget salg** — kun hvis gæld består over **2 sæsoner**: auto-sælg dyreste rytter indtil over bunden. Skriver `finance_transactions`-row (ny `reason_code`, §3.1/§7).

**Breach-streak (2 sæsoner) kræver persistens** — en kolonne/tabel (ikke en CHECK-constraint), migration (§7).

**#45 (relateret):** mange små lån > loft. Den atomiske guard shippede allerede i 07b (`create_loan_atomic` RPC + `pg_advisory_xact_lock`, `loanEngine.js:224-255`; app-fallback `getTotalDebt`→insert `:257-282`). Resterende gap = en ægte **DB-CHECK-constraint**, ikke et uguardet race. *(Tidligere `~L125`-citat var forkert — det er `processLoanAgreementSeasonFees`, urelateret.)*

### 5.3 Blød tuning på resten
Source/sink-magnitude + rate-ladders forbliver **scorecard-drevet tuning** (§6). Ingen hårde clamps udover §5.1-5.2.

## 6. Validering — simulate-before-ship

### 6.0 Kalibrerings-metode (så tal ikke er metodeløse placeholders)
Alle load-bearing tal fastsættes via en **eksplicit konvergens-procedure** mod live-population + syntetisk S2-projektion, med start-kandidater (analogt til E2's `strict_fair_v1`):
- **Upkeep-ladder + sponsor/præmie-base:** løs numerisk så **D1 net = 0 (±5%)** og **D3 net ∈ [0, +30k]** i no-engangs-konfig. Start-kandidat: behold E2's sponsor (600/400/260k), introducér upkeep-ladder D1≈250k/D2≈110k/D3≈30k pr. sæson, justér præmie-per-point indtil net-målene holder.
- **§2.1 mål-kurve:** median ≤ **1,3× start ved sæson 5**.
- **§6.3 absorptions-mål:** sinks absorberer **≥ 90%** af tilbagevendende sources pr. sæson.
Hver konstant får et start-kandidat-tal + en accept-bound i implementerings-planen; det endelige tal er det der består gates 6.1-6.7.

### 6.1-6.7 Nyt `moneySupplyScorecard` (multi-sæson, billable real teams §2.6)
1. **Total pengemængde** over N sæsoner vs. §2.1 mål-kurve — **PASS/FAIL headline** (mens §6.7 er dormant, jf. flag-state).
2. **Median + mean balance-trajektorie** pr. division — bekræft §2.2 net-mål. **Inkl. eksplicit D3-net PASS/FAIL** (blocker-fix: D3-loopet skal lukke i Fase 1 uden engangs).
3. **Source/sink-ledger split** pr. sæson — assert sinks ≥ 90% af tilbagevendende sources.
4. **Gini-koefficient** af balancer over tid — rich-get-richer-vagt; må ikke stige.
5. **Nødlåns-trigger-count + total nødlåns-gæld** pr. sæson — assert bounded (validér §5.2). Hard target som `economyContractSimulation` (0 insolvent efter S1, ≤50% behøver nødlån).
6. **Aggregat-konserverings-invariant** — to tjek: (a) per-team drift `abs(balance − (800000 + sum(tx.amount)))` (genbrug `GET /api/admin/economy-health`, `routes/api.js:6507-6580`, STARTING_BALANCE `:6319`, drift `:6555-6556`); (b) **NYT aggregat:** `sum(alle human credits) − sum(alle human debits)` over tid → fanger market_value-mint (squad-auto-sale §3.4) som per-team-drift *ikke* kan se.
7. **Kontant-vækst < værdi-vækst-ratio** — udvid `valueDevelopSellScorecard` med ægte PASS/FAIL-gate. **Dormant hvis `SEASON_VALUE_RECALC_ENABLED=false`** (værdier statiske → triviel) → mål da mod *projiceret* værdi-vækst, eller markér dormant og brug §6.1 som headline. Afklar flag-state (§8) FØR success-kriterier låses.

**Disciplin:** kør mod live-population (read-only key) **og** syntetisk S2-projektion (rigtige S2-data under 0.067-løn findes ikke endnu — flag som projektioner). Wire ind i `balance:check` CI-gate. **Fix først den stale `15000`-sim-kommentar** (`economyBaselineSimulation.js:14,197` — SSOT er 1500).

## 7. Fasering & sekvensering

- **Fase 1 — skal lande + deployes FØR `relaunchSeason1 --apply`** (ellers bager friske hold gamle tal ind → re-seed):
  - Kanonisk filter-align (§2.6) + løbende upkeep (§3.1) + source re-tune (§4.1) + 900k-clamp (§5.1) + #97-gældsbund + emergency-ceiling-align (§5.2) + #45 DB-CHECK + `moneySupplyScorecard` (§6).
  - **Fase-1-migrationer (HVER er `database/*.sql` → ejer-merge-only, materielt for 2-4-dages-vinduet):**
    1. Hård gældsbund DB-CHECK / enforcement + emergency-ceiling-align (§5.2).
    2. Ny `reason_code`/`actor_type`-enum-værdi for upkeep + forced-sale (`economyConstants.js:96-98` CHECK-constraints; INSERT fejler på prod uden).
    3. Persistens for 2-sæsoners breach-streak (kolonne/tabel).
    4. #45 DB-CHECK-constraint.
- **Fase 2:** forhandlbare sponsor-kontrakter — *vælg-blandt-tilbud* (§4.2, ny `sponsor_contracts` + offer-persistens + transition-backfill, migration → ejer merger) + engangs-investerings-feature (§3.2).
- **Fase 3:** modbuds-forhandling (§4.2) oven på persisteret draft-state.

**Mekaniske rammer (ikke-omsættelige):** enhver `database/*.sql` auto-applies i prod ved merge → **ejer merger** · økonomi-konstanter (løn frossen INT) rammer kun populationen via relaunch re-seed · frontend co-SSOT'er (§4.1) synkes i samme PR · `GAME_INVARIANTS.md` opdateres (clamp-rækkefølge, nye sinks, gældsbund) · patch notes + help/FAQ (en+da).

## 8. Åbne spørgsmål / risici

- **`SEASON_VALUE_RECALC_ENABLED` / `SEASON_RIDER_PROGRESSION_ENABLED` = false** (`economyConstants.js:80,85`) — **afklares før Fase-1 tal-tuning** (kritisk vej): bestemmer om §6.7-gaten er live eller dormant, og om upkeep-tier (§3.1) eller værdi-baseret skalering er meningsfuld. Antagelse indtil ejer siger andet: **begge OFF i Fase 1**.
- **Engangs-hamster-risiko:** mitigeret ved at Fase 1 lukker D3-loopet via kilde-re-tune (§3.2), ikke via engangs. Valideres i §6.2.
- **Ingen levy → AI-pulje-sink-kollaps-risiko** (§3.3) hvis menneske-marked vokser. Overvåges.
- **Ingen rigtig S2-population endnu** → kontrakt-balance + net-per-sæson er projektioner indtil live.
- **Værdi-baseret upkeep feedback-loop** (§3.1) — løst ved tier-skalering; hvis værdi-input senere ønskes, kræver lag/smoothing + §6-assertion mod auto-eskalering.
- **`updateRiderValues` har intet team-filter + ingen ledger-backing** (`economyEngine.js:1279-1383`) — ubacket værdi-skabelse; bevidst værdi-sink-løftestang eller bug?
- **Squad auto-sale market_value-mint** (§3.4) — luk asymmetrien som del af konserverings-invarianten?
- **`loan_config` seed-provenance** — base rente/fee-rows ikke i tracked migration; bekræft seed-kilde.

## 9. Nøglefiler

- `backend/lib/economyConstants.js` — SSOT-konstanter (sponsor :15, INITIAL_BALANCE :19, præmie :35, løn-rate :93, finance enums :96-98, flags :80/:85)
- `backend/lib/sponsorEngine.js` — sponsor-model (performance-pulje :11/:45-84, fallback :114-124)
- `backend/lib/economyEngine.js` — sæson-orkestrering (billable-filter :188-189, modifier-apply :230, løn-debit :436-488, academy-debit-mønster :520-553, board-baseline :846/:870, kapacitets-filter :1482-1484, `updateRiderValues` :1279-1383)
- `backend/lib/loanEngine.js` — #97 nødlån (`createEmergencyLoan` :326, soft-check :344-353), #45 atomisk guard (:224-255, fallback :257-282, `getTotalDebt` :168), renter :509-563
- `backend/lib/squadEnforcement.js` — auto-sale :209-233, auto-purchase :149-207, markup :61
- `backend/routes/api.js` — economy-health (route :6507, drift :6555-6556, STARTING_BALANCE :6319)
- `backend/scripts/economyBaselineSimulation.js` (stale 15000-kommentar :14/:197) + `valueDevelopSellScorecard.js` — harness-startpunkter
- `frontend/src/lib/expectedPrizeCalculator.js:10` (PRIZE_PER_POINT co-SSOT) + `marketValues.getRiderSalary`
- `database/` — `seed-relaunch-rehearsal.sql:78-80` (loan ceilings), `player-events.sql:28-43` (RLS-mønster)
- `docs/GAME_INVARIANTS.md` — sponsor-clamp, præmie 1500, finalization-paths
- Epic: [#1441](https://github.com/NicolaiDolmer/CyclingZone/issues/1441) · forgænger: [2026-06-15-okonomi-korrekthed-design.md](2026-06-15-okonomi-korrekthed-design.md) · merged interim: PR #1438 / #1440
