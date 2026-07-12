# 2026-07-12 — race_entries_pkey-crash i entry-generatoren ved mid-sæson-kørsel (#2375)

## Symptom
Boot-kørslen af den nye entry-generator-sweep (PR #2378) crashede i prod:
`race_entries insert (2185f4e6.../34ea9bcb...): duplicate key value violates unique constraint "race_entries_pkey"`.
NB: fejlformatet er `(race_id/team_id)` — `34ea9bcb` er et **hold**, ikke en rytter.
Holdets auto-entries var på det tidspunkt allerede slettet → løbet stod uden holdets felt.

## Rod-årsag (to lag)
1. **PK er `(race_id, rider_id)` UDEN team_id**, men skrivningen var team-scoped
   `delete(race,team,auto)` + rå `insert`. Enhver residual række med samme (race,rytter)
   under et ANDET team_id (ghost) — eller en intra-batch-dublet — vælter insertet.
2. **`selectInChunks` paginerede `.range()` uden ORDER BY.** Postgres garanterer ingen
   rækkefølge uden ORDER BY, så samme rytter-række kan dubleres/springes over mellem
   side-queries. `autopickTeamSelection` deduper ikke input → samme rytter kunne pickes
   to gange → dublet (race_id, rider_id) i én insert-batch. Ved sæson-transition var
   tabellen frisk og kørslen "heldig"; mid-sæson er en 200-holds-chunk langt over 1000
   rytter-rækker (flere sider) → latent bug materialiserede.

Sekundær skade: delete-then-insert betød at en insert-fejl EFTER delete efterlod løbet
tømt for holdets entries (ikke-atomisk to-trins-skrivning via PostgREST).

## Fix (PR fix/2375-entry-generator-idempotent)
- `selectInChunks` tager `orderBy` (unik nøgle pr. tabel) → deterministisk paginering.
- Step 10 er nu **diff-baseret pr. (race,team)**: upsert KUN manglende
  (`onConflict: race_id,rider_id`, `ignoreDuplicates: true` → PK-kollision kan aldrig
  vælte), slet KUN forældede, rolle-opdatér KUN ændrede. Insert FØR delete →
  aldrig-tommere-garanti. Intra-batch dedup på rider_id før skrivning.
- Per-enhed try/catch (heal-sweep-mønsteret) + `failed_units`/`errors` i resultatet;
  cron-wrapperen Sentry-capturer én samlet fejl pr. tick.
- Test-mocken håndhæver nu PK'en på race_entries som Postgres → regression tilbage til
  rå insert med dublet fejler i CI.

## Læring
- **PostgREST `.range()`-paginering uden ORDER BY er en dublet-/tab-bug, ikke bare
  æstetik.** Alle pagineringer skal ordne på en UNIK nøgle.
- **Kend PK'en før du skriver delete+insert:** delete-filteret skal dække de kolonner
  PK'en kollliderer på — ellers er "idempotent regenerering" kun idempotent i det
  scenarie den blev testet i (frisk sæson), ikke i drift (transfers, ghosts).
- **To-trins skrivninger uden transaktion:** skriv additivt først, destruktivt sidst,
  så en fejl aldrig efterlader mindre data end før.
