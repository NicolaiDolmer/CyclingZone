# Postmortem · 2026-07-23 · RLS-policyer uden kolonne-/værdi-begrænsning kombineret med brede table-grants

## Hvad skete der?

Backlog-audit 23/7 fandt (#2802, #2803, #2814) at `anon` og `authenticated` begge
havde fuld INSERT/UPDATE/DELETE-grant på `public.users`, `transfer_offers`,
`auction_bids` og `swap_offers`. Kombineret med RLS-policies der mangler
kolonne- eller værdi-begrænsning gav det tre reelle skrivehuller:

- `users`: enhver bruger kunne PATCHe sin egen række med `{"role":"admin"}` og
  få adgang til alle `/api/admin/*`-ruter. Policyen "Users can update own
  profile" har `with_check = (auth.uid() = id)` men intet om HVILKE kolonner.
- `transfer_offers`: køberen i en handel kunne selv sætte `seller_confirmed`
  uden sælgers accept — UPDATE-policyen tillader begge parter og har ingen
  `WITH CHECK` overhovedet.
- `auction_bids`: enhver kunne INSERT'e fiktive bud (vilkårligt beløb) der
  vises som ægte i Live-bud-feeden, rytterprofilens bud-tidslinje og
  achievement-tælleren — INSERT-policyen tjekker kun at `team_id` er ens eget.

Ingen af de tre var udnyttet i prod på verifikationstidspunktet (`role='admin'`
count = 2, begge kendte; 0 auction_bids-rækker med amount > auktionens
current_price).

## Root cause

Da agenten der målte i prod (23/7 kl. ~11:30) kørte samme
`role_table_grants`-query mod ALLE public-tabeller (ikke kun de fire), viste
det sig at ~140 tabeller — praktisk talt hele schemaet — har identisk mønster:
`anon` OG `authenticated` med INSERT/UPDATE/DELETE/TRUNCATE. Det er altså IKKE
en isoleret fejl på fire tabeller, men Supabase's schema-level default
privileges: nye tabeller i `public` arver som udgangspunkt fuld DML-grant til
`anon`/`authenticated`/`service_role`, fordi Supabase's sikkerhedsmodel er
designet til at RLS — ikke table-grants — er håndhævelses-laget. Det er
"by design" fra Supabase's side (PostgREST tjekker table-grant FØRST, RLS
DEREFTER), men det betyder at en RLS-policy uden kolonne-/værdi-begrænsning er
den ENESTE ting der står mellem en klient og skrivning — der er intet
grant-lag der fanger fejlen, fordi grantet i forvejen er "alt er tilladt".

De tre konkrete huller opstod fordi policyerne blev skrevet til at afgøre
"hvilken RÆKKE" (row-level), men glemte "hvilken KOLONNE" og "hvilken VÆRDI":
- `users`: policy tjekker ejerskab (`auth.uid()=id`), men ikke hvilke felter.
- `transfer_offers`: policy tjekker deltagelse, men `WITH CHECK` er `NULL`
  (ingen constraint på hvad der ændres).
- `auction_bids`: policy tjekker `team_id`, men intet om `amount`.

Samme rodårsagsklasse som #2671/#2676 (afdækket 19/7): brede grants der
"lækker" gennem en for-tillidsfuld policy/funktion.

## Fix

`database/2026-07-23-rls-write-lockdown-users-transfers-bids-swaps.sql`
(idempotent, auto-applies ved merge):

1. `REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON users, transfer_offers,
   auction_bids, swap_offers FROM anon, authenticated`.
2. Kolonne-scoped re-grant KUN for `users` — de fire kolonner frontend
   faktisk skriver direkte (verificeret ved grep): `language`,
   `consent_preferences`, `discord_id`, `nps_last_prompted_at`. `role`, `xp`,
   `level`, `login_streak`, `email`, `username` m.fl. får IKKE grantet
   tilbage — de skrives kun af backend (service_role).
   `transfer_offers`/`auction_bids`/`swap_offers` får INGEN re-grant —
   frontend skriver aldrig direkte til dem (kun `.select()` + realtime-
   subscribe; alle mutationer går gennem backend/service_role-ruter).
