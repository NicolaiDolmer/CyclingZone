# sim3570 — simulering af #3570-reparationen mod en ægte PostgreSQL

Harnesset der fandt fem blokkere i apply-værktøjet og rollback-filen. Det lå i en
session-scratchpad; en verifikation ingen kan gentage er ikke en verifikation, så
det ligger her nu.

**Ikke en mock.** `pgsim.mjs` rejser en PGlite (PostgreSQL 18.3 i WASM, allerede i
`backend/node_modules`) med det rigtige prod-skema — rigtige typer, NOT NULL,
primærnøgler og FK'en `rider_derived_abilities.rider_id → riders.id ON DELETE CASCADE`.
En håndskrevet mock håndhæver kun de kolonnenavne dens forfatter huskede; her
håndhæver Postgres dem, og `repair3570Rollback.sql`'s `DO $$ … RAISE EXCEPTION`-porte
bliver faktisk eksekveret af en server. **Ingen prod-forbindelse. Ingen skrivning
uden for WASM-databasen.**

Populationen er `docs/snapshots/3570/` plus 35 syntetiske pensionerede, så
backup-tallet bliver 8.234 og `is_retired`-kanten faktisk køres.

| script | hvad det beviser |
|---|---|
| `20-rollback-rundtur.mjs` | backup → skrivning → rollback bringer alle 16.468 rækker tilbage felt for felt. Kører den **committede** rollback-fil ordret, i to varianter (PART A tager kopien / værktøjet fylder den selv), og igen for at vise at PART B er idempotent. |
| `30-b5-sletninger.mjs` | post-verify skelner «rytter slettet af AI-hold-trimmen undervejs» (skal bestå) fra fire måder en skrivning kan gå galt (skal alle fejle). |
| `50-negativtest-planfil.mjs` | `--plan-fil`-porten er fejlbar: den sunde D-fil består, seks beskadigelser fanges — inkl. «rytter i scopet mangler i filen» mod en frisk population, hvor kørslen skal stoppe **før** kopien tages. |
| `21-isoler-a0.mjs` | A0-spærren i rollback-filen, isoleret. Den gamle form fejlede på en ren database — altså i præcis den førstegangs-situation PART A findes til. |

Kør fra `backend/`:

```bash
node scripts/dev/sim3570/20-rollback-rundtur.mjs
```

Stierne udledes af filernes egen placering, så harnesset kører fra et hvilket som
helst checkout eller worktree. `CZ_SIM_UD=<mappe>` flytter `out-*.json` ud af
checkoutet. Kørslerne tager 1-3 minutter hver.

**Læs resultaterne i sammenhæng:** [`docs/reparation-3570/RAPPORT-DRYRUN-D.md`](../../../../docs/reparation-3570/RAPPORT-DRYRUN-D.md).
