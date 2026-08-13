# Dateret snapshot — #3593 (forankring) + #3591 pkt. 2 (lofterne)

**Formål:** rollback-grundlag og facit for målingen af hvad der sker med rytternes
udviklings-lofter når `race_day_engine_enabled` tændes 23/8, samt for forankringen af
sekundær-typen i `archetype_draw`.

| fil | indhold |
|---|---|
| `riders_full-2026-08-11.json.gz` | 8.677 levende ryttere: `archetype_draw`, `primary_type`, `secondary_type`, `valuation_type`, `ability_caps`, `abilities`, `base_value`, `market_value`, `salary`, `birthdate`, sæson-alder, `owner_kind`, hold, manager. Taget 2026-08-11T16:36:25Z. |
| `meta-2026-08-11.json` | aktiv sæson, `app_config`, populations-tællinger, alders-konvention. |
| `dry-run-lofter-resume-2026-08-11.json` | harnessens maskinlæsbare resumé (tallene nedenfor). |

**Alders-konventionen:** `age` ER sæson-alder (`ageForSeason(birthdate, 2)`).
`age_wallclock` findes ved siden af og må ALDRIG bruges til klassifikation.

## Genskabes med

```bash
infisical run --env=prod -- node scripts/dev/snapshot-3570-full.mjs ../docs/snapshots/3591
node scripts/dev/lofterDryRun3591.mjs            # read-only, rører aldrig DB
node scripts/dev/lofterDryRun3591.mjs --detaljer # + pr-rytter-fil (~18 MB, bevidst ikke i repoet)
```

## Hvad målingen viste (11/8)

**#3591's præmis var udløbet.** Issuet regnede med at 2.139 af 3.473 AI-ryttere (61,6 %)
ville skifte type og 38,5 % tabe loft ved 23/8-flippet. Målt på dette snapshot:
**0 af 3.293 AI-ryttere ændrer loft, 0 skifter type, 0 flytter markedsværdi.**
#3570-reparationen (kørt 11/8 kl. 08:12) genopbyggede lofterne med den rigtige
kaldform som sideeffekt og lukkede dermed hullet for AI-populationen.

**Negativ-kontrol** (uden den beviser «0» intet): 1.487 af de 3.293 er forbi peakAge, så
de to kaldformer ER skelnelige for dem. Gemte lofter matcher med-alder-formen for
3.293/3.293 og uden-alder-formen for kun 1.806 — præcis de 1.806 før peak, hvor
formerne falder sammen.

**Det der er tilbage** er #3593-kohorten: 573 levende ryttere (532 frie agenter +
41 menneske-ejede, alle akademi-ryttere 16-19 år) uden sekundært anlæg, hvor de to
skrivestier former loftet af hver sin sekundær. Heraf har 546 et gemt loft der afviger
fra det motoren ville bygge — 479 ville vinde loft, 67 tabe (rating-delta p10 −1,
median 0, p90 +4, yderpunkter −3/+9).

Forankringen selv (`archetype_draw.secondary` udfyldt fra `secondary_type`) ændrer
**0 lofter, 0 primær-typer, 0 sekundær-typer** — og fjerner 39 sekundær-type-skift
som ellers ville ramme ved næste loft-genopbygning.
