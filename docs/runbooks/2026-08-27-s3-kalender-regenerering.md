# Køreplan — S3-kalender-regenerering

> **Skrevet 26/8 kl. 21:40. Ikke kørt. Kræver ejer-GO på hvert prod-skridt.**
> Kode er merged ([#4276](https://github.com/NicolaiDolmer/CyclingZone/pull/4276)); det er kun ANVENDELSEN på sæson 3 der udestår.

## Hvorfor

Målt i live prod 26/8 kl. 21:20:

| Problem | Live tilstand | Issue |
|---|---|---|
| Bjergetaper slutter nedad | **144 af 225 (64,0 %)**, kun 9,8 % opad | [#4272](https://github.com/NicolaiDolmer/CyclingZone/issues/4272) |
| Løbsdag over flere kalenderdatoer | **61 løbsdage**, værste spænder 7 datoer | [#4236](https://github.com/NicolaiDolmer/CyclingZone/issues/4236) |
| Løb med hul i løbsdagene | 8 | [#4236](https://github.com/NicolaiDolmer/CyclingZone/issues/4236) |

Løbsdags-fejlen er ikke kosmetisk: **bindingen lyver.** En rytter bindes på dage hvor hans løb ikke kører, så felterne ikke kan fyldes lovligt — og det brænder fast i resultater der ikke kan køres om.

## Prisen

```
Sæson 3       active · 28/8 → 27/9 · 31 løbsdage · 0 kørt
Løb           531
Udtagelser    1.066   →  991 spillernes egne (29 hold) · 75 assistentens (3 hold)
Resultater    0
Seneste udtagelse   26/8 kl. 20:30
```

**En regenerering sletter alle 1.066 udtagelser.** Wipe-scriptets gameplay-port stopper ellers hele kørslen.

> **Timing-argumentet:** de 991 valg ryger uanset HVORNÅR vi regenererer. Hver time vi venter, lægger flere managere arbejde i valg der bliver slettet. At vente gør prisen større, ikke mindre.

## To spærrer der begge skal åbnes

1. **Sæson-porten.** `regenSeason3Calendar.mjs` og `wipeSeason3Calendar.mjs` nægter begge at køre medmindre status er præcis `upcoming`. Status er `active`.
2. **Gameplay-porten.** Wipen stopper på ét ikke-nul fund i 14 tabeller. `race_entries` = 1.066.

Begge er bevidste værn. De skal åbnes eksplicit, ikke omgås.

> **⚠️ [#4229](https://github.com/NicolaiDolmer/CyclingZone/issues/4229):** den 25/8 stod sæsonen ikke-aktiv i **fire timer**. Alder, rangliste, træning og akademi var nede for alle spillere — og alle fire kalender-invarianter rapporterede grønt imens. Vinduet hvor status ≠ `active` skal være så kort som muligt, og ejeren skal være til stede hele vejen.

## Rækkefølge

Hvert skridt kræver ejer-GO. Ingen kæde af mutationer i træk.

| # | Skridt | Kommando | Verificér før næste |
|---|---|---|---|
| 0 | **Discord-besked ud** | ejeren poster | Beskeden er synlig i kanalen |
| 1 | Dry-run af regen | `node scripts/dev/regenSeason3Calendar.mjs` | Første løbsdag = 2026-08-28 |
| 2 | **Sæson → `upcoming`** | SQL, ejer-GO | `select status from seasons where number=3` |
| 3 | Dry-run af wipe | `node scripts/dev/wipeSeason3Calendar.mjs` | Rapporterer 531 løb, ingen uventede tabeller |
| 4 | Ryd udtagelser | SQL, ejer-GO | `race_entries` for S3 = 0 |
| 5 | **Wipe** | `... wipeSeason3Calendar.mjs --apply --jeg-har-set-dry-runnet` | 0 løb tilbage for season_id |
| 6 | **Regenerér** | `... regenSeason3Calendar.mjs --apply --jeg-har-set-dry-runnet` | 531 løb skrevet, første løbsdag 28/8 |
| 7 | Scorecard mod prod | `node scripts/dev/calendarScorecard4218.mjs` | exit 0 |
| 8 | Invarianter mod prod | `node scripts/verify-invariants.js` | 0 brud |
| 9 | **Sæson → `active`** | SQL, ejer-GO | Spillere kan se kalenderen igen |
| 10 | Verificér i browseren | ejeren, som authenticated bruger | Kalenderen ser rigtig ud |

Alle scripts køres med `infisical run --env=prod --` foran, fra `C:\Dev\CyclingZone\backend`.

**Skridt 2 til 9 er vinduet hvor sæsonen ikke er `active`.** Mål: under ti minutter. Går noget galt undervejs, er skridt 9 (sæt tilbage til `active`) altid den første handling — en kalender med fejl er mindre skadelig end en sæson der ikke findes.

## Efter

- `stage_scheduler_enabled` + `auto_entry_generator_enabled` tændes **først** når kalenderen er verificeret. Ejer-only.
- Patch note 7.194 er allerede skrevet og beskriver ændringen.
- Spillerne skal udtage forfra. Assistenten udtager automatisk 1 time før hvert løb ([#4174](https://github.com/NicolaiDolmer/CyclingZone/issues/4174)), så ingen står uden hold — men de mister deres egne valg.

## Fallback hvis regenereringen ikke kan nås

Et in-place script der kun opdaterer `finale_type` på S3's eksisterende etaper — samme mønster som `recomposeSeason3Stages4103.mjs` (ejer-godkendt 23/8, rører aldrig løb, datoer eller `race_stage_schedule`). Det retter de 144 bjergetaper uden wipe, uden statusskifte og uden at koste en eneste udtagelse.

Det retter **ikke** de 61 løbsdage over flere datoer eller de 8 løb med hul. Cirka en times arbejde plus verifikation.

## Ikke afgjort

- Om løbsdags-aksen kan repareres på plads via `calendarGameDayRepair.js` ([#4161](https://github.com/NicolaiDolmer/CyclingZone/issues/4161)-mønsteret) i stedet for en fuld regenerering. **Ikke målt.** Den blev bygget til et andet symptom (udfladet akse), og om den også kan levere kontiguitet er uafklaret.
- `race_entries.binding_span` afhænger af løbsdags-aksen. Ændres aksen uden regenerering, skal spændet genberegnes. Ikke undersøgt.
