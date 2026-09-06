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
| M7 | Distance-slid: monument-effekt + dag-til-dag | F3 |
| M8 | Brosten-sektorer | F3 |
| M9 | Bonussekunder — bounded så bjerg dominerer GC | F3 |
| M10 | Incidents + 3 km-reglen — graduerede styrt, mekaniske uden DNF | F3 ✅ wiret 6/9 |
| M11 | Vejr-lag pr. etape, seeded | F3 |
| M12 | Effort pr. rytter (`protect`/`normal`/`save`) | F3 |
| M14 | AI-holds ordrer gennem samme type | F3 ✅ wiret 3/9 (harness) |
| M15 | Tidsgrænsen (UCI-reglen) + OTL som udfaldsklasse | F3 ✅ wiret 6/9 — se §2d |
| M16 | Holdspil — kaptajnen beskyttes, hjælperen betaler | F3 ✅ wiret 6/9 — se §2e |

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

**Grus er RAPPORTERET men ikke bånd-gatet** i `stageFinaleMetrics.js` — samme status som
`classic`. #4272's finale-bånd blev godkendt tal for tal 26/8, og grus fandtes ikke
dengang; et bånd for den kræver derfor en ejer-beslutning, ikke en PR.

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

> ⚠ **Reglen er inert mod v4's nuværende output.** Målt 6/9 over 984 etapekørsler (328 proxy-etaper × 3 seeds, 180-rytters felt fra populations-snapshottet): **0 OTL, 0 grupetto-redninger**. Største spredning mellem vinder og sidsteplads var 6,1 % på bjerg — mod en 15 %-grænse. v4 komprimerer feltet langt under virkeligheden, hvor en bjergetapes sidste mand er 20-30 minutter nede. Grænsen er sat efter UCI, ikke efter motorens nuværende spredning; at trimme den ned til under 6 % for at få reglen til at fyre ville gøre reglen forkert i stedet for at gøre motoren rigtig. Det er samme fejlfamilie som modsigelse 6 og 11 i §7. Kaldsstedet er verificeret: med en bredere `strengthSpeedGain` (motorens egen tuning-flade) sætter `simulateStageV4` OTL-status og emitterer eventet som den skal.

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

## 3. Invarianter (property-testede, må aldrig brydes)

