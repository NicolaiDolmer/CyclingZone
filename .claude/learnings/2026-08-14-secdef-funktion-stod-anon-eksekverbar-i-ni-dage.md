# SECURITY DEFINER-funktion stod anon-eksekverbar i ni dage (#3765)

**Dato:** 2026-08-14 · **Klasse:** #2858 (tredje gang) · **Fix:** PR #3766 (hullet), PR med `security-grants-audit.yml` (vagten)

## Hvad der skete

`public.apply_race_results_batch(uuid, integer[], jsonb)` stod live fra 5/8 til 14/8 med:

```
postgres=X | anon=X | authenticated=X | service_role=X
```

Funktionen er `SECURITY DEFINER`, har ingen autorisations-gate i kroppen, og gør `DELETE` + `INSERT` på `race_results`. Enhver med den publicerbare anon-nøgle — som ligger i frontend-bundtet, som den skal — kunne have kaldt `/rest/v1/rpc/apply_race_results_batch` og omskrevet ethvert løbs resultater. `SECURITY DEFINER` kører som ejeren, så RLS beskyttede ikke.

Ingen evidens for udnyttelse: nul kald i edge-loggens 24-timers vindue, og alle 223.090 resultat-rækker skrevet siden 5/8 ligger i batches på 152+ rækker på motorens faste tidspunkter. Ingen små eller skævt timede skrivninger.

## Rod-årsag — to fejl der skulle ramme samtidig

**1. Grant-mekanikken (kendt klasse, #2858).** Supabase' `ALTER DEFAULT PRIVILEGES` granter `EXECUTE` eksplicit til `anon` + `authenticated` ved *enhver* funktions-oprettelse i `public`. `REVOKE ALL ... FROM PUBLIC` fjerner **ikke** de eksplicitte role-grants. Migrationsforslaget skrev netop:

```sql
REVOKE ALL ON FUNCTION ... FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ... TO service_role;
```

Det *ligner* en lukning og er det ikke. Klassen havde bidt to gange før (#2676, #2692) — begge gange reddede en intern `auth.role()`-gate runtime, så konsekvensen blev aldrig følt.

**2. Filen blev aldrig anvendt af automatikken.** Funktionen lå i `database/proposals/`. `auto-migrate.yml` kører `find database -maxdepth 1 -name '2026-*.sql'` og har path-filteret `database/2026-*.sql` — `proposals/` er struktureltvuderet ude. `schema_migrations` bekræfter det: fire `2026-08-05-*`-migrationer fra `database/` står anvendt, forslagsfilen står ikke.

Funktionen findes altså i prod, men blev anvendt **i hånden**, og kun `CREATE OR REPLACE`-delen kom med. De to grant-linjer nederst i filen blev aldrig kørt.

Det er den farlige del: `database/proposals/` indeholder filer der ser ud som migrationer, læses som migrationer og navngives som migrationer — men intet anvender dem. Så de bliver anvendt manuelt, stykvis, og den sidste tredjedel af filen er den der falder på gulvet.

## Hvorfor det ikke blev opdaget

Supabase' egen advisor (0028/0029) flagede det hele tiden. Ingen kiggede, fordi ingen automatik kiggede:

- `auto-migrate.yml` — anvender SQL, verificerer ikke grants bagefter.
- `rls-audit.yml` — dækker **tabel**-grants (#2830). Ikke funktioner.
- `db-health.yml` — disk-IO og performance. Ikke sikkerhed.
- Verificeret ved gennemsøgning 14/8: **intet** i `.github/` eller `scripts/` refererede `get_advisors`, `prosecdef`, `proacl` eller `has_function_privilege`.

Review kunne heller ikke fange det: på review-tidspunktet var migrationen ikke anvendt, så den faktiske ACL fandtes ikke at kigge på — og filen så korrekt ud for et menneske der ikke kender default-privileges-mekanikken.

#2858 foreslog begge de rigtige værn i juli. Issuet blev aldrig lukket, og klassen bed igen.

## Hvad der er gjort

**Hullet:** PR #3766 revoker `anon` + `authenticated` på `apply_race_results_batch` (paritet med `apply_stage_result` og `dashboard_rider_ranking`, der begge stod korrekt) og grant-låser også `compute_daily_growth_snapshot`. Kilde-forslaget er rettet, så mønsteret ikke kan gentages derfra.

**Vagten:** `security-grants-audit.yml` i to lag, fordi ingen af dem kan stå alene:

| Lag | Kører | Ser | Fanger |
|---|---|---|---|
| `scripts/check-secdef-revoke-lint.mjs` | PR, kun ændrede SQL-filer | filer | nye migrationer der glemmer `REVOKE ... FROM anon, authenticated` |
| `scripts/security-grants.sql` | hver 6. time mod prod | faktisk `pg_proc.proacl` | hånd-anvendt SQL der aldrig var en fil — netop denne hændelses sti |

Linten er verificeret mod den ægte forslagsfil: den fejler på den, med den rigtige begrundelse. Live-tjekket er verificeret mod prod: det finder præcis de to kendte og ingen falske positiver blandt de seks bevidst klient-kaldbare.

Linten spærrer kun på **ændrede** filer. Hele `database/` har 27 historiske fund mens den levende database kun har to — et hårdt gate på hele mappen ville være støj fra dag ét, og støj bliver slået fra.

## Læringen

**`REVOKE ... FROM PUBLIC` er ikke en lukning i Supabase.** Rollerne skal nævnes ved navn. Det er ikke intuitivt, det ser rigtigt ud, og det har nu narret tre migrationer.

**En mappe med filer ingen automatik anvender, er en fælde.** `database/proposals/` producerer manuelt anvendte, delvist anvendte migrationer. Enten skal noget anvende dem, eller også skal de ikke ligne migrationer. Værd at tage stilling til separat — vagten dækker konsekvensen, ikke årsagen.

**En kendt klasse uden automatisk værn er en åben klasse.** #2858 beskrev både problemet og de to rigtige løsninger tre uger før hændelsen. Diagnosen var korrekt og gratis; det var værnet der manglede. Når noget har bidt to gange, er tredje gang et spørgsmål om tid — ikke om opmærksomhed.
