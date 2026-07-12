# 2026-07-12 — uq_race_entries_captain-kollision i diff-skrivningen (#2375 hotfix 2, CYCLINGZONE-2D)

## Symptom
Efter hotfix #2382 (diff-baseret skrivning) fejlede 31 (race,team)-enheder i prod —
alle Team UKYO (Division 3 A) — med `uq_race_entries_captain` /
`uq_race_entries_sprint_captain`. Per-enhed-isolationen virkede (resten af sweepen
kørte; 132→9 tomme løb), men holdets egne løb blev ikke suppleret.

## Rod-årsag
`uq_race_entries_*` er unikke partial-indexes pr. **(race_id, team_id)** for
captain/sprint_captain/hunter — på tværs af manuelle OG auto-rækker
(`database/2026-06-12-race-entries-roles.sql`). Diff-skrivningen fra #2382
indsatte/promoverede den NYE special-rolle-holder FØR den gamle holder var
nedgraderet: den gamle wholesale delete-then-insert ryddede implicit slottet før
insert, men diff-varianten arvede ikke den egenskab. Enhver bevaret række med
captain (manuel manager-udtagelse ELLER en bevaret auto-kaptajn fra før en stærkere
rytter kom til holdet) kolliderede med supplement-batchens captain.

## Fix (PR fix/2375-role-aware-supplement)
- **Manager vinder altid:** manual-scannen læser nu `race_role`; holder en manuel
  række en special-rolle, demoteres auto-ønsket til helper i skrivelaget (manuelle
  rækkers roller røres aldrig). topUp-neutraliseringen i staging var allerede der —
  dette er den hårde garanti i skrivelaget.
- **Vacate før insert:** eksisterende auto-rækker der MISTER en special-rolle
  (rolle-skift eller stale) opdateres til helper FØRST (én update), så uq-slottet er
  frit før upsert/promote. Vacate er en UPDATE → aldrig-tommere-garantien holder.
- Promotions kører SIDST (efter vacate + stale-delete) og beregnes mod den
  EFFEKTIVE rolle, så swaps (captain↔sprint_captain) heller ikke kolliderer.
- Test-mocken håndhæver nu uq_race_entries_* på insert/upsert/update som Postgres.

## Læring
- **En diff-refaktor skal bevare de IMPLICITTE invarianter i det gamle flow** —
  wholesale delete-then-insert "ryddede slots" som en gratis bivirkning; da delete
  forsvandt, forsvandt garantien. Kortlæg ALLE unikke constraints på tabellen (ikke
  kun PK'en du lige er blevet bidt af) før du ændrer skriverækkefølge.
- **Rolle-/status-felter med partial unique indexes kræver vacate-then-assign** i
  to-trins-skrivninger uden transaktion: frigør slottet (update til neutral værdi)
  før den nye holder skrives.