3. Forward-guard: `BEFORE UPDATE`-trigger `guard_users_role_change_trigger`
   på `public.users` der raiser `role_change_forbidden` hvis `NEW.role`
   ændres og der REELT er en JWT-rolle (`auth.role()`) forskellig fra
   `service_role`. Dette er et UAFHÆNGIGT lag af kolonne-grantet — hvis en
   fremtidig migration/schema-restore ved et uheld genopretter
   `UPDATE(role)`-grantet (samme mekanisme som ramte #2676), stopper
   triggeren stadig selve mutationen.
4. `REVOKE ... REFERENCES, TRIGGER` tilføjet på alle fire tabeller (lav-severity
   fund fra adversarielt review, se "Eftervirkning" nedenfor for det kritiske
   fund fra samme review) — ikke exploitable via PostgREST, men hørte med til
   en fuldstændig lockdown.

Backend er upåvirket: `backend/routes/api.js:542-544` instantierer
`supabase`-klienten med `SUPABASE_SERVICE_KEY` (service_role, BYPASSRLS) — al
skrivning til de fire tabeller (transfer-accept, bud, admin-rollestyring)
går allerede gennem denne klient. `handle_new_user()` (signup-trigger på
`auth.users`) er SECURITY DEFINER med EXECUTE allerede revoket fra
anon/authenticated (2026-05-21) — REVOKE INSERT på `users` her ændrer derfor
ikke signup-flowet.

Verificeret lokalt: `pwsh -File scripts/verify-local.ps1` — backend 4210/4210
pass, frontend 1251/1251 pass, build OK (ingen af de tre lag rammer
service_role-baserede tests, som forventet).

### Eftervirkning: triggeren låste ejeren selv ude (fanget ved adversarielt review, samme dag)

Første udkast af `guard_users_role_change()` brugte betingelsen
`auth.role() IS DISTINCT FROM 'service_role'`. Det ser rigtigt ud, men
`auth.role()`s egen definition (Supabase-standard) er:

```sql
select coalesce(
  nullif(current_setting('request.jwt.claim.role', true), ''),
  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
)::text
```

— dvs. den returnerer **NULL** når der slet ikke er en JWT-kontekst sat,
hvilket er PRÆCIS situationen ved en direkte Postgres-forbindelse: MCP
(`execute_sql`/`apply_migration`), Supabase Dashboard SQL Editor, og
migrationer der kører som `postgres`/superuser — altså den kanal repoet selv
bruger til at applye migrationer (hard rule 9) og til manuelt at rette
`users.role` ("sat ved seed" historisk).

`NULL IS DISTINCT FROM 'service_role'` evaluerer til **TRUE** i SQL (`IS
DISTINCT FROM` behandler NULL som en almindelig, sammenlignelig værdi — modsat
`=`/`<>` som begge giver NULL ved NULL-input). Så første udkast blokerede
ALLE role-ændringer uden JWT-kontekst, inklusive ejerens/operatørens egne
direkte SQL-ændringer — den nøjagtige kanal triggeren skulle skåne. Kun
PostgREST-kald (som altid har en JWT, også for `anon`) skulle rammes.

**Fix:** betinget kun på at der REELT er en JWT-rolle, og at den ikke er
`service_role`:

```sql
DECLARE v_jwt_role text := auth.role();
...
IF NEW.role IS DISTINCT FROM OLD.role
   AND v_jwt_role IS NOT NULL
   AND v_jwt_role <> 'service_role' THEN
  RAISE EXCEPTION ...
```

Tre cases, alle verificeret: (1) `v_jwt_role IS NULL` → ingen JWT-kontekst
(direkte SQL) → tilladt; (2) `v_jwt_role = 'service_role'` → backend-admin-rute
→ tilladt; (3) `v_jwt_role IN ('anon','authenticated')` → PostgREST-kald fra
klienten selv → blokeret. Post-verify-blokken i migrationen har nu et
kørbart (BEGIN/ROLLBACK) test-eksempel for alle tre cases via
`SET LOCAL request.jwt.claims = '{"role":"..."}'`.

## Forhindret-fremover

- **Umiddelbart:** trigger-laget på `users.role` overlever selv et
  grant-uheld — næste gang default-privileges lækker igennem (fx efter en
  schema-restore), er der stadig en hård stop-klods for netop den farligste
  kolonne.
- **Strukturelt (foreslået, IKKE bygget i denne PR — kræver ejer-beslutning
  om scope):** en periodisk advisor/test der fejler hvis `authenticated`
  eller `anon` har INSERT/UPDATE/DELETE på en tabel der ikke står på en
  eksplicit allowlist. Uden den bliver hver ny tabel født med samme hul, og
  vi opdager det kun ved manuel audit (som denne).
- **Ved enhver ny tabel fremover:** skriv RLS-policyen FØRST med tanke på
  "hvilken kolonne / hvilken værdi", ikke kun "hvilken række". `WITH CHECK`
  må aldrig være `NULL` på en UPDATE-policy der involverer to parter (køber/
  sælger-mønsteret fra #2803) — brug eksplicit `WITH CHECK` der låser
  modpartens felter, eller separér i to policies.
- **Efter enhver `pg_dump`/schema-restore/branch-reset:** gentag
  `role_table_grants`-auditten (samme query som denne migrations
  post-verify-blok) FØR merge — default privileges kan gen-granteres uden at
  nogen rørte migrationsfilerne (samme mekanisme som #2676).
- **Enhver fremtidig `auth.role()`/`auth.uid()`-baseret trigger/guard skal
  eksplicit teste NULL-casen** (ingen JWT-kontekst = direkte Postgres-adgang)
  FØR den skrives til en migration, ikke opdages ved adversarielt review. Det
  billigste sted at teste: `SET LOCAL request.jwt.claims = '{"role":"..."}'`
  i en rullet-tilbage transaktion (se post-verify-blokken i denne migration)
  — kør alle tre cases (ingen JWT / service_role / anon-authenticated) FØR PR.

## Læring

En RLS-policy der kun tjekker RÆKKE-ejerskab er ikke en fuld adgangskontrol —
den er kun så stram som den bredeste kolonne-/tabel-grant den sidder oven på.
Fordi Supabase's default er "grant alt til anon/authenticated, lad RLS
filtrere", er en glemt kolonne-begrænsning i én policy nok til at åbne hele
tabellen for skrivning. Når man reviewer en RLS-policy, skal man altid stille
tre spørgsmål, ikke ét: HVEM (row), HVILKE FELTER (column-grant/WITH CHECK
per kolonne), og HVILKEN VÆRDI (WITH CHECK på selve indholdet) — og man skal
verificere alle tre mod `information_schema.role_table_grants` +
`column_privileges`, ikke kun læse policy-teksten. Backlog-audits der kun
kigger på `pg_policies` uden også at joine grants overser præcis denne
klasse af hul.

En anden takeaway, uafhængig af selve RLS-hullet: `auth.role()`/`auth.uid()`
er NULL — ikke `'anon'` eller fejl — uden for PostgREST-kontekst. Enhver
kode der skriver `x() IS DISTINCT FROM '<forventet-værdi>'` som en gate,
blokerer stiltiende ALLE NULL-kontekster, inklusive dem man ville undtage
(her: superuser/direkte SQL). `IS DISTINCT FROM` er "NULL-safe" i den forstand
at den ALDRIG selv returnerer NULL — men det betyder også at den ALDRIG
"fejler åbent" på NULL, den tager stilling. Rigtig mønster for en gate der
skal springes over uden JWT-kontekst: eksplicit `x IS NOT NULL AND x <>
'<forventet>'`, aldrig `x IS DISTINCT FROM '<forventet>'` alene.
