# Race-motorens regler — SSOT

> **Læs denne FØR enhver opgave der rører motoren, ruter, taktik eller resultater.** Ejer-direktiv 25/8 2026 ([#4221](https://github.com/NicolaiDolmer/CyclingZone/issues/4221)): *"Det må ALDRIG NOGENSINDE ske, at du ikke bruger et SSOT-dokument, når vi rent faktisk har lavet et."*

Reglerne lå spredt over **25 design-dokumenter**. Denne fil er nu kilden. Ændrer du en værdi, ændrer du den i den fil tabellen peger på — og opdaterer denne i samme PR.

---

## 0. De to kontrakter (den hyppigste fejlkilde)

Motoren har to frosne grænseflader. De må ikke forveksles, og ingen af dem må udvides uden ejer-go.

| Kontrakt | Hvad den er | Hvor den bor |
|---|---|---|
| **`StageInput` / `StageOutput`** | Motorens rene ind/ud. Én deterministisk funktion: `simulateStageV4(input) → output` | `types.ts` i engine-pakken — **den fil er kontraktens SSOT** |
| **`TeamOrder`** | Hvad spilleren har bedt om. Snapshotes ved lock og stemples ind i `StageInput.orders` | [`2026-08-21-race-tactics-orders-v1-design.md`](superpowers/specs/2026-08-21-race-tactics-orders-v1-design.md) §Ordre-kontrakten |

**Kernen kræver aldrig ordrer.** Adapteren oversætter fravær til neutrale defaults. AI-hold genererer `TeamOrder` gennem præcis samme type — ingen side-kanaler.

**Tre udfaldsklasser, ikke to.** `StageResult.status` er `finished` · `abandoned` · **`otl`** (uden for tidsgrænsen, ejer-beslutning 6/9 — se §2d). De tre er gensidigt udelukkende, og klassement og flip-mapping skal kunne skelne dem: en `abandoned` nåede aldrig målstregen, en `otl` gjorde men for sent. Feltet er additivt udvidet i `types.ts`; hvad flip-laget skal gøre med `otl` står i samme fil og i `mechanics/timeLimit.ts`.

---

## 1. Rolle-vokabularet (kanonisk, ikke til forhandling)

Fem værdier. De er defineret i den frosne kontrakt — `backend/lib/engine/v4/types.ts:35`:

```ts
export type RiderRole = "captain" | "sprint_captain" | "helper" | "hunter" | "free_role";
```

Samme fem står i `race_entries.race_role` og `race_stage_roles.race_role`, skrevet 69.962 gange i prod.

| Værdi | Spiller-facing EN | Hvad den gør |
|---|---|---|
| `captain` | Captain | Holdets beskyttede rytter |
| `sprint_captain` | Sprint captain | Leadout-toget arbejder for ham (M6) |
| `hunter` | Breakaway hunter | Prioriterer udbrud |
| `helper` | Domestique | Arbejder for kaptajnen |
| `free_role` | Free role | Ingen bundet opgave |

**Enhver flade der viser eller sætter en rolle bruger disse fem.** Opfind aldrig et sjette ord, og oversæt aldrig til et andet sæt i en ny flade. `race_stage_roles` udfases efter v4-flippet; `race_entries.race_role` består.

---

## 1b. Løbsdagens intention (ejer-beslutning 5-6/9, [#4632](https://github.com/NicolaiDolmer/CyclingZone/issues/4632))

Rollen svarer på *hvad er din opgave*. Intentionen svarer på *hvor hårdt går du efter den i dag*. Det er **ikke en ny akse** — det er det eksisterende `effort`-felt udvidet fra tre til fem trin. Rollen gælder hele løbet og er standard; intentionen vælges pr. etape, og "ikke valgt" betyder rollens standard (`normal`).

```
grupetto  <  save  <  normal  <  protect  <  all_out
```

De tre midterste er de oprindelige S3-værdier med **uændret navn og semantik** — eksisterende rækker og kode er upåvirkede. Oplæggets forslag om at omdøbe `save`/`protect` til `conserve`/`committed` blev **ikke** valgt.

**Hvor værdien bor.** Ét felt, to indgange, ingen ny tabel:

| Lag | Sted |
|---|---|
| Data | `race_stage_roles.effort` (v3, live) og `race_team_orders.riders[].effort` (v4-sporet, jsonb) |
| Vokabular | `backend/lib/raceRoles.js` — `VALID_EFFORTS_FIVE_STEP` / `validEffortsFor(flag)` |
| Kontrakt (v4) | `backend/lib/engine/v4/types.ts`'s `EffortLevel` + `ai/teamOrderContract.ts` — samme fem strenge 1:1 |
| Skrivevej | `PUT /api/races/:raceId/stage-roles` og `PUT /api/races/:raceId/team-orders/:stageNumber` |
| Launch-switch | `app_config.race_day_intention_enabled` (`backend/lib/raceIntentionFlag.js`), default off |

**Hvad intentionen koster (model C).** Den genbruger to mekanismer der allerede er live i v3 og opfinder ingen tredje: trætheds-belastningen efter etapen (`effortFatigueMultiplier`) og work-cost-prisen for roller der har en (`workCost`). Dertil en dormant krok på løbsdagens formudbytte (`applyRaceDevelopmentTick`), som først har en aftager når `race_day_development_enabled` (D2) tændes igen. `grupetto` er desuden udelukket fra udbruds-udvælgelsen — den har den største trætheds-besparelse mod ingen egen chance. v4's `effortDemandMultiplier` (M12) er den dybere fremtidige resultat-mekanik og arver det samme enum. **Præcise multiplikatorer står i koden, ikke her** (§4, offentlighedspolitik) — og de er startgæt indtil ejeren har set et dry-run-scorecard.

**Tre invarianter, property-testet i `backend/lib/raceIntention.test.js`:**

1. `all_out` koster **altid strengt mere** træthed end `normal`. Der findes ingen gratis all-out.
2. **Monotoni (§3 invariant 3) holder med intention aktiveret.** Inden for samme gruppe kan lavere evne på `all_out` aldrig slå højere evne på `all_out`. Intentionen er en multiplikator oven på evnen, aldrig et fortegns-skift.
3. **Work-cost bliver aldrig en bonus.** For enhver kombination af rolle × profil × de fem trin er prisen ≤ 0 og aldrig større end fuld pris. Loftet er en konstruktions-egenskab (`Math.min(0, …)`), ikke kun et testkrav.

**Fog of war.** API'et returnerer kun enum-værdien og det gyldige vokabular — aldrig multiplikatorer eller det tal et valg er værd.

**Rækkefølge før flippet** (oplæg §7): data-model + API bag flaget (off) → UI → dry-run-scorecard mod realistisk feltstørrelse → ejer-go → flip. Beslutningsgrundlag: `docs/superpowers/specs/2026-09-03-race-day-intention-decision.md`.

---

## 2. Mekanik-kataloget (ejer-godkendt 20/8)

Scope er lukket. En mekanik uden for listen kræver ejer-go, ikke en PR.

| # | Mekanik | Fase |
|---|---|---|
| M1 | Gruppedannelse + gruppe-tider + finale-opgør | F2 ✅ |
| M2 | Stignings-selektion | F2 ✅ |
| M3 | Nedkørsel v2 — monotoni-garanti, descent attack, risiko-koblet | F2 ✅ |
| M4 | Punch-finale — forspring bæres ind i finalen | F2 ✅ |
| M5 | Udbrud v2 + spiller-ordre, bounded bidrag | F3 ✅ wiret 3/9 |
| M6 | Sprint-tog, leadout-roller | F3 ✅ wiret 3/9 |
| M7 | Distance-slid: monument-effekt + dag-til-dag | F3 ✅ wiret 6/9 |
| M8 | Brosten-sektorer | F3 ✅ wiret 6/9 |
| M9 | Bonussekunder + spurt-/bjergpassager — bounded så bjerg dominerer GC | F3 ✅ wiret 6/9 — se §2g |
| M10 | Incidents + 3 km-reglen — graduerede styrt, mekaniske uden DNF | F3 ✅ wiret 6/9 |
| M11 | Vejr-lag pr. etape, seeded | F3 ✅ wiret 6/9 — se §2f |
| M12 | Effort pr. rytter (femtrins: `grupetto`/`save`/`normal`/`protect`/`all_out`) | F3 ✅ wiret 6/9 — trinnet ganges på kraftkravet, ikke på CP; `grupetto` er ude af udbruddet og tæller 0 W'-reserve i finalen |
| M13 | Holdtidskørsel — holdets tid er den k'te rytters passage | F3 ✅ wiret 6/9 — se §2h |
| M14 | AI-holds ordrer gennem samme type | F3 ✅ wiret 3/9 (harness) |
| M15 | Tidsgrænsen (UCI-reglen) + OTL som udfaldsklasse | F3 ✅ wiret 6/9 — se §2d |
| M16 | Holdspil — kaptajnen beskyttes, hjælperen betaler | F3 ✅ wiret 6/9 — se §2e |

**M13 stod ikke i tabellen før 6/9.** Kataloget lukkede 20/8 med M1-M14, men M13-rækken manglede i selve tabellen — mekanikken var bygget (`mechanics/teamTimeTrial.ts`, 17 grønne tests) og uden kaldssted, fordi den krævede et hold-id på rytteren. Det kom med M16 (§2e), og forgreningen er nu på plads.

**M15 og M16 er ejer-besluttede scope-udvidelser, ikke PR-tilføjelser.** Kataloget blev lukket 20/8 med M1-M14. Ejeren besluttede 4/9 at tidsgrænsen ([#2582](https://github.com/NicolaiDolmer/CyclingZone/issues/2582)) er et krav til v4 før flip — *"ikke i v3"* — og låste reglen 6/9. Den står i §2d. **M16** (holdspillet) står i §2e og hviler på samme grundlag: kataloget har ingen holdspils-post, men ejer-beslutning 1 (5/9, §9) gør "holdspil med hold-id på rytteren" til flip-minimum, fordi kaptajn-beskyttelsen og hjælperens pris ellers forsvinder ved flippet.

Tre nye stats er ejer-valgt ind (20/8) og fødes skjulte først: dagsform-stabilitet · vejr-teknik · højde-tolerance.

**Stående ordre (ejer 20/8):** foreslå løbende nye stats når motor- eller rutearbejdet gør dem meningsfulde.

---

## 2b. Etapetyper (`profile_type`) — motorens terræn-vokabular

Elleve værdier. De er defineret i `PROFILE_TYPES` (`backend/lib/raceStageProfileGenerator.js`)
og håndhævet af CHECK'en på `race_stage_profiles.profile_type`. Hver type har ÉN
`demand_vector` (hvilke evner dagen belønner) og ÉT sæt finale-vægte (hvordan den slutter)
— begge samme sted i samme fil, så de er ét sted at tune.

`flat` · `rolling` · `hilly` · `mountain` · `high_mountain` · `itt` · `itt_hilly` · `ttt` ·
`cobbles` · **`gravel`** · `classic`

Hvornår hver type opstår, og hvilken terræn-familie den tælles i, står i
[`CALENDAR_RULES.md`](CALENDAR_RULES.md) §5-§7b. Denne fil ejer hvad typen GØR ved løbet.

### Grus (`gravel`) — ejer-direktiv 21/8, ramme 3/9 ([#4105](https://github.com/NicolaiDolmer/CyclingZone/issues/4105))

Ordret 21/8: *"Terre di Toscana skal blive et grusvejs løb og ikke et brostensløb"*.
Ordret 3/9: *"det skal være næsten samme type der er god til den slags løb"* og
*"brostensevnen tæller kun på etaper med brosten/grus"*.

**Grus er sin egen type, ikke en etikette på brosten.** Det er dét der gør det muligt at
tælle den i brostensfamilien i kalenderens dækning uden at spillet holder op med at kunne
skelne de to. Fire ting definerer den:

| | Hvad der gælder | Hvorfor |
|---|---|---|
| **Rytterprofil** | brostensevnen er den tungeste dimension, som på brosten. Vægten der er taget fra den ligger på udholdenhed, punch/klatring og tilfældighed | ejer-rammen: næsten samme rytter skal vinde. Grusklassikeren er længere, mere nedslidende og mere lotteri-agtig, og den afgøres oftere på en kort stejl rampe |
| **Sektorer** | en grus-etape har **altid** mindst én sektor, og sektorerne er flere og længere end brostenens. `sectors[].kind = "gravel"` | ejer-reglen "brostensevnen tæller kun på etaper med brosten/grus" — en grus-etape uden sektorer ville lade den dominerende vægt hvile på ingenting |
| **Segmenter** | en grus-sektor bliver et **`cobbles`-segment** i v4. Segment-modellen er uændret | segmentet beskriver FYSIKKEN (løst/ujævnt underlag: lav læsgevinst, høj styrtrisiko, høj work-cost), og den er den samme. Underlaget står i `profile_type` og i `sectors[].kind` |
| **Finaler** | udbrud er det hyppigste udfald, rampe-finale det næsthyppigste, samlet gruppe mindretallet | grus bryder feltet tidligere end brosten, og den toscanske type afgøres på en rampe |

**RETTET (#4911): grus HAR sit eget bånd siden 3/9, det er kun `classic` der ikke har.**
Ejer-beslutning 3/9 (#4105/#4270, valg A) gav grus sit eget bånd i
`stageFinaleMetrics.js`'s `TERRAIN_FINALE_BANDS.gravel` (`up: [15,35], flat: [10,30],
break: [45,65]`, afledt af grusets egne finale-vægte), håndhævet af
`stageFinaleMetrics.test.js`. Denne fil sagde indtil 6/9 fejlagtigt "samme status som
classic" — kun `classic` mangler stadig et bånd (se boksen nedenfor). **Ude af scope for
denne PR** (uden for docs/scripts/baselines): kommentaren i
`raceStageProfileGenerator.js:173-178` gentager den samme stale påstand ordret ("gravel
staar - som classic - IKKE i ejerens baand-tabel... gater den ikke") og bør rettes i en
selvstændig, lille PR.

> ⚠ **`classic` bærer en brostens-vægt uden garanteret sektor-forsyning.** Grus opfylder
> ejer-reglen ved konstruktion; `classic` gør det ikke — den trækker 0-3 sektorer og får
> altså ingen i cirka en fjerdedel af tilfældene. At rette det er en balance-ændring
> (`classic` er monument-arketypen), ikke en oprydning, og den er ikke lavet.

Invarianterne for typen er property-testet i `backend/lib/gravelStageType.test.js` og
måler RELATIONER mod evne-fordelingen, ikke faste tal — [#4604](https://github.com/NicolaiDolmer/CyclingZone/issues/4604)'s
læring om at et scorecard der hænger på et absolut tal måler feltstørrelsen.

---

## 2c. Incidents — hvad koster hvad (M10)

To modeller lever side om side indtil v4-flippet: **v4's trappe** (den ejer-besluttede, gældende fremad) og **v3's binære model** (den spillerne møder i dag).

### v4 — trappen (ejer-beslutning 6/9, [#2944](https://github.com/NicolaiDolmer/CyclingZone/issues/2944))

Ejerens klage var at et styrt er et **binært totaltab**: enten sker der intet, eller også ryger rytteren ud af løbet med skadedage oveni. Varians uden mitigering opleves som uretfærdighed, ikke spænding. Trappen erstatter det binære med fire udfald:

| trin | hvad sker der | tid | skade | udgår |
|---|---|---|---|---|
| **1. let styrt** | rytteren rejser sig og kører videre | lille tidstab | nej | nej |
| **2. hårdt styrt** | han kommer i mål, men mærket | stort tidstab | dage | nej |
| **3. alvorligt styrt** | løbet er slut for ham. **Sjældent** | — | dage | **ja** |
| **4. mekanisk uheld** (punktering, kæde, hjul) | hjulskift eller cykelskift | tidstab | **aldrig** | **aldrig** |

To ting er absolutte:

- **Et mekanisk uheld kan aldrig tvinge nogen til at udgå og kan aldrig skade nogen.** Det er håndhævet af kontrolstrømmen i `resolveIncident` (`mechanics/incidents.ts`), ikke af et filter der kan glemmes: der findes præcis én gren der kan sætte skadedage eller udgåelse, og den ligger inde i styrt-grenen. Property-testet over 500 kombinationer.
- **En hjælper tæt på gør et mekanisk uheld billigere.** "Tæt på" = en anden, stadig kørende rytter i **samme gruppe** i det segment — gruppen *er* nærhedsmodellen i v4 — som enten har rollen `helper` **eller er holdkammerat**. Holdkammerat-halvdelen kunne ikke afgøres da M10 blev wiret 6/9, fordi `Entrant` ikke bar noget `team_id`; M16 landede feltet, og definitionen blev strammet det ene sted noten pegede på (`hasHelperNearby` i `mechanics/incidents.ts`). En holdkammerat tæller uanset rolle — også `free_role`: enhver holdkammerat rækker dig et hjul, og det er et andet spørgsmål end hvem der arbejder for holdet i dag.

**3 km-reglen beskytter tiden, ikke kroppen.** Et hårdt styrt inde på de sidste kilometer på en flad etape giver stadig skadedage — rytteren får gruppens tid, men han er lige så forslået. Et alvorligt styrt udgår uanset km-mærket: en rytter der ikke kører over stregen kan ikke få gruppens tid.

**Hyppighed.** Ejerens mål er ca. **1-2 % af rytterne pr. etape**. To ting bærer det: risikoen skaleres **pr. km** (ikke pr. segment, så rutemodellens granularitet ikke bestemmer raten), og et **hårdt loft pr. etape** arvet fra v3 (samme andel af feltet). Loftet er regressionsvagt, ikke mål. Målt i `backend/scripts/headToHeadV4.js` over 264 etapekørsler: **1,42 %** uheld pr. etape, DNF-rate **0,02 %** af feltet, og **2,3 %** af styrt var alvorlige.

**Nedkørsels-styrt har et gulv (#4905, ejer 6/9).** Descent attack-risikoen (`mechanics/descent.ts`, koblet til M3's angreb) dæmpes af descending-evnen MULTIPLIKATIVT med et gulv (`DESCENT_EXTRA_TUNING.incidentRiskFloorFraction`, `tuning.ts`) i stedet for den gamle subtraktive form, der kunne ramme PRÆCIS 0 for enhver descending-evne ≥ ~67 — netop de ryttere der altid angriber på en nedkørsel. Uden gulvet var nedkørselsstyrt statistisk usynlige, også i regn, selvom M11 forstærker basis-risikoen der. Målt i `backend/scripts/v4DescentIncidents.js`.

### v3 — den binære model (gælder indtil flip)

Et uheld har to akser der afgøres uafhængigt: **arten** (`kind`: styrt eller mekanisk defekt) og **udfaldet** (`outcome`: tabt tid eller udgåelse). De må ikke forveksles.

| | tabt tid | udgåelse (DNF) |
|---|---|---|
| **styrt** | tid lagt til etapetiden | ude af resten af løbet **+ skade i et antal dage** |
| **mekanisk defekt** | tid lagt til etapetiden | ude af resten af løbet, **ingen skade** |

I v3 kan en punktering altså stadig tvinge en rytter til at udgå. Det er præcis det v4's trin 4 afskaffer, og forskellen forsvinder ved flippet.

**Skade-reglen ([#4520](https://github.com/NicolaiDolmer/CyclingZone/issues/4520), fastlagt 5/9) gælder BEGGE modeller:** kun et **styrt** kan skade rytteren. En mekanisk udgang koster løbet, ikke kroppen — rytteren er klar til næste løbsdag. Håndhæves to steder i v3: `raceIncidents.rollIncidents` sætter `injury_days` udelukkende på `kind:'crash'`, og `raceRunner.persistIncidents` skriver kun `rider_condition.injured_until`/`injury_cause='race_crash'` for styrt-udgange. Indtil 5/9 gav ALLE udgåelser skade uanset art — spillerne så en mekanisk defekt koste dage på sidelinjen, hvilket ingen doc lovede.

**Ejeren kan omgøre den.** Vil en mekanisk udgang også koste dage (fx som "rytteren kom hjem sent og mistede træning"), er det et bevidst designvalg, ikke en fejl — men så skal det stå her OG i `help.json` (en+da) samtidig, ellers er reglen usynlig for spilleren.

**Tredje art: `kind:'injury'`** ([#4418](https://github.com/NicolaiDolmer/CyclingZone/issues/4418)) er ikke et uheld i løbet. Det er en rytter der var skadet i forvejen og derfor ikke kunne stille til start på en etape. Skaden ejes af `rider_condition` og må aldrig overskrives af løbsmotoren. I UI'en er han en **ikke-starter**, ikke en udgået — en label-mapping der behandler alt ikke-styrt som "mekanisk defekt" er derfor forkert.

---

## 2d. Tidsgrænse (ejer 6/9) — kun v4 ([#2582](https://github.com/NicolaiDolmer/CyclingZone/issues/2582))

Ejeren besluttede 4/9 at UCI's tidsgrænser bliver et krav til v4 før flip — ordret *"ikke i v3"* — og låste reglen 6/9. **M15 er en ejer-besluttet udvidelse af det ellers lukkede mekanik-katalog i §2.**

**Reglen i klart sprog.** En rytter der kommer i mål langt nok efter vinderen er ude af løbet. På et etapeløb betyder det at han ikke stiller til start næste dag og ryger ud af alle klassementer; på et endagsløb er det en DNF. Men kommer en stor gruppe samlet i mål efter grænsen, reddes hele gruppen — det er grupettoen, og den findes fordi et helt felt der har opgivet på en bjergetape ikke skal sendes hjem. Hvor sent man må komme afhænger af etapetypen: fladt er strammest, højbjerg mildest.

**Fire ting reglen ALDRIG gør.**

| | |
|---|---|
| Viser tallet | Spilleren ser **"uden for tidsgrænsen"** og **"grupettoen på N ryttere reddes"**. Aldrig en procent, aldrig en sekundgrænse. Fog-gaten ([#1791](https://github.com/NicolaiDolmer/CyclingZone/issues/1791)) gælder ubetinget |
| Skelner spiller fra AI | AI-hold rammes af præcis samme regel. Mekanikken har ingen holdakse overhovedet, så undtagelsen er strukturelt umulig, ikke bare udeladt |
| Bruger terningen | Ingen rng. Tidsgrænsen er en **regel**, ikke en lodtrækning |
| Flytter placeringer | Rank, tid, gruppe og rækkefølge er urørte. Kun `status` ændres. Invariant 3 og 6 er derfor uberørte per konstruktion |

**Faktortabellen — grænsen som andel af vindertiden. Alle værdier er STARTGÆT** (samme forbehold som resten af `tuning.ts`), kalibreres i harnesset. Bor i `TIME_LIMIT_EXTRA_TUNING` (`backend/lib/engine/v4/tuning.ts`).

| Etapetype | Andel over vindertiden | Hvorfor |
|---|---|---|
| `flat` | 5 % | UCI-båndets bund. Feltet ruller samlet ind |
| `rolling` | 6 % | Knap over fladt, samme massefinale-dynamik |
| `cobbles` | 9 % | Kort men nedslidende; sektorerne har allerede splittet feltet |
| `hilly` | 10 % | Første type hvor selektionen kan hage en svag klatrer af |
| `gravel` | 11 % | Længere og mere nedslidende end brosten (§2b) |
| `classic` | 11 % | Monument-arketypen: lang, hård, stor spredning i mål |
| `mountain` | 15 % | Høj ende af båndet — grupettoen er normen her |
| `high_mountain` | 20 % | Båndets top (ejer: *"bjerg/summit højest"*) |
| `itt` · `itt_hilly` · `ttt` | 25 % | UCI-praksis for enkeltstart/holdtidskørsel ligger over massestarts-båndet, fordi en TT spreder feltet af natur |

Ukendt eller manglende `profile_type` falder tilbage på 10 % — motoren kaster aldrig på en type den ikke kender.

**Grupettoen.** En samlet ankomst på mindst **20 % af feltet** (UCI's egen tommelfingerregel), dog altid mindst **8 ryttere**, reddes samlet. "Samlet" måles som en kæde af ankomster hvor der er under **2 minutter** til naboen. Det tal er ikke gruppe-sammensmeltningens tærskel, og det er målt, ikke gættet: finalen lægger hvert placerings-tier mindst merge-tærsklen + margin fra naboen, netop så tierne ikke folder sammen igen — et merge-tærskel-vindue kunne derfor per konstruktion aldrig kæde to tiers til én grupetto, og en grupetto der ankom i to klumper ville blive massakreret. En forward-guard i `timeLimit.test.ts` fælder enhver fremtidig ændring der sætter vinduet tilbage under tier-skridtet.

**OTL er en tredje udfaldsklasse**, ikke en variant af de to andre: rytteren *kom* i mål (modsat `abandoned`), men uden for grænsen. `StageResultStatus` er derfor `finished | abandoned | otl` (`types.ts`).

> ✅ **Reglen bider (7/9, [#4885](https://github.com/NicolaiDolmer/CyclingZone/issues/4885)).** Den var inert indtil motorens hale blev rettet: målt 6/9 gav 984 etapekørsler **0 OTL og 0 grupetto-redninger**, fordi største spredning mellem vinder og sidsteplads var 6,1 % på bjerg mod en 15 %-grænse. Grænsen blev **ikke** trimmet — det ville have gjort reglen forkert i stedet for at gøre motoren rigtig. Rod-årsagen var fart-modellen (se §7 række 15 og [`audits/v4-tail-spread-2026-09-07.md`](audits/v4-tail-spread-2026-09-07.md)). Efter rettelsen, målt på S3-kalenderen (141 etaper × 3 seeds, felt 180): OTL forekommer på bjerg-, kuperede, rullende og klassiker-etaper, og grupetto-redningen udløses. Procenterne i tabellen er uændrede og fortsat ejer-låste.

---

## 2e. Holdspil (ejer 5/9) — kaptajnen beskyttes, hjælperen betaler (M16)

Auditten 5/9: *"Holdspillet findes ikke i v4. Kaptajnbeskyttelse og hjælperstøtte kræver et hold-id på rytteren, som den frosne kontrakt ikke har. Ved et flip forsvinder både hjælperens pris og kaptajnens fordel."* Ejer-beslutning 1 (5/9, §9) gør *"holdspil med hold-id på rytteren"* til flip-minimum. **M16 er derfor en ejer-besluttet udvidelse af det ellers lukkede katalog i §2, på samme grundlag som M15.**

**Hold-id er nu på rytteren.** `Entrant.team_id` (`types.ts`) er **valgfri** og sættes af `adapters/entrantAdapter.ts` og broen (`raceEngineV4Bridge.js`, som allerede bærer feltet). Rollen alene tænder aldrig holdspillet — begge dele kræves, præcis som v3's `buildTeamContext` springer enhver entrant uden `team_id` **eller** `race_role` over. En startliste uden hold-id kører bit-identisk med før, så de fire golden fixtures er urørte.

**De to kanaler, som i v3:**

| | v3 | v4 (M16) |
|---|---|---|
| **Kaptajnen beskyttes** | score-løft, `teamComponent` | CP-faktor **over 1** |
| **Hjælperen betaler** | negativ score-delta, `workCost` | CP-faktor **under 1** |

Den beskyttede er **sprint-kaptajnen på flade etaper, kaptajnen ellers** — med fald tilbage på den anden, 1:1 med v3. `helper` og `hunter` arbejder; `free_role` bidrager 0 og betaler 0, ubetinget ([#2376](https://github.com/NicolaiDolmer/CyclingZone/issues/2376)). Der skal være mindst én arbejdende holdkammerat i **samme gruppe** — gruppen *er* nærhedsmodellen i v4, samme definition som §2c's *"tæt på"*.

**Valutaen er CP, ikke W'.** Første wiring-forsøg brugte den anaerobe reserve og var *bit-identisk* med og uden hold: siden [#4604](https://github.com/NicolaiDolmer/CyclingZone/issues/4604)'s relative krav-tempo ligger ingen over CP i normaltilstanden, så W' genoplades fuldt hvert segment og enhver delta er visket ud før næste segment læser den. CP er den vedvarende akse — den styrer både gruppens tempo og klatre-selektionen, altså netop de to steder v3's holdspil også slår igennem.

**Fire garantier, konstruktion frem for kalibrering** (property-testet i `mechanics/teamPlay.test.ts`):

1. **Bevarelse.** Kaptajnens bonus overstiger aldrig det holdet faktisk betalte. Holdspil flytter kræfter, det skaber dem ikke — v4's udgave af *"aldrig gratis alt-ud"*.
2. **Bounded.** Bonussen har desuden et hardt etape-loft: otte hjælpere giver ikke otte gange fordel.
3. **Intet fortegns-skift.** Prisen er altid ≥ 0. `all_out` **fjerner** prisen (§9 punkt 3), men ingen kombination af rolle × profil × intention kan gøre den negativ, dvs. til gratis CP oveni egen evne. Samme strukturelle loft som v3's `Math.min(0, …)` i `workCost`, spejlet.
4. **Monotoni (§3 invariant 3).** Faktoren er multiplikativ på rytterens egen CP, aldrig et absolut fradrag, så to ryttere i samme holdrolle-klasse aldrig kan bytte indbyrdes orden. Holdspillet er — som i v3 — en kanal **mellem** roller, ikke støj inden for én.

Prisen er desuden **granularitets-uafhængig**: den betales pr. segment som andel af segmentets km, så en hel etape koster det samme uanset hvor fint rutemodellen har skåret den op. Samme princip som M10's pr.-km-skalering (§2c).

**Intentionen skalerer prisen** (§9 punkt 3, Model C): `all_out` = 0, `save`/`grupetto` = halv, `normal`/`protect` = fuld. Det er work-cost-**aksen** og ikke M12's demand-akse — de to peger med vilje hver sin vej for `all_out`: en rytter der giver alt for **sig selv** brænder mere og arbejder samtidig ikke for holdet.

> ⚠ **Kalibreringen er ikke i mål.** Holddominans-ankeret (`same_team_top10_share_4plus`) ligger på sit **gulv, 0,0 %, i både v3 og v4** og kan derfor hverken bekræfte eller afkræfte at holdspillet virker — det er en regressionsvagt mod det modsatte problem. Derfor måler harnessen nu **beskyttelses-gabet** direkte (`scripts/lib/headToHeadTeamPlay.js`): gennemsnitlig placering pr. rolle, korrigeret for rytterens egen evne-rang i feltet, målt på begge motorer over samme etaper og seeds. **v4's gab er stadig en brøkdel af v3's.** Startværdierne i `TEAM_PLAY_EXTRA_TUNING` er valgt så mekanikken er målbar uden at vælte et eneste anker; at løfte den til fuld v3-paritet er en **kalibrering med ejer-go** (§4 *"Simulér før ship"*), ikke en wiring-ændring. Tallet er en flip-blokker på linje med de øvrige paritets-huller. **Holdarbejdet bogføres bevidst ikke i `RiderLoad.work_norm`**: det tal er segment-loopets arbejde i motorens egne enheder, og et holdspils-led ville skulle opfinde en omregning fra "andel af CP". At holdarbejde også skal koste i træningsudbyttet er rigtigt, men det hører i løbsdags-udviklingen ([#4850](https://github.com/NicolaiDolmer/CyclingZone/issues/4850)/D2) sammen med intentionens egen udbytte-multiplikator — ikke i en opfundet enhed i motoren.

---

## 2f. Vejret (ejer-scope: flip-paritet) — hvad det gør, wiret 6/9 (M11)

Vejret er ét felt pr. etape (`race_stage_profiles.weather`, seedet i `routeSegments.buildWeather`
siden F1) med en type og en vind-eksponering. Motoren bruger det to steder:

- **Kraften.** Regn og vind sænker rytterens bæredygtige tærskel (CP) i segmentløkken, samme
  sted og samme form som M7's distance-slid. Etapen bliver langsommere i dårligt vejr, og den
  der er dårlig til vejret mister mere end feltet omkring ham. Regn rammer hele etapen; vind
  rammer kun i det omfang terrænet er åbent — en stigning ligger i læ af sig selv.
- **Risikoen.** Regn forstærker styrt-risikoen på brosten/grus (`mechanics/cobbles.ts`) og i
  descent-angreb (`mechanics/descent.ts`).

Sol og overskyet er baseline: en etape i sol er bit-identisk med en etape uden vejr-lag.
Spilleren ser én melding i tidslinjen ("regn"), på den km hvor vejret begynder at bide, og
aldrig et tal ud over den km.

**"Vejr-teknik"** er en af de tre ejer-valgte stats fra 20/8 der endnu ikke er født. Indtil da
bruger motoren en proxy afledt af eksisterende evner. Den giver lindring, aldrig immunitet:
selv den bedste betaler noget for regnen.

**Sidevind-selektion (vifter) er IKKE med** ([#2476](https://github.com/NicolaiDolmer/CyclingZone/issues/2476)).
Vejret skærper de selektioner der allerede findes; det skaber ingen nye grupper. Målt over
kontrollerede kørsler (`backend/scripts/v4TailSpread.js --weather-experiment`) flytter vejret
etapens tid, ikke feltets sammensætning. Skal vejret kunne SPLITTE et felt, er det viften der
mangler, ikke en hårdere kalibrering af dette lag.

---

## 2g. Passager og bonussekunder (M9) — hvem ejer point og trøjer ([#2770](https://github.com/NicolaiDolmer/CyclingZone/issues/2770) · [#2413](https://github.com/NicolaiDolmer/CyclingZone/issues/2413))

**Ejer-beslutning 6/9 (låst).** Spurtpoint, bjergpoint og bonussekunder blev indtil nu lagt på **uden for** motoren (`backend/lib/racePassages.js`, kaldt fra `raceRunner`). Auditens åbne punkt 6 var: kobler man v4's egen mekanik ind uden at slukke det lag, får rytterne point **to gange**; gør man ingenting, mangler point og trøjer efter flippet. Valget er: **når v4 kører etapen, er motorens egen M9-mekanik den eneste kilde**, og laget udenfor gates af *for netop den etape*. Kører v3, er alt uændret. Kill-switchen midt i et løb er derfor stadig sikker: hver etape har præcis én kilde.

| | Hvor |
|---|---|
| Mekanikken | `backend/lib/engine/v4/mechanics/bonusSeconds.ts` — segment-hook for bjergtoppe og indlagte spurter, målpassagen bygges i `index.ts` på den endelige placeringsrækkefølge |
| Kontrakten | `StageOutput.passages` + `StageOutput.passage_totals` (additive, `types.ts`) — samme form som `computePassages` |
| Gaten | `raceEngineV4Bridge.passagesFromV4Output` (`null` ⇒ det gamle lag kører) + kaldsstederne i `raceRunner.js` |
| Point-skalaerne | ejer-låste Tour-skalaer, **spejlet 1:1** fra `racePassages.js` ind i `BONUS_SECONDS_EXTRA_TUNING`. En paritetstest fælder enhver drift |

**Tre ting er anderledes end i v3, med vilje:**

1. **Hvem der er foran måles, i stedet for at gættes.** v3 havde ingen grupper og udledte "er han med i udbruddet" af en syntetisk status plus et lodtrukket catch-km. v4 læser sit rigtige gruppe-lag: gruppen afgør rækkefølgen ved vejpunktet, evnen afgør inden for gruppen. Det er hele grunden til at flytte passagerne ind i motoren.
2. **Bonussekunderne har et samlet loft pr. rytter pr. etape** (#2413: *"GC-effekten er bounded"*). v3 har intet — samme rytter kan tage både mål- og spurtbonus. Målt over 423 etapekørsler: v3's største enkeltdag var 13 s, v4's 10 s. Loftet klemmer proportionelt og runder **ned til hele sekunder** (`race_results.bonus_seconds` er en `integer`-kolonne).
3. **Passagerne rører aldrig et resultat.** De ændrer hverken tid, gruppe, placering eller status — kun point, sekunder og tidslinje-events. Invariant 2, 3 og 6 er derfor uberørte per konstruktion, ikke ved en efterfølgende guard.

**Målt paritet** (423 etapekørsler, 141 proxy-etaper × 3 seeds, 180-rytters felt): **pointudbuddet er identisk** — samme samlede spurt-/mål- og bjergpoint, 0 etaper med afvigelse. Med motoren holdt fast (v3's lag kørt på v4's eget resultat) giver de to lag **samme pointtrøje i 3 af 3 løb og samme bjergtrøje i 2 af 3**; top-3 ved de enkelte vejpunkter undervejs er enige i cirka en fjerdedel af tilfældene. Den uenighed **er** modelforskellen fra punkt 1 og skal være der.

---

## 2h. Holdtidskørsel (ejer 6/9) — holdets tid er den k'te rytters passage (M13)

Auditten 5/9 og [#3463](https://github.com/NicolaiDolmer/CyclingZone/issues/3463) fandt samme hul: *"ni ryttere fra samme hold ville hver få deres egen tid"*. Ejeren tog M13 med i paritetsbølgen 6/9.

**Diskriminatoren er `profile_type`, aldrig `finale_type`.** `raceStageProfileGenerator.js` mapper både `itt`, `itt_hilly` og `ttt` til finale-typen `solo_tt` — de kan ikke skelnes på finalen. `simulateStageV4` forgrener derfor på `route.profile_type === "ttt"` og kører `mechanics/teamTimeTrial.ts` i stedet for segment-loopet: en TTT er ikke en vejetape med et ekstra hook på, men en anden gruppemodel.

**Reglerne:**

| | Sådan |
|---|---|
| **Holdet** | ét hold = én gruppe, samlet af `adapters/teamRosterAdapter.ts` på `Entrant.team_id` |
| **Starten** | hvert hold kører fra sit eget nul — hold-vis start, som UCI |
| **Holdets tid** | den k'te rytters passage over stregen, `TTT_EXTRA_TUNING.countbackRiderRank`, clampet til holdets startantal |
| **Rytterens tid** | holdets tid, for alle holdets startende ryttere |
| **Belastningen** | den enkeltes *reelle* forbrug, også for en droppet rytter ([#3459](https://github.com/NicolaiDolmer/CyclingZone/issues/3459)) |
| **Fronten** | turnus uden styrke-bias — også de svagere tager tørn, ellers giver en stærk TT-hjælper ingen mening |

**Fallback:** en TTT-rute hvor ingen rytter bærer hold-id kører den almindelige vejetape-vej, bit-uændret. De fire golden fixtures er dermed urørte.

**Kalenderen har ingen TTT endnu.** `ttt`-filleren har været slået fra siden [#2411](https://github.com/NicolaiDolmer/CyclingZone/issues/2411) — *"pauset indtil motoren kan simulere ægte hold-TTT"* — og S3 har derfor nul TTT-etaper (de eneste to `ttt`-rækker i basen er S1-rester uden rute). Motor-forudsætningen er væk nu; at lukke TTT ind i kalendergenereringen igen ændrer hvilke etaper spillerne får og er derfor et **ejer-valg**, ikke en wiring-ændring.

> ⚠ **Tre huller står åbne, alle ejer-gatede.** (1) **Uheld og tidsgrænse rører ikke en TTT.** M10 og M15 bor i segment-loopet, som TTT-grenen ikke går igennem. Tidsgrænsen kan ikke bare anvendes uændret: en TTT-ankomstgruppe *er* et helt hold, og grupetto-redningen er kalibreret til et massestartsfelt, så et enkelt langsomt hold ville ryge ud af løbet samlet. (2) **En TTT uddeler ingen point til pointkonkurrencen.** M9's lag uddeler grønne point ved målstregen også på en holdtidskørsel (kun bonussekunderne er undtaget, `racePassages.js:146`); TTT-grenen producerer ingen passager. Det svarer til UCI-praksis, men det er en flip-paritets-afvigelse og dermed et ejer-valg. Inert i dag: kalenderen har nul TTT-etaper. (3) **Massestarts-ankrene måler skævt på TTT.** `same_team_top10_share_4plus` (bånd < 3 %) er strukturelt 100 % på en holdtidskørsel — det vindende holds ryttere *deler* tiden og fylder derfor top 8 med rette. Ankret bør sandsynligvis udelade tidskørsler, men det er en ændring af en ejer-godkendt målestok (§4 *"Et gulv er ikke et mål"*) og ikke noget denne wiring gør på egen hånd.

---

## 3. Invarianter (property-testede, må aldrig brydes)

1. **Determinisme.** Samme input ⇒ byte-identisk output. Per-rytter-hash, så én ekstra tilmelding ikke flytter andres relative udfald. **Rng-streamen er nøglet på segmentet** ([#4886](https://github.com/NicolaiDolmer/CyclingZone/issues/4886)): `SegmentHookContext.rngFor` er bundet til (seed, segment, mekanik, rytter), så en mekanik der kaldes pr. segment ruller nyt hver gang i stedet for at genbruge sin første lodtrækning. En mekanik hvis lodtrækning hører til et vejpunkt eller til målstregen bruger `rngForStage` og begrunder det på kaldstedet.
2. **Gruppe-tid.** Alle i samme mål-gruppe har identisk `time_seconds`.
3. **Monotoni.** Inden for samme gruppe kan lavere testet evne aldrig give bedre tid. Støj skalerer magnitude, aldrig fortegn.
4. **Km-dækning.** `0 ≤ km ≤ distance_km`, monotont ordnet, #2410-taksonomien håndhævet.
5. **Fog-gate ([#1791](https://github.com/NicolaiDolmer/CyclingZone/issues/1791)).** Ingen rå komponenter, vægte eller sandsynligheder i `events[].params`.
6. **Låst feltstørrelse ([#4615](https://github.com/NicolaiDolmer/CyclingZone/issues/4615)).** Lige så mange i mål som på startlisten, hver rytter præcis én gang, placeringer = en komplet permutation 1..N. Grupper splittes, smelter sammen og bliver til placerings-tiers hele vejen igennem; hvert skridt kan tabe eller duplikere en rytter, og fejlen ville vise sig som et forskudt anker-tal længe før nogen så årsagen. Feltet er nævneren i felt-sammenhængs-ankeret.
7. **Felt-sammenhæng ([#4615](https://github.com/NicolaiDolmer/CyclingZone/issues/4615)).** En massefinale afgøres på **placering**, ikke på tid: den ankomne pulje deler vindertiden, og rækkefølgen bæres af `EngineState.finish_order`. Selektive finaler (bjerg, punch, nedkørsel, udbrud, ITT) beholder individuelle tids-tiers — dér er tidsforskellene ægte.

8. **Tidsgrænsen flytter kun `status` ([#2582](https://github.com/NicolaiDolmer/CyclingZone/issues/2582), ejer 6/9).** M15 sætter `otl` og rører aldrig `rank`, `time_seconds`, `group_id` eller rækkefølgen. Invariant 3 og 6 er derfor uberørte per konstruktion, ikke ved en efterfølgende guard: en OTL-rytter bliver stående i resultatlisten, han er blot mærket. Hvad der sker med ham i DB'en er flip-lagets ansvar (§2d). Property-testet i `backend/lib/engine/v4/mechanics/timeLimit.test.ts`.

**Rettet (§7 modsigelse, "to invarianter kaldt property-testede"):** Invariant 6 og 7 er IKKE fast-check-baserede property-tests — `fieldIntegrity.test.ts` importerer ikke biblioteket. De er verificeret over et fast sæt evne-niveauer (5/11/30/60/99), samme skala-sweep-form som #4604-load-guarden. Beskyttelsen er reel (fem uafhængige evne-niveauer, ikke ét), men af en anden testtype end ordet "property-testet" lover andre steder i denne fil (fx invariant 8, `timeLimit.test.ts`, som rent faktisk bruger `fast-check`).

Invariant 3 er den dyre. Den er hele grunden til at støj må skaleres, men aldrig vendes.

---

## 4. Doktrin

**Simulér før ship.** Intet balance-følsomt shippes uden dry-run-harness mod ægte population plus scorecard med ejer-go. v4's scorecard ankres i virkelighedens tal som primær kilde; de eksisterende gate-bånd er regressionsvagt, ikke mål.

**Et gulv er ikke et mål.** Rapporteres et tal som OK, skal det stå hvilken regel det måles mod, og om det er ejer-godkendt mål eller regressionsvagt ([#4221](https://github.com/NicolaiDolmer/CyclingZone/issues/4221)).

**Styrke straffes aldrig.** Den bedste skal kunne vinde. Balance sikres via fordeling og struktur, ikke via handicap (ejer 4/8).

**Offentlighedspolitik ([#3436](https://github.com/NicolaiDolmer/CyclingZone/issues/3436)).** Repoet er offentligt. Kvalitativ omtale er fri; præcise vægte, formler, eksponenter og tærskler hører i private filer og chat — aldrig i issues, PR'er, patch notes eller Discord.

---

## 5. Faser og hvor vi er

| Fase | Indhold | Status |
|---|---|---|
| F0 | Spec ejer-godkendt, 16 valg | ✅ 20/8 |
| F1 | Rute-SSOT: segmentmodel, vejr-lag, generator, legacy-syntese | ✅ PR #4028 |
| F2 | Motor-kerne: segment-loop, M1-M4, tidslinje, golden fixtures | ✅ PR #4072, 21/8 |
| F3 | Mekanik-bølge M5-M16 + taktik-kort | **✅ koblet ind 6/9** — kalibrering udestår, se noten |
| F4 | Flip-infrastruktur: flag, kaldssted, output → `race_results`, kill-switch | ✅ PR #4879, 6/9 |
| F5 | Kalibrering i S3 → ejer-gate | ikke startet |
| F6 | Flag-flip i S4-start (mål, ikke garanti — §9 punkt 1) | **ejer-gated** |

**F3-noten (rettet, [#4911](https://github.com/NicolaiDolmer/CyclingZone/issues/4911)).** Stod fra 21/8 til 6/9 med en stale "wiret 3/9"-beskrivelse (kun M5+M6 koblet ind, taktik-kort ikke bygget, fire uenige ordre-kontrakter). Alt det er ændret siden:

- **M7-M13, M15, M16 koblet ind 6/9** (paritets-bølgen, se §2-tabellen for kaldssted pr. mekanik). Tilbage: kalibrering (jagt-modellen, bjerg-ankeret, tidsgrænsens spredning — §7).
- **Ordre-kæden er lukket** (PR #4894, ejer-beslutning 27/8+2/9 om #4246): `ai/teamOrderContract.ts` er nu DEN ene kontrakt (ikke længere fire uenige kopier), rollen er standardordren (`defaultOrderForRole()`), sprint-toget kan sættes via `leadout`-feltet, og `race_role` afvises med 400 i stedet for at blive gemt (`raceTeamOrdersApi.js:8-10,38`, `ai/teamOrderContract.ts:103`). `TeamOrder` er stadig den åbne `{team_id, kind, params}`-konvolut, men det er nu et bevidst designvalg, ikke en uenighed mellem fire kopier.
- **Taktik-kortet ER bygget** (PR #4913, 6/9): løbssiden som hero + faner, egen Tactics-fane med etape-vælger, intention og ordrer pr. rytter, ejer-godkendt på preview (screenshots i PR-beskrivelsen).

**v3 er låst fallback indtil flip.** Flippet er ejer-only og sker aldrig som sidegevinst ved en anden opgave. Kill-switchen (§0, PR #4879) gør en tilbagerulning billig: broen oversætter v4's output til v3's `ranked`-form, så alt nedstrøms er uændret.

---

## 6. Hvad der håndhæver hvad

| Regel | Håndhæves af |
|---|---|
| Determinisme, gruppe-tid, monotoni, km-dækning | property-tests (`fast-check`) + golden fixtures |
| Låst feltstørrelse + felt-sammenhæng | `fieldIntegrity.test.ts` (5 evne-niveauer) |
| Tidsgrænsen (§2d) + at OTL kun rører `status` | `mechanics/timeLimit.test.ts` (23 tests, 300-runs property-tests + e2e-wiring) |
| Scorecardets feltstørrelse | `headToHeadV4.js`'s låste default (`--field-size=all` er den eksplicitte vej ud) |
| Fog-gaten | samme testmønster som `raceTimeline.test.js` |
| Type-kontrakten | `tsc`-typegate i CI (Node 24 type stripping) |
| Rolle-vokabularet | `backend/lib/raceRoles.test.js` (16/16 pass) — låser de fem rollenavne, låst 3/9. Rettet §7-modsigelse: stod tidligere fejlagtigt som "intet i dag" her, mens §7 punkt 3 kaldte det løst |
| Balance-bånd | `race:gate` + `balance:check` (advisory) |

---

## 7. Kendte åbne modsigelser

| # | Modsigelse | Issue |
|---|---|---|
| 1 | ~~`hunter` er en **rolle**, `try_break` er en **ordre**~~ **LUKKET (PR #4894, 6/9):** rollen er standardordren (`defaultOrderForRole()`, `ai/teamOrderContract.ts:189`), taktik-kortet er dagens overlay, rollen skrives aldrig om af kortet. `race_role` er ikke længere sat-bart i `TeamOrder`-bodyen — et PUT med feltet afvises med 400 og skrives aldrig (`raceTeamOrdersApi.js:8-10,38`, `REJECTED_TEAM_ORDER_RIDER_FIELDS` i `teamOrderContract.ts:103`). Den udestående oprydning fra 5/9 er dermed lavet | denne fil §1 + [decision-spec](superpowers/specs/2026-09-03-role-vs-teamorder-decision.md) |
| 2 | ~~`sprint_captain` overlapper `leadout_for`~~ **LUKKET, samme PR:** `leadout` er nu et eksplicit, valgfrit per-rytter-felt i kontrakten (`teamOrderContract.ts:45`), sat af rollens standard (helperen kører sprint-kaptajnens tog, `:201`) og overskrivbart af taktik-kortet — samme mønster som #1, nu også bygget for netop dette rollepar | samme |
| 3 | Rolle-vokabularet havde ingen gate. **Løst 3/9:** `backend/lib/raceRoles.test.js` låser de fem værdier | denne fil §1 |
| 4 | `race:gate:routes` er permanent rød; `longDayEnduranceLift`-båndet står på middelværdien | [#4197](https://github.com/NicolaiDolmer/CyclingZone/issues/4197) |
| 5 | `balance:check` tæller 98 afvigelser på main, men er advisory | [#4196](https://github.com/NicolaiDolmer/CyclingZone/issues/4196) |
| 6 | **RETTET (#4911): tallene var forældede OG selvmodsigende** (linje 205 sagde sprinter 99,7 %/nedkørsel sidste røde anker, linje 213 i samme afsnit sagde sprinter faldt til 85,0 % — modsatte billeder af samme tilstand). De hårdkodede tal er erstattet af §7b's genererede tabel, som er den ene sandhed fremover: ingen anker-tal i denne fil er længere håndskrevet | [#4132](https://github.com/NicolaiDolmer/CyclingZone/issues/4132) · [#4604](https://github.com/NicolaiDolmer/CyclingZone/issues/4604) · [#4911](https://github.com/NicolaiDolmer/CyclingZone/issues/4911) |
| 7 | `raceRouteRealismScorecard` måler sin egen plan, ikke basen | [#4219](https://github.com/NicolaiDolmer/CyclingZone/issues/4219) |
| 8 | **Head-to-head-scorecardet er seed-domineret.** Samme kode, samme kalender, fem seeds: sprinter-ankeret svinger ~12 procentpoint til hver side. Etaper med samme etapenummer deler feltsample OG motor-seed, så n=117 flade etaper er reelt ~20 uafhængige træk. Et enkelt-seed-tal kan derfor hverken erklære et anker grønt eller rødt — scorecardet skal aggregere over seeds før det kan gate noget. **Ejer-beslutning 2/9: gaten måles som 5-seed-middel med spænd; fejlrettelser der løfter alle ankre uden regression må merges som fundament (#4606), mens båndkravene forfølges pr. anker** | [#4604](https://github.com/NicolaiDolmer/CyclingZone/issues/4604) |
| 9 | `positioning` og `tactics` står i `AbilityKey` og vægter i finalens demand-vektorer, men **ingen rytter i spillet har dem** (0 af **5.650** i den pinnede population — `backend/scripts/baselines/population-snapshot-2026-07-11.json`, verificeret 6/9; **rettet fra 5.938**, som var et forældet, usporet tal og selv var uenigt med audittens egen "5.650"-linje samme sted). Vægten falder tavst på gulvet, så bl.a. massespurt-finalen afgøres på en mindre del af sin egen vektor end tabellen antyder | [#4604](https://github.com/NicolaiDolmer/CyclingZone/issues/4604) |
| 10 | **Felt-favoritters win-rate er stadig rød, tallet genmålt mod main `d0d7821e5` (#4933+#4935 rebaset ind).** Pinnet 3-seed-måling efter M7-M16-bølgen + halerettelsen (§7b): **54,1 % (53,2-54,6 spænd)** mod båndet 25-40 %, orders=none (ordre-effekten er en anden akse, se punkt 7 i denne tabel). Faldet fra branchens oprindelige 59,8 % (58,9-61,0, målt mod den gamle base) er halerettelsens egen effekt, ikke en ny kalibrering. Cellen forfølges ved at koble flere mekanikker på og lade AI-ordrer skabe reel variation, **aldrig ved at straffe styrke** (ejer 4/8) | [#4604](https://github.com/NicolaiDolmer/CyclingZone/issues/4604) |
| 11 | **Bjerg-top-10-ankeret er kun meningsfuldt ved realistisk feltstørrelse.** Samme kode scorer ~212 s ved 180 ryttere (§7b, genmålt mod main `d0d7821e5`) og 19 s ved hele populationen (**5.650**, rettet fra 5.938) — målet er sekundbaseret og skalerer med feltet, fordi en stor peloton giver en stor frontgruppe. Det pinnede 180-rytters felt er gaten (§7b's baseline), jf. scorecard-metodologien 23/8; hele-populationen-tallet er ikke et mål for dette anker | [#4604](https://github.com/NicolaiDolmer/CyclingZone/issues/4604) |
| 12 | **App-lag løst 4/9 (#4746), DB-lag stadig åbent:** `EXCLUSIVE_ROLES` (frontend) og backend-guarden (`raceStageRolesApi.validateStageRoleOverrides`) håndhæver nu `hunter` på etape-taktikken (`race_stage_roles`), samme mønster som `captain`/`sprint_captain` — en ny hunter degraderer den forrige i UI'et, og et rå API-kald med 2+ huntere afvises. Holdudtagelsen (`race_entries`) håndhævede allerede `hunter` unikt via DB-constraint. Målt 3/9 (før fixet): 119 af 760 hold-etape-hunter-grupper (15,7 %) havde mere end én hunter, op til 6 samtidig — de RÆKKER er ikke ryddet op (ingen DB-migration i #4746's PR: en unique-constraint på `race_stage_roles` ville fejle mod dem med det samme, og en oprydning er destruktiv/ejer-gated). A/B-forslag + begrundelse i [decision-spec](superpowers/specs/2026-09-03-role-vs-teamorder-decision.md) §5 (denne PR bygger forslag A, kun i app-laget) | [#2405](https://github.com/NicolaiDolmer/CyclingZone/issues/2405) · [#4746](https://github.com/NicolaiDolmer/CyclingZone/issues/4746) |

| 13 | **RETTET NUMMERERING (#4911): denne raekke var en anden "12" end raekken ovenfor** (tabellen var brækket med to punkt-12'ere, jf. auditten). **Sprinter-vinderraten (≥ 90 %) og felt-sammenhængen (80-95 %) trækker mod hinanden når M5 er wiret.** Et udbrud der overlever en flad etape gør begge ting på én gang: vinderen er ikke en sprinter, og kun udbryderne deler vindertiden. Pinnet 3-seed-måling efter M7-M16 og halerettelsen (§7b, main `d0d7821e5`): felt-sammenhængen er **30,4 % (29,2-31,9)** mod bånd 80-95 %, sprinter-ankeret er **88,6 % (80,0-94,3)** mod bånd ≥ 90 % — begge stadig FAIL, og sprinter-ankeret er nu rødt på 1 af 3 seeds hvor det før hale-rettelsen var grønt der. Begge tal styres af samme størrelse — hvor ofte et udbrud går hele vejen. Kalibrering af jagt-modellen, ikke en wiring-mangel, ejer-gated | [#4615](https://github.com/NicolaiDolmer/CyclingZone/issues/4615) |
| 14 | **To led i jagt-modellen er absolutte konstanter målt mod en evne-relativ skala** (samme fejlfamilie som #4604/#4606): sen-etape-uroen og udbruddets størrelses-bonus. Mod den ægte population (median-evne 11/99) er de evne-afledte led en brøkdel af deres tiltænkte størrelse mens konstanterne står uændret. En naiv relativisering af begge led blev prøvet og **målt 3/9: den forværrede bjerg-ankeret** (207 → 247 s mod bånd 180-240) og blev rullet tilbage. Rettelsen kræver sin egen kalibrering med ejer-go, ikke en sidegevinst | [#4615](https://github.com/NicolaiDolmer/CyclingZone/issues/4615) |
| 15 | ~~**v4 komprimerer feltet så hårdt at tidsgrænsen (§2d) aldrig bider.**~~ **Løst 7/9 ([#4885](https://github.com/NicolaiDolmer/CyclingZone/issues/4885)).** Målt 6/9: 0 OTL og 0 grupetto-redninger på 984 etapekørsler, største spredning 6,1 % på bjerg mod en 15 %-grænse. Grænsen blev ikke trimmet; motoren blev rettet. Rod-årsagen var **ikke** gruppe-låsning men fart-modellen: styrke-leddet målte gruppens CP som en *absolut* difference mod en konstant kalibreret for et midt-skala felt (samme fejlfamilie som #4604 rettede på krav-siden og som overlevede på fart-siden), hvilket låste hele hale-spændet på ~4 % uanset mekanik — og W' blev aldrig læst tilbage i den bæredygtige tærskel, så en kørt-i-sænk rytter kunne ikke blive langsommere, kun mindre. Efter rettelsen (genmålt 7/9 mod main `d7db448ac`, dvs. oven på #4886 og #4905): hale-p90 på bjerg 2,7 % → 9,1 %, på fladt uændret 0,2 % (feltet skal netop *ikke* splittes dér), og M15 fyrer (0,06-2,0 % OTL på bjerg/kuperet/rullende/klassiker, grupetto-redninger på 7 etaper). **Prisen er bjerg-top-10-ankeret:** det er nu grønt på 1 af 3 seeds (242 ❌ / 165 ❌ / 228 ✅ mod båndet 180-240) — men s2 var allerede rødt på main efter #4886 (177), og resten er en åben kalibrering af overskuds-grenen, se række 16. Måling: [`audits/v4-tail-spread-2026-09-07.md`](audits/v4-tail-spread-2026-09-07.md) | [#2582](https://github.com/NicolaiDolmer/CyclingZone/issues/2582) · [#4604](https://github.com/NicolaiDolmer/CyclingZone/issues/4604) · [#4885](https://github.com/NicolaiDolmer/CyclingZone/issues/4885) |
| 16 | **Bjerg-top-10-ankeret (180-240 s) og halens længde trækker mod hinanden, og ankeret er nu grønt på 1 af 3 seeds.** Genmålt 7/9 mod main `d7db448ac`: 242 / 165 / 228 s. To uafhængige bidrag, målt hver for sig: rng-segment-nøglingen ([#4886](https://github.com/NicolaiDolmer/CyclingZone/issues/4886)) flyttede main selv fra 200/182/216 til 220/**177**/212 — s2 var altså rødt før #4885 — og hale-rettelsens overskuds-gren lægger yderligere 10-22 s på. Ankerets margin er dermed opbrugt i begge ender: s1 er 2 s over loftet, s2 15 s under gulvet. At dæmpe overskuds-grenen yderligere koster hale-længde og er en **kalibrering med ejer-go** (§4 *"Simulér før ship"*), ikke en wiring-ændring | [#4885](https://github.com/NicolaiDolmer/CyclingZone/issues/4885) · [#4886](https://github.com/NicolaiDolmer/CyclingZone/issues/4886) · [#2415](https://github.com/NicolaiDolmer/CyclingZone/issues/2415) |
| 17 | **RETTET: v4-baserede sprinter/favorit-tal er MAALT AF DENNE PR og af halerettelsen ([#4885](https://github.com/NicolaiDolmer/CyclingZone/issues/4885), PR #4935), ikke arvet fra tidligere audit-koersler** (som selv modsagde hinanden, jf. punkt 6). Se §7b's ankertabel for aktuel status pr. anker | [#4911](https://github.com/NicolaiDolmer/CyclingZone/issues/4911) |
| 18 | **NY (#4911): hvert v4-løb rapporterer stadig samme sejrstype.** `buildFinishEvent`'s `PLACEHOLDER_WIN_TYPE = "group_finish"` (`index.ts:159,168`) stemples ubetinget på ALLE massestarts-etaper uanset om det var massespurt, solo eller udbrud — kommentaren derover ("F2-placeholder... uden en reel finale-mekanik") er selv forældet, for finalen (M4) ER koblet ind siden F2. De fire golden fixtures (`fixtures/*/expected.json`) fryser fejlen fast. TTT er undtaget: `mechanics/teamTimeTrial.ts:402` sætter korrekt `win_type: "ttt_win"`. Ejer-valg om finale-klassificering, ikke rettet her | [#3855](https://github.com/NicolaiDolmer/CyclingZone/issues/3855) |
| 19 | **NY (#4911): aggregerings-koden modsiger stadig sin egen beskrivelse.** `headToHeadAnchors.js`'s `aggregateScorecards` siger domme afgøres på middelværdien mod båndet, men `bandById` (`:587-598`) har kun 10 opslag mens `buildScorecard` nu returnerer 13 ankre — `descent_attack_gain_bounds`, `breakaway_rate_per_terrain` og `bonus_seconds_bounded` mangler stadig og falder tilbage på `measured[0].verdict` (dommen for det FØRSTE seed, ikke middelværdien). Pt. maskeret i §7b's tal, fordi alle tre ankre er seed-uafhængige konstanter i denne kørsel (spænd 0) — men koden er ikke rettet, kun ufarlig lige nu. Ikke rettet her: risiko for at ændre maalt tilstand i en fil uden for denne PR's append-only-scope | [#4604](https://github.com/NicolaiDolmer/CyclingZone/issues/4604) |

**Bjerg-ankerets måleflade (ejer-beslutning 2/9, [#4604](https://github.com/NicolaiDolmer/CyclingZone/issues/4604)).** Bjerg-top-10-spredningen måles **kun på topankomster** — bjergetaper der slutter på toppen. En bjergetape der slutter på en nedkørsel hører til nedkørsels-ankeret, som netop kræver at de etaper er tættere; da begge ankre tidligere midlede over de samme etaper, kunne de to bånd ikke opfyldes samtidigt.

---

## 7b. Ankertabellen (genereret af harnesset, [#4911](https://github.com/NicolaiDolmer/CyclingZone/issues/4911))

Tabellen herunder er IKKE håndskrevet. Den er renderet af `backend/scripts/renderV4AnchorTable.mjs` fra `backend/scripts/baselines/v4-anchor-baseline.json`, som `backend/scripts/buildV4AnchorBaseline.mjs` producerer ved at køre `headToHeadV4.js` på to PINNEDE, committede filer (population + proxy-etaper) over tre låste seeds. Det retter audit-modsigelsen "gaten er ikke pinnet nogen steder" — samme to filer og samme tre seeds hver gang, så et fremtidigt kalibrerings-PR kan sammenligne mod netop denne baseline i stedet for en tilfældig kørsel.

**Sådan refreshes tabellen (én kommando i to led):**

```
node backend/scripts/buildV4AnchorBaseline.mjs && node backend/scripts/renderV4AnchorTable.mjs --write
```

`node backend/scripts/renderV4AnchorTable.mjs --check` fejler (exit 1) hvis blokken nedenfor er ude af sync med baseline-JSON'en — samme tjek kører i `renderV4AnchorTable.test.mjs`, som backend-suiten samler op.

**Hvad tabellen IKKE dækker:** `orders=none` (ingen AI-taktik/leadout-ordrer i dette scorecard — det er en anden akse, se §7 punkt 7's note om "wiret ≠ virker"), GT-vindermargin (kræver akkumuleret GC over et helt etapeløb, ikke etape-for-etape), og de tre ankre nævnt i §7 punkt 19 (aggregerings-bug, pt. ufarlig fordi deres værdier er seed-konstante i denne kørsel).

<!-- v4-anchors:start -->

> **Genereret af harnesset, ikke haandskrevet** (#4911). Kilde: `backend/scripts/baselines/v4-anchor-baseline.json`, produceret af `backend/scripts/buildV4AnchorBaseline.mjs` fra den PINNEDE population + de PINNEDE proxy-etaper — samme to filer hver gang, saa et fremtidigt kalibrerings-PR maaler mod netop denne baseline, ikke en tilfaeldig koersel. Spaend i parentes er min-max over seeds.
>
> Pinnet: motor-sha `d0d7821e53` · population `backend/scripts/baselines/population-snapshot-2026-07-11.json` (5650 ryttere, sha256 e360366e3def2980) · etaper `backend/scripts/baselines/v4-proxy-stages-2026-09-06.json` (sha256 bbf6e20ce5293280) · seeds s1, s2, s3 · feltstoerrelse 180 · genereret 2026-09-06T22:26:22.808Z.
>
> **Refresh:** `node backend/scripts/buildV4AnchorBaseline.mjs && node backend/scripts/renderV4AnchorTable.mjs --write`

| Anker | Baand (kilde) | v3 | v4 |
|---|---|---|---|
| Felt-sammenhaeng, flade etaper | 80.0%-95.0% (#3917-maalingen (mor-spec §5: "80-95% af feltet paa vinderens tid")) | 4.0 % (3.8 %-4.1 %) [FAIL] | 30.4 % (29.2 %-31.9 %) [FAIL] |
| Nedkoersels-gaps vs. summit-gaps (ratio) | <= 0.5 (#3426-maalingen (mor-spec §5: nedkoersels-gaps vs. summit-gaps, ratio <=0,5 ved p5-p10)) | 0.59 (0.49-0.76) [FAIL] | 0.38 (0.26-0.49) [PASS] |
| Descent attack-gevinst (10-20s-loft, aldrig omvendt fortegn i gruppen) | 10-20s (ejer-valg 20/8 (mor-spec §4 M3 / §5: descent attack-gevinst-loft)) | n/a | 20s (20s-20s) [PASS] |
| Punch-korrelation (punch-evne vs. placering paa punch-etaper) | spearman > 0.2 (#3965-harnesset (mor-spec §5)) | 0.69 (0.67-0.70) [PASS] | 0.71 (0.70-0.72) [PASS] |
| Brostensevnens loeft paa brosten/grus (spearman-forskel vs. flad) | loeft >= 0.03 (FORSLAG, ikke ejer-godkendt) (FORSLAG (M8-wiring 6/9, #2789/#4105) — regressionsvagt for ejer-reglen 3/9 "brostensevnen taeller kun paa etaper med brosten/grus"; taersklen er valgt af denne harness, ikke ejer-godkendt) | 0.497 (0.476-0.521) [PASS] | 0.141 (0.107-0.163) [PASS] |
| Felt-favoritters win-rate | 25.0%-40.0% (v3-spec §2 + ejer-valg 20/8 (mor-spec §5: "i dag 80-88%")) | 35.7 % (34.8 %-36.9 %) [PASS] | 54.1 % (53.2 %-54.6 %) [FAIL] |
| Samme-hold-top-10 (andel etaper med 4+ fra ét hold) | < 3.0% (v3-spec §2 (mor-spec §5: "4+ fra samme hold i top 10 sjaeldent, < 3%")) | 0.0 % (0.0 %-0.0 %) [PASS] | 0.0 % (0.0 %-0.0 %) [PASS] |
| Udbruds-rater pr. terraen (descent-dominans 54% skal ned) | race:gate-baand (ingen fast tal her — se gate-konfig) (race:gate + #3426 (mor-spec §5)) | 28.4 % (25.5 %-29.8 %) [PASS] | n/a |
| Sprinter-vinderrate paa flat (top-20%-sprint-evne vinder) | >= 90.0% (race:gate + #3149 (mor-spec §5: "sprinter-vinderrate paa flat >= 90%")) | 92.4 % (88.6 %-94.3 %) [PASS] | 88.6 % (80.0 %-94.3 %) [FAIL] |
| ITT-korrelation (time_trial-evne vs. placering, synlig) | spearman > 0.3 (race:gate + #3149 (mor-spec §5: "ITT-korrelation synlig" — tærskel valgt af denne harness)) | 0.73 (0.72-0.75) [PASS] | 0.84 (0.84-0.85) [PASS] |
| Bonussekunder GC-effekt bounded (maks ~10s/etape) | <= 10s/etape pr. rytter (#2413-kravet (mor-spec §5)) | 13s (13s-13s) [FAIL] | 10s (10s-10s) [PASS] |
| Bjergetape top-10-spredning, topankomster (#2415) | 180-240s (~3-4 min) (#2415 (gap-realisme-baand: bjergetape top-10 inden for ~3-4 min, PCS-niveau)) | 114s (106s-119s) [FAIL] | 212s (165s-242s) [PASS] |
| GT-vindermargin (#2415) | 60-480s (1-8 min) (#2415 (gap-realisme-baand: GT-vindermargin typisk 1-8 min)) | n/a | n/a |

<!-- v4-anchors:end -->

---

## 8. Kildedokumenter

Denne fil er kilden til **reglerne**. Design-rationalet bor stadig i:

[`2026-08-20-race-engine-v4-intra-stage-design.md`](superpowers/specs/2026-08-20-race-engine-v4-intra-stage-design.md) (vision, mekanik-katalog, beslutningslog) · [`2026-08-21-race-engine-v4-f2-core-design.md`](superpowers/specs/2026-08-21-race-engine-v4-f2-core-design.md) (kerne-kontrakten) · [`2026-08-21-race-tactics-orders-v1-design.md`](superpowers/specs/2026-08-21-race-tactics-orders-v1-design.md) (ordre-kontrakten) · [`2026-07-21-realistic-routes-foundation-design.md`](superpowers/specs/2026-07-21-realistic-routes-foundation-design.md) (rutemodellen) · [`2026-07-22-sub2-deep-competitions-design.md`](superpowers/specs/2026-07-22-sub2-deep-competitions-design.md) (passager, pointskalaer) · [`2026-07-22-sub3-route-aware-engine-design.md`](superpowers/specs/2026-07-22-sub3-route-aware-engine-design.md) (gap-model) · [`2026-08-17-race-event-log-stage-timeline-design.md`](superpowers/specs/2026-08-17-race-event-log-stage-timeline-design.md) (tidslinje-taksonomi).

Naboområder: [`CALENDAR_RULES.md`](CALENDAR_RULES.md) (hvornår løbene køres) · [`PROGRESSION_RULES.md`](PROGRESSION_RULES.md) (hvilke evner rytterne møder op med) · [`GAME_INVARIANTS.md`](GAME_INVARIANTS.md).

---

## 9. Ejerbeslutninger 5-6/9: flip-scope og taktik (låst, genåbn ikke)

> Grundlag: [`audits/race-engine-v4-audit-2026-09-05.md`](audits/race-engine-v4-audit-2026-09-05.md). Rationale og byggekø: [`superpowers/specs/2026-09-06-race-engine-v4-flip-and-tactics-design.md`](superpowers/specs/2026-09-06-race-engine-v4-flip-and-tactics-design.md). Afsnit 2c (uheld), 5 (faser) og 7 (modsigelser) er delvist forældede mod disse beslutninger; de rettes i doc-reparations-PR'en (byggekø rk. 9).

**Én motor.** Der findes præcis én v4: `backend/lib/engine/v4`. Ny motor-logik uden for den mappe er forbudt. Mekanik-kataloget skal altid vise **bygget** og **koblet ind** som to kolonner; "bygget" alene betyder at motoren ikke kalder det.

| # | Regel | Ejer |
|---|---|---|
| 1 | **Flip-scope = v3-paritet + de tre krav.** v4 må først kaldes klar når alt spillerne har i v3 er koblet ind (styrt, bonussekunder, indsatsvalg, holdspil, vejr/brosten/grus/distance-slid) plus #2789, #2944, #2582, plus flag, kaldssted, output → `race_results`, kill-switch til v3. Ankre grønne før "klar". 28/9 er et mål, ikke en garanti; S3 kører færdig på v3 | 5/9 |
| 2 | **Intention vælges i holdudtagelsen pr. rytter pr. etape.** Rollen gælder hele løbet og er standard; intentionen er dagens overlay; "ikke valgt" = kører sin rolle. Fem trin i samme felt (`race_stage_roles.effort`: grupetto, save, normal, protect, all_out) | 6/9 |
| 3 | **Intentionens pris = Model C.** Træthed bagefter (grupetto < save, all_out > protect), holdarbejdets pris (all_out fjerner prisen, loftet til 0, aldrig bonus over egen evne), træningsudbytte den dag. Aldrig gratis alt-ud; svag slår aldrig stærk på samme trin; grupetto er ikke et frikort. v4 M12 lægges oveni ved flip med samme enum | 6/9 |
| 4 | **Uheldstrappen (M10).** Let styrt = tidstab. Hårdt styrt = stort tidstab + skadedage. Alvorligt styrt = udgår + skadedage, sjældent. Mekanisk uheld = altid kun tid, aldrig udgåelse, aldrig skade; hjælper tæt på = hurtigere hjulskift. Kun styrt kan skade (#4520). v3's loft over uheld pr. etape arves; hyppighed kalibreres mod ca. 1-2 % pr. etape | 6/9 |
| 5 | **Tidsgrænse = UCI-reglen.** Uden for tidsgrænsen = ude af løbet (etapeløb) / DNF (endagsløb). Stor gruppe der kommer samlet reddes. Grænse pr. etapetype (udgangspunkt 5-20 %), vises aldrig. AI-hold rammes ens. Kun v4. OTL er en udfaldsklasse ved siden af i mål/udgået | 6/9 |
| 6 | **Alle seks rute-huller lukkes før flip**, inkl. brostens-finaler (sektorer tæt på mål i rutegeneratoren, v4 læser `sectors`, brostens-mekanik ind) og enkeltstarters 80 hm. Efterprøves mod rigtige ruter i harnesset | 6/9 |
| 11 | **Løbssiden som hero + faner, variant A** (PR #4913, 6/9 kl. 16:35). FØR løbet: Overview/Team/Tactics/Stages. UNDER løbet: Overview/Team (låst)/Tactics (kun ulåste etaper)/Stages/Results. EFTER løbet: Overview/Results/Stages/Team (read-only). Team = udtagelse + rolle, én guldknap. Tactics = én etape-vælger, intention + ordrer pr. rytter, én guldknap. Erstatter #4888 og #4895 | 6/9 |
| 12 | **TIER WAVE er ops, ikke en spilregel.** Bølge-drift-protokollen (targeted lokalt, CI som fuld gate, push-kadence, frys-tjek) hører hjemme i [`docs/NIGHT_WAVE_RUNBOOK.md`](NIGHT_WAVE_RUNBOOK.md) (verificeret 6/9 — protokollen bor rent faktisk der, ikke i `AI_OPS_REFERENCE.md` som issuet foreslog), ikke i denne fil — kun en pointer-række her for at undgå at duplikere ops-regler ind i motorens SSOT | 6/9 |

**Fog of war (ejer 6/9):** ingen procenter, multiplikatorer eller grænser på spillerens skærm. Han ser "taber 40 sek.", "ude i 4 dage", "uden for tidsgrænsen".
