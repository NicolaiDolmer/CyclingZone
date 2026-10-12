# #6490 native samtidighed, 12/10

**L4 er blokeret.** Det godkendte counter-design giver to reproducerede nye
deadlocks. L1–L3 er uaktiverede draft-kandidater; ingen prod/staging-writes,
flagændringer eller GIN-drop er udført. Dette er ikke kapacitetsbevis.

L4's første FULL fandt desuden en CRLF-fejl i L3's manuelle reader-switch/rollback
efter et frisk Windows-checkout. Fragmenterne normaliseres nu ligesom de pinnede
definitioner. Eksplicit LF/CRLF-regression reproducerede fejlen rødt, og fikset
har selvstændigt review. Det er en portabilitetsrettelse, ikke en ændring af
counter-repræsentationen. Den endelige FULL-resultatstatus står i PR/issue.

SSOT: [TRAINING_RULES](../../TRAINING_RULES.md). Godkendt
[design](../../superpowers/specs/2026-10-11-6490-training-seen-design.md) og
[plan](../../superpowers/plans/2026-10-11-6490-training-seen.md).
Foreslået ændring: [ejerkort/addendum](../../superpowers/specs/2026-10-12-6490-membership-addendum.md).

## Bevis

| Rapport | Faktisk miljø | Resultat |
|---|---|---|
| [counter-concurrency.json](counter-concurrency.json) | Ny lokal PG 17.11-database | 8 cases PASS; blandede samtidige UPSERTs FAIL, SQLSTATE 40P01 |
| [counter-multi-statement.json](counter-multi-statement.json) | Separat ny lokal PG 17.11-database | 8 cases PASS; modsatte keys over flere statements FAIL, 40P01 |
| [membership-spike.json](membership-spike.json) | Tredje ny lokal PG 17.11-database | 3 prototype-cases PASS, herunder begge konflikter |

Counter-triggeren sorterer keys inden for hver event. En blandet UPSERT kan
alligevel først tage A i UPDATE-eventen og derefter B i INSERT-eventen, mens
den anden transaktion tager B og derefter A. PostgreSQLs serverlog bekræfter
den gensidige transaction-ShareLock i `training_seen_after_insert`, ved indsættelse
i `rider_training_seen`. Den ekstra testbarriere bruger kompatible shared advisory
locks efter controllerens release og er ikke den rapporterede deadlock-cyklus.
Flere source-statements i samme transaktion kan danne samme A/B-cyklus.

Native bevis bruger rigtige, separate psql-forbindelser, observerede
`pg_blocking_pids` og et fast domæneur. Ingen timing-sleeps tæller som bevis.
Timeout er fejl, aldrig grønt skip. `parity:null` ved fejl må ikke fortolkes som
nul afvigelser. De otte beståede cases havde hver fuld nul-paritet og readiness.
Klientrollecasen kræver konkret SQLSTATE 42501; en vilkårlig forbindelsesfejl er
ikke bevis for afvist adgang. Det ægte psql-output fra restore-check bestod med
`-q`, og genopbygningen efter replica/ACL-tab bestod på PostgreSQL 17.

Membership-spiken er en lokal testfixture, ikke en produktionsmigration. Den
bevarer eksisterende memberships ved uændret match (kontrolleret med xmin/ctid),
deduplikerer og vedligeholder OLD/NEW set-difference. Dens uafhængige oracle er
det gamle JSON-containment-prædikat og faktiske rapportantal. Den erstatter ikke
L1–L4's fulde matrix: backfill, TRUNCATE/cascade, actual reader-roller, rollback
og restore skal tilpasses og genverificeres ved en godkendt designændring.

## Reproduktion og afgrænsning

L4 tilføjer et lokalt, engangs-fixturemiljø, fordi frisk read-only stagingkontrol
viste PG 17.6, manglende projektion og to ældre læserdefinitioner. Den eksisterende
staging-wrapper er uændret og omgås ikke. Staging er ikke erklæret klargjort.
Runneren forbinder kun ved alle disse eksplicitte værdier:

- `CZ_TARGET_ENV=local-disposable`, `PGHOST=127.0.0.1`, `PGPORT=56490`, `PGUSER=cz6490`.
- `PGDATABASE=cz_6490_<12 hex>`, ny og tom; serveren skal være PG17 med
  `-c cz.fixture=6490`. Ingen tabel må findes i public ved start.
- `PGPASSWORD` leveres via et lokalt procesmiljø; ingen URL eller password i argv,
  stdout eller rapport. `CZ_PSQL_BIN` kan pege på den lokale psql-binærfil.

Databaserne oprettes separat før kørslen i en isoleret lokal cluster. Runneren
installerer kun fixtures i disse tomme databaser. Den tager ikke imod eksterne
targets eller bruger repoets .env. Den fejler lukket på ukendt miljø/schema.
Ved fejl bevares syntetiske fixtures til diagnose; egne psql-processer lukkes.
Succes-cleanup sletter kun runnerens egne report-id'er. Ingen generel TRUNCATE,
index-drop eller process-kill. Prototypen er ligeledes local-only.

```powershell
& ./scripts/verify-lock.ps1 -Max 2 -- node backend/scripts/staging/verifyTrainingSeen6490.mjs --mode concurrency --clock 2026-10-11T12:00:00Z --out <nyt-resultat.json>
# Gentag i en ny database med --mode multi-statement.
& ./scripts/verify-lock.ps1 -Max 2 -- node backend/scripts/staging/trainingSeenMembershipSpike6490.mjs <nyt-spike-resultat.json>
```

For counter-kandidaten er exit 1 det reproducerede blocker-resultat, ikke en
bestået gate. Outputfilen skal være ny. Counter-rapporterne angiver base-commit;
alle rapporter indeholder normaliseret SHA-256 af runner/fixture, version og cases,
og counter-fejlene angiver SQLSTATE. Ingen rå
rapporter, credentials eller spillerdata. Fixture-hash dækker de indlæste SQL-
kilder, runner-hash binder de konkrete case-interleavings. Native kørsler skete
fra L3-base `fb60a40b2` med L4-koden, som gemmes i samme PR som rapporterne.

Windows-binaries: [officiel EDB-distribution](https://www.enterprisedb.com/download-postgresql-binaries),
17.11-3; lokalt målt zip SHA-256
`4b8db0930c38f6ef845db919551dedda3b6b845aeb0927b3d79a6e8e9e4537cf`.
Det er et lokalt filfingeraftryk, ikke en påstand om verificeret leverandørsignatur.
Ingen Windows-service installeret; testserveren lukkes efter denne leverance.

Uafhængigt read-only review og genreview (gpt-6-astra/high) bekræftede blockerens
gyldighed og prototypen som begrænset grundlag for ejerkortet. Reviewet kørte
ingen tests; de native rapporter kommer fra hovedsessionens faktiske kørsler.
