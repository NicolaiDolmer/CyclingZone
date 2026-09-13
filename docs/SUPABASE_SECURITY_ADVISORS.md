# Supabase security-advisors — status, klassifikation og 7-dages regel

> Kilde til sandhed er advisoren selv: `get_advisors(type: "security")` mod
> projekt `ghwvkxzhsbbltzfnuhhz` (Supabase MCP, read-only). Denne fil er
> klassifikationen — hvilke fund der er lukket, hvilke der bevidst står åbne, og
> hvad der skal gøres for at lukke resten. Opdatér den når advisoren ændrer sig.
>
> Den korte regel (tjek ved session-start, ingen WARN over 7 dage) står i
> [`AI_OPS_REFERENCE.md`](AI_OPS_REFERENCE.md#supabase-security-advisors--7-dages-regel).

## Status 12/9 2026 (kl. 18:27 dansk tid), #5176

**Målt med `get_advisors(type: "security")`: 7 WARN + 117 INFO**,
`observed_at=2026-09-12T16:27:58.178Z`. Fire `0016` og tre `0029`.
De fire fund fra #5153 er dermed væk fra advisoren; grants og øvrige
DDL-detaljer er ikke genmålt med SQL i denne session.

### Fire matviews: to-trinsudgivelse godkendt 12/9, revoke afventer trin 2

`backend/routes/rankings.ts` serverer de samme offentlige resultater bag
eksisterende `requireAuth`, Zod-validering og eksplicitte SELECT-kolonner.
Lister pagineres server-side med stabil sortering. De 10 direkte reads i
9 frontend-filer er peget om; kontrakt og testplan står i
[`slices/5176-matviews-behind-backend.md`](slices/5176-matviews-behind-backend.md).
Preview og e2e anvender de samme API-matchers og seeds. Review fandt også
`get_season_honours()` som indirekte INVOKER-læsning: `SeasonEndPage.jsx`
bruger nu `/api/rankings/honours`. Serveren henter aggregater via service_role
og synlige ryttere/hold med den validerede brugers Authorization-header.
Eksisterende RLS anvendes dermed før top-5, og database-sorteringen bevarer
navne/id-tiebreaks. En test med en skjult historisk topscorer og seks synlige
ryttere beviser, at de fem synlige vælges. Ingen nye DEFINER-funktioner.

`database/proposals/2026-09-12-5176-revoke-matview-select.sql` revoker SELECT fra
PUBLIC/anon/authenticated og giver eksplicit SELECT til service_role.
View-definitioner, refresh-RPC'er og aggregatberegninger ændres ikke.
Lokalt PostgreSQL-bevis: migrationen køres to gange, begge klientroller
afvises på alle fire views, og service_role kan fortsat læse dem.
Filen ligger uden for auto-migrate-globben. **PR #5183 ændrer derfor ingen
database-rettigheder. Prod-apply er ikke udført af Codex.** Efter trin 2 forventes 3 WARN,
ikke 0; Claude kører kommentarens grant/kolonne-tjek og advisoren igen.

**Godkendt rækkefølge:**

1. PR #5183 udgiver den nye læsning. Ved udgivelsen skal backend-endpoints
   være klar, før den nye frontend anvendes; begge deployments og alle seks
   endpoints kontrolleres. Test med en almindelig authenticated manager:
   stillinger, global/rytter-rangliste, holdstatistik, dashboard og honours.
2. Revoken aktiveres i en særskilt ejer-godkendt PR ved at flytte forslaget
   til `database/` og afstemme staging-testen. Forinden dokumenteres, hvordan
   allerede åbne gamle klienter er overgået til den nye frontend. Det er en
   release-forudsætning, ikke noget preview-mocks beviser. Hvis nye endpoints
   eller klientovergangen ikke er verificeret, forbliver forslaget inaktivt.
3. Claude verificerer grants/kolonneadgang og advisor-tal efter auto-migrate.

Ejerens tilladelse til denne opdeling er ikke et merge-go. Begge merges
kræver fortsat eksplicit godkendelse. Indtil trin 2 vil de fire WARN bestå.

### `is_admin()`: accepteret tilsigtet adgang, 12/9 2026

0029 er her en accepteret klassifikation af tilsigtet adgang (falsk positiv
som krav om at fjerne authenticated-EXECUTE), ikke bevis for et utilsigtet
privilegium. Funktionen læser den aktuelle brugers admin-status og bruges
både af session-gated frontend-RPC'er og af authenticated-RLS-policies.
Det tidligere optalte antal er 61 policies; **ikke genmålt 12/9**.
INVOKER er ikke en ren erstatning: users-policyens egen admin-kontrol
ville give rekursion. Den aktuelle advisor bekræfter fortsat DEFINER-adgang.

Re-verifikation ved ændring og næste ugentlige kontrol: Claude aflæser
`pg_proc` (`prosecdef`, `proconfig`, `pg_get_functiondef`),
`has_function_privilege` for anon/authenticated/service_role og
`pg_policies`-referencer til funktionen; kontroller anonym afvisning samt
admin/non-admin som hver sin session. Kontroller også session-gating i
`RoadmapPage.jsx` og beskyttet route for `SurveyPage.jsx` i `App.jsx`.
Genåbn vurderingen, hvis funktionens data eller kaldere ændres.

Alternativ: privat skema til den privilegerede helper, policies der kalder
den, og en public INVOKER-wrapper til frontend. Gevinst: privilegeret kode
ligger uden for Data API og kan fjerne dette advisor-fund. Pris: migration
af alle policy-referencer, schema-USAGE/EXECUTE-kontrakt og positive/negative
auth-tests; wrapperens adgang må ikke blive en ny generisk privilegiekanal.
Ikke implementeret i #5176. Accept fjerner **ikke** den målte WARN.

### `founder_public_list()`: behold kontrakten, separat forslag

Kilde: `2026-09-03-4649-founder-public.sql`. Funktionen læser
**subscriptions**, ikke users, og returnerer kun team_id + founder_number.
`2026-06-26-cz-pro-subscriptions.sql` giver authenticated SELECT, men RLS
begrænser den til eget abonnement. INVOKER alene skjuler andre founders
og ændrer deres rækkenummerering. En bredere SELECT-policy ville med det
eksisterende tabel-grant også åbne betalingsstatus og providerreferencer.
Det er derfor **ikke** en adfærdsneutral eller sikker enkeltændring.

Anbefaling: separat backend-læseendpoint med præcis to outputfelter og
samme sortering, derefter revoke af authenticated-EXECUTE på RPC'en.
Alternativt en separat public-safe projektion; ikke en bred subscriptions-
policy. Live-RLS er ikke genverificeret her, og ingen founder-policy ændres.

### `is_offered_intake_rider(uuid)`: B godkendt af ejeren 12/9 2026

Ejerens svar i Codex-sessionen: **"B: Kun indloggede må læse riders"**.
Dette fastlægger adgangsreglen. Policy-ændringen og de tilhørende whitelist-
ændringer er endnu ikke implementeret eller appliceret; den nuværende
fail-closed-tilstand er uændret. Implementering kræver samlet post-verifikation
af policy-roller, funktionsadgang og de to whitelist-poster nedenfor.

Kodegennemgang 12/9: `App.jsx` placerer `/riders/:id`, `/teams/:id` og
`/managers/:teamId` bag `ProtectedRoute`. `LandingPage.jsx` viser oversat
statisk indhold; `LaunchWaitlistForm.jsx` skriver kun launch_waitlist.
`RoadmapPage.jsx` læser roadmap_items/votes og session-gater is_admin.
`frontend/index.html` bruger den statiske `og-cycling-zone.png`; OG-billedet
er ikke afhængigt af riders. Ingen af disse konkrete flader kræver
anon-SELECT på riders. Browser/prod-log-bevis for anon er ikke genkørt.

- **A: offentlig rider-adgang.** Fordel: giver plads til offentlige profiler.
  Ulempe: kræver en eksplicit sikker feltliste og reparation af anon-
  funktionsrettigheder; nuværende 42501 er ikke en fungerende public API.
- **B: loginpligtig rider-adgang (anbefalet).** Fordel: matcher de eksisterende
  routes og undgår policy-evaluering som anon. Ulempe: eksterne anon-klienter
  får ingen riderdata; fremtidige offentlige profiler kræver et særskilt API.

Et `TO authenticated`-skift alene fjerner ikke 0029: authenticated skal
stadig kunne evaluere hjælperen. Eliminering af WARN kræver desuden privat
helper/schema eller en anden gennemtestet policy-kontrakt. Intet af dette
ændres som en samlet verificeret migration efter ejerens B-beslutning. De to anon-whitelist-poster i
`scripts/security-rls-policy-fn-grants.sql` skal afstemmes ved et policy-skift,
ellers giver vagten `policy_fn_whitelist_stale`.

## Historisk status 11/9 2026 (kl. 12:51, før #5166)

11 WARN + 117 INFO — **målt runtime-tilstand**, ikke forventet tilstand.
Migrationen `database/2026-09-11-5153-security-advisors-hardening.sql` (#5153) er
skrevet til at lukke 4 af WARN'erne, men den er endnu ikke appliceret: den kører
af `auto-migrate.yml` ved merge. De fire står derfor som **afventer apply** her,
og flippes først til "Lukket" når post-verify-blokken i migrationen + en ny
`get_advisors`-kørsel bekræfter det.

De 7 resterende falder i to forskellige kategorier — de har ikke samme ejer og
ikke samme lukke-arbejde:

- **Frontend-afhængige (6):** `is_admin()` (0029), `founder_public_list()`
  (0029) og de fire matviews (0016). De kan først lukkes når et kaldested i
  `frontend/src` er peget om. Ejes af en frontend-PR.
- **DB-policy-afhængig (1):** `is_offered_intake_rider(uuid)` (0029). Ingen
  frontend-kalder overhovedet — den holdes i live af `"Public read riders"`-RLS-
  policyen. Lukkes udelukkende med database-ændringer (flyt hjælperen til et
  privat skema + `ALTER POLICY`), men forudsætter en ejer-beslutning om anon-
  adgang til `riders`. Venter altså IKKE på frontend-arbejde.

| Lint | Objekt | Status | Hvorfor |
|---|---|---|---|
| `0011_function_search_path_mutable` | `record_forum_thread_view(uuid,uuid)` | **Afventer apply** (#5153) | `SET search_path = public, pg_catalog`. Funktionen er INVOKER og kun service_role-kaldbar, men slog op ukvalificeret. |
| `0014_extension_in_public` | `btree_gist` | **Afventer apply** (#5153) | Flyttes til `extensions`. Verificeret ubrugt: 0 exclusion-constraints, 0 indekser med dens opclasses. |
| `0028_anon_security_definer_function_executable` | `is_admin()` | **Afventer apply** (#5153) | `REVOKE EXECUTE ... FROM anon`. anon-stien til `"Public read riders"` er aktiv (kolonne-grants, ikke bord-grant) men fejler allerede i dag med 42501 på policyens anden operand; revoken flytter kun hvilken funktion fejlen nævner. Den ÉNE anon-sti der reelt blev ramt lå i frontend (`/roadmap`) og er lukket i samme PR. Se note nedenfor. |
| `0029_authenticated_security_definer_function_executable` | `is_beta_tester()` | **Afventer apply** (#5153) | Ingen policy, ingen view, ingen funktionskrop og ingen frontend-RPC bruger den. `service_role` beholder EXECUTE. |
| `0029_...` | `is_admin()` | Åben — bevidst | Frontend kalder `rpc("is_admin")` som admin-gate (`RoadmapPage.jsx` — kun med session, `SurveyPage.jsx` — login-gated rute), og authenticated-policies evaluerer den. Kan ikke blive INVOKER: `users`' cross-user-read-policy gater selv på `is_admin()` → 42P17 infinite recursion. |
| `0029_...` | `is_offered_intake_rider(uuid)` | Åben — **DB-policy-afhængig**, ikke frontend | Ingen RPC-kalder, men `"Public read riders"` kalder den, og RLS-udtryk evalueres som den kaldende rolle → authenticated SKAL beholde EXECUTE. Lukkes med DDL alene, når anon-spørgsmålet nedenfor er afgjort. |
| `0029_...` | `founder_public_list()` | Åben — bevidst | Kaldes direkte af `frontend/src/lib/useFounderTeams.js`. DEFINER for at kunne aggregere founder-numre uden at eksponere `users`-rækker. anon revoket i #4870. |
| `0016_materialized_view_in_api` ×4 | `rider_rankings_mv`, `global_rank_mv`, `team_standings_ext_mv`, `team_race_points_mv` | Åben — kræver frontend-PR | anon er allerede revoket (#3124, bekræftet 11/9). Linten kræver at HVERKEN anon NOR authenticated har SELECT, og alle fire læses direkte fra frontend. |

### Note: hvorfor anon-revoken på `is_admin()` ikke gen-åbner #2671/#2676

`"Public read riders"` har fortsat `roles={public}` og
`USING (is_admin() OR NOT is_offered_intake_rider(id))`. Afgørende er at der er
TO forskellige privilegie-spærringer i spil, og kun den ene er aktiv:

1. **Bord-/kolonne-privilegiet er IKKE spærret.** `has_table_privilege('anon',
   'public.riders','SELECT')` = `false`, men det er misvisende: `riders` bruger
   kolonne-grants (#2241/#4783), og `has_any_column_privilege` = `true` med 52
   af 56 kolonner grantet til anon. anon kommer altså forbi ACL-checket og frem
   til policy-udtrykket.
2. **Funktions-privilegiet ER spærret — og det giver en FEJL, ikke `false`.**
   Målt runtime 11/9 (`BEGIN; SET LOCAL ROLE anon; SELECT count(*) FROM
   public.riders; ROLLBACK;`): `ERROR 42501 permission denied for function
   is_offered_intake_rider`. anon mangler EXECUTE på policyens anden operand, og
   `false OR NOT f(x)` kan ikke kortslutte den væk. Det er ikke en "fail-closed
   nul rækker"-tilstand; det er en fejl.

Derfor gen-åbner `REVOKE EXECUTE ON FUNCTION public.is_admin() FROM anon` intet:
anon-læsningen af `riders` fejler allerede, og revoken flytter kun hvilken af de
to funktioner fejlen nævner.

**Den anon-sti der FAKTISK blev ramt, lå i frontend.** `/roadmap` er en
offentlig rute (#2042/#2824 — registreret uden for `ProtectedRoute` i
`App.jsx`), og `RoadmapPage.jsx` kaldte `supabase.rpc("is_admin")` ubetinget,
også uden session. Efter revoken ville hver udlogget besøgende få 403/42501.
Det ville ikke være brugersynligt — fejlen destruktureres væk, `isAdmin` bliver
`false`, og selve listen loader via `roadmap_items`' egen anon-policy (#3457) —
men det ville lægge en fejlstrøm i prod-loggen. Rettet i samme PR: RPC'en kaldes
kun når `supabase.auth.getSession()` giver en session. `SurveyPage.jsx`, den
anden `rpc("is_admin")`-kalder, ligger bag `ProtectedRoute` og rammes ikke.

**Drift-vagten er opdateret i samme PR.** `scripts/security-rls-policy-fn-grants.sql`
(#2671, kørt hver 6. time af `.github/workflows/security-grants-audit.yml`,
`exit 1` ved ethvert fund) ser efter revoken triplen `riders / "Public read
riders"` / `is_admin` / `anon` som et nyt WARN. Det er den tilsigtede
fail-closed-tilstand, så triplen er whitelistet ved siden af søsterposten for
`is_offered_intake_rider`, med reference til den learning der bærer
beslutningen. Målt read-only mod prod 11/9 er det den **eneste** nye tripel:
`"Public read riders"` er den eneste policy med `roles={public}` der kalder
`is_admin()`.

**Eksisterende fund (ikke introduceret af #5153):** at anon-stien ender i 42501
i stedet for i rækker eller i et tomt sæt, er en inkonsistens — policyen siger
`roles={public}`, privilegierne siger delvist nej. Kalder noget faktisk `riders`
som anon, ligger der en fejlstrøm i loggen i dag; det bør verificeres i Postgres-
/PostgREST-loggen.

**Åbent ejer-spørgsmål:** skal anon kunne læse `riders` overhovedet? Svaret
afgør om 0029-fundet på `is_offered_intake_rider` lukkes ved at flytte hjælperne
til et privat skema (og dermed reparere anon-læsningen), eller ved at scope
policyen `TO authenticated` (og dermed droppe anon-læsning eksplicit i stedet
for ved et uheld). Ikke besluttet i #5153.

### Opskrift for de 4 matview-fund (følge-PR, kræver frontend-ejerskab)

Det naive trick virker **ikke**: flyt matview'et til et privat skema og læg et
view med samme navn i `public`, så frontend er uberørt. Et
`security_invoker=true`-view kræver at kalderen selv har SELECT på matview'et
(ingen gevinst), og et view UDEN `security_invoker` ejet af `postgres`
(`rolbypassrls=true`) bytter bare 4× `0016` for 4× `0010_security_definer_view`
— samme WARN-niveau, og det bryder husmønstret (alle fire eksisterende
public-views er `security_invoker=true`).

Den reelle vej, pr. matview:

1. Luk læsningen bag en `SECURITY DEFINER`-RPC (eller et backend-endpoint) med
   de filtre frontend faktisk bruger — husk `team_race_points_mv`s
   head+count-kald (`useNpsPrompt.js`) og `StandingsPage.jsx`' paginerede
   `fetchAllRows`.
2. Peg **alle 10 reads** om — de ligger i 9 filer, fordi `StandingsPage.jsx`
   læser to forskellige matviews:
   - `global_rank_mv` ×3: `GlobalRankWidget.jsx`, `useGlobalRank.js`,
     `TeamProfilePage.jsx`
   - `rider_rankings_mv` ×3: `TeamStatsTab.jsx`, `useRiderRankings.js`,
     `ResultaterPage.jsx`
   - `team_race_points_mv` ×3: `useNpsPrompt.js`, `DashboardPage.jsx`,
     `StandingsPage.jsx`
   - `team_standings_ext_mv` ×1: `StandingsPage.jsx`

   Flad liste over de 9 unikke filer, så scope ikke kan misforstås:
   `GlobalRankWidget.jsx`, `useGlobalRank.js`, `TeamProfilePage.jsx`,
   `TeamStatsTab.jsx`, `useRiderRankings.js`, `ResultaterPage.jsx`,
   `useNpsPrompt.js`, `DashboardPage.jsx`, `StandingsPage.jsx`. 10 reads, 9
   filer — differencen er `StandingsPage.jsx`, der står i to grupper.

   Husk preview-mockene (`frontend/src/preview/mockHandlers.js`,
   `installPreviewMock.js`).
3. `REVOKE ALL ON TABLE public.<mv> FROM authenticated` — først her forsvinder
   linten.
4. Refresh-stien går via fire DB-RPC'er. `backend/lib/refreshRankingMatviews.js`
   kalder dem via `service_role`, så matview'et kan flyttes eller omdøbes uden
   ændring af backend-kaldet. RPC-implementeringerne skal til gengæld opdateres
   med de nye matview-referencer i samme migration.

### Forward-note: btree_gist ligger ikke længere i `public`

En ny `EXCLUDE USING gist (<uuid-kolonne> WITH =, ...)` skal have `extensions` i
`search_path` eller skema-kvalificere opclassen. Der er 0 exclusion-constraints
i basen i dag, så ingen eksisterende DDL rammes.

## INFO: 117 tabeller med RLS uden policy (`0008_rls_enabled_no_policy`)

Ikke i #5153 — og for hovedparten ikke en defekt. RLS slået til UDEN policy er
fail-closed: anon og authenticated får nul rækker, `service_role` bypasser RLS.
Klassifikation (målt 11/9, summer til 117):

| Klasse | Antal | Håndtering |
|---|---|---|
| Snapshot-/backup-tabeller (`backup_*`, `*_backup_*`, `cutover_*`, `*_snapshot_*`) | 79 | Skal ryddes, ikke policy-dækkes → **#2259**. |
| Ops-/log-tabeller (`*_log`, `*_runs`, `*_outbox`, `*_events`, `*_ticks`, `matview_refresh_heartbeat`, `schema_migrations`, `traffic_events`, …) | 28 | **Bevidst uden policy.** Kun `service_role` skriver og læser dem; en klient har intet legitimt behov. Nye ops-tabeller følger samme mønster: RLS til, ingen policy. |
| Spil-tabeller der serveres via backend-API'et (`board_mandates`, `board_relations`, `board_consequences`, `board_vision_milestones`, `team_dna`, `team_board_members`, `race_entry_days`, `rider_derived_ability_history`, `player_feedback`, `signup_attribution`) | 10 | **Bevidst uden policy.** Læses/skrives af backend som `service_role`. En policy tilføjes KUN hvis en direkte klient-læsning introduceres — så er fail-closed-tilstanden i øvrigt det rigtige udgangspunkt. |

Relateret historik: #528 (oprindelig klassifikation), #2259 (backup-oprydning),
#3124, #4870, #5088 (matview-eksponering).
