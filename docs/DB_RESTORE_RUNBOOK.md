# DB Restore Runbook — Cycling Zone

> Ejer-beslutning 19/8-2026: PITR-add-on **fravalgt** ($100/md. uden omsætning).
> Dette dokument er den kompenserende kontrol: hvad vi kan gendanne, hvor hurtigt,
> og præcis hvordan. **Revurdér PITR når spillet får omsætning** eller ved
> abonnements-lancering — beslutningen er logget i
> `docs/audits/2026-08-04-supabase-hardening.md` (19/8-sektionen).

## Dækning i dag (ærlige tal)

| Lag | Hvad | RPO (max datatab) | RTO (gendannelsestid) |
|---|---|---|---|
| Supabase daglige backups | Hele instansen (inkl. auth) | op til 24 timer | dashboard-restore, typisk under 1 time |
| Månedlig restore-drill (`restore-drill.yml`) | `public`-skemaet (al spildata) via logisk dump | beviser proceduren, tallet logges pr. kørsel | målt i hver drill-kørsel |
| Tabel-snapshots før risikable operationer | De berørte tabeller | ~0 for netop den operation | minutter (SQL) |

Konsekvensen af fravalgt PITR: går noget galt kl. 14, kan Supabase-restore kun gå
tilbage til seneste nat. Derfor er **snapshot-ritualet før risikable operationer
obligatorisk** (se nedenfor) — det er vores minut-præcise dækning på de tidspunkter
hvor risikoen faktisk er forhøjet.

## Scenarie 1: Dårlig migration eller datafejl i enkelte tabeller (mest sandsynlige)

1. **STOP skrivningen først**: pausér race-engine/scheduler hvis relevant (at slukke
   er altid tilladt; gen-tænd er ejer-beslutning).
2. Findes et **tabel-snapshot** fra før operationen (`database/*backup*`-tabeller,
   `docs/snapshots/`)? → gendan målrettet derfra med `INSERT ... SELECT`. Det er
   standardvejen og har ~0 datatab.
3. Intet snapshot? → vurder om data kan rekonstrueres fra kilde (fx genkørsel af
   finalization) før fuld restore overvejes. Fuld restore ruller HELE databasen
   tilbage og koster alle spilleres handlinger siden i nat — ejer-beslutning.

## Scenarie 2: Fuldt tab / korrupt instans

1. Supabase Dashboard → Database → Backups → vælg seneste daglige backup → Restore.
   (Restore sker in-place på projektet; følg dashboardets flow.) Detaljeret manuel
   procedure + smoke-tests: [`RUNBOOK_RESTORE_DRILL.md`](RUNBOOK_RESTORE_DRILL.md).
2. Efter restore: kør post-verify (nedenfor), gen-applicér migrationer nyere end
   backuppen (`schema_migrations`-tabellen viser hvad der var applied; sammenlign
   med `database/2026-*.sql` i git).
3. Informér spillerne (ejeren poster selv; udkast skrives af agenten).

## Scenarie 3: Supabase utilgængelig / projekt tabt

Den månedlige drill beviser at et rent `pg_dump`-dump af `public`-skemaet kan
gendannes i en hvilken som helst Postgres 17. Nød-procedure: kør drill-workflowets
trin manuelt mod en ny instans (Supabase-projekt eller anden Postgres), gendan
auth-brugere via Supabase-support/backup. Bemærk: `auth`-skemaet er IKKE med i
vores logiske dump — det ejes af Supabase og dækkes kun af deres backups.

## Snapshot-ritual før risikable operationer (obligatorisk)

Før enhver masse-mutation, backfill eller destruktiv migration:

```sql
CREATE TABLE backup_<tabel>_<yyyymmdd> AS TABLE <tabel>;
```

eller JSON-snapshot til `docs/snapshots/<issue>/` (mønster: #3591, #3645).
Snapshottet SKAL dække afledte felter, ikke kun de direkte muterede
(PR-templatens afledningstjekliste). Oprydning af gamle backup-tabeller: #2259.

## Den månedlige drill

`.github/workflows/restore-drill.yml` kører den 1. i måneden (05:00 UTC) og ved
manuel dispatch: dump af prod (public-skemaet) → restore i frisk Postgres 17 i
runneren → verifikation af tabelantal + nøgletabellers rækkeantal → målt varighed
logges som vores reelle RTO for spildata. Fejler den, oprettes automatisk et
`claude:todo`-issue. Dumpet forlader aldrig runneren (repoet er offentligt
læsbart — aldrig artifacts med spillerdata).

**Baseline fra første grønne drill (19/8-2026, run 32249356613):** 167 tabeller,
8.981 riders, 365 teams, 1.028.420 race_results, 1.308 races gendannet på
**97 sekunder** (dump + restore, ekskl. dashboard-flow). ~105 forventede
stderr-linjer fra grants/matview-refresh udenfor Supabase-miljøet er normalt;
verifikations-gaten er den reelle dom.

## Post-verify efter enhver restore

```sql
SELECT count(*) FROM public.riders;         -- forvent > 1.000
SELECT count(*) FROM public.teams;          -- forvent > 50
SELECT count(*) FROM public.race_results;   -- forvent > 100.000
SELECT max(imported_at) FROM public.race_results;  -- matcher forventet tidspunkt?
SELECT filename FROM schema_migrations ORDER BY applied_at DESC LIMIT 5;
```

Plus: åbn spillet som almindelig bruger (ikke kun admin) og verificér dashboard,
resultater og auktioner — samme lektion som #279 (service_role-grønt beviser intet
om spillernes flade).