1. **Determinisme.** Samme input ⇒ byte-identisk output. Per-rytter-hash, så én ekstra tilmelding ikke flytter andres relative udfald.
2. **Gruppe-tid.** Alle i samme mål-gruppe har identisk `time_seconds`.
3. **Monotoni.** Inden for samme gruppe kan lavere testet evne aldrig give bedre tid. Støj skalerer magnitude, aldrig fortegn.
4. **Km-dækning.** `0 ≤ km ≤ distance_km`, monotont ordnet, #2410-taksonomien håndhævet.
5. **Fog-gate ([#1791](https://github.com/NicolaiDolmer/CyclingZone/issues/1791)).** Ingen rå komponenter, vægte eller sandsynligheder i `events[].params`.
6. **Låst feltstørrelse ([#4615](https://github.com/NicolaiDolmer/CyclingZone/issues/4615)).** Lige så mange i mål som på startlisten, hver rytter præcis én gang, placeringer = en komplet permutation 1..N. Grupper splittes, smelter sammen og bliver til placerings-tiers hele vejen igennem; hvert skridt kan tabe eller duplikere en rytter, og fejlen ville vise sig som et forskudt anker-tal længe før nogen så årsagen. Feltet er nævneren i felt-sammenhængs-ankeret.
7. **Felt-sammenhæng ([#4615](https://github.com/NicolaiDolmer/CyclingZone/issues/4615)).** En massefinale afgøres på **placering**, ikke på tid: den ankomne pulje deler vindertiden, og rækkefølgen bæres af `EngineState.finish_order`. Selektive finaler (bjerg, punch, nedkørsel, udbrud, ITT) beholder individuelle tids-tiers — dér er tidsforskellene ægte.

8. **Tidsgrænsen flytter kun `status` ([#2582](https://github.com/NicolaiDolmer/CyclingZone/issues/2582), ejer 6/9).** M15 sætter `otl` og rører aldrig `rank`, `time_seconds`, `group_id` eller rækkefølgen. Invariant 3 og 6 er derfor uberørte per konstruktion, ikke ved en efterfølgende guard: en OTL-rytter bliver stående i resultatlisten, han er blot mærket. Hvad der sker med ham i DB'en er flip-lagets ansvar (§2d). Property-testet i `backend/lib/engine/v4/mechanics/timeLimit.test.ts`.

Invariant 6 og 7 er property-testet i `backend/lib/engine/v4/fieldIntegrity.test.ts` over evne-niveauerne 5/11/30/60/99, samme skala-invariant-form som #4604-load-guarden.

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
| F3 | Mekanik-bølge M5-M12 + taktik-kort | **delvis (2/9)** — se noten |
| F4 | Skygge-mode: runner-hook, sammenlignings-scorecard | ikke startet |
| F5 | Kalibrering i S3 → ejer-gate | ikke startet |
| F6 | Flag-flip i S3 på en hviledag | **ejer-gated** |

**F3-noten (målt 2/9, [#4604](https://github.com/NicolaiDolmer/CyclingZone/issues/4604), opdateret 3/9 [#4615](https://github.com/NicolaiDolmer/CyclingZone/issues/4615)).** "I gang" stod i denne tabel fra 21/8 til 2/9 uden at være efterprøvet. Tilstanden 2/9 var: `index.ts` kaldte **kun M2, M3 og M4** (plus M1, der bor i selve segment-loopet), og M5-M12 var kode uden kaldssted.

**Wiret 3/9 (#4615):** `SegmentHookContext` bærer nu `StageInput.orders` rå videre, `MechanicHooks` har et `breakaway`-felt, og motoren kalder **M5** (udbrud, hvert segment — efter climb/descent, før finale) og **M6** (leadout, inde fra finale-hooket, på den usorterede kontendentliste før sortering). **M14** producerer ordrer opstrøms og når kernen gennem `StageInput.orders` — derfor har den intet hook. Head-to-head-harnessen kan nu bygge realistiske holdplaner (`--orders=ai`) i stedet for at give alle `free_role` og en tom ordre-liste, som gjorde M6/M14 målbart død kode i scorecardet.

`TeamOrder` er **bevidst stadig den åbne `{team_id, kind, params}`-konvolut**, ikke T3-formen: hver mekanik parser sin egen `kind`. Rolle-vs-ordre-modsigelsen (#4246, modsigelse 1-2 i §7) er ejer-gated og må ikke låses ind i en frossen kontrakt som sidegevinst ved en wiring-PR. Når #4246 er afgjort, kollapser wrapperne til identitet, og afgørelsen skal bæres af `scripts/lib/headToHeadOrders.js`'s rolle-/ordre-tildeling. Taktik-kortet (UI) er stadig ikke bygget.

**v3 er låst fallback indtil F6.** Flippet er ejer-only og sker aldrig som sidegevinst ved en anden opgave.

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
| Rolle-vokabularet | intet i dag — se modsigelse 3 |
| Balance-bånd | `race:gate` + `balance:check` (advisory) |

---

## 7. Kendte åbne modsigelser

| # | Modsigelse | Issue |
|---|---|---|
| 1 | `hunter` er en **rolle**, `try_break` er en **ordre** — begge udtrykker "kør efter udbruddet". **Løst (ejer-beslutning 27/8 + 2/9, #4246):** rollen er standardordren for hele løbet, taktik-kortet vinder for den enkelte etape, rollen skrives aldrig om af kortet. `race_role` er dog stadig fejlagtigt et sat-bart felt i selve `TeamOrder`-bodyen (`raceTeamOrdersApi.js`, `teamOrdersAdapter.ts`) — udestående oprydning, se spec §4 | denne fil §1 + tactics-spec + [decision-spec](superpowers/specs/2026-09-03-role-vs-teamorder-decision.md) |
| 2 | `sprint_captain` (rolle) overlapper `leadout_for` (F3-ordre) på samme måde. Samme løsning som #1 gælder generelt (rolle = default, ordre = etape-overlay) — ikke separat afklaret pr. rollepar | samme |
| 3 | Rolle-vokabularet havde ingen gate. **Løst 3/9:** `backend/lib/raceRoles.test.js` låser de fem værdier | denne fil §1 |
| 4 | `race:gate:routes` er permanent rød; `longDayEnduranceLift`-båndet står på middelværdien | [#4197](https://github.com/NicolaiDolmer/CyclingZone/issues/4197) |
| 5 | `balance:check` tæller 98 afvigelser på main, men er advisory | [#4196](https://github.com/NicolaiDolmer/CyclingZone/issues/4196) |
| 6 | v4's head-to-head-gate er fortsat rød, men to af de tre ankre er nu inde. Genmålt 2/9 over 5 seeds efter bjerg-ankeret: **bjerg-top-10-spredning 211 s (177-237) mod båndet 180-240** · **sprinter-vinderrate 99,7 % (99,1-100) mod båndet ≥ 90 %** · nedkørsels-/summit-ratio 1,07 (0,92-1,21) mod båndet ≤ 0,5. Nedkørslen er det sidste af de tre | [#4132](https://github.com/NicolaiDolmer/CyclingZone/issues/4132) · [#4604](https://github.com/NicolaiDolmer/CyclingZone/issues/4604) |
| 7 | `raceRouteRealismScorecard` måler sin egen plan, ikke basen | [#4219](https://github.com/NicolaiDolmer/CyclingZone/issues/4219) |
| 8 | **Head-to-head-scorecardet er seed-domineret.** Samme kode, samme kalender, fem seeds: sprinter-ankeret svinger ~12 procentpoint til hver side. Etaper med samme etapenummer deler feltsample OG motor-seed, så n=117 flade etaper er reelt ~20 uafhængige træk. Et enkelt-seed-tal kan derfor hverken erklære et anker grønt eller rødt — scorecardet skal aggregere over seeds før det kan gate noget. **Ejer-beslutning 2/9: gaten måles som 5-seed-middel med spænd; fejlrettelser der løfter alle ankre uden regression må merges som fundament (#4606), mens båndkravene forfølges pr. anker** | [#4604](https://github.com/NicolaiDolmer/CyclingZone/issues/4604) |
| 9 | `positioning` og `tactics` står i `AbilityKey` og vægter i finalens demand-vektorer, men **ingen rytter i spillet har dem** (0 af 5.938 i S3-populationen). Vægten falder tavst på gulvet, så bl.a. massespurt-finalen afgøres på en mindre del af sin egen vektor end tabellen antyder | [#4604](https://github.com/NicolaiDolmer/CyclingZone/issues/4604) |
| 10 | **Felt-favoritters win-rate (bånd 25-40 %) var 83,2 % 2/9 fordi mekanikkerne ikke var wiret.** Efter #4615's wiring falder den (målt 3/9 over 5 seeds mod en offline proxy-kalender: 57,7 %) men er stadig rød. Cellen forfølges ved at koble mekanikkerne på, **aldrig ved at straffe styrke** (ejer 4/8). Oprindelig note: Målt 2/9 over 5 seeds: 53,7 % før bjerg-ankeret, 83,2 % efter. Båndet forudsætter at udbrud og holdtaktik af og til vinder — M5 (udbrud), M6 (leadout) og M14 (AI-taktik) er skrevet og testet, men kaldes ikke af `index.ts`, så den stærkeste rytter vinder næsten altid. Cellen skal forfølges ved at koble mekanikkerne på, **aldrig ved at straffe styrke** (ejer 4/8). Jo bedre fysiologien virker, jo højere stiger tallet — det er en måler på manglende mekanik, ikke på balance | [#4604](https://github.com/NicolaiDolmer/CyclingZone/issues/4604) |
| 11 | **Bjerg-top-10-ankeret er kun meningsfuldt ved realistisk feltstørrelse.** Samme kode scorer 211 s ved 180 ryttere og 19 s ved hele populationen (5.938) — målet er sekundbaseret og skalerer med feltet, fordi en stor peloton giver en stor frontgruppe. Kørsel B (180) er gaten, jf. scorecard-metodologien 23/8; kørsel A's tal er ikke et mål for dette anker | [#4604](https://github.com/NicolaiDolmer/CyclingZone/issues/4604) |
| 12 | **App-lag løst 4/9 (#4746), DB-lag stadig åbent:** `EXCLUSIVE_ROLES` (frontend) og backend-guarden (`raceStageRolesApi.validateStageRoleOverrides`) håndhæver nu `hunter` på etape-taktikken (`race_stage_roles`), samme mønster som `captain`/`sprint_captain` — en ny hunter degraderer den forrige i UI'et, og et rå API-kald med 2+ huntere afvises. Holdudtagelsen (`race_entries`) håndhævede allerede `hunter` unikt via DB-constraint. Målt 3/9 (før fixet): 119 af 760 hold-etape-hunter-grupper (15,7 %) havde mere end én hunter, op til 6 samtidig — de RÆKKER er ikke ryddet op (ingen DB-migration i #4746's PR: en unique-constraint på `race_stage_roles` ville fejle mod dem med det samme, og en oprydning er destruktiv/ejer-gated). A/B-forslag + begrundelse i [decision-spec](superpowers/specs/2026-09-03-role-vs-teamorder-decision.md) §5 (denne PR bygger forslag A, kun i app-laget) | [#2405](https://github.com/NicolaiDolmer/CyclingZone/issues/2405) · [#4746](https://github.com/NicolaiDolmer/CyclingZone/issues/4746) |

| 12 | **Sprinter-vinderraten (≥ 90 %) og felt-sammenhængen (80-95 %) trækker mod hinanden når M5 er wiret.** Et udbrud der overlever en flad etape gør begge ting på én gang: vinderen er ikke en sprinter, og kun udbryderne deler vindertiden. Målt 3/9 over 5 seeds efter wiringen: felt-sammenhængen steg fra ~1 % til 17,7 % (bånd 80-95 %), mens sprinter-ankeret faldt fra ~91 % til 85,0 %. Begge tal er styret af den samme størrelse — hvor ofte et udbrud går hele vejen — og på en flad etape går det i dag hele vejen langt oftere end i virkeligheden. Det er en kalibrering af jagt-modellen, ikke en wiring-mangel, og den er ejer-gated | [#4615](https://github.com/NicolaiDolmer/CyclingZone/issues/4615) |
| 13 | **To led i jagt-modellen er absolutte konstanter målt mod en evne-relativ skala** (samme fejlfamilie som #4604/#4606): sen-etape-uroen og udbruddets størrelses-bonus. Mod den ægte population (median-evne 11/99) er de evne-afledte led en brøkdel af deres tiltænkte størrelse mens konstanterne står uændret. En naiv relativisering af begge led blev prøvet og **målt 3/9: den forværrede bjerg-ankeret** (207 → 247 s mod bånd 180-240) og blev rullet tilbage. Rettelsen kræver sin egen kalibrering med ejer-go, ikke en sidegevinst | [#4615](https://github.com/NicolaiDolmer/CyclingZone/issues/4615) |
| 14 | **v4 komprimerer feltet så hårdt at tidsgrænsen (§2d) aldrig bider.** Målt 6/9 over 984 etapekørsler (328 proxy-etaper × 3 seeds, 180-rytters felt): 0 OTL, 0 grupetto-redninger. Største spredning vinder-til-sidsteplads var 6,1 % på bjerg (median 3,5 %) mod en 15 %-grænse; på fladt var medianen 0,3 %. I virkeligheden er sidste mand på en bjergetape 20-30 minutter nede. Grænsen er sat efter UCI's bånd, som ejeren låste 6/9 — den må **ikke** trimmes ned under motorens nuværende spredning for at få reglen til at fyre; det ville gøre reglen forkert i stedet for at gøre motoren rigtig. Samme fejlfamilie som modsigelse 6 og 11: et sekundbaseret mål mod en for kompakt motor. Mekanikken er bygget, wiret og verificeret (kaldsstedet fyrer med en bredere `strengthSpeedGain`), men er inert indtil spredningen er kalibreret | [#2582](https://github.com/NicolaiDolmer/CyclingZone/issues/2582) · [#4604](https://github.com/NicolaiDolmer/CyclingZone/issues/4604) |

**Bjerg-ankerets måleflade (ejer-beslutning 2/9, [#4604](https://github.com/NicolaiDolmer/CyclingZone/issues/4604)).** Bjerg-top-10-spredningen måles **kun på topankomster** — bjergetaper der slutter på toppen. En bjergetape der slutter på en nedkørsel hører til nedkørsels-ankeret, som netop kræver at de etaper er tættere; da begge ankre tidligere midlede over de samme etaper, kunne de to bånd ikke opfyldes samtidigt.

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

**Fog of war (ejer 6/9):** ingen procenter, multiplikatorer eller grænser på spillerens skærm. Han ser "taber 40 sek.", "ude i 4 dage", "uden for tidsgrænsen".
