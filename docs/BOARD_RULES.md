# Bestyrelses-reglerne — SSOT

> **Læs denne FØR enhver opgave der rører bestyrelsen: tilfredshed, mål, planer, forhandling,
> konsekvenser, bonustilbud eller bestyrelsens kobling til sponsorøkonomien.** Hard rule 30
> ([#4221](https://github.com/NicolaiDolmer/CyclingZone/issues/4221)) · områdedokument oprettet under
> [#4266](https://github.com/NicolaiDolmer/CyclingZone/issues/4266).
>
> Bestyrelsen er en af ejerens 10 kernefunktioner og havde indtil 29/8 intet SSOT-dokument.
> Denne fil beskriver **hvad der kører i dag**, ikke hvad der er besluttet. De to er ikke det samme:
> Mandat-modellen (#3514) er ejer-godkendt 7/8, migreret 23/8 og **slukket** — se §6.
>
> Sponsorsiden bor i [`SPONSOR_RULES.md`](SPONSOR_RULES.md). Grænsen mellem de to er §5, og den er
> selve grunden til at begge filer findes. Økonomiens øvrige regler: [`ECONOMY_RULES.md`](ECONOMY_RULES.md).
>
> Verificeret mod kode og prod 29/8; §1.1, §4's checkpoint-afsnit og §7 række 9 er verificeret på ny
> 31/8 under [#4382](https://github.com/NicolaiDolmer/CyclingZone/issues/4382). Beslutnings-arkæologi:
> [`audits/2026-08-29-sponsor-board-decision-inventory.md`](audits/2026-08-29-sponsor-board-decision-inventory.md).

---

## 1. Modellen der kører i dag

Et hold har **op til tre parallelle bestyrelsesplaner** (`board_profiles`): 1-årig, 3-årig og 5-årig.
Hver har sit eget `satisfaction`-tal (0-100), sine egne mål og sin egen `budget_modifier`.

Målt i prod 29/8: 680 profiler, heraf 618 `completed`. For S3: 176 × 1yr, 39 × 3yr, 21 × 5yr.

**Det er rod-årsagen til en hel fejlklasse.** Tre tal for samme relation har givet mindst otte
forekomster af kontekst-drift og tæller-mismatch siden maj (#2469 → #2592 → #2596, #3095, #3141,
#3144, #3494, #4377). Mandat-modellen (§6) blev designet for at afskaffe det.

**Grundregler der aldrig har ændret sig:**
- **Bestyrelsen fyrer aldrig.** Ingen game-over-tilstand (ejer 7/7, #2237).
- **Blød kalibrering.** Konsekvenser strammer, de dræber ikke.
- **Manager-only.** AI-hold har ingen bestyrelsesrelation.
- **Styrke straffes aldrig** — gælder også her.

**Rettet 31/8 (#4382):** bulletten "Sæson 1 er observationsår. Ingen konsekvenser, kun referat" stod
her indtil nu og er forkert. `economyEngine.js:1632-1642` bærer ejer-beslutning #1721 af 22/6:
**sæson 1 er IKKE en observations-sæson.** Rigtige planer (5yr/3yr/1yr) evalueres fuldt fra sæson 1,
satisfaction bevæger sig og `budget_modifier` afledes med fuld effekt. Kun `is_baseline`-profiler
springes over. Den eneste reelle sæson-1-beskyttelse der findes i koden er lag 2's 30-dages grace for
nye managere (`NEW_MANAGER_SALARY_CAP_GRACE_DAYS`), som er distinkt fra #1721.

### 1.1 Plan-livscyklussen

Verificeret mod kode og prod 31/8 under #4382. Dette var det hul §7 række 8 pegede på.

| Fase | Hvad sker der | Kode |
|---|---|---|
| Løbetid | Planen løber `getPlanDuration(plan_type)` sæsoner (1/3/5). `seasons_completed` tælles op ved hver sæson-slut, og `cumulative_stage_wins` / `cumulative_gc_wins` akkumulerer på tværs af planens sæsoner | `boardGoals.js:29`, `economyEngine.js:1659-1661` |
| Midtvejs-review | `isMidReview = !planIsComplete && seasons_completed === Math.floor(planDuration / 2)` → 3yr efter 1 sæson, 5yr efter 2. Sender én notifikation (`notif.boardMidReview.*`). **Ingen konsekvens knyttet til** | `economyEngine.js:1664, 1851-1879` |
| Udløb | `planIsComplete = seasons_completed >= planDuration` → planen **udsættes ikke**. `negotiation_status` sættes til `pending`, `seasons_completed` og begge cumulative-tællere nulstilles, og plan-vinduet rulles frem | `economyEngine.js:1663, 1761-1776` |
| Genforhandling | Obligatorisk. En `pending` plan tæller **ikke** med i `computeBoardBaseModifier`, der kun midler `completed`-planer, så en overset flerårsplan falder ud af sponsor-modifierens gennemsnit | `sponsorEngine.js:193-202` |

**Gen-underskrivnings-lås (ejer-valg 1/9, #3575/#4377):** `getBoardRenegotiationLock`
(`boardRequests.js`) blokerer `/board/sign` + `/board/renew` for en `completed` 3yr/5yr-plan
**ubetinget**, uanset indeværende sæsons fremdrift — den kan først gen-underskrives når
`negotiation_status` er flippet til `pending` (dvs. planperioden reelt er fuldført). Før 1/9
tjekkede låsen kun sæson-fremdrift, så en aktiv, ikke-udløbet flerårsplan kunne gen-underskrives
tidligt i en ny sæson og nulstille `seasons_completed`/`cumulative_*_wins`/
`plan_start_season_number` midt i planperioden (re-roll-hul). 1yr-planer er uændrede: de udløber
hver sæson, så same-sæson-vindue/progress-reglerne er fortsat deres eneste lås.

**De tre planer er uafhængige.** `board_profiles` har præcis én række pr. (team, plan_type). Målt
31/8: 236 × 1yr, 222 × 3yr, 223 × 5yr, med `count(distinct team_id)` lig `count(*)` for hver type.
Forhandlingsstien tager `board.plan_type` som parameter (`boardRequests.js:131, 516`), så en
1-årsforhandling kan ikke røre 3- eller 5-årsmålene.

**Genforhandlings-pukkel målt 31/8:** 44 × 1yr, 9 × 3yr, 6 × 5yr står i `pending`.

---

## 2. Tilfredshed → penge

```
satisfaction ≥ 80  →  modifier 1,20
             ≥ 60  →           1,10
             ≥ 40  →           1,00
             ≥ 20  →           0,90
             ellers →          0,80
```

`boardEvaluation.satisfactionToModifier`. Den **effektive** modifier for et hold er
**gennemsnittet af alle `completed` planers `budget_modifier`** (`economyEngine.js:288-292`) — ikke
den højeste, ikke den 1-årige. Et hold med tre planer på 1,20 / 1,10 / 1,00 kører på 1,10.

Målt fordeling 29/8: **D1 1,188 · D2 1,171 · D3 1,099 · D4 1,022** (laveste i spillet: 0,83).
Fordelingen er ikke tilfældig — et hold der lige er rykket op har pr. definition haft en god sæson.

**Hvor modifieren rammer:** kun den garanterede sponsor-base ved sæsonstart, og (fra
implementeringen af §3 i SPONSOR_RULES) divisions-tillægget. Løbsdags-indtægt, resultat-bonusser og
signing-bonus er **rå**.

Tilfredsheds-bevægelsen: `satisfactionDelta = round((adjustedOverallScore − expectation) × 55)`,
hvor `expectation` afhænger af bestyrelsens personlighed.

Bevægelser logges i `board_satisfaction_events` — 1.313 events for 217 hold på transitionsdagen
23/8, og løbende derefter (270 events for 94 hold 29/8). **At HVER bevægelse producerer et event er
ikke verificeret:** `boardWeekendFinalization.js` skriver dem, men hverken `boardEvaluation.js` eller
`economyEngine.js` indeholder tabelnavnet, så sæson-slut-stien er ikke bekræftet som logget.
"Kvittering for alt" er et bindende designprincip fra Mandat-spec'en — ikke en verificeret egenskab
ved den model der kører i dag.

---

## 3. Mål

15 måltyper findes i `boardGoals.js`:

`top_n_finish` · `relative_rank` · `stage_wins` · `gc_wins` · `jersey_wins` · `monument_podium` ·
`min_riders` · `min_u25_riders` · `min_national_riders` · `u25_development_delta` ·
`signature_rider` · `no_outstanding_debt` · `profitable_transfers` · `sponsor_growth` ·
`domestic_dominance`

Mål genereres af `generateBoardGoals` ud fra fokus × klub-DNA × dynamisk kalibrering.
`sponsor_growth` filtreres bort for 1-årige planer (#1267: sponsorindkomst kan ikke flyttes inden
for én sæson).

**Én måltype er i praksis stadig et skelet:**

- **`domestic_dominance`** er et skelet uden implementering. Mandat-spec'en §3.6 siger det skal
  afsluttes eller slettes.

~~**`sponsor_growth` kunne matematisk aldrig opfyldes**~~ **Rettet 2/9 (PR #4550, #3494/#4377):**
målet regnede `(currentSponsorIncome − planStartSponsorIncome) / planStartSponsorIncome`, hvor
begge sider læste `teams.sponsor_income` — en kolonne der aldrig opdateres efter sæson 1 (målt
29/8: 240.000 for alle 230 hold). Målet er nu re-pointet til ægte `sponsor_contracts`-udbetalinger
(kontrakt-base + løbsdags-indtægt, `finance_transactions` via `SPONSOR_GROWTH_REASON_CODES`,
`boardGoalContext.js`), med baseline = planens første afsluttede sæson. Ingen baseline (plan-sæson
1) eller ingen måling → `awaiting_data`, aldrig et fallback til det døde felt.

---

## 4. De seks konsekvens-lag

Lag 1 lever i `board_profiles.budget_modifier`. Lag 2-6 lever i `board_consequences` og evalueres på
**to** checkpoints, ikke ét: ved mid-season-checkpointet
(`boardWeekendFinalization.js:471-473` kalder `evaluateAndApplyConsequences` når
`race_days_completed` netop har krydset `floor(race_days_total / 2)`) og igen ved sæson-slut
(`economyEngine.js`). Rettet 31/8 under #4382: den gamle formulering "evalueres ved sæson-slut" er
grunden til at bonustilbuddets timing føles tilfældig for spillerne.

| Lag | Konsekvens | Udløser | Detalje |
|---|---|---|---|
| 1 | Sponsor-modifier | løbende | ±20 %, §2 |
| 2 | Lønloft | tilfredshed < 40 | Loft = lønsum × 1,5, gulv 5.000. **Strammes aldrig** under en tidligere sat cap. 30 dages grace for nye managere |
| 3 | Signerings-restriktion | < 30 | Køb over **300.000 CZ$** kræver bestyrelsens godkendelse |
| 4 | Tvangslistning | < 15 | Beskytter ryttere med popularitet ≥ 70 eller stjerne-værdi |
| 5 | Sponsor-pullout | < 10 **eller** 2× planudløb i træk under 30 % | Faktor **0,90**, stacker multiplikativt med lag 1. Varer én sæson |
| 6 | Bonustilbud | **> 75** (strengt, `isBonusOfferEligible` afviser `satisfaction <= 75`) **og** mindst 75 % af mål nået | **200.000 CZ$**. Bestyrelsens eneste egne penge. Berettigelsen tjekkes **pr. plan**, så alle tre plantyper kan udløse tilbuddet, men højst ét pr. hold pr. sæson (`expires_at_season_id`-guard). Det accepterede ekstra-mål lægges **altid** på 1-årsplanen, uanset hvilken plan der udløste tilbuddet (`api.js:15125-15145`). **Rettet 5/9 (#3574):** ekstra-målet (`signature_rider` eller `monument_podium`, `selectBonusExtraGoal`) er en beholdning, ikke en handling — uden en baseline ville et hold der allerede kvalificerede sig (sandsynligt, da netop det er tilbuddets forudsætning) se målet opfyldt i samme sekund det blev tilføjt. Accept-routen fastfryser nu holdets stjerne-antal/podie-sum PÅ ACCEPT-TIDSPUNKTET som `baseline` på goal-objektet; `evaluateGoal`/`evaluateGoalProgress` (`boardGoals.js`) kræver NETTO +target oveni baseline for disse to typer når feltet er sat — DNA-tradition-mål af samme typer bærer aldrig `baseline` og er uændrede |

Lag 2-3 håndhæves i transfer- og auktions-routes via `assertSigningAllowed`. Lag 5 hookes ind i
`processSeasonStart`s modifier-stak og udløber automatisk ved sæsonskifte.

---

## 5. Adskillelsen — kontrakten mellem de to systemer

> Ejer-direktiv 25/8 ([#4265](https://github.com/NicolaiDolmer/CyclingZone/issues/4265)):
> *"I sæson 3 skal bestyrelsen og sponsorere adskilles i ui."*
>
> **UI kan ikke adskille det der ikke er adskilt i modellen.** Dette afsnit er forudsætningen.

### 5.1 Sætningen

**EN:** *Your sponsor decides the size of the deal. Your board decides whether you get more or less
of it than agreed — up to 20 % either way.*

**DA:** *Sponsoren bestemmer aftalens størrelse. Bestyrelsen bestemmer om du får mere eller mindre
end aftalt — op til 20 % hver vej.*

Den tidligere formulering, *"sponsor = penge, bestyrelse = tillid"*, er **ikke sand** og har aldrig
været det. `MAX_BOARD_MODIFIER = 1,20` betyder at bestyrelsens tillid ganger sponsorens penge, og
ejer-beslutningen 29/8 om at lade divisions-tillægget gå gennem samme modifier styrker koblingen.
Valget var derfor mellem at fjerne koblingen eller lave sætningen om. **Koblingen bliver; sætningen
er lavet om.** Begrundelse: modifieren er den eneste mekanisme der gør bestyrelsens tilfredshed
mærkbar uden at indføre en ny pengestrøm, og ejer-valg 4 af 7/8 forbød netop nye pengestrømme.

### 5.2 Hvem ejer hvilket håndtag

| Håndtag | Ejer | Manageren påvirker det ved |
|---|---|---|
| Aftalens størrelse (`renownTarget`) | **Sponsor** | at vinde løb — division + resultat-historik |
| Split mellem garanti og løbsdage | **Sponsor** | at vælge arketype |
| Kontraktlængde og klausuler | **Sponsor** | at vælge arketype |
| Divisions-tillægget | **Sponsor** | at rykke op |
| Løbsdags-indtægt | **Sponsor** | at stille til start |
| Resultat- og målbonusser på kontrakten | **Sponsor** | at vinde etaper og nå sæsonmålet |
| **Budget-modifier ±20 %** | **Bestyrelse** | at nå bestyrelsens mål |
| **Sponsor-pullout −10 %** | **Bestyrelse** | at undgå at falde under 10 % tilfredshed |
| **Bonustilbud 200.000** | **Bestyrelse** | at nå ≥ 75 % af målene med ≥ 75 % tilfredshed |
| Lønloft, signerings-restriktion, tvangslistning | **Bestyrelse** | tilfredshed |

**Læseregel:** sponsoren betaler for hvad klubben **er** og hvad den **gør**. Bestyrelsen justerer
udbetalingen efter om den **stoler på manageren**. Sponsoren kender ikke dine bestyrelsesmål;
bestyrelsen kan ikke ændre din kontrakt.

### 5.3 De koblinger der skal væk før UI kan adskilles

| # | Kobling | Skal blive eller gå | Hvorfor |
|---|---|---|---|
| 1 | Budget-modifier ganger sponsorpengene | **Blive** | Ejer 29/8. Sætningen i §5.1 forklarer den |
| 2 | Loftet defineres af `MAX_BOARD_MODIFIER` | **Blive**, men omdøbes i kode og tekst | Det er et *sponsor*-loft; at det er kalibreret mod bestyrelsens maksimum er en implementationsdetalje, ikke en regel spilleren skal læse |
| 3 | Sponsor-pullout er en bestyrelses-konsekvens på sponsor-penge | **Blive** | Den er den hårde ende af samme modifier-akse |
| 4 | Bestyrelsen har et **sponsor-vækstmål** | **GÅ** — eller bygges færdig | I dag umuligt at opfylde (§3). Så længe det findes, blander det de to systemer på den værst tænkelige måde: et bestyrelsesmål der måler sponsoren og altid siger 0 |
| 5 | **Sponsorforhandlingen bor på `/board`** (`BoardPage.jsx:2822` CTA + `:3152` modal) | **GÅ** | Den direkte, mekaniske årsag til at spillerne blander systemerne sammen. Designet 21/6 kaldte det "hybrid"; i praksis betyder det at sponsoren ikke har nogen egen flade |
| 6 | Bestyrelsessidens tilfredshedsmåler forklarer sig selv med **sponsor-modifieren** (`BoardPage.jsx:655`) | **BLIVE, men vendes om** | Det er den rigtige forklaring på det forkerte sted. Den hører hjemme som "hvad din tillid gør ved sponsorudbetalingen", ikke som målerens undertekst |

**Rækkefølgen er bindende:** #4 og #5 skal løses før UI-adskillelsen (#4265) kan bygges. #4 er en
korrekthedsfejl; #5 er en flytning der kræver at sponsoren får sin egen flade at flytte til.

---

## 6. Mandat-modellen (#3514) — godkendt, migreret, slukket

Ejer-godkendt 7/8 med 10 låste beslutninger. Erstatter tre planer med **én relation** (`confidence`
0-100), **ét årligt mandat** (3-5 mål) og en **vision** af milepæle med målsæson.

**Faktisk tilstand, målt 29/8:**

| | Status |
|---|---|
| `board_mandate_model_enabled` | **`off`** siden 17/8 12:35 |
| `board_relations` | 217 rækker, oprettet 23/8 18:38, **ikke opdateret siden** |
| `board_mandates` | 217, alle `season_number = 3`, status `active` |
| `board_vision_milestones` | 2.059 |
| `team_board_members` | 1.085 (5 pr. hold) |
| Backup | `backup_board_profiles_3514_20260823`, 649 rækker |
| Fase 2 (Boardroom-side, årsmøde) | Boardroom-siden (S-M2b) + årsmødets **backend** (S-M2c, #4557) findes nu bag flaget. Frontend-mødet (`/board/meeting`-UI'et) er en separat, senere worker (S-M2c-frontend) |
| Issue-label | `claude:done` — med tomme fase-checkbokse |

**Opdateret 3/9 (#4557, S-M2c a+b):** `boardMandateEngine.js::advanceMandateAtSeasonEnd` og
`::proposeMandateForNewTeam` er nu wiret ind i `economyEngine.js::processTeamSeasonEnd` (efter
`applySeasonEndSync`, samme fail-safe try/catch-disciplin) — næste sæsons mandat foreslås (status
`proposed`) automatisk ved sæson-slut for hold der har en skyggerelation. `GET/POST /board/meeting/*`
(§4.8 i slice-spec'en) + en ny 30-min-cron (`boardMandateAutoAccept.js`) er bygget, alt stadig
flag-gated. **Dette ændrer IKKE tabellen ovenfor:** `board_mandate_model_enabled` er stadig `off`,
og de 237 aktive mandater rammes først ved sæson-slut 27/9 (S3→S4), hvor det første rigtige årsmøde
opstår automatisk — se `backend/scripts/proposeNextMandateDryRun.js` for tørkørslen ejeren skal se
FØR flip.

**Konsekvensen af at flippe flaget i dag:** `boardMandateEngine.js` er den eneste runtime-skriver af
`board_relations`, og den er flag-gated. Skyggemodellen har derfor stået stille i seks dage mens
`board_profiles` er kørt videre. Et flip nu ville vise spillerne et tillidstal fra 23/8 og et mandat
uden S3-fremgang. **Flaget kan ikke flippes uden at skyggedata først genopbygges.**

Ejer-valg 4 af 7/8 er stadig bindende uanset flagets tilstand: **mål-bonusser og -straffe udbetales
kun i tillid.** Penge forbliver i lag 6 og modifieren.

---

## 7. Kendte åbne modsigelser

| # | Modsigelse | Bevis |
|---|---|---|
| 1 | **`sponsor_growth` er umuligt at opfylde** og har været det for alle 135 profiler der bar det. Ejer-beslutning 7/8 om at rette det er ikke bygget | §3, målt 29/8 |
| 2 | **#3514 bærer `claude:done`** mens fase 2 ikke findes og flaget er slukket. Label-tilstanden lyver om leverancen | `gh issue view 3514` |
| 3 | **Skyggemodellen er frosset siden 23/8** og driver længere fra `board_profiles` for hver dag. Ingen vagt måler afstanden | §6 |
| 4 | **Hvorfor flaget blev sat `off` 17/8 kan ikke findes** — hverken i commits eller issue-tekst. Fem dage før den migration det gater | inventaret §5 |
| 5 | **Tre satisfaction-tal, ét gennemsnit.** Spillerne ser tre tal på bestyrelsessiden og ét i økonomien. Rod-årsag til mindst 8 rapporterede fejl | §1 |
| 6 | **`domestic_dominance` er et dødt skelet** der stadig kan genereres | §3 |
| 7 | ~~**#4377: flerårsmåls-tællere ignorerede historik** (trøjer 0/2, sponsor 0/8 → 0/12)~~ **Lukket 5/9:** trøjer rettet af PR #4549 (kode: `sprint_kommerciel`-DNA'ens jersey_wins-tradition-mål er nu altid `cumulative:true`) + `database/2026-09-01-4377-jersey-wins-cumulative-repair.sql` (data, applied 1/9, post-verify OK). Sponsor-indkomst rettet af PR #4550 (§3, samme dag som #3494 blev lukket — sponsor_growth måler nu ægte `sponsor_contracts`-udbetalinger, ikke det døde `teams.sponsor_income`-felt). Sejre var allerede sit eget spor (#3948, PR #4046, 21/8). Re-audit 5/9 mod prod (`backend/scripts/audit-4377-board-goal-counters.js`): 0 af 120 aktive jersey_wins-mål stadig unflagged | #4377, #4549, #4550, #4046, #3948 |
| 8 | ~~**#4382:** plan-livscyklussen er udokumenteret~~ **Lukket 31/8:** livscyklussen står nu i §1.1, og spiller-siden i `help.json` → `sections.board.multiYearLifecycle` (EN+DA). Afsnittet skal opdateres ved #3514 fase 2, jf. #3522 | §1.1, #4382 |
| 9 | **`expireSeasonScopedConsequences` er død kode.** Funktionen findes i `boardConsequences.js:167` og testes i `boardConsequences.test.js:968`, men kaldes **ingen steder** i produktionsstien. Lag 5 udløber via en separat inline-update (`economyEngine.js:471`); **lag 6 udløber aldrig**. Målt 31/8: 37 bonustilbud står stadig `active` på sæson 1 og 2, som begge er `completed`. Et hold kan i princippet stadig indløse et to sæsoner gammelt tilbud til 200.000 CZ$. Ikke rettet her: et fix fjerner penge fra 37 hold og er en ejer-beslutning | `boardConsequences.js:167`, målt 31/8 |

---

## 8. Bestyrelsesmedlemmer (`team_board_members`)

Hvert menneskehold (`is_ai=false`) har **altid 5 bestyrelsesmedlemmer** (`TEAM_BOARD_MEMBERS_COUNT`,
`boardMembers.js`) — 3 identity-matched + 2 non-conflicting wildcards, én formand. Tildeles af
`assignBoardMembersForTeam` (idempotent: no-op hvis holdet allerede har 5), enten første gang en
manager vælger Klub-DNA (`chooseDnaForTeam`, `POST /board/dna-choose`) eller via
`regenerateBoardMembersForTeam` (DNA-genvalg, auto-accept, reparation).

**#4664 (2-3/9):** op til 40 menneskehold målt uden fuldt board — heraf en delmængde med
`team_dna_key` SAT men 0 rækker i `team_board_members`, en tilstand koden selv antog var umulig
(atomiske rollback-guards i to af tre `chooseDnaForTeam`-grene). Rod-årsag:
`regenerateBoardMembersForTeam` slettede holdets rækker FØR den indsatte det nye sæt — to separate,
ikke-transaktionelle Supabase-kald. Fejlede insert'et efter delete'et var committet (transient
netværksfejl, dobbelt-indsendelse, et deploy der dræbte processen midtvejs), stod holdet permanent
uden bestyrelse: `requiresBoardDnaChoice` (`season_1_identity_basis && !team_dna_key`) er `false` når
DNA allerede er sat, så DNA-vælgeren — den eneste sti der (gen)tildeler — vises aldrig igen. Fixet:
`regenerateBoardMembersForTeam` gemmer nu det gamle sæt før delete og gendanner det best-effort hvis
re-insert fejler (aldrig værre stillet end før kaldet). Backfill: `repairMissingBoardMembers.js`
(dry-run default, `--apply` skriver via `assignBoardMembersForTeam`). Forward-guard: invariant F i
`ownershipInvariantWatch.js` (daglig, read-only, Sentry-capture med fast fingerprint
`human-team-without-board-members`). Postmortem:
`.claude/learnings/2026-09-03-new-teams-without-board-members.md`.

## Kildedokumenter

- `superpowers/specs/2026-08-07-board-mandate-rework-design.md` — de 10 ejer-beslutninger er gyldige;
  §3-5 beskriver en model der er migreret men slukket. Læs den som plan, ikke som tilstand.
- `slices/09-board-mandate-rework-MASTER.md` — faseplanen. Fase 0's #3494 er ikke leveret.
- `slices/02-board-redesign-MASTER.md` — konsekvens-lagenes oprindelse (Appendix C).
- `audits/2026-06-20-board-mechanics.md`, `audits/2026-06-14-board-goal-calibration-findings.md` —
  kalibrerings-grundlaget for mål og tærskler.
- `ECONOMY_RULES.md` §6 — bestyrelsens økonomiske dele, nu udfoldet her.
