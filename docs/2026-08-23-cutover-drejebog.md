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
| 4 | #3514 mandat-migration | Intet bygget (var anbefalet droppet — ejeren genoplivede 17/8) | Migration bygget + testet · genberegnings-script dry-run mod staging · egen syv-punkts-sektion skrevet her |

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

## Komponent 1 — markedsvægt (forsøges, gated)

Var blokeret i 15/8-udkastet; ejeren valgte 17/8 at den forsøges. Det kræver at ALLE disse falder på plads senest 22/8:

1. **#3750-fixet:** modellen trænes i dag på en konstant — det skal rettes før et refit betyder noget.
2. **Refit** af værdimodellen på nuværende typefordeling (den gamle er 74,8 % divergent) — og refittet skal måle MINDST lige så godt som den kørende model. Auditten 14/8 målte den gamle dårligere; det krav står ved magt.
3. **Config-migration:** `market_value*`-nøglerne findes ikke i prod (målt 15/8: 0 rækker). Idempotent migration skrives + reviewes før merge.
4. **Dry-run** af søndags-sweepet (`marketValueSundaySweep.js`) mod staging med refittet artefakt; tal fremlægges for ejeren.

23/8 er en søndag, så sweepets søndags-gate er ikke et problem. **Spillerbeskeden:** ejerens udkast fra 14/8 melder værdi-blandingen udskudt til 30/8 — det SKAL omskrives før posting, ellers modsiger beskeden cutoveren (håndteres i bølge 2).

**Når gaten ikke grøn:** komponent 1 OG 2 udskydes sammen (rækkefølgen værdier-før-løn er bindende), race-day flipper stadig.

## Komponent 2 — løn (#3393, forsøges, gated)

Beslutning 4+5 er truffet 17/8 (Ø4+Ø5 ovenfor): **ankerværdien som grundlag, ét globalt A kalibreret mod ~35 % af målt indtægt.** Det afblokerer PR'en, som skal:

1. Omskrives fra vist værdi til ankerværdi (`calibrateAnchorSalary()` i `salaryBasis.js` findes allerede, bruges ikke af `salaryBasisRecompute.js`).
2. **Genmåle indtægtssiden** før A kalibreres — 14/8-tallene (D2 44,5 %, D3 15,9 %, D4 55,4 %) er forældede efter #3730's 7,95 M sponsor-udbetaling og #3719/#3720's præmiedrift.
3. Genberegnings-script med dry-run mod staging; tal fremlægges.

Målt effekt hvis 1+2 kører (simulering af den gamle formel, ikke live løn): D2-lønudgift −33,8 % ved konvergens, D3/D4 +10 %. **Skal genmåles med ankerværdi-grundlaget.**

**Rækkefølgen er bindende: 1 før 2, aldrig omvendt.** Lønnen regnes af værdier; flyttes værdierne ikke, er der intet nyt at prissætte efter.

## Komponent 4 — mandat-migration (#3514, genoplivet 17/8)

Ejeren omgjorde drop-anbefalingen 17/8. Intet er bygget pr. 17/8, så komponenten har den korteste bane af alle fire:

1. Bølge 2 bygger migrationen (eget spor) + genberegnings-script for mandat (spor 1, ejer-valg 13/8).
2. Denne sektion SKAL udvides til fuld syv-punkts-form (hvad den gør / rækkefølge / hvad kan ikke rulles tilbage / snapshot / rollback / vindue / verifikation) af sporet der bygger den — før den kan flippe.
3. Dry-run mod staging; tal fremlægges.

**Når gaten ikke grøn:** komponent 4 udskydes alene — den blokerer intet andet.

---

## Huller pr. 17/8

- Det daglige ticks tidspunkt i forhold til etape-scheduleren er ikke målt.
- Gendannelses-/snapshot-scripts findes ikke endnu (bygges i bølge 2 spor 1).
- Komponent 4's syv-punkts-sektion mangler (bygges af mandat-sporet).
- Løn-effekten er ikke genmålt med ankerværdi-grundlag.

Refs #3645 #3459 #3449 #3393 #3514 #3591 #3709 #3757
