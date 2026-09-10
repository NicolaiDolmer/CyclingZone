# Bestyrelses-reglerne — SSOT

> **Læs denne FØR enhver opgave der rører bestyrelsen: tilfredshed, mål, planer, forhandling,
> konsekvenser, bonustilbud eller bestyrelsens kobling til sponsorøkonomien.** Hard rule 30
> ([#4221](https://github.com/NicolaiDolmer/CyclingZone/issues/4221)) · områdedokument oprettet under
> [#4266](https://github.com/NicolaiDolmer/CyclingZone/issues/4266).
>
> Bestyrelsen er en af ejerens 10 kernefunktioner og havde indtil 29/8 intet SSOT-dokument.
> Denne fil skelner mellem gældende regler, bygget kode og godkendt fremtidigt design.
> **Aktuel rework-status og hvad der bliver/udgår: læs §0 først.** Mandat-modellen
> er fortsat i **beta** (prod-læst 10/9); Boardroom og årsmødet er bygget, og
> skyggemodellen skriver data. Ældre målinger i §1-8 er historiske, ikke nutidsbevis.
>
> Sponsorsiden bor i [`SPONSOR_RULES.md`](SPONSOR_RULES.md). Grænsen mellem de to er §5, og den er
> selve grunden til at begge filer findes. Økonomiens øvrige regler: [`ECONOMY_RULES.md`](ECONOMY_RULES.md).
>
> Verificeret mod kode og prod 29/8; §1.1, §4's checkpoint-afsnit og §7 række 9 er verificeret på ny
> 31/8 under [#4382](https://github.com/NicolaiDolmer/CyclingZone/issues/4382). §6 og §7 række 3 er
> målt på ny 6/9 (#4837, #4838, #4839). Beslutnings-arkæologi:
> [`audits/2026-08-29-sponsor-board-decision-inventory.md`](audits/2026-08-29-sponsor-board-decision-inventory.md).

---

## 0. Mandatet: samlet overblik, verificeret 10/9 2026

**Anledning:** ejerens GDD-samtale 10/9: hvad er planlagt til at blive, og hvad udgår?
**Kilder:** ejer-spec 7/8 + addendum 1/9, den nyere ejerretning om overblik/faner i
PR #4844, kode ved `3759ab2e639ffcb3f4888e105338a97aad63484e`, GitHub-issues/PR'er
læst 10/9 og read-only Supabase-måling 10/9 kl. 08:48 Europe/Copenhagen.
Dette afsnit afløser ældre STATUS-påstande nedenfor, ikke de uændrede mekanikregler.

### 0.1 Hvad bliver, erstattes og flyttes?

| Del | Godkendt slutbillede for det eksisterende rework | Kilde/bevis |
|---|---|---|
| Tre parallelle planer og satisfaction-tal | Erstattes af én relation med confidence, ét årligt mandat og langsigtede visions-milepæle | Spec 7/8 §3; `boardMandate.js`, `boardMandateEngine.js` |
| Managerens forhandling | Ét årsmøde med fokusvalg, Easier/Keep/Stretch, anmodning og underskrift; mid-season/ekstraordinær samtale består som retning | Spec §3.2-3.3; `boardMandateMeeting.js`; `annualMeeting/AnnualMeetingPage.jsx`; PR #4656/#4661 |
| Navngivne medlemmer og mål-ejerskab | Bevares og får stemme, kvitteringer, referater og medlemsvisning | Addendum 1/9 A3; `boardVoice.js`, `BoardCard.jsx`; PR #4558 |
| Langsigtede mål | Bliver visions-milepæle med oprindelige frister; tidligt opnået milepæl fejres straks, nyt slot-forslag ved næste årsmøde | Addendum 1/9 A7 afløser spec'ens venten til målsæsonen for tidlig opfyldelse |
| Sponsorsamtale | Flyttet til egen Sponsors-side; den økonomiske kobling til bestyrelsens tillid består | §5; merged PR #4843; `SponsorsPage.jsx`, `App.jsx` |
| Bonustilbud | Bevares i Boardroom; bonusmålet skrives også til mandatet | Merged PR #4844; `boardBonusGoal.js`, `api.js::applyAcceptedBonusGoal`; #4856 lukket |
| Klub-DNA | **Bevares med eksisterende DNA-pakker.** Valg/genvalg er flyttet med til Boardroom; reworket leverer ikke en fri identitetsmodel | `BoardroomPage.jsx::chooseDna`, `DnaChoiceCard`; `boardClubDna.js`; PR #4844 |
| Faner | De gamle 1/3/5-års-planfaner udgår; den nyere Boardroom har Overview, Mandate, Vision, Board | PR #4844; `BoardroomPage.jsx::TABS`. Den gamle formulering "ingen faner" er afløst |
| Fyring, hårdt game over | Fortsat fravalgt. Bestyrelsens eksisterende konsekvenslag bevares i reworkets kontrakt | §1, §4; spec 7/8 §2.5 |
| Gammel BoardPage | Fallback under beta/rollback; planlagt slettet efter stabil fuld aktivering | `BoardroomRoute.jsx`; [#4858](https://github.com/NicolaiDolmer/CyclingZone/issues/4858) |

### 0.2 Hvad er faktisk leveret og aktiveret?

- **Kode/merge-bevis:** PR #4841 (skrivning i beta), #4842 (nye hold + sæsonskifte),
  #4843 (Sponsors-side), #4844 (Boardroom med bonus/DNA) er alle MERGED på GitHub.
  Boardroom og årsmødets ruter samt komponenter findes på ovenstående kode-HEAD.
- **Produktionsflag:** `board_mandate_model_enabled = 'beta'`, målt 10/9. Fladen er
  dermed ikke aktiveret for alle. `featureStage.evaluateFlagStage` tillader beta
  for berettigede seere og for `engineWrite`; `off` lukker begge.
- **Positiv skriveevidens:** 239 `board_relations`; seneste opdatering
  `2026-09-09 14:08:56.989+00`; seneste kvittering med `mandate_id`
  `2026-09-09 14:08:57.112041+00`. Der er 12.866 mandatkvitteringer siden 6/9 UTC.
  Påstanden om fortsat frysning siden 1/9 er afløst. Tallene beviser aktivitet,
  ikke korrekthed af hver evaluering eller dækning af alle berettigede hold.
- **Mandatstatus, samme læsetjek:** 237 `active`, 2 `proposed`. Dette er ikke
  et bevis for et gennemført årsmøde eller fuld visuel/end-to-end-verifikation.
- **Hjælp og kommunikation:** #4855 er lukket; Mandatet-hjælp findes i en+da,
  og `docs/drafts/patch-note-mandate-flip.md` + `discord-mandate-flip.md` er
  udarbejdet til aktiveringen. Udkastene er ikke publiceringsbevis.

### 0.3 Resterende releasearbejde, ikke nye designvalg

[#4859](https://github.com/NicolaiDolmer/CyclingZone/issues/4859) er fortsat åben
og ejer selve beta-til-alle-flippet. Dens forudsætninger omfatter:

- #4855 og #4856 er **lukkede**, sponsor/Boardroom-PR'erne er **merged**.
- #4857 er **åben**: kontrollér dagens berettigede hold og den nødvendige backfill.
  Det gamle antal manglende hold er ikke genmålt her og må ikke genbruges som nutidstal.
- Sæson 4-forudsætningen (#4270), et aktuelt dry-run/scorecard, samlet verifikation
  og særskilt ejer-go består. Denne GDD-session har ikke givet aktiverings-go.
- #4858 er oprydning **efter** stabil aktivering, ikke en før-flip-blokering.

Issue #3514 er åben. Dens statuskommentar fra 7/9 om at fase 2 ikke er bygget
stemmer ikke med merged PR'er og kode. Brug dette overblik og de konkrete
rest-issues frem for de historiske fasecheckbokse. Der er ikke lavet runtime-
ændringer, migrationer eller udsendt spillerkommunikation i denne gennemgang.

### 0.4 Ny designretning fra GDD-samtalen 10/9

Ejeren har efterfølgende valgt disse principper; de er **ikke endnu en detaljeret
erstatning for det byggede DNA-, mål- eller konsekvenssystem**:

- **D-001:** en talentfabrik kan være en selvstændig langsigtet succesvej uden
  hyppige store løbssejre som nødvendigt slutmål.
- **D-002:** managerens frit kombinerede ambitioner skal fylde mest i identiteten,
  suppleret af omdømme og identitet gennem handlinger. De fem DNA-pakker er ikke
  den ønskede eneste fremtidige model.
- **D-003:** bestyrelsen udfordrer planens kvalitet **inden for managerens valgte
  retning**. Den kræver troværdig fremgang, men gør ikke automatisk en talentfabrik
  til et titelprojekt. Kravene skal stadig være meningsfulde.
- **D-009:** manageren kan frit begynde et strategisk kursskifte. Modstanden kommer
  fra faktiske investeringer, trup, kontrakter og optjent omdømme; der lægges ikke
  en særskilt skiftepris/ventetid oveni alene for at binde identiteten. Erklæringen
  sletter ikke aftalte forpligtelser. Konkrete regler for genforhandling og
  overgangen fra den eksisterende DNA-genvalgslås skal stadig designes.

Begrundelser og ejerens svar: [GDD-beslutninger](design/gdd/DECISIONS.md).
Før et konkret redesign: afklar målbare succeskriterier, modstand/konsekvenser,
omdømmets kilder og forholdet til eksisterende mandater. Ingen nye bonusser,
frister, vægte eller migrationsregler er vedtaget. Dette er en ny designretning,
ikke en skjult ændring af scope for de allerede godkendte releaseopgaver.

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

## 6. Mandat-modellen (#3514): historisk status og migrationsregler

**Aktuel status står i §0.** Tabellen og auditnoterne nedenfor bevarer den tidligere
diagnose og begrundelser; skyggeskrivning, Boardroom og årsmøde er siden leveret.

Ejer-godkendt 7/8 med 10 låste beslutninger. Erstatter tre planer med **én relation** (`confidence`
0-100), **ét årligt mandat** (3-5 mål) og en **vision** af milepæle med målsæson.

**Faktisk tilstand, målt 6/9 (audit):**

| | Status |
|---|---|
| `board_mandate_model_enabled` | **`beta`** siden 17/8 12:35 (ikke `off`) |
| Hvem ser beta | Kun admin/beta-testere. Prod: 0 brugere med `is_beta_tester=true`, 1 admin: beta har haft **én mulig seer** |
| `board_relations` | 237 rækker: 232 af 234 menneskehold (2 hold oprettet 2/9 og 3/9 mangler); 128 AI-hold har by design ingen. `max(updated_at)` = 2026-09-01 15:42:55, rebuild 1/9, **ingen skrivning siden** |
| Hvorfor motoren ikke skriver | Cron-kaldet kører uden `isBetaTester`-kontekst, så beta-flaget aldrig evaluerer sandt for skrivevejen. `board_mandates`: 237, alle `season_number = 3`, status `active`, 0 `proposed` | #4839 |
| `proposeMandateForNewTeam` | **Ingen kaldsti i produktion**, kun `advanceMandateAtSeasonEnd` er wiret i `economyEngine.js::processTeamSeasonEnd`. Nye hold får aldrig et skyggemandat | #4837 |
| `advanceMandateAtSeasonEnd` | Lukker det aktive mandat FØR den opdager at næste sæson mangler. Sæson 4 findes ikke i `seasons` (#4270) | #4838 |
| Tørkørsel 5/9 (`proposeNextMandateDryRun.js`) | 237 hold simuleret: 176 får 5 mål, 61 får 4. Tillidstrappe: 122 trusted / 108 standard / 7 strained. Auto-accept: 141 hold à 5 dage, 96 à 10 dage |
| Flader der forsvinder ved flip | Sponsor-forhandling (`SponsorOfferModal`, #4265, flytter til egen Sponsors-side), bonustilbud (`BonusOfferCard`, 20 aktive lag-6-tilbud i S3), klub-DNA-valg (7 hold uden DNA): findes kun i den gamle `BoardPage.jsx` |
| Årsmødet (S-M2c) | 0 produktions-evidens. Alle 237 mandater står `active`, 0 `proposed` |
| Issue-label | `claude:done`, stadig med tomme fase-checkbokse |

**Daværende rækkefølge før flip (ejer 6/9):** backend → Sponsors-side → Boardroom
med bonus/DNA → hjælp og kommunikationsudkast → særskilt aktiverings-go.
Backend og de nævnte flader er nu merged, hjælp/udkast leveret; aktuel rest i §0.3.
S4 i DB kører som eget spor efter kalenderpakkeren (`TRAINING_RULES.md` §13).

**Opdateret 6/9 (#4837 + #4838) — to huller i motorens kaldstier lukket:**

1. **Nye hold fik aldrig relation/mandat (#4837).** `proposeMandateForNewTeam` og
   `ensureRelationForTeam` var skrevet, testet og eksporteret, men INGEN produktionssti kaldte dem
   (afsnittet ovenfor påstod fejlagtigt at ny-holds-hooket var wiret ved sæson-slut — det var kun
   `advanceMandateAtSeasonEnd`, og den kræver en EKSISTERENDE relation). Alle 237 relationer stammede
   derfor fra engangs-scriptet `mandateShadowRebuild3514.mjs` (1/9); to hold oprettet 2/9 og 3/9 havde
   5 bestyrelsesmedlemmer og en `board_profile`, men 0 relation, 0 mandat, 0 milepæle. Ny
   `boardMandateEngine.js::ensureMandateForTeamFormation` er nu holddannelsens ene indgang, kaldt fra
   `boardMembers.js::chooseDnaForTeam` (spillerens DNA-valg) og
   `boardAutoAccept.js::autoAcceptPendingPlan` (cron'ens auto-valg). Fail-safe (kaster aldrig) og
   idempotent. Backfill for de allerede fødte hold:
   `backend/scripts/backfillMandateForTeamsWithoutRelation.js` (dry-run default, `--apply --owner-go`).
2. **Sæsonskiftet lukkede mandatet før det opdagede at næste sæson manglede (#4838).**
   `advanceMandateAtSeasonEnd` kaldte `completeActiveMandate` FØR `proposeNextMandate`, som springer
   over med `target_season_not_found` når sæson-rækken ikke findes. Målt 5/9: sæson 4 er ikke
   materialiseret, så sæsonskiftet 27/9 ville have efterladt 237 hold med et `completed` mandat og
   intet nyt — og `boardRoom.js` læser kun `status = 'active'`. Guarden (`findNextSeason`,
   `seasonLookup.js`) ligger nu FØR lukningen: findes sæsonen ikke, er sæsonskiftet en ren no-op for
   mandatet. **Uafhængigt krav står stadig: sæson 4 skal i DB før 27/9 (#4270).**

**Flag-note (midlertidig):** `isBoardMandateModelEnabled` accepterer nu `{ engineWrite: true }`, så
motoren skriver skyggedata i stage `beta` uanset om den enkelte manager er beta-tester (ejer-go 6/9).
Afløses af #4839, der skiller skrive-gaten fra læse-gaten permanent.

Ejer-valg 4 af 7/8 er stadig bindende uanset flagets tilstand: **mål-bonusser og -straffe udbetales
kun i tillid.** Penge forbliver i lag 6 og modifieren.

---

## 7. Kendte åbne modsigelser

**Historisk auditliste.** Nutidsstatus for reworket står i §0. Særligt række 1 er
afløst af sponsor_growth-fixet i §3; række 2 af det genåbnede epic; række 3 af den
verificerede skyggeskrivning. Øvrige rækker er ikke genverificeret som del af GDD-opstarten.

| # | Modsigelse | Bevis |
|---|---|---|
| 1 | **`sponsor_growth` er umuligt at opfylde** og har været det for alle 135 profiler der bar det. Ejer-beslutning 7/8 om at rette det er ikke bygget | §3, målt 29/8 |
| 2 | **#3514 bærer `claude:done`** mens fase 2 ikke er flippet for spillerne (flaget står `beta`, 0 reelle seere). Label-tilstanden lyver om leverancen | `gh issue view 3514` |
| 3 | **Skyggemodellen er frosset siden rebuild 1/9 15:42** og driver længere fra `board_profiles` for hver dag. Rod-årsag fundet 6/9: cron-kaldet kører uden `isBetaTester`-kontekst, så beta-flaget aldrig evaluerer sandt for skrivevejen. Ingen vagt måler afstanden | §6, #4839 |
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
