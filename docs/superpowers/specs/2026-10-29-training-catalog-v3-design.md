# #5319 Træningskatalog version 3 (S12): design og måling

Designspor 29/10 (kind: investigate, #5220). Ingen produktkode, ingen prod-skrivning, intet flag rørt.
Kilde: `2026-10-23-6110-potentiale-et-tal-samlet-design.md` §13 S12 + byggeplan punkt 16. Relaterede: #7103, #6968 (enkeltstart kan ikke trænes målrettet), #5456 (fælles vægtsum for hårde sessioner), #4631, #5236/#5237.
Rå tal, vægte og harness ligger privat i `balance-internals/catalog-v3/` (ikke repo). Her står kun struktur og kvalitativ rangering (repoet er offentligt, hard rule 17).
Ejer-kort: `pr-screens/catalog-v3/kort.html` (+ `kort-1440.png`, `kort-390.png`).
Byg: #5319 bag flaget `training_catalog_v3` (kode: `backend/lib/trainingCatalogV3.js`).

## 1. Hvad er galt i dag (bekræftet i koden)

- `threshold` træner `time_trial` + `tempo`. Det er den eneste hårde vej til enkeltstart, og den bryder S12-reglen "enkeltstart og tempo trænes aldrig i samme session".
- `sprint` og `threshold` har en lavere vægtsum end resten af de hårde sessioner (#5456-invarianten gælder i dag kun vo2max-familien + de tre nye fra september). Sprint og tærskel er altså underpris-pakker.
- Målt: enkeltstartsrytterens bedste hårde valg i dag giver blandt de laveste hovedevne-fremgange af de specialiserede typer, og klassementsrytteren kan i praksis kun træne enkeltstart via tærskel.

## 2. Katalog v3 (anbefalet variant, valg 1 = A)

Alle hårde sessioner: intensitet `hard`, samme vægtsum som vo2max-familien, ingen evne over vo2max-familiens højeste enkeltvægt. "Par for" = sessionen er en af typens to hårde sessioner. Vægtene står i koden og i den private log.

| nøgle | EN | DA | evner | par for | styrke | pris |
|---|---|---|---|---|---|---|
| `vo2max` | Mixed intervals | VO2max-intervaller | climbing, punch, tempo | ingen (hybrid, bevares) | bred | ingen spids |
| `vo2max_climb` | Mountain intervals | Bjergintervaller (før "VO2max klatring") | climbing (hoved), tempo | klatrer, klassement | mest klatring pr. dag | ingen udholdenhed/punch |
| `vo2max_punch` | VO2max (punch) | VO2max (punch) | punch (hoved), tempo | puncheur, baroudeur | mest punch pr. dag | ingen klatring |
| `threshold` | Threshold | Tærskel | tempo (hoved), endurance (før: time_trial, tempo) | puncheur | mest tempo pr. dag | ingen enkeltstart |
| `sprint` | Sprint | Sprint | sprint (hoved), acceleration | sprinter | topfart | ingen positionering |
| `cobbled_sectors` | Cobbled sectors | Brostenssektorer | cobblestone, durability, positioning | brostensrytter | brosten + placering | brosten deler dagen |
| `echelon_drills` | Echelon drills | Vifteøvelser | flat, positioning, durability | rouleur | flad + placering | flad deler dagen |
| `attack_repeats` | Attack repeats | Angrebsintervaller | aggression, punch, acceleration | baroudeur | eneste hårde aggression | aggression deler dagen |
| `long_climbs` | Long climbs | Lange stigninger | climbing, tempo, endurance | klatrer | motor + udholdenhed | klatring deler dagen |
| `lead_out` | Lead-out | Lead-out | acceleration, flat, positioning | sprinter | acceleration + placering | ingen topfart |
| `itt_short` | Short time trials | Korte enkeltstarter | time_trial, flat (lige dele) | enkeltstart, rouleur | enkeltstart + flad | ingen udholdenhed |
| `itt_long` | Long time trials | Lange enkeltstarter | time_trial, endurance (lige dele) | enkeltstart, klassement | enkeltstart + udholdenhed | ingen flad |
| `cobbled_classic` | Cobbled classic | Brostensklassiker | cobblestone, endurance (lige dele) | brostensrytter | mest brosten pr. dag | ingen placering |

Uændrede ikke-hårde: `tempo` (normal), `endurance` (let), `technique`/`aero`/`loebslaere` (færdighed), `restitution`.

### Invariant-tjek (harness + `backend/lib/trainingCatalogV3.test.js`, alle bestået)
- Hver af de 8 typer har præcis 2 hårde sessioner.
- Samme vægtsum for alle 13 hårde sessioner; ingen evne over loftet.
- Ingen session (hård eller ej) indeholder både `time_trial` og `tempo`.
- Ingen session giver alt: for hver type rammer den bedste enkeltsession kun en del af typens hovedevne-vægt. Undtagelse pr. definition: enkeltstartstypen har kun én hovedevne, så enhver TT-session rammer "alt" for den; prisen er her støtteevnen (flad eller udholdenhed).

## 3. Måling (lokal harness, kurve B off = prod nu)

Metode: produktionens rene `dailyAbilityDelta` (curveB = null), syntetisk kohorte pr. type, 28 dage med to hårde dage, en let og en hviledag pr. blok. Score = hovedevne-fremgang vægtet med typens positive loft-vægte. Dagens katalog: typens bedste mulige par af dagens hårde sessioner. v3 måles på identiske ryttere og støj. Tallene står i den private log.

Kvalitativt resultat:
- Sprinter, enkeltstart, brostensrytter og rouleur går tydeligt frem med deres bedste v3-valg (indhentning; enkeltstart og brosten mest).
- Klatrer, puncheur, baroudeur og klassement står uændret med deres bedste valg.
- Ingen type får det dårligere end i dag med sit bedste valg.

Usikkerhed: forskelle under ca. 5 % regnes som støj (parret måling på samme ryttere). Antagelser: ingen træthed/skade, ingen løbsdage, ingen staff/faciliteter, én sæson.

Fund: (a) ingen type taber med sit bedste valg; (b) at skifte mellem de to sessioner koster lidt i hovedevnerne for klatrer, puncheur, baroudeur og klassement, til gengæld vokser andre evner (det er S12's "styrke og pris"); (c) med en højere hovedevne-vægt på de nye TT/brosten-sessioner springer de to typer forbi alle, derfor ejer-valg 1A.

Iterationer (privat log): r1 ændrede også Bjergintervaller/VO2max(punch)-vægte og kostede klatrer og puncheur tydeligt på skift; rullet tilbage til navneændring.

## 4. Ejer-valg (truffet 29/10)
1. Løft af enkeltstart/brosten: **A** (den lavere hovedevne-vægt).
2. Gemte `threshold`-programmer: **A** flyt enkeltstarts- og klassementsryttere til `itt_long` ("bevar evnerne" som 14/8).
3. Prisen for at skifte: **A** accepter (ingen variationsbonus).

## 5. Byggeplan
- **Filer:** `backend/lib/training.js` (`programAbilityWeight`), `backend/lib/trainingCatalogV3.js` (v3-tabeller, par-tabel, flag-læsere, `applyTrainingCatalog`), `backend/lib/trainingDayTypes.js` (v3-hard-listen + SESSION_INTENSITY_V3; nye nøgler EFTER `attack_repeats`), `SMART_DEFAULT_FOCUS_KEYS` røres ikke, frontend-sessionsvælgere + i18n.
- **Flag:** `training_catalog_v3` (app_config). Off = dagens tabeller bit-identisk; on = v3-vægte og nye sessioner synlige. Vægttabellen vælges ét sted (`applyTrainingCatalog` i motoren).
- **Migration:** ingen skema-ændring (`training_plans.focus` er tekst). `vo2max_climb`/`vo2max_punch`/`sprint`: samme nøgle, ingen datamigration (kun navn/vægt). `threshold`: ved flag-on, idempotent script med dry-run (`scripts/5319-migrate-threshold-plans.mjs`): planer for ryttere med tt eller gc som primær/sekundær → `itt_long`; resten bliver. Antal måles read-only før kørsel; ejer ser tallet før apply. Rollback: flag off + omvendt map fra scriptets log.
- **Tests:** #5456-invarianten udvidet til alle hårde sessioner, "ingen session med time_trial + tempo", "hver type præcis 2 par-sessioner", flag-off bit-identitet, migration dry-run-test, i18n-nøgler i alle sprog.
- **Hjælp:** træningsafsnittet i `help.json` bag flaget: to hårde pr. type, de nye sessioner, enkeltstart har egne sessioner.
- **Patch note (EN først):** "Training v3: five new hard sessions (Long climbs, Lead-out, Short and Long time trials, Cobbled classic). Threshold no longer trains time trial. Sprint and Threshold now give a full hard day."
- **Risiko:** power creep for sprinter/enkeltstart/brosten/rouleur er tilsigtet indhentning; overvåges en sæson via træningsrapportens hovedevne-andel. Kurve B er off; tændes den igen, skal harnessen køres igen med curveB.
