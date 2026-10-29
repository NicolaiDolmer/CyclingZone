# #5319 Træningskatalog version 3 (S12): design og måling

Designspor 29/10 (kind: investigate, #5220). Ingen produktkode, ingen prod-skrivning, intet flag rørt.
Kilde: `2026-10-23-6110-potentiale-et-tal-samlet-design.md` §13 S12 + byggeplan punkt 16. Relaterede: #7103, #6968 (enkeltstart kan ikke trænes målrettet), #5456 (vægtsum 3), #4631, #5236/#5237.
Rå tal og harness ligger privat i `C:/dev/CyclingZone-local/balance-internals/catalog-v3/` (ikke repo). Her står kun indeks og rangering.
Ejer-kort: `pr-screens/catalog-v3/kort.html` (+ `kort-1440.png`, `kort-390.png`).

## 1. Hvad er galt i dag (bekræftet i koden)

- `threshold` træner `time_trial` + `tempo` (vægtsum 2). Det er den eneste hårde vej til enkeltstart, og den bryder S12-reglen "enkeltstart og tempo trænes aldrig i samme session".
- `sprint` og `threshold` har vægtsum 2, mens resten af de hårde sessioner har 3 (#5456-invarianten gælder i dag kun vo2max-familien + de tre nye fra september). Sprint og tærskel er altså underpris-pakker.
- Målt: enkeltstartsrytterens bedste hårde valg i dag giver den laveste hovedevne-fremgang af de "specialiserede" typer (rang 5 af 8), og klassementsrytteren kan i praksis kun træne enkeltstart via tærskel.

## 2. Katalog v3 (anbefalet variant, valg 1 = A)

Alle hårde sessioner: intensitet `hard`, vægtsum 3, ingen evne over 2. "Par for" = sessionen er en af typens to hårde sessioner.

| nøgle | EN | DA | evner (vægt) | sum | par for | styrke | pris |
|---|---|---|---|---|---|---|---|
| `vo2max` | VO2max intervals | VO2max-intervaller | climbing 1, punch 1, tempo 1 | 3 | ingen (hybrid, bevares) | bred | ingen spids |
| `vo2max_climb` | Mountain intervals | Bjergintervaller (før "VO2max klatring") | climbing 2, tempo 1 | 3 | klatrer, klassement | mest klatring pr. dag | ingen udholdenhed/punch |
| `vo2max_punch` | VO2max (punch) | VO2max (punch) | punch 2, tempo 1 | 3 | puncheur, baroudeur | mest punch pr. dag | ingen klatring |
| `threshold` | Threshold | Tærskel | tempo 2, endurance 1 (før: time_trial 1, tempo 1) | 3 | puncheur | mest tempo pr. dag | ingen enkeltstart |
| `sprint` | Sprint | Spurt | sprint 2, acceleration 1 (før: 1/1) | 3 | sprinter | topfart | ingen positionering |
| `cobbled_sectors` | Cobbled sectors | Brostenssektorer | cobblestone 1, durability 1, positioning 1 | 3 | brostensrytter | brosten + placering | kun 1 brosten |
| `echelon_drills` | Echelon drills | Vifteøvelser | flat 1, positioning 1, durability 1 | 3 | rouleur | flad + placering | kun 1 flad |
| `attack_repeats` | Attack repeats | Angrebsintervaller | aggression 1, punch 1, acceleration 1 | 3 | baroudeur | eneste hårde aggression | kun 1 aggression |
| `long_climbs` | Long climbs | Lange stigninger | climbing 1, tempo 1, endurance 1 | 3 | klatrer | motor + udholdenhed | kun 1 klatring |
| `lead_out` | Lead-out | Lead-out | acceleration 1, flat 1, positioning 1 | 3 | sprinter | acceleration + placering | ingen topfart |
| `itt_short` | Short time trials | Korte enkeltstarter | time_trial 1,5, flat 1,5 | 3 | enkeltstart, rouleur | enkeltstart + flad | ingen udholdenhed |
| `itt_long` | Long time trials | Lange enkeltstarter | time_trial 1,5, endurance 1,5 | 3 | enkeltstart, klassement | enkeltstart + udholdenhed | ingen flad |
| `cobbled_classic` | Cobbled classic | Brostensklassiker | cobblestone 1,5, endurance 1,5 | 3 | brostensrytter | mest brosten pr. dag | ingen placering |

Uændrede ikke-hårde: `tempo` (normal), `endurance` (let), `technique`/`aero`/`loebslaere` (færdighed), `restitution`.

### Invariant-tjek (harness, alle bestået)
- Hver af de 8 typer har præcis 2 hårde sessioner.
- Vægtsum = 3 for alle 13 hårde sessioner; maks enkeltvægt 2.
- Ingen session (hård eller ej) indeholder både `time_trial` og `tempo`.
- Ingen session giver alt: for hver type rammer den bedste enkeltsession højst 75 % af typens hovedevne-vægt. Undtagelse pr. definition: enkeltstartstypen har kun én hovedevne, så enhver TT-session rammer "alt" for den; prisen er her støtteevnen (flad eller udholdenhed).

## 3. Måling (lokal harness, kurve B off = prod nu)

Metode: produktionens rene `dailyAbilityDelta` (curveB = null), syntetisk kohorte pr. type (60 ryttere × 5 frø, alder 21-29, potentiale 2-5, halvdelen med sekundærtype), 28 dage `[A, B, let, hvile] × 7`. Score = hovedevne-fremgang vægtet med typens positive loft-vægte. Dagens katalog: typens bedste mulige par af dagens hårde sessioner (gentagelse tilladt). v3 måles på identiske ryttere og støj.

| type | v3 bedste valg (i dag = 100) | v3-parret på skift | rang i dag → v3 bedste |
|---|---|---|---|
| sprinter | 127 | 114 | 4 → 3 |
| enkeltstart | 144 | 144 | 5 → 2 |
| klatrer | 100 | 89 | 1 → 4 |
| puncheur | 100 | 87 | 2 → 5 |
| brostensrytter | 136 | 118 | 3 → 1 |
| baroudeur | 100 | 89 | 8 → 8 |
| rouleur | 119 | 109 | 6 → 6 |
| klassement | 100 | 93 (enkeltstart ca. 3x, klatring ca. 0,6x) | 7 → 7 |

Usikkerhed: 95 %-interval ca. ±7 % på hvert tal; spredning mellem frø større (kohorte-sammensætning), men i dag og v3 køres parret på samme ryttere, så forskelle under 5 point regnes som støj. Antagelser: ingen træthed/skade, ingen løbsdage, ingen staff/faciliteter, én sæson.

Fund: (a) ingen type får det dårligere end i dag med sit bedste valg; (b) at skifte mellem de to sessioner koster 7-13 % i hovedevnerne for klatrer, puncheur, baroudeur og klassement, til gengæld vokser andre evner (det er S12's "styrke og pris"); (c) med vægt 2 i stedet for 1,5 på de nye TT/brosten-sessioner springer de to typer forbi alle (indeks 187/161), derfor 1,5.

Iterationer (privat log): r1 ændrede også Bjergintervaller/VO2max(punch)-vægte → klatrer −15 %, puncheur −21 % på skift; rullet tilbage til navneændring.

## 4. Åbne ejer-valg (på kortet)
1. Løft af enkeltstart/brosten: A vægt 1,5 (anbefalet) / B vægt 2.
2. Gemte `threshold`-programmer: A flyt enkeltstarts- og klassementsryttere til `itt_long` (anbefalet, "bevar evnerne" som 14/8) / B alle bliver.
3. Prisen for at skifte: A accepter (anbefalet) / B ny variationsbonus (nyt design).

## 5. Byggeplan (efter ejer-go på kortet)
- **Filer:** `backend/lib/training.js` (TRAINING_FOCUSES + FOCUS_ABILITY_WEIGHT for 5 nye nøgler, nye vægte for `threshold`/`sprint`), `backend/lib/trainingDayTypes.js` (hard-listen + SESSION_INTENSITY; nye nøgler tilføjes EFTER `attack_repeats` så eksisterende rækkefølge er uændret), `SMART_DEFAULT_FOCUS_KEYS` røres ikke (assistentens valg uændret, egen måling hvis det ønskes), frontend-sessionsvælger + i18n (en/da navne og evne-linjer), race/rapport-mappings der kender "hovedevne" pr. session (fx #7316-målingens map).
- **Flag:** `training_catalog_v3` (app_config). Off = dagens tabeller bit-identisk; on = v3-vægte og nye sessioner synlige. Vægttabellen vælges ét sted.
- **Migration:** ingen skema-ændring (`training_plans.focus` er tekst). `vo2max_climb`/`vo2max_punch`/`sprint`: samme nøgle, ingen datamigration (kun navn/vægt). `threshold`: ved flag-on, idempotent script med dry-run: planer hvor rytterens time_trial-rolleklasse ≥ tempo-klassen (tt, gc som primær/sekundær) → `itt_long`; resten bliver. Antal måles read-only før kørsel; ejer ser tallet før apply. Rollback: flag off + omvendt map fra scriptets log.
- **Tests:** udvid #5456-invarianten til alle hårde sessioner (sum 3, maks 2), ny test "ingen session med time_trial + tempo", "hver type præcis 2 par-sessioner" (par-tabellen bor i training.js som data), flag-off bit-identitet, migration dry-run-test, i18n-nøgler en+da.
- **Hjælp en+da:** træningsafsnittet i `help.json`: de 13 hårde sessioner, "to hårde pr. type", og at enkeltstart nu har egne sessioner.
- **Patch note (EN først):** "Training v3: five new hard sessions (Long climbs, Lead-out, Short and Long time trials, Cobbled classic). Threshold no longer trains time trial. Sprint and Threshold now give a full hard day."
- **Risiko:** power creep for sprinter/enkeltstart/brosten/rouleur er tilsigtet indhentning; overvåges en sæson via træningsrapportens hovedevne-andel. Kurve B er off; tændes den igen, skal harnessen køres igen med curveB.
