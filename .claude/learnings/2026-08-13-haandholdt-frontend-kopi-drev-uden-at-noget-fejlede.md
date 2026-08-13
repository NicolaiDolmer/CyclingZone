# En håndholdt frontend-kopi drev fra backend-kilden uden at noget fejlede

**Dato:** 2026-08-13 · **Issue:** #3665 · **PR:** #3670 · **Fundet under:** rytter-pakkens designsession

## Symptom

Ingen. Det er hele pointen.

`frontend/src/lib/riderRating.js` bar en håndholdt kopi af backendens type-vægte under navnet `RATING_TYPE_WEIGHTS`, med kommentaren *"Holdes manuelt i sync med backend; riderRating.test.js verificerer formen."* Testen verificerede **formen**, ikke **værdierne**.

Målt 13/8 var kopien drevet på tre punkter:

| Type | Frontend viste | Backend brugte | Hvornår backend ændrede sig |
|---|---|---|---|
| `brostensrytter` | `cobblestone: 5` | `cobblestone: 6` | #3325, 4/8 |
| `puncheur` | `climbing: 1` | krydsleddet fjernet | #3325, 4/8 |
| `rouleur` | `flat: 2` | `flat: 4` | #3325, 4/8 |

Spillerne så altså et rating-tal beregnet med andre vægte end dem markedsværdien og loft-formningen brugte — i ni dage, uden at en eneste test, guard eller CI-vagt sagde noget.

## Rod-årsag

To lag:

1. **En kommentar er ikke en kontrakt.** *"Holdes manuelt i sync"* beskriver en intention, ikke en mekanisme. Den holder præcis så længe den næste der rører backend-tabellen også husker at søge i frontend — og #3325 rørte den for at rette et helt tredje problem (typefordeling under caps), så der var ingen grund til at tænke på visningen.

2. **Testen målte den forkerte akse.** `riderRating.test.js` tjekkede at hver type havde et vægt-objekt med numeriske værdier. Det er en strukturtest. Den kan ikke fejle på et forkert tal, kun på et manglende felt — og driften var udelukkende forkerte tal.

## Fix

Kopien er ikke rettet. Den er **fjernet som kategori**: `scripts/generate-ability-registry.mjs` genererer frontendens evne-config og visnings-opskrifter fra backend-kilden, og en drift-vagt sammenligner de genererede filer **byte for byte** med generator-outputtet. Vagten kører i `backend-tests` (required check).

En sidegevinst: samme generator fjernede seks andre håndholdte lister over de 15 evner (`VISIBLE_ABILITIES`, `CONTRAST_ABILITIES`, `PRIMARY_STAT`, klassifikatorens 13-liste, frontendens `ABILITY_CATEGORIES`/`ABILITY_SHORT`/`ABILITY_ICONS`) — alle med samme drift-risiko, ingen med en vagt.

## Læring

**Når to steder skal være ens, skal det ene genereres af det andet.** Ethvert alternativ — en kommentar, en konvention, en strukturtest, en code-review-vane — fejler tavst, og tavse fejl opdages først når nogen tilfældigt måler.

**Test værdier, ikke former, når værdierne er pointen.** En test der ikke kan fejle på det der faktisk går galt, giver falsk tryghed. `riderRating.test.js` var grøn hele vejen igennem driften.

**Byte-sammenligning kræver at linjeslutninger er styret.** Vagten fejlede næsten falsk på Windows, fordi `core.autocrlf=true` giver de genererede filer CRLF ved checkout. Repoet havde allerede en `.gitattributes`-linje for præcis dét problem (#3570) — samme mønster tilføjet, plus normalisering i selve sammenligningen. Genererede filer skal altid have `text eol=lf`.

## Forward-guard

- `backend/lib/abilityRegistryGuards.test.js` vagt 4 — drift-test, byte-sammenligning
- `.gitattributes`: `frontend/src/lib/generated/*.js text eol=lf`
- `docs/HOWTO_ADD_ABILITY.md` — beskriver generatoren som eneste vej

## Backwards-check

**Gjort 2026-08-14 (#3681).** 25 kopier med et eksplicit sync-løfte i en kommentar blev fundet og målt mod deres kilde. Resultatet:

- **9 var allerede dækket** af en drift-test (rulesNumbers, raceClassificationTotals, board-bånd, cron-monitor-slugs, raceReport-varianter, staffSeverance, clubMock, evne-registret selv, rangliste-lint'ens target-liste).
- **14 var i sync, men uden noget der håndhævede det** — de har nu én fælles vagt i `backend/lib/handheldCopyGuards.test.js`, som kører i det required `backend-tests`-check. Hver vagt er mutations-testet: alle 14 fejler når man ændrer én af siderne.
- **3 var drevet.** To af dem er admin-flader (`EconomyAdminSection.jsx`' spejle af `FINANCE_REASON` og `ADMIN_ACTION_TYPE`, som var 15 hhv. 3 værdier bagud). Den tredje var spiller-vendt: `OnboardingProgressCard.STEP_TARGETS` pegede stadig på `/races` efter at #3102 opløste ruten, så onboarding-trin 3 sendte en ny spiller til Resultat-hubben mens tourens anker bor på Planlægnings-hubben. Rettet i samme PR.

To mønstre gik igen og er værd at kende:

1. **En test der bærer sin egen tredje kopi bevogter ingenting.** `stageProfileConfig.test.js` pinnede frontend-listen mod en `DB_PROFILE_TYPES`-literal inde i testen selv — en ændring i backend-enumen ville have ladet begge stå grønne. Samme fælde i `onboarding-tour-coverage.spec.js`, som skrev *"Ruten skal matche STEP_TARGETS"* og så hardkodede sin egen rute-tabel. Det var præcis dér driften sad.
2. **Retningen er næsten altid "backend voksede, kopien blev stående".** Alle tre drevne kopier fejlede ved TILFØJELSE i kilden, ikke ved ændring. En vagt skal derfor sammenligne hele nøglesættet, ikke bare de nøgler kopien allerede kender.
