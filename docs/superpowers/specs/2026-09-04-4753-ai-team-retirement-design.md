# AI-hold nedlægges i stedet for at slettes (#4753)

**Dato:** 2026-09-04 · **Refs:** #4753, #4233, #2377, #4286, #2074, #2389, #2187, #2407, #4592
**Status:** design — implementering bag flag `ai_team_retire_enabled` (default OFF), reparation kræver ejer-GO.

## 1. Problemet, målt

Read-only mod prod 4/9 (`league_divisions` + `teams` + `transfer_offers`):

| Pulje | Hold | AI | Ægte | `pending_removal_at` |
|---|---|---|---|---|
| 8 (D4-A) | **25** | 16 | 9 | 1 |
| 10 (D4-C) | **25** | 16 | 9 | 1 |
| 11 (D4-D) | **25** | 16 | 9 | 1 |
| 15 (D4-H) | **25** | 17 | 8 | 1 |

16 AI-hold har `transfer_offers`-rækker der blokerer en hard delete; **13 af dem er blokeret
udelukkende af døde tilbud** (withdrawn/accepted/rejected). 3 har levende tilbud
(Borealis Development, Aero Devo, Domestik Pro Team). Døde rækker forsvinder aldrig →
de 13 er permanent utrimbare.

**Nyt fund:** `backend/scripts/audit-league-size-invariant.js` ekskluderer hold med
`pending_removal_at != null` (#2639). Alle 4 overfyldte puljer har præcis ét markeret hold,
så auditen tæller dem som 24 og **står grøn på præcis den overtrædelse den blev bygget til
at fange**. Det er derfor ingen alarm gik i august.

Rod-årsagen er ikke FK'en. Rod-årsagen er at trimmen **hård-sletter**. Enhver tabel der
peger på et AI-holds ryttere eller hold-række kan blokere sletningen, og der er kommet en
ny hver måned siden juli (#2074 race_entries, #2389 race_results/præmier, #4233
transfer_offers). Vælger man FK-semantik pr. tabel (#4233's A/B/C), løser man én tabel og
venter på den næste.

## 2. Designet: nedlæggelse

Et AI-hold **nedlægges** i stedet for at slettes. Ingen `DELETE` på `teams` eller `riders`
i trim-stien overhovedet. Så kan intet fremtidigt FK nogensinde blokere den igen.

### 2.1 Hold-tilstanden

Ny kolonne `teams.retired_at timestamptz` (additiv, `IF NOT EXISTS`, nullable, ingen
destruktiv klasse). Nedlæggelse skriver i ÉN update:

```
retired_at = now(), league_division_id = null, pending_removal_at = null
```

`league_division_id = null` er selve pulje-exiten. Det er **ikke** en ny mekanik: det er
præcis den `parkTeam` (#4592) allerede bruger, og som #4183 etablerede — "occupancy tæller
kun hold med `league_division_id = pool.id`". Kolonnen er den kanoniske pulje-nøgle i alle
tællere jeg fandt (§3), så puljen falder til 24 i samme øjeblik.

**Hvorfor ikke genbruge et eksisterende felt:**
- `parked_at` (#4592) betyder "menneske-manager væk, holdet er urørt og kan komme tilbage".
  `selectTeamsToPark` gater på `isHumanTeam` — semantikkerne må ikke blandes.
- `pending_removal_at` betyder "burde trimmes, men er udskudt". Den skal blive ved med at
  betyde det, fordi heal-sweep'ens budget-gate (#2407) hviler på den. Nedlæggelse **rydder**
  markøren, den overtager den ikke.

### 2.2 Rytterne — A/B

**A (anbefales): rytterne pensioneres med holdet.** `is_retired = true, team_id = null`,
plus `closeTransferListingsForRiders` + `withdrawOpenTransferDealsForRiders` +
`clearFutureRaceEntriesSafe` — nøjagtigt den kæde `retirementRelease.js` (#2748) og
`legacyRiderRetirement.js` allerede bruger.

- *Fordel:* spilleren ser **præcis** det samme som i dag (rytterne forsvinder fra
  rytterdatabasen, markedet, rankings, løbsudtagelse), fordi alle de læsere allerede
  filtrerer `is_retired` (§3). Rækkerne bevares, så `transfer_offers`/`race_results` beholder
  levende FK-mål. Ingen ny semantik — to eksisterende call-sites lander på samme tilstand.
- *Omkostning:* `is_retired` kommer til at betyde både "for gammel" og "holdet lukkede".
  Rytteren kan ikke genoplives uden en eksplicit rollback-sti.
- *Alternativ:* B.

**B: rytterne frigives som frie agenter** (`team_id = null`, aktive). *Fordel:* intet tab af
spillebart materiale. *Omkostning:* 13 hold × 20 ryttere = **~260 ryttere ville lande i
markedet på én gang** — en mærkbar økonomisk begivenhed spillerne ikke har bedt om, og en
adfærdsændring i forhold til i dag hvor de forsvinder. Det er en ejer-beslutning, ikke en
bugfix.

**Valg: A.** Den bevarer data uden at ændre spillet. B kan altid tages senere som et
selvstændigt produktvalg.

### 2.3 Guards — hvilke overlever

De tre eksisterende blokeringer var alle FK-/korrekthedsguards mod **sletning**. Under
nedlæggelse er FK-argumentet væk, så hver enkelt skal begrundes på ny:

| Guard | Under nedlæggelse | Hvorfor |
|---|---|---|
| Inflight race_entries (#2074) | **beholdes** — udskyd | Et hold midt i et etapeløb skal køre løbet færdigt; feltet må ikke skifte under et kørende løb. |
| Uudbetalte præmier (#2389) | **beholdes** — udskyd | Payout og standings-recalc læser holdet; nedlæggelse midt i det giver samme kollision som #2389. |
| `transfer_offers`, **levende** (pending/countered/awaiting_confirmation) | **beholdes** — udskyd | En spiller står midt i en forhandling. At lukke holdet under ham er dårlig oplevelse, ikke en FK-fejl. |
| `transfer_offers`, **døde** (withdrawn/accepted/rejected) | **bortfalder** | Den eneste grund til at de blokerede var `DELETE`. Der er ingen DELETE mere. |

Det er hele fixet for de 13 hold: blokeringen var aldrig et spilproblem, kun et
sletnings-problem. `ACTIVE_MARKET_STATUSES` fra `transferExecution.js`/`marketUtils.js`
(pending/countered/awaiting_confirmation) er den delte definition af "levende" — ikke en ny liste.

## 3. Læsere jeg fandt (grep på tabelnavne, ikke funktionsnavne)

**Pulje-optælling — alle nøgler på `league_division_id`, alle falder til 24 straks:**
`aiTeamGenerator.generateAndAllocateAiTeams` (`t.league_division_id === pool.id`),
`aiTeamGenerator.reconcileAiTeamsForPool` (`.eq("league_division_id", pool.id)`),
`aiTeamTrimHealSweep.defaultGetPoolTrimBudgets` (`.in("league_division_id", poolIds)`),
`managerParking.parkTeam` (samme mekanik), `api.js:10897` (admin pyramide-oversigt,
springer `league_division_id == null` over), `poolBalance.js`, `pyramidCompression.js`,
`audit-league-size-invariant.js` (`continue` ved `league_division_id == null`).
Ingen tæller pr. `teams.division` — den kolonne bruges kun til kvalitets-/benchmark-opslag.

**Rytter-flader — alle filtrerer allerede `is_retired`:** `/api/riders` (rytterdatabasen,
`.eq("is_retired", false)`), `marketUtils.getTeamMarketState` (trup-cap),
`riderEligibility.applyRiderEligibilityFilter` (løbsudtagelse), `raceEntriesLoader`,
`raceRunner`, `riderProgressionEngine`, `dailyTrainingEngine`, `marketValueSundaySweep`,
`scoutMissionMaturation`, `poolBalance`, `auctionRules`/`auctionFinalization` (#2918),
`squadEnforcement.findCheapestAvailableRiders` (#2748-guarden),
`api.js` physiology-benchmark (`or("is_retired.is.null,is_retired.eq.false")`),
`ownershipInvariantWatch`, `academyGraduation`, `aiContractAutoRenewal`.

**AI-sweeps der læser `is_ai = true` bredt — skal have `retired_at` som ny diskriminator:**
`aiRecoverySweep` (kandidat-query; dens `recoverRidersForTeam` filtrerer allerede
`is_retired`, så effekten er kun en tom tick-række pr. dag pr. nedlagt hold — men filtret
tilføjes, samme lektie som #4592's `starterSquadHealSweep`-adoption),
`aiTeamTrimHealSweep` (kandidat-query), `aiTeamGenerator.clearAllAiTeams` (relaunch-wipe),
`squadEnforcement.findCheapestAvailableRiders` (AI-ejede købskandidater — et nedlagt holds
ryttere har `team_id = null` og er `is_retired`, så de falder allerede ud).

**Standings/historik:** `season_standings` og `race_results` læses pr. `team_id`; holdrækken
består, så attributionen bliver *bedre* end i dag (hvor `race_results.team_id` SET NULL'es
og visningen falder tilbage på det denormaliserede `team_name`).

## 4. Reparation nu

`backend/scripts/retire-stuck-ai-teams.js --dry-run` (read-only, service-key) lister pr. pulje
hvilke hold der ville nedlægges, valgt i **samme deterministiske id-orden** som
`removeAiTeams`, begrænset af samme pr.-pulje-budget (`aiCount - targetAi`) som #2407's
guard. Puljerne 8/10/11/15 ender på 24. Apply kræver eksplicit `--apply` **og** ejer-GO.

## 5. Forward-guards

1. **Ingen DELETE i trim-stien.** Test der asserter at en fake supabase-klient aldrig ser
   `.delete()` på `teams`/`riders` når `ai_team_retire_enabled` er tændt.
2. **Auditen skal kunne se >24 igen.** `pending_removal_at`-eksklusionen bindes til
   `STALE_BACKSTOP_HOURS` (120t, samme definition som heal-sweep'ens stale-detektion): et
   hold der har været markeret længere end backstoppen tælles **med** i invarianten. Det er
   præcis de 4 nuværende hold (markeret 28/8), så auditen ville have været rød.
3. Flag `ai_team_retire_enabled` (app_config, `featureStage` tre-tilstand, fail-safe OFF)
   — samme mønster som `auto_prize_enabled`/`rider_values_bulk_write_enabled`.
