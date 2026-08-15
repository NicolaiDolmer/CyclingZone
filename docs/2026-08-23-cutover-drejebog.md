# Cutover 23/8 — drejebog pr. komponent

**Status: FØRSTE UDKAST, 15/8. Ikke ejer-godkendt.** Skrevet efter #3645. Alle tilstands-tal er målt read-only mod prod (`ghwvkxzhsbbltzfnuhhz`) 15/8. Der er ikke flippet noget, ikke merget noget, ikke muteret noget.

Hvor der står **ikke verificeret**, er det fordi jeg ikke har målt det. Der står aldrig et gæt i stedet.

---

## Hovedbudskabet før detaljerne

#3645 blev skrevet ud fra at **fire** ting flippes 23/8. Målt mod beslutningerne 14.-15/8 er kun **én** af de fire klar:

| # | Komponent | Status 15/8 | Kan flippes 23/8? |
|---|---|---|---|
| 1 | Markedsvægt `global_weight` → 1,0 | #3449 skal **ikke** merges ([auditten](audits/2026-08-14-oplaas-vaerdier-og-loefter.md) del 1, fire grunde). Config-nøglerne **findes ikke i prod** (målt: 0 rækker) | **Nej** |
| 2 | [#3393](https://github.com/NicolaiDolmer/CyclingZone/issues/3393) løn efter markedsværdi | Draft, gated på beslutning 4+5 ([#3757](https://github.com/NicolaiDolmer/CyclingZone/issues/3757)). Afhænger desuden af 1 | **Nej** |
| 3 | [#3459](https://github.com/NicolaiDolmer/CyclingZone/issues/3459) race-day-flip | Færdig. Kun flippet mangler. Målt: `race_day_engine_enabled = 'off'` | **Ja** |
| 4 | [#3514](https://github.com/NicolaiDolmer/CyclingZone/issues/3514) mandat-migration | Anbefales droppet (NOW.md) | **Nej, medmindre du omgør** |

**Det ændrer hvad drejebogen skal handle om.** Rækkefølge- og afhængighedsproblemet i #3645 ("lønnen regnes af værdier, som markedsvægten flytter") opstår kun hvis 1 og 2 kører. Gør de ikke det, er 23/8 en **enkelt-komponent-cutover**, og risikoen falder dramatisk.

Første beslutning på listen er derfor ikke "i hvilken rækkefølge", men **"skal 23/8 stadig være en cutover-dato, eller skal den reduceres til race-day-flippet alene?"** Min anbefaling: reducér til komponent 3. En dato der bærer én verificeret ændring er bedre end en dato der bærer fire, hvoraf tre er blokerede.

---

## Komponent 3 — race-day-flippet (#3459)

Den eneste der er klar, og derfor den eneste der er skrevet ud i fuld længde her.

### Hvad flippet gør

`race_day_engine_enabled` går fra `'off'` til `'on'`. Følgen er ikke kun at motoren tænder:

- `dailyTrainingEngine` begynder at dække **AI-hold**. `trainingSweep` filtrerer i dag på `is_ai = false` netop fordi flaget er off (`backfillCores.js:307`).
- `aiRecoverySweep` bliver et **no-op** (`aiRecoverySweep.js:145-152`) — dailyTrainingEngine overtager AI-holdenes restitution.
- Ryttere der har kørt løb samme dag rammer den gensidigt udelukkende gren i `dailyTraining.js:234`.

### Rækkefølge og afhængighed

1. **Bekræft først:** ingen etape er i gang eller planlagt inden for flippets vindue. Race-motoren må ikke skifte kontrakt midt i en kørsel.
2. **Snapshot** (se nedenfor) skal være taget og verificeret læsbart, ikke bare kørt.
3. Flip.
4. Første verifikation umiddelbart efter (se nedenfor), FØR næste døgns tick.

Ingen af de andre tre komponenter må køre samme dag hvis 3 flippes. Ét flip, én dag.

### Hvad kan IKKE rulles tilbage

**Dette er dokumentets vigtigste afsnit.**

Når `dailyTrainingEngine` tikker AI-holdene for første gang, **genopbygges deres `ability_caps` med alder** via `buildCapsForRider`. Deres nuværende caps er aldrig blevet aftrappet, fordi de udelukkende kom fra `backfillCores` uden alders-argument (#3591). Målt på dateret snapshot 10/8: **kun 46 af 3.473 AI-rytteres caps matcher noget `buildCapsForRider`-output overhovedet, og 45,4 % taber loft alene ved kaldformen (p10 Δ bedste-af-8 loft-rating −29).**

At sætte flaget tilbage til `'off'` **gendanner ikke de gamle caps.** Flaget styrer hvilken motor der kører, ikke hvad den allerede har skrevet. En rollback kræver at caps skrives tilbage fra snapshottet — hvilket er en population-mutation med sin egen ejer-gate.

Ingen rytter kan miste *evne* (`buildCapsForRider` returnerer `max(tapered, current)`, så gulvet er rytterens nuværende evne). Det er **loftet** der falder, altså hvor langt rytteren kan udvikle sig — og det er et spiller-vendt tal.

**Konsekvens for planen:** flippet er ikke et flag, det er en engangs-korrektion af 3.473 AI-rytteres lofter, forklædt som et flag. Det er præcis mønstret fra #3709, hvor en loft-ændring ramte som en sideeffekt i stedet for som en kontrolleret ændring. **Det skal meldes til spillerne før, ikke efter.**

### Snapshot før

**Skal tages, og skal verificeres læsbart før flip:**

| Tabel | Kolonner | Hvorfor |
|---|---|---|
| `rider_derived_abilities` | `rider_id, ability_caps, ability_progress` | Det eneste der ikke kan rekonstrueres efter tikket |
| `riders` | `id, primary_type, secondary_type, archetype_draw, potentiale, birthdate` | Klassifikations-grundlaget caps afledes af |
| `app_config` | hele tabellen | Flag-tilstand før |

Hvor det gemmes: `docs/snapshots/3459/` efter samme mønster som `docs/snapshots/3591/`. **Ikke verificeret:** om der findes et eksisterende snapshot-script der dækker præcis disse tre — jeg har ikke ledt efter et.

### Rollback: konkret

```sql
-- Trin 1: stop videre skade (idempotent, ikke destruktivt)
update app_config set value = 'off' where key = 'race_day_engine_enabled';
```

Det stopper motoren. Det gendanner **ikke** caps. Trin 2 (gendan caps fra snapshot) er en population-mutation og **findes ikke som script i dag** — den skal skrives før flippet, ikke efter. Uden trin 2 er rollback ufuldstændig, og drejebogen ville lyve hvis den påstod andet.

**Handling før 23/8:** skriv og tør-kør gendannelses-scriptet. Et rollback man ikke har prøvet, er ikke et rollback.

### Hvor længe er vinduet

S3 starter **24/8**, altså dagen efter. Så snart en etape er kørt under den nye motor, er resultaterne en del af sæsonens historik, og et cap-rollback ville gøre resultater og lofter indbyrdes uenige.

**Praktisk vindue: fra flip til første etape under ny motor.** Det er under et døgn, og det er kortere end det ser ud, fordi det daglige tick kommer først. **Ikke verificeret:** det præcise tidspunkt for det daglige tick i forhold til etape-scheduleren.

Anbefaling: flip **tidligt** søndag, ikke sent, så vinduet ligger i vågen tid.

### Verifikation pr. skridt

Umiddelbart efter flip, før næste tick:

1. `select value from app_config where key = 'race_day_engine_enabled'` → `'on'`.
2. Sentry: ingen nye issues på træningsstien inden for 15 min.
3. `aiRecoverySweep` logger "sprunget over — race_day_engine_enabled=on".

Efter første tick:

4. **Loft-deltaet på AI-hold mod snapshottet.** Grænsen der udløser stop: hvis mediant loft-tab overstiger det målte p10-tal fra 10/8-snapshottet (Δ bedste-af-8 loft-rating −29), er noget andet end den forventede aftrapning i gang.
5. Ingen rytter har mistet *evne* (ikke bare loft). Ét eneste tilfælde = stop.
6. Antal ryttere tikket ≈ antal AI-ryttere + menneskeryttere. Et tal langt under betyder at sweepet filtrerer forkert.

### Hvem beslutter

**Ejer-gated på dagen:** selve flippet. Reglen fra 27/6 gælder direkte — at gen-tænde et live spiller-vendt system er ejer-only, og at tænde motoren for AI-holdene for første gang er i den kategori. Du skal have set live-tilstanden.

**Ejer-gated i forvejen:** om spillerne får besked om loft-ændringen før flippet. Min anbefaling er ja, af samme grund som #3709's tilbagerulning: spillerne så det selv, før vi meldte det.

---

## Komponent 1 — markedsvægt (blokeret)

Ikke skrevet ud, fordi den ikke kan køre. Kort om hvorfor, så drejebogen er komplet:

- Config-nøglerne findes ikke i prod (målt 15/8: `select key from app_config where key like 'market_value%'` → 0 rækker). Sweepet er inert indtil en migration er kørt **og** flaget flippet.
- #3449 skal ikke merges i nuværende form; artefaktet er fittet på en typefordeling der ikke findes (74,8 % divergens).
- Sweepet kan desuden **kun** køre om søndagen (`marketValueSundaySweep.js`).

**Før den kan på en drejebog overhovedet:** de 6 punkter i auditten "Før sweepet kan køre, uanset dato", plus #3750.

## Komponent 2 — løn (#3393, blokeret)

Gated på beslutning 4+5 (#3757) og på komponent 1. Lønnen regnes af værdier; flyttes værdierne ikke, er der intet at prissætte efter. **Rækkefølgen er bindende: 1 før 2, aldrig omvendt.** Målt effekt hvis begge kørte (simulering af foreslået formel, ikke live løn): D2-holdenes lønudgift −33,8 % ved konvergens, D3/D4 +10 %.

## Komponent 4 — mandat-migration (#3514, anbefales droppet)

Står som "anbefales droppet" i NOW.md. Hvis beslutningen omgøres, skal den have sin egen sektion her med samme syv punkter. **Ikke verificeret:** hvad #3514 konkret migrerer — jeg har ikke læst issuet i denne session.

---

## Hvad du skal tage stilling til

1. **Reduceres 23/8 til race-day-flippet alene?** (min anbefaling: ja)
2. **Skal spillerne have besked om AI-holdenes loft-ændring før flippet?** (min anbefaling: ja)
3. **Hvem skriver gendannelses-scriptet, og hvornår tør-køres det?** Uden det er der ikke noget reelt rollback.
4. **Bekræft eller omgør:** #3514 droppet.

## Huller i dette udkast

- Det daglige ticks tidspunkt i forhold til etape-scheduleren er ikke målt.
- Der findes intet gendannelses-script for caps, og jeg har ikke ledt efter et eksisterende snapshot-script.
- #3514 er ikke undersøgt.
- Komponent 1 og 2 er ikke skrevet ud i syv-punkts-form, fordi de er blokerede. Ophæves blokeringen, mangler det arbejde.

Refs #3645 #3459 #3449 #3393 #3514 #3591 #3709
