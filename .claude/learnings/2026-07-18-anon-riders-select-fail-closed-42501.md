# Anon-læsning af riders fejler med 42501 — bevidst accepteret fail-closed

**Dato:** 2026-07-18 · **Kontekst:** Undersøgelse af "permission denied for function is_admin" på alle anon-SELECT mod `riders` i prod

## Symptom

Enhver anon-rolle-læsning af `public.riders` (fx `GET /rest/v1/riders` med kun apikey, ingen bruger-JWT) fejler:

```
ERROR: 42501: permission denied for function is_admin
```

Authenticated virker upåvirket.

## Rod-årsag (tidslinje)

1. **2026-06-22** (`database/2026-06-22-hide-intake-riders-from-db.sql`, #1743): riders-SELECT-policyen `"Public read riders"` ændret til `is_admin() OR NOT is_offered_intake_rider(id)`. Migrationen grantede korrekt EXECUTE til **anon** på begge funktioner (lærdom fra [2026-05-31-rls-policy-calling-function-needs-role-grant.md](2026-05-31-rls-policy-calling-function-needs-role-grant.md) — samme fejlklasse, første bid).
2. **2026-06-29** (`database/2026-06-29-secure-securitydefiner-rpc-grants.sql`): hardening-migration revokede anon-EXECUTE på `is_admin()` + `is_offered_intake_rider(uuid)` med begrundelsen "frontend kalder kun authenticated". Den backwards-check dækkede **kun .rpc()-kaldsstier** — den overså at begge funktioner også kaldes fra riders-**RLS-policyen**, som anon rammer via almindelig tabel-læsning. → Anden bid af samme fejlklasse.
3. Siden 29/6 har al anon-læsning af riders derfor fejlet — uden at nogen bemærkede det i ~3 uger.

## Beslutning: accepteret fail-closed, INGEN re-grant

Fuld kodebase-audit 18/7 (frontend routes, backend-klienter, scripts, edge functions):

- **Ingen pre-login-flade læser riders.** Alle 25+ `.from('riders')`-forekomster ligger bag `ProtectedRoute` (App.jsx — kun `/`, `/login`, `/reset-password`, privacy, `/founder-supporter`, `/ui` er offentlige, og ingen af dem henter rytterdata). LandingPage har nul supabase-læsninger (kun waitlist-INSERT).
- Backend bruger udelukkende service_role; import-scripts bruger service_role; ingen edge functions.
- 3 ugers total stilhed i prod bekræfter empirisk at stien er ubrugt.

Derfor: **ingen migration.** Anon-fejlen er harmløs fail-closed (fejl i stedet for data) og revoken fra 29/6 bibeholdes som den strammeste tilstand. Verifikations-reproduktion: `BEGIN; SET LOCAL role anon; SELECT id FROM riders LIMIT 1; ROLLBACK;` → 42501.

## Hvis anon-læsning ENGANG ØNSKES (fx offentlig landing-showcase)

```sql
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon;
GRANT EXECUTE ON FUNCTION public.is_offered_intake_rider(uuid) TO anon;
```

Sikkert: `is_admin()` → false for anon (auth.uid() er NULL); `is_offered_intake_rider` lækker intet (boolean om skjult intake-status). Alternativ, hvis anon aldrig skal kunne læse: `ALTER POLICY "Public read riders" ... TO authenticated` — så returnerer anon tomt/pænt afvist i stedet for 42501.

## Regel fremad (skærpelse af 2026-05-31-reglen)

Når du **REVOKEr EXECUTE fra en rolle** på en funktion: grep ikke kun efter `.rpc('fn')`-kaldssteder — tjek OGSÅ `pg_policy` (`pg_get_expr(polqual, polrelid) LIKE '%fn%'`) for RLS-policies der kalder funktionen, og kør `SET LOCAL role <rolle>`-smoke-test mod hver berørt tabel. En policy-kaldt funktion rammes af ALLE roller der kan læse tabellen, uanset om de nogensinde kalder funktionen direkte.
