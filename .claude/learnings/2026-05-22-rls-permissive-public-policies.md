# 2026-05-22: RLS "Service role full access" policies var faktisk public-write

> **Issue:** [#548](https://github.com/NicolaiDolmer/CyclingZone/issues/548). **Migration:** `database/2026-05-22-rls-permissive-policy-lockdown.sql` (v3.90). **Audit:** [`docs/RLS_AUDIT_2026-05-22.md`](../../docs/RLS_AUDIT_2026-05-22.md).

## TL;DR

5 RLS-policies med navne som "Service role full access X" var faktisk **public** (alle roller incl. authenticated). Auth user kunne INSERT/UPDATE/DELETE i `loans`, `loan_config`, `notifications`, `activity_feed`, `admin_log`. Plus 1 nyt fund: `users.Public read basic user info` eksponerede email+discord_id+consent_preferences til alle auth users. Alle 6 verificeret eksploiterbart på prod-DB via SET ROLE-tests, derefter lukket via migration.

## Hvordan opstod det

Anti-pattern på tværs af 5 policies:

```sql
CREATE POLICY "Service role full access X" ON X
  FOR ALL TO public          -- ← bug: skulle være service_role
  USING (true);
```

`TO public` i Postgres betyder "all roles", ikke "anonymous role". Dette inkluderer `authenticated`. Misforståelsen var sandsynligvis at navngivningen ("Service role full access") implicit afspejlede scope, men SQL-syntax overruled navnet.

`service_role` har `BYPASSRLS`-flag i Supabase, så uden nogen policy ville service_role stadig have fuld adgang. **`TO service_role`-policies er principielt redundante** — men de fungerer som "kun service-role kan ramme denne række via RLS-evalueringen". Den korrekte fix er bare `TO service_role` så non-service-role rammer default-deny.

## Hvorfor advisoren ikke fangede severity

Supabase advisor flagger pattern som `rls_policy_always_true` (WARN). #527 (Phase B) blev åbnet for at adressere — men prioritet var **P2** med klassificering "service-role intentional design". Antagelsen: navnet "Service role full access" betød at kun service-role brugte policy'en i praksis.

**Antagelsen var forkert.** Hver permissive policy var fuldt eksploiterbar af enhver authenticated user. Audit-step der manglede: faktisk SET ROLE authenticated + forsøg exploit. Det er nu udført, dokumenteret, og fixet.

## Bonus-fund: `users.Public read basic user info`

Eksisterende policy:
```sql
CREATE POLICY "Public read basic user info" ON users FOR SELECT
  USING (auth.role() = 'authenticated');
```

Hver authenticated user fik ALLE kolonner fra ALLE rækker i `users`-tabellen — inkl. `email` (24 unique addresses), `discord_id` (14), `consent_preferences` (jsonb). GDPR-risk + doxxing-risk.

Frontend-usage-grep viste: kun admin-pages (AdminPage.jsx + AdminUsersTab.jsx) læser cross-user data. Alle andre kald er `.eq("id", session.user.id)` (own-row). Fix: drop bredt policy, behold "Users can read own profile", tilføj `"Admins can read all users" FOR SELECT TO authenticated USING (public.is_admin())`. `is_admin()` er SECURITY DEFINER så ingen RLS-rekursion.

## Verifikation pre-fix (alle 5 var eksploiterbare som random auth user)

```sql
SET LOCAL role = authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-000000000000';

SELECT COUNT(*) FROM loans;                          -- → 17 (alle synlige)
SELECT COUNT(*) FROM users WHERE email IS NOT NULL;  -- → 24 (alle emails)

INSERT INTO notifications (..., 'bid_received', 'PHISH', 'evil.com', ...);  -- → success
INSERT INTO activity_feed (..., 'rls-test', ...);                            -- → success
INSERT INTO loans (..., team_id=<other-team>, principal=999999, ...);        -- → success
UPDATE loans SET amount_remaining = amount_remaining - 100000 WHERE id=...;  -- → success
DELETE FROM loans WHERE ...;                                                  -- → success
UPDATE loan_config SET interest_rate_pct = 0.01;                              -- → success
```

## Verifikation post-fix

```sql
-- Random auth user:
SELECT COUNT(*) FROM loans;                          -- → 0
SELECT COUNT(*) FROM users WHERE email IS NOT NULL;  -- → 0
INSERT INTO notifications (...);                     -- → ERROR 42501
INSERT INTO activity_feed (...);                     -- → ERROR 42501

-- Admin user (ndmh32):
SELECT COUNT(*) FROM users;                           -- → 24 ✓
SELECT COUNT(*) FROM users WHERE email IS NOT NULL;   -- → 24 ✓
```

## Forward-guard

| # | Tiltag | Status |
|---|---|---|
| 1 | Migration applied til prod 2026-05-22 (`rls_permissive_policy_lockdown_2026_05_22` via Supabase MCP) | ✅ Done |
| 2 | Advisor re-run viser 5/6 `rls_policy_always_true` lukket (kun pending_race_result_rows → #518) | ✅ Done |
| 3 | **CI lint-rule:** SQL-grep for `CREATE POLICY ... TO public ... USING (true)` på non-SELECT commands → fail | 🔲 TBD-issue |
| 4 | **Audit-skabelon:** ved RLS-warn fra advisor → kør faktisk `SET ROLE authenticated` exploit-test, ikke kun antage "service-role intentional" | 🔲 docs update |
| 5 | **#527 close:** Phase B work fuldt dækket af denne migration (5/6 policies) + #518 dækker den 6. | 🔲 close |

## Beslægtede memories / mønstre

- `.claude/learnings/2026-05-20-rls-silent-update-races.md` — RLS-bug var silent
- Sæson-loop forensik (2026-05-22) — silent state-divergence-pattern
- Memory: `feedback_runtime_verify_first.md` — "Verificér FØR claim". Denne sag: tool-warn ≠ klassificeret severity. Manuel runtime-test elevated 6 fund fra P2 til P0/P1.

## Lessons learned

1. **`TO public` på write-policies er anti-pattern.** Default til `TO service_role` for "kun-service" policies; brug `TO authenticated` + restrictive USING for user-scoped writes.
2. **Advisor's `rls_policy_always_true` WARN er ofte P0/P1 — verifér severity med exploit-test, ikke antagelse om policy-navn.**
3. **Cross-user SELECT policies skal column-restrictes** når tabellen indeholder PII (email, discord_id, consent_preferences). Lav view eller revoke column-grants frem for at åbne for hele rækken.
4. **`is_admin()` SECURITY DEFINER pattern løser RLS-rekursion** for admin-policies på users-tabellen.
