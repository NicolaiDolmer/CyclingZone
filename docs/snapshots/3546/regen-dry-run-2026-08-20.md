# #3546 / #3467 — regenSeason3Calendar.mjs dry-run mod prod (2026-08-20)

100 % read-only (bruger `buildTierMaterializationPlan` direkte — samme rene funktion +
samme mønster som `s3CalendarPackageScorecard.js`; ingen `.insert()`/`.update()`/`.delete()`
kaldes i dry-run-stien). Kørt via:

```
cd backend && infisical run --env=prod -- node scripts/dev/regenSeason3Calendar.mjs
```

## Output

```
=== #3546/#3467 regenerering af S3-kalenderen ===
TILSTAND: DRY-RUN (100% read-only, skriver intet)
Database: ghwvkxzhsbbltzfnuhhz

Sæson 3: id=00000000-0000-0000-0000-000000000003 · status=upcoming · start_date=2026-08-24
Eksisterende races for season_id=00000000-0000-0000-0000-000000000003: 430

── #3467 bufferdag ──
Bufferdag (ingen løb):        24/8-2026 (dagen umiddelbart efter cutoveren 23/8)
FØRSTE S3-LØBSDAG:            2026-08-25 (ejer-beslutning #3467, 18/8)
from-anker (real_day 0 base): 2026-08-24T12:00:00.000Z

── Planlagt kalender (4 tiers, 1138 etape-tider i alt) ──
   tier 1: quota=140 · races/pulje≈28 · puljer=1 · tomme dage=0 · dage uden afgørelse=5
   tier 2: quota=112 · races/pulje≈33 · puljer=2 · tomme dage=0 · dage uden afgørelse=3
   tier 3: quota=84 · races/pulje≈32 · puljer=4 · tomme dage=0 · dage uden afgørelse=4
   tier 4: quota=56 · races/pulje≈26 · puljer=8 · tomme dage=0 · dage uden afgørelse=9

Tidligste planlagte scheduled_at: 2026-08-25T09:00:00.000Z
→ Tidligste danske kalenderdag:    2026-08-25

Bufferdags-gate: OK — intet løb planlagt før 2026-08-25, 24/8 er reelt løbsfri.

DRY-RUN slut — intet skrevet. ⚠ 430 races findes stadig — kør wipeSeason3Calendar.mjs --apply FØRST.
Kør med --apply --jeg-har-set-dry-runnet for at skrive (kun efter wipe + ejer-go).
```

## Konklusion (#3467)

Bufferdagen holder: en frisk plan bygget mod det ægte `race_pool`-katalog (denne PRs
kode) med `from = resolveCalendarFrom({ firstRaceDate: "2026-08-25" })` planlægger
**intet løb før 25/8** — 24/8 er reelt løbsfri. Scriptet selv gater på dette (exit 1
hvis tidligste planlagte dag ≠ `--first-day`), så en fremtidig regression i
`buildScheduleRows`/`from`-beregningen ikke kan glide igennem umærket.

`seasons.start_date` står stadig som `2026-08-24` (uændret af denne kørsel — dry-run
skriver intet). Dette er IKKE første-løbsdags-feltet (kun `editionYearFrom(seasonStartDate)`
læser det, til GT-udgaves-årstal) og påvirker ikke bufferdags-gaten, men er værd for
orkestratoren at tage stilling til ved regenerering: skal `seasons.start_date` opdateres
til at matche 25/8, eller er 24/8 (cutover-/aktiverings-dagen) den tiltænkte semantik?

## Status

`--apply` er IKKE kørt af denne session (ingen mutationer mod prod, jf. opgavens punkt 6).
Regenerering sker efter: wipe --apply (ejer-go) → seed af opdateret `race_pool`-katalog
→ dette scripts --apply.
