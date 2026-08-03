# Supabase-hærdning — status 2026-08-04

Kilde: `get_advisors(type=security)` mod prod (`ghwvkxzhsbbltzfnuhhz`), kørt 2026-08-04, sammenholdt
med `pg_proc.proconfig` (read-only SELECT) og eksisterende migrationer/issues. Ingen skrivninger mod
prod i denne audit — kun SELECT + advisor-kald.

Denne fil samler tre løbende hærdnings-tråde ét sted, så fremtidige advisor-kørsler er hurtige at
triagere: hvad er allerede lukket, hvad er en bevidst beslutning (ikke en fejl), og hvad afventer
ejer-handling i Supabase-dashboardet (ikke kode).

## 1. `identity_events_set_ip_prefix()` — mutable search_path (0011) — LUKKET

Advisor-fundet fra 28/7 (issue [#3124](https://github.com/NicolaiDolmer/CyclingZone/issues/3124)) er
allerede rettet og live i prod. Verificeret i dag:

```sql
select p.proname, p.proconfig
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'identity_events_set_ip_prefix';
-- proconfig = {search_path=pg_catalog, public}  ✔
```

`get_advisors(security)` kørt i dag indeholder **ingen** `function_search_path_mutable`-fund —
bekræfter samme konklusion fra advisor-siden.

Migrationen ligger i `database/2026-08-03-security-hardening-3124.sql`, merged via PR
[#3220](https://github.com/NicolaiDolmer/CyclingZone/pull/3220) (commit `6288d261`) og allerede
appliceret. Der er **ikke** oprettet en ny migration i denne audit — en `ALTER FUNCTION ... SET
search_path` mod en funktion der allerede har den korrekte `search_path` ville være et no-op, men et
duplikat-migrationsnavn i `database/` skaber forvirring om hvilken fil der reelt lukkede fundet.
Denne fil er cross-referencen i stedet.

## 2. `is_beta_tester()` / `is_offered_intake_rider(uuid)` — bevidst anon/authenticated-kaldbare

Advisor flagger begge som `authenticated_security_definer_function_executable` (WARN) — signeret ind
kan kalde dem som RPC. Det er **ikke** et hul; begge er allerede vurderet og besluttet i
`database/2026-08-03-security-hardening-3124.sql` (linje 81-91). Konsolideret her for
opslags-hastighed:

- **`is_offered_intake_rider(uuid)`** — kaldes ikke direkte som RPC af frontend. Bruges inde i
  `"Public read riders"`-RLS-policyens `USING`-klausul, som har `roles={public}` (dvs. alle roller,
  inkl. `anon`). Postgres kræver `EXECUTE` på en funktion for at en rolle overhovedet kan evaluere den
  i en RLS-klausul — uafhængigt af `SECURITY DEFINER`. At revoke `anon`/`authenticated` her ville
  fejle **enhver** `SELECT` mod `riders` for den rolle med `42501 permission denied for function
  is_offered_intake_rider` — samme incident-klasse som blev rettet 19/7 i
  [#2676](https://github.com/NicolaiDolmer/CyclingZone/issues/2676)
  (`database/2026-07-19-revoke-rpc-grants-2676.sql`). **Skal forblive kaldbar. Ingen ændring
  anbefalet.**
- **`is_beta_tester()`** — samme mønster: ingen kendte direkte RPC-kaldesteder i frontend (backend
  læser `users.is_beta_tester` direkte via `service_role` i `backend/routes/api.js`), men funktionen
  er en billig, tilsigtet RLS-hjælper i samme familie som `is_admin()`/`is_offered_intake_rider()`.
  **Ingen ændring anbefalet** — revoke ville være en gætte-baseret hærdning uden observeret
  gevinst og med samme regressionsprofil som ovenfor, hvis en fremtidig policy begynder at bruge den.

Konklusion: begge WARN er **accepterede, dokumenterede undtagelser**, ikke åbne fund. Ingen kode- eller
migrationsændring i denne audit.

## 3. `auth_otp_long_expiry` — ÅBEN, ejer-handling (dashboard, ikke kode)

Advisor (WARN, `facing: EXTERNAL`): email-OTP-udløb er sat til mere end 1 time. Supabases egen
anbefaling: sæt til under 1 time.

- **Hvor:** Supabase Dashboard → **Authentication → Sign In / Providers → Email** → feltet
  "Email OTP Expiration" (sekunder). Kan **ikke** læses eller ændres via SQL/MCP — GoTrue-auth-config
  ligger uden for Postgres-katalogerne som `execute_sql` har adgang til, så den nøjagtige nuværende
  værdi kan ikke bekræftes fra denne audit (kun at den er `> 3600s`, jf. advisor-teksten).
- **Anbefaling:** sæt til **1800 sekunder (30 min)**. Balancerer UX (spillere når typisk bekræftelses-
  eller nulstil-mails inden for få minutter) mod eksponeringsvindue for et lækket/gættet link.
  `3600s` (1 time) er advisorens minimumskrav og et acceptabelt alternativ hvis 30 min opleves for
  stramt i praksis.
- **Berørte flows i CyclingZone:** `frontend/src/pages/LoginPage.jsx` kalder
  `supabase.auth.resetPasswordForEmail(...)` (glemt-adgangskode) — det primære flow der bruger et
  tidsbegrænset email-link/OTP-token i dag. Kortere udløb reducerer direkte vinduet hvor et opsnappet
  nulstillings-link kan misbruges.
- **Status:** ikke sporet af nogen åben issue i dag — [#2258](https://github.com/NicolaiDolmer/CyclingZone/issues/2258)
  (28/7) havde det som acceptkriterie #5, men blev lukket `claude:done` uden at dette punkt var
  gennemført (det er en dashboard-klik-handling, ikke noget en PR kan lukke). Denne audit
  genåbner **ikke** #2258 — det er ejerens kald om et nyt issue er værd at oprette for et 30-sekunders
  dashboard-klik, eller om det klares direkte. Ingen kodeændring i denne PR.

## 4. Bonus-fund: `auth_leaked_password_protection` — allerede sporet, ikke duplikeret her

Advisor (WARN): HaveIBeenPwned-tjek af adgangskoder er slået fra. Dette var **uden for scope** for
denne audit, men dukker op i samme `get_advisors`-kørsel og er allerede sporet i åbent issue
[#929](https://github.com/NicolaiDolmer/CyclingZone/issues/929) (samme dashboard-sektion som OTP-
expiry — begge kan slås til i samme klik-runde). Nævnes her for fuldstændighed, ingen ny handling i
denne PR.

## Post-verify (til ejer/orkestrator — ingen apply i denne PR)

Ingen migration i denne PR, så intet at applicere. Verifikation af §1's allerede-lukkede fund kan
gen-køres når som helst:

```sql
select p.proname, p.proconfig
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'identity_events_set_ip_prefix';
-- forventet: proconfig indeholder 'search_path=pg_catalog, public'
```

Og efter en eventuel dashboard-ændring af OTP-expiry: gen-kør `get_advisors(type=security)` — punkt
`auth_otp_long_expiry` skal være væk fra listen.
