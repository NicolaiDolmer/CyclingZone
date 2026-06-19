# DB Performance-advisor — 2026-06-20

> Snapshot af Supabase performance-advisor (prod `ghwvkxzhsbbltzfnuhhz`) under natbølgen. **Post-launch prioritering** (#1375 perf-tracker) — intet her er launch-blokerende ved nuværende skala, men relevant før ægte-spiller-volumen efter forever-relaunch. Alle fixes er migrations → **ejer merger** (database/*.sql auto-applies).

## Oversigt — 79 lints

| Type | Antal | Niveau | Karakter |
|------|-------|--------|----------|
| `unindexed_foreign_keys` | 53 | INFO | FK uden covering-index → langsomme joins/cascades ved skala |
| `multiple_permissive_policies` | 19 | WARN | Flere RLS-policies pr. rolle/action → alle evalueres pr. query |
| `unused_index` | 5 | INFO | Indeks aldrig brugt → kan droppes |
| `auth_rls_initplan` | 1 | WARN | RLS re-evaluerer auth pr. række |
| `auth_db_connections_absolute` | 1 | WARN | Connection-pool-konfig |

## 1. Quick win (lille, klar) — `auth_rls_initplan`

`academy_graduation_owner_read`-policy kalder `auth.<function>()` direkte → re-evalueres pr. række. (Samme klasse som 44 policies blev fixet 2026-06-16; denne blev misset.) Fix:

```sql
-- Wrap auth-kald i (select ...) så Postgres evaluerer det ÉN gang pr. query.
-- Hent den eksakte policy-definition først, behold WHERE-logikken, kun auth-kaldet ændres:
--   auth.uid()  →  (select auth.uid())
-- Eksempel (verificér mod faktisk policy-body via pg_policies):
ALTER POLICY academy_graduation_owner_read ON public.academy_graduation
  USING ( <eksisterende-betingelse med auth.uid() erstattet af (select auth.uid())> );
```

## 2. Hot-path unindexed foreign keys (21 af 53 er trafik-relevante)

Disse FK'er ligger på tabeller der hyppigt joines/filtreres ved spil-aktivitet — prioritér dem ved skalering:
`auctions` (seller_team_id, current_bidder_id, cancelled_by), `auction_proxy_bids` (team_id), `finance_transactions` (race_id, season_id), `loan_agreements` (from/to_team_id, rider_id), `loans` (team_id), m.fl. Mønster:

```sql
CREATE INDEX IF NOT EXISTS idx_<table>_<col> ON public.<table> (<fk_col>);
-- fx: CREATE INDEX IF NOT EXISTS idx_finance_transactions_race_id ON public.finance_transactions (race_id);
```

De resterende 32 ligger på lav-trafik-tabeller (akademi, board-log osv.) — lavere prioritet. Fuld liste: [Supabase advisor 0001](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys).

## 3. Unused indexes (kan droppes — rydder skrive-overhead)

`founder_waitlist_intent_score_desc`, `idx_team_board_members_chairman`, `idx_teams_team_dna_key`, `launch_waitlist_created_desc`, `idx_race_pool_type`. NB: nogle (waitlist) kan være til fremtidig brug — verificér intention før drop.

## 4. multiple_permissive_policies (19 WARN — RLS-konsolidering)

Mest på `race_classes`, `race_points`, `race_entries`, `app_config`, `countries`. Flere permissive SELECT-policies for samme rolle betyder Postgres OR'er dem alle pr. query. Konsolidér til én policy pr. rolle/action hvor muligt. **Forsigtig RLS-refactor** (test mod prod-klon) — ikke en quick fix; lav-impact på små tabeller, men ryd op før skala.

## Anbefaling

Ingen er launch-blokerende. Rækkefølge når perf prioriteres (#1375): (1) auth_rls_initplan quick win, (2) hot-path FK-indekser før ægte-spiller-volumen, (3) drop unused, (4) RLS-policy-konsolidering. Saml i én reviewet perf-migration (ejer merger). Re-kør `get_advisors performance` efter for at bekræfte lints falder.
