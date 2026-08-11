# Daterede snapshots — #3570 ryttertype-reformen

**Formål:** disse filer er rollback-grundlaget for reparationen af rytter-identiteten
(#3570). De lå oprindeligt kun i en midlertidig session-scratchpad; den adversariske
verifikator på reparations-dry-runnet pegede på det som den største enkeltrisiko —
"eneste faktiske redning i dag" — så de er lagt her.

| fil | indhold |
|---|---|
| `riders_full-2026-08-10.json.gz` | 8.199 levende ryttere: `archetype_draw`, `primary_type`, `secondary_type`, `valuation_type`, `ability_caps`, `abilities`, `base_value`, `market_value`, `current_production_value`, `salary`, `birthdate`, sæson-alder, `owner_kind`, hold, manager. Taget 2026-08-09T22:30:17Z. |
| `birthstats-2026-08-10.json.gz` | samme 8.199 rytteres 14 legacy-`stat_*` + `height`/`weight` — det medfødte anlæg, som ingen kodesti opdaterer efter oprettelsen. Taget 2026-08-09T22:47:33Z. |
| `meta-2026-08-10.json` | aktiv sæson, `app_config`, populations-tællinger, alders-konvention. |

**Alders-konventionen:** feltet `age` ER sæson-alder (`ageForSeason(birthdate, 2)`).
`age_wallclock` findes ved siden af og må ALDRIG bruges til klassifikation — det var
præcis den forveksling der kostede blokker 1 i natbølgen (481 af 2.356 "unge" er 22+ i
sæson-alder og klassificeres i produktion mod voksen-baselinen).

**Den godkendte skriveplan (indstilling D) og kørebogen** ligger i
[`docs/reparation-3570/`](../../reparation-3570/README.md) — samme grund, samme
scratchpad de blev reddet ud af.

**Genskabes med:**
```
infisical run --env=prod -- node scripts/dev/snapshot-3570-full.mjs <outDir>
infisical run --env=prod -- node scripts/dev/snapshot-3570-birthstats.mjs <outDir>
```

**Vigtigt:** populationen driver. Mellem 22:30 og formiddagen 10/8 blev mindst 45
menneske-ejede ryttere reklassificeret af nattens sweep. Snapshottet er facit for
ANALYSEN, men enhver skrive-liste skal genberegnes på skrivedagen.

**Reparationen kører aldrig fra en forudberegnet liste.** Værktøjet
`backend/scripts/dev/repair3570Apply.mjs` tager sit eget friske snapshot og bygger
planen forfra hver gang. Snapshottet her bruges til to ting: som rollback-grundlag,
og som **selvtest** — værktøjet kører sin planlægger mod netop disse filer og kræver
at den reproducerer dry-runnets godkendte tal, før den overhovedet rører produktionen.

```
node scripts/dev/repair3570Apply.mjs --hjaelp      # flag-oversigt
node scripts/dev/repair3570Apply.mjs --selvtest    # kun paritets-porten, ingen DB
```
