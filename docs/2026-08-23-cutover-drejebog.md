# Cutover 23/8 — drejebog pr. komponent

**Status: EJER-BESLUTTET 17/8.** Udkastet fra 15/8 stillede fire spørgsmål; alle er besvaret af ejeren 17/8 (bølge 2-sessionen), plus økonomi-beslutning 4+5 fra #3757. Alle tilstands-tal er målt read-only mod prod (`ghwvkxzhsbbltzfnuhhz`) 15/8. Der er ikke flippet noget endnu.

Hvor der står **ikke verificeret**, er det fordi det ikke er målt. Der står aldrig et gæt i stedet.

---

## Ejer-beslutninger 17/8

| # | Spørgsmål | Beslutning |
|---|---|---|
| 1 | Reduceres 23/8 til race-day-flippet alene? | **Nej — alle fire komponenter forsøges 23/8.** Udkastets anbefaling (reducér) blev afvist. |
| 2 | Spillerbesked om AI-loft-korrektionen før flippet? | **Ja.** Udkast EN+DA skrives i bølge 2; ejeren poster selv. |
| 3 | Hvem skriver caps-gendannelses-scriptet? | **Bølge 2 spor 1**, tør-køres mod staging-branchen `staging-3746-trin7` (prod-kopi) før 23/8. Apply er ejer-gated. |
| 4 | #3514 mandat droppet? | **Nej — genoplivet til 23/8.** |
| Ø4 | Lønnens grundlag (fra #3757) | **Ankerværdien**, ikke den viste værdi. Lønnen er en egenskab ved rytteren; manager-valg kan ikke flytte lønbyrden (målt spænd ellers op til faktor 2,6). |
| Ø5 | anchorSalary-kalibrering (fra #3757) | **Ét globalt A, kalibreret hver sæsonovergang mod ~35 % af målt indtægt.** Indtægtssiden genmåles FØR første kalibrering (#3730-sponsor + #3719/#3720-præmiedrift gør 14/8-tallene forældede). |

**"Forsøges" betyder gated, ikke garanteret:** hver komponent flipper kun hvis dens klar-gate er grøn senest 22/8 (se pr. komponent). Race-day (#3459) er den eneste der er klar i dag. En komponent der ikke når sin gate, udskydes til sin egen dato — den trækker ikke de andre med sig.

## Tilstand målt 15/8 + gate pr. komponent

| # | Komponent | Status 15/8 | Gate for 23/8 |
|---|---|---|---|
| 1 | Markedsvægt `global_weight` → 1,0 | #3449 draft; config-nøglerne **findes ikke i prod** (målt: 0 rækker); model-artefaktet fittet på forældet typefordeling (74,8 % divergens); #3750: modellen trænes på en konstant | #3750-fixet merged · refit måler MINDST lige så godt som den kørende model · config-migration klar · dry-run af søndags-sweepet mod staging |
| 2 | #3393 løn efter markedsværdi | Draft-PR bygget, var gated på beslutning 4+5 — **nu truffet (Ø4+Ø5)** | PR omskrevet til ankerværdi + globalt A · indtægtssiden genmålt · genberegnings-script dry-run mod staging · afhænger af 1 på dagen |
| 3 | #3459 race-day-flip | **Færdig.** Kun flippet mangler. Målt: `race_day_engine_enabled = 'off'` | Snapshot taget + verificeret læsbart · gendannelses-script tør-kørt · spillerbesked postet |
| 4 | #3514 mandat-migration | **Bygget 17/8** (bølge 2): inert DDL + backfill-script, 55 tests grønne, dry-run mod prod + fuld skrive-gennemkørsel mod staging | ✅ alle fire krav opfyldt 17/8, se komponent 4-afsnittet |

## Rækkefølgen på dagen (bindende)

Udkastets regel "ét flip, én dag" er **overstyret af ejeren 17/8**. I stedet gælder en bindende rækkefølge med stop-gate mellem hver komponent — en rød verifikation stopper ALT efterfølgende, aldrig kun sin egen komponent:

1. **Snapshot** (alle tabeller, se komponent 3) — verificeret læsbart.
2. **Race-day-flippet** (#3459) — tidligt på dagen, i vågen tid. Verifikation 1-3 grønne før næste skridt.
3. **Markedsvægt** (komponent 1) — 23/8 ER en søndag, så søndags-sweepet kan køre naturligt. Kun hvis gate 1 var grøn 22/8.
4. **Løn-genberegning** (komponent 2) — ALTID efter 3 (værdier før løn, aldrig omvendt). Kun hvis gate 2 var grøn.
5. **Mandat-migration** (komponent 4) — sidst, mindst modne komponent. Kun hvis gate 4 var grøn.

Hvert skridt er ejer-gated på dagen: ejeren ser live-tilstanden og siger go pr. skridt (27/6-reglen — ingen kæde af mutationer uden ejer-øjne imellem).

---

## Komponent 3 — race-day-flippet (#3459)

Den eneste der er klar, og derfor den eneste der er skrevet ud i fuld længde.

### Hvad flippet gør

`race_day_engine_enabled` går fra `'off'` til `'on'`. Følgen er ikke kun at motoren tænder:

- `dailyTrainingEngine` begynder at dække **AI-hold**. `trainingSweep` filtrerer i dag på `is_ai = false` netop fordi flaget er off (`backfillCores.js:307`, `trainingSweep.js:72`).
- `aiRecoverySweep` bliver et **no-op** (`aiRecoverySweep.js:145-152`) — dailyTrainingEngine overtager AI-holdenes restitution.
- Ryttere der har kørt løb samme dag rammer den gensidigt udelukkende gren i `dailyTraining.js:234`: løbsdagen ERSTATTER træningspasset, ganges med devMult (~1,15) og omfordeles over løbsprofilens relevante evner.
- Recovery-parametrene skifter til `RACE_DAY_ENGINE_RECOVERY_CONFIG` (`raceFatigue.js:178`).

### Hvad kan IKKE rulles tilbage

**Dette er dokumentets vigtigste afsnit.**

Når `dailyTrainingEngine` tikker AI-holdene for første gang, **genopbygges deres `ability_caps` med alder** via `buildCapsForRider`. Deres nuværende caps er aldrig blevet aftrappet, fordi de udelukkende kom fra `backfillCores` uden alders-argument (#3591). Målt på dateret snapshot 10/8: **kun 46 af 3.473 AI-rytteres caps matcher noget `buildCapsForRider`-output overhovedet, og 45,4 % taber loft alene ved kaldformen (p10 Δ bedste-af-8 loft-rating −29).**

At sætte flaget tilbage til `'off'` **gendanner ikke de gamle caps.** Flaget styrer hvilken motor der kører, ikke hvad den allerede har skrevet. En rollback kræver at caps skrives tilbage fra snapshottet — hvilket er en population-mutation med sin egen ejer-gate.

Ingen rytter kan miste *evne* (`buildCapsForRider` returnerer `max(tapered, current)`, så gulvet er rytterens nuværende evne). Det er **loftet** der falder — og det er et spiller-vendt tal.

**Ejer-beslutning 17/8:** spillerne får besked FØR flippet (beslutning 2 ovenfor). Præcis læringen fra #3709: spillerne så det selv, før vi meldte det.

### Snapshot før

**Skal tages, og skal verificeres læsbart før flip:**

| Tabel | Kolonner | Hvorfor |
|---|---|---|
| `rider_derived_abilities` | `rider_id, ability_caps, ability_progress` | Det eneste der ikke kan rekonstrueres efter tikket |
| `riders` | `id, primary_type, secondary_type, archetype_draw, potentiale, birthdate` | Klassifikations-grundlaget caps afledes af |
| `app_config` | hele tabellen | Flag-tilstand før |

Hvor det gemmes: `docs/snapshots/3459/` efter samme mønster som `docs/snapshots/3591/`. Snapshot-script + gendannelses-script bygges i bølge 2 spor 1 (ejer-beslutning 3) og tør-køres mod `staging-3746-trin7`.

### Rollback: konkret

```sql
-- Trin 1: stop videre skade (idempotent, ikke destruktivt)
update app_config set value = 'off' where key = 'race_day_engine_enabled';
```

Det stopper motoren. Det gendanner **ikke** caps. Trin 2 (gendan caps fra snapshot) er en population-mutation — scriptet bygges og tør-køres i bølge 2 spor 1 FØR flippet. Et rollback man ikke har prøvet, er ikke et rollback.

### Hvor længe er vinduet

S3 starter **24/8**, dagen efter. Så snart en etape er kørt under den nye motor, er resultaterne en del af sæsonens historik, og et cap-rollback ville gøre resultater og lofter indbyrdes uenige.

**Praktisk vindue: fra flip til første etape under ny motor** — under et døgn, og kortere end det ser ud, fordi det daglige tick kommer først. **Ikke verificeret:** det præcise tidspunkt for det daglige tick i forhold til etape-scheduleren.

Flip **tidligt** søndag, ikke sent, så vinduet ligger i vågen tid — og så der er plads til komponent 1/2/4 efter.

### Verifikation pr. skridt

Umiddelbart efter flip, før næste tick:

1. `select value from app_config where key = 'race_day_engine_enabled'` → `'on'`.
2. Sentry: ingen nye issues på træningsstien inden for 15 min.
3. `aiRecoverySweep` logger "sprunget over — race_day_engine_enabled=on".

Efter første tick:

4. **Loft-deltaet på AI-hold mod snapshottet.** Stop-grænse: mediant loft-tab over p10-tallet fra 10/8 (Δ −29) betyder at noget andet end den forventede aftrapning er i gang.
5. Ingen rytter har mistet *evne* (ikke bare loft). Ét eneste tilfælde = stop.
6. Antal ryttere tikket ≈ AI-ryttere + menneskeryttere. Langt under = sweepet filtrerer forkert.

En rød verifikation her stopper OGSÅ komponent 1/2/4 samme dag.

### Hvem beslutter

**Ejer-gated på dagen:** selve flippet (27/6-reglen — gen-tænde/tænde et live spiller-vendt system er ejer-only; ejeren skal have set live-tilstanden). **Besluttet i forvejen 17/8:** spillerbesked før flippet — udkast skrives i bølge 2, ejeren poster.

---

## Komponent 1 — markedsvægt (GATE MÅLT RØD 17/8 — UDGÅR 23/8)

Bølge 2 spor 9 (PR #3836, merged) kørte hele klargøringen: #3750-filteret (1.288 rå handler → 391 kvalificerede), refit med evidensvægt pr. rytter, inert config-migration (nøglerne findes nu i prod: sweep off, vægt 0), staging-dry-run. **Gaten er RØD:** refittet måler dårligere end den kørende model på alle tre mål (MAE 29.831 mod 20.572 CZ$, holdout n=78). Per gate-reglen udgår komponenten 23/8.

**Nøglefundet der ændrer den videre vej:** den kørende model × én konstant (0,422) slår både sig selv og refittet — markedet er enigt om RANGORDENEN og uenigt om NIVEAUET med faktor ~2,4 (bank-auktioner clearer 0,33×, spillerauktioner 0,26×, forhandlede 0,78×). Dertil bekræftede tørkørslen audittens grund 3: blend-sweepet omfordeler monotont fra dyre til billige ryttere (doktrin-brud: straffer styrke). **Anbefalet vej: niveau-korrektion (én konstant), ikke modelskifte** — egen beslutning + måling, hører i værdi/løn-design-sessionen. Scorecard: `docs/audits/2026-08-17-vaerdimodel-refit-scorecard.md`.

**Spillerbeskeden:** hverken 23/8-varianten ELLER 30/8-fallbacken (75/25-løftet) kan postes som de står — begge afventer design-sessionens retning.

## Komponent 2 — løn (#3393, afventer fælles design — flipper ikke 23/8)

**Ejer-valg 17/8 i bølge 2:** #3393 designes færdig SAMMEN med ejeren før den bygges om. Dertil: under den bindende rækkefølge (værdier før løn) kan den ikke flippe når komponent 1 er RØD — medmindre ankerværdi-grundlaget (beslutning Ø4) afkobler den fra markedsvægten; det spørgsmål ejes af design-sessionen.

Beslutning 4+5 er truffet 17/8 (Ø4+Ø5 ovenfor): **ankerværdien som grundlag, ét globalt A kalibreret mod ~35 % af målt indtægt.** Det afblokerer PR'en, som skal:

1. Omskrives fra vist værdi til ankerværdi (`calibrateAnchorSalary()` i `salaryBasis.js` findes allerede, bruges ikke af `salaryBasisRecompute.js`).
2. **Genmåle indtægtssiden** før A kalibreres — 14/8-tallene (D2 44,5 %, D3 15,9 %, D4 55,4 %) er forældede efter #3730's 7,95 M sponsor-udbetaling og #3719/#3720's præmiedrift.
3. Genberegnings-script med dry-run mod staging; tal fremlægges.

Målt effekt hvis 1+2 kører (simulering af den gamle formel, ikke live løn): D2-lønudgift −33,8 % ved konvergens, D3/D4 +10 %. **Skal genmåles med ankerværdi-grundlaget.**

**Rækkefølgen er bindende: 1 før 2, aldrig omvendt.** Lønnen regnes af værdier; flyttes værdierne ikke, er der intet nyt at prissætte efter.

## Komponent 4: mandat-migration (#3514, genoplivet 17/8)

Ejeren omgjorde drop-anbefalingen 17/8. Bygget i bølge 2 (PR for fase 1a/1b). Alle tal nedenfor er målt: dry-run mod prod (kun SELECT) og fuld skrive-gennemkørsel mod staging `staging-3746-trin7`, begge 17/8.

### Hvad migrationen gør

Den oversætter hvert holds tre bestyrelsesplaner til én relation, ét mandat og en visionstidslinje:

| Fra (uændret, bliver stående) | Til (ny, tom indtil scriptet kører) |
|---|---|
| `board_profiles(1yr).current_goals` | `board_mandates` (sæsonens mandat, mål uændrede) |
| `board_profiles(3yr/5yr).current_goals` | `board_vision_milestones` (én milepæl pr. mål, med planens EGEN slut-sæson) |
| `satisfaction` 1yr/3yr/5yr | `board_relations.confidence` (50/30/20-vægtet, ejer-beslutning 7) |

**Den rører ikke `board_profiles` med ét eneste felt.** Den gamle model står urørt bagved. Kill-switchen `board_mandate_model_enabled` (app_config, seedet `'off'`) afgør hvilken model der læses.

To ting er værd at vide, fordi de er valg og ikke tilfældigheder:

- **Aldrig-underskrevne 3/5-års-forhandlinger udelades.** 22 rækker i prod (19 × 3yr, 3 × 5yr) står `pending` uden start-/slut-sæson og med 0 kørte sæsoner. Deres satisfaction er uden undtagelse præcis 50 (default-værdien). De tæller hverken i tallet eller i visionen. 1-års-planer udelades aldrig af reglen; `pending` er deres normale tilstand ved sæsonskiftet (147 af 208 rækker 17/8).
- **Vægtene renormaliseres når en plan mangler.** 32 hold har ingen 3-års-plan, 24 ingen 5-års. At tælle en manglende plan som 0 ville straffe hold for noget de ikke har gjort.

**Målte tal (prod-dry-run 17/8, 208 hold):**

| Tal | Værdi |
|---|---|
| Mandater der oprettes | 208 |
| Visions-milepæle | 1.800 (1.243 headline) |
| Confidence | min 19 · p10 39 · median 62 · p90 93 · max 100 |
| Hold der krydser en NY konsekvens-tærskel | **0** |
| Hold der slipper UD af et konsekvens-lag | 34 (lag 2: 16 · lag 3: 12 · lag 4: 11 · lag 5: 6) |
| Hold der mister bonustilbuds-båndet (>75) | 24 |
| Tillids-trappen (staging) | 9 hold får 1 justering · 127 får 2 · 71 får 3 |

De 0 nye tærskel-krydsninger er ikke held: et vægtet snit kan matematisk ikke ligge under sit eget minimum, og scriptets selvtest bevogter invarianten med 2.000 tilfældige tilfælde før den rører en database. De 24 hold der mister bonus-båndet er derimod en **reel, tilsigtet følge**: de var over 75 på ÉN plan og lavere på de andre, og samlet set var de aldrig over 75. Det er præcis den forskel spillerne i dag oplever som "dashboard 65 % vs. board 67 %".

### Rækkefølgen på dagen

Komponent 4 er **sidst** af de fire (se den bindende rækkefølge ovenfor), den er den mindst modne. Internt i komponenten:

1. Backup-tabellen `backup_board_profiles_3514_<yyyymmdd>` oprettes og verificeres.
2. DDL'en (`database/2026-08-18-3514-mandate-model.sql`) er allerede applied ved merge, den er inert og skal blot verificeres til stede.
3. Dry-run køres **live på dagen** mod prod. Ejeren ser scorecardet.
4. Ejer-go → `--apply --jeg-har-set-scorecardet`. Post-verify kører automatisk.
5. Kill-switchen står stadig `'off'`. **Flippet til `'on'` er et separat skridt** og hører sammen med UI-flippet få dage senere, ikke med 23/8.

Punkt 5 er det vigtigste: 23/8 skriver vi data, vi tænder ikke noget. Det gør komponent 4 til den mest ufarlige af de fire, og det er også derfor den ikke blokerer noget andet.

### Hvad kan IKKE rulles tilbage

**Meget lidt, og det er bevidst designet sådan.**

Migrationen er rent additiv: den skriver kun til tre helt nye, tomme tabeller. Ingen eksisterende spillerdata overskrives. Rollback er derfor ikke en datareparation, men et flag der allerede står i sikker stilling.

Det ene der IKKE er additivt er én skema-ændring på en eksisterende tabel: `board_satisfaction_events.board_id` går fra NOT NULL til nullable, og to nullable FK-kolonner (`mandate_id`, `milestone_id`) tilføjes. At løsne en not-null er bagudkompatibelt, ingen eksisterende række bliver ugyldig, ingen eksisterende skriver udelader feltet. At sætte den tilbage til NOT NULL kræver dog at rækker med `board_id IS NULL` først fjernes. Så længe kill-switchen aldrig har været `'on'`, er der ingen sådanne rækker, og tilbagerulningen er triviel.

**Kvitterings-rækkerne** (`reason_category = 'board_model_updated'`, én pr. hold) er den eneste skrivning til en eksisterende tabel. De er synlige for spilleren i referat-feedet, men først når UI'et flipper. De kan slettes målrettet på `reason_category`.

### Snapshot før

Spor 1's generiske snapshot-værktøj skal dække disse tabeller for komponent 4:

| Tabel | Kolonner | Hvorfor |
|---|---|---|
| `board_profiles` | **hele tabellen** | Kilden alt udledes af. Skal kunne læses tilbage kolonne for kolonne, ikke kun tælles. |
| `board_satisfaction_events` | `id, board_id, team_id, season_id, reason_category, created_at` | Så de tilføjede migrations-kvitteringer kan skelnes fra de eksisterende |
| `board_consequences` | hele tabellen | Konsekvens-tilstanden FØR, så et bånd-skifte kan bevises frem for påstås |
| `app_config` | hele tabellen | Flag-tilstand før (fælles med komponent 3) |
| `team_board_members` | hele tabellen | Uændret af migrationen, men fase 2 giver medlemmerne navne, udgangspunktet skal stå fast |

De tre nye tabeller behøver **intet** snapshot: de er tomme før, og rollback er at tømme dem.

Hvor det gemmes: `docs/snapshots/3514/`, samme mønster som `docs/snapshots/3591/`.

### Rollback: konkret

```sql
-- Trin 1: kill-switchen (den står allerede sådan 23/8, dette er for det tilfælde
-- at den er flippet ved UI-flippet nogle dage senere). Fuld tilbagevenden til
-- den gamle model, øjeblikkeligt, uden datatab.
update public.app_config set value = '"off"'::jsonb where key = 'board_mandate_model_enabled';

-- Trin 2 (kun hvis data skal væk igen, normalt UNØDVENDIGT, tabellerne er inerte):
delete from public.board_satisfaction_events where reason_category = 'board_model_updated';
truncate public.board_vision_milestones;
truncate public.board_mandates;
truncate public.board_relations;

-- Trin 3 (kun hvis skemaet skal helt tilbage, kræver at trin 2 er kørt):
-- alter table public.board_satisfaction_events alter column board_id set not null;
```

Trin 1 er prøvet: hele skrive-gennemkørslen mod staging 17/8 blev udført med flaget på `'off'` hele vejen, og appen læste uændret fra `board_profiles`. Trin 2 er prøvet i den forstand at hele backfillen er kørt to gange mod staging og er idempotent (anden kørsel oprettede 0 nye rækker).

**Forbehold, og det er et ægte hul:** staging-gennemkørslen blev udført som SQL der spejler scriptets regler 1:1, ikke som scriptet selv. Agent-sessionen har ikke adgang til stagings service-nøgle (secret-reglen), og scriptet skriver gennem supabase-js. Scriptets LÆSE-sti, planlægger og scorecard er derimod kørt direkte mod prod. Det der IKKE er bevist er scriptets egen skrivekode mod en rigtig database. Staging-kørslen fandt til gengæld den ene fejl der faktisk var i skrivestien (partial unique index kan ikke bruges som ON CONFLICT-mål), og den er rettet i DDL'en. **Anbefaling: kør scriptets `--apply` mod staging med ejerens nøgle FØR 23/8, så den sidste sti også er prøvet.**

### Hvor længe er vinduet

**Der er reelt ikke noget vindue at tabe**, og det er forskellen på denne komponent og komponent 3.

Fordi migrationen ikke tænder noget, findes der ingen tilstand hvor spillet skriver videre oven på migrerede data. `board_profiles` bliver ved med at være sandheden indtil kill-switchen flippes. Kører migrationen 23/8 og flippes UI'et først 27/8, kan backfillen køres om når som helst i mellemtiden (den er idempotent) uden at nogen spiller har set noget.

Det ægte vindue åbner ved **UI-flippet**, ikke ved migrationen: fra det øjeblik confidence er det tal spilleren ser, er hver senere weekend-opdatering skrevet mod den nye model. Det vindue håndteres i UI-flip-PR'en, ikke her.

**Ikke verificeret:** om S3's sæsonstart-jobs (`processSeasonStart`) rører `board_profiles` mellem migrationen 23/8 og UI-flippet. Kører migrationen før sæsonskiftet og ændrer sæsonstarten satisfaction, vil confidence være regnet på forældede tal. **Derfor: kør backfillen EFTER dagens øvrige komponenter og efter sæsonskiftet, eller kør den om lige før UI-flippet.** Den er idempotent, så en genkørsel er gratis.

### Verifikation pr. skridt

Scriptet kører selv 1-3 og stopper med exit 1 hvis noget fejler.

Før skrivning:
1. Selvtest: 6 kendte regnestykker + 2.000 tilfældige monotoni-tjek. Fejler den, røres databasen aldrig.
2. Backup-tabellen findes og har mindst lige så mange rækker som `board_profiles`.
3. Scorecardet viser **0 hold der krydser en ny konsekvens-tærskel**. Ét eneste = stop. **Baseline-definition (afgjort 17/8 efter to-agenters-uenighed, se learning `2026-08-17-to-agenter-to-baselines-samme-tal.md`): baseline er de AKTIVE rækker i `board_consequences`, aldrig en genberegning af hvad reglerne burde have produceret.** Målt facit 17/8: 0 nye negative konsekvenser, 34 lettelser, 3 hold (Indeso, Purple Rain, Xtreme Noob) mister bonus-berettigelse — deres IGANGVÆRENDE tilbud løber til naturligt udløb (grandfather; teknisk valg 17/8, ejer informeret). De 22 aldrig-underskrevne 3/5-års-forhandlinger (satisfaction præcis 50 = default-støj) indgår ikke i confidence.

Efter skrivning:
4. Én relation pr. hold, ingen dubletter.
5. Ingen confidence uden for 0-100, og hver relation har en `confidence_source.method`, et tal uden kvittering er den tilstand reworket findes for at afskaffe.
6. Ingen milepæl uden mål-sæson.
7. `board_profiles` har **præcis samme rækkeantal** som før. Ændrer det sig, har noget andet end migrationen skrevet.
8. `board_mandate_model_enabled` er stadig `'off'`.

Manuelt bagefter (ejeren, 2 minutter):
9. Åbn `/board` som en almindelig spiller. Alt skal se **fuldstændig uændret ud**, samme tre tal, samme faner. Ser det anderledes ud, er flaget flippet ved et uheld.

En rød verifikation her stopper **kun** komponent 4. Den er sidst på dagen og blokerer intet andet.

### Hvem beslutter

**Ejer-gated på dagen:** selve `--apply`-kørslen (population-skrivning; ejeren skal have set scorecardet live, ikke kun dry-run-tallene fra 17/8; 27/6-reglen). Scriptet nægter at skrive uden `--jeg-har-set-scorecardet`.

**Ejer-gated separat, ikke 23/8:** flippet af kill-switchen til `'on'`. Det er et spiller-vendt systemskifte og hører sammen med UI-flippet.

### Gate-status pr. 17/8

| Krav | Status |
|---|---|
| Migration bygget | ✅ DDL inert + backfill-script med dry-run/apply-gate |
| Testet | ✅ 55 unit-tests grønne (model, motor, navne) |
| Dry-run mod staging | ✅ Fuld skrive-gennemkørsel + idempotens-bevis + 0 invariant-brud (se forbehold nedenfor) |
| Syv-punkts-sektion | ✅ denne sektion |
| **Kan komponent 4 flippe 23/8** | **GRØN** for migrationen. UI-flippet er ikke 23/8 og har sin egen gate. |

---

## Status efter bølge 2 (17/8 aften): 23/8 = race-day + mandat-backfill

Komponent 1 RØD (udgår), komponent 2 afventer design-session, komponent 3 KLAR, komponent 4 GRØN for backfillen. Værktøjet (PR #3835) er merged og bevist mod staging.

## Huller pr. 17/8

- Det daglige ticks tidspunkt i forhold til etape-scheduleren er ikke målt.
- **Komponent 3's stop-grænse (Δ −29) står i før-#3666-rating-enheden og kan ikke bruges som gate uden genmåling** (spor 1-fund 17/8); gendannelses-værktøjet rapporterer i rå loft-enheder — genmål grænsen FØR 23/8.
- Mandat: script-apply mod staging med ejerens egen nøgle udestår (agent-sessionen havde ikke stagings service-nøgle).
- Løn-effekten er ikke genmålt med ankerværdi-grundlag (hører i design-sessionen).
- Om `processSeasonStart` rører `board_profiles` mellem migrationen og UI-flippet er ikke målt (komponent 4).

Refs #3645 #3459 #3449 #3393 #3514 #3591 #3709 #3757
