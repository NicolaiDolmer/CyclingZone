# Supabase security-advisors — status, klassifikation og 7-dages regel

> Kilde til sandhed er advisoren selv: `get_advisors(type: "security")` mod
> projekt `ghwvkxzhsbbltzfnuhhz` (Supabase MCP, read-only). Denne fil er
> klassifikationen — hvilke fund der er lukket, hvilke der bevidst står åbne, og
> hvad der skal gøres for at lukke resten. Opdatér den når advisoren ændrer sig.
>
> Den korte regel (tjek ved session-start, ingen WARN over 7 dage) står i
> [`AI_OPS_REFERENCE.md`](AI_OPS_REFERENCE.md#supabase-security-advisors--7-dages-regel).

## Status 11/9 2026 (kl. 12:51)

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
| `0028_anon_security_definer_function_executable` | `is_admin()` | **Afventer apply** (#5153) | `REVOKE EXECUTE ... FROM anon`. anon har ikke bord-SELECT på `riders`, så #2671/#2676-invarianten er allerede uden effekt — se note nedenfor. |
| `0029_authenticated_security_definer_function_executable` | `is_beta_tester()` | **Afventer apply** (#5153) | Ingen policy, ingen view, ingen funktionskrop og ingen frontend-RPC bruger den. `service_role` beholder EXECUTE. |
| `0029_...` | `is_admin()` | Åben — bevidst | Frontend kalder `rpc("is_admin")` som admin-gate (`RoadmapPage.jsx`, `SurveyPage.jsx`), og authenticated-policies evaluerer den. Kan ikke blive INVOKER: `users`' cross-user-read-policy gater selv på `is_admin()` → 42P17 infinite recursion. |
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

   Husk preview-mockene (`frontend/src/preview/mockHandlers.js`,
   `installPreviewMock.js`).
3. `REVOKE ALL ON TABLE public.<mv> FROM authenticated` — først her forsvinder
   linten.
4. Refresh-stien er DB-intern (fire RPC'er, `backend/lib/refreshRankingMatviews.js`
   kalder dem via service_role), så den tåler at matview'et flyttes eller
   omdøbes uden backend-ændring.

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
