# RLS-policy der kalder en funktion kræver EXECUTE-grant til hver rolle der rammer tabellen

**Dato:** 2026-05-31 · **Kontekst:** #669 admin-gate (RLS-synlighed for fiktive ryttere)

## Hvad skete

Ændrede `riders`-SELECT-policyen fra `USING (true)` til `USING (pcm_id IS NOT NULL OR public.is_admin())` for at skjule fiktive ryttere fra ikke-admin. Den **gamle** policy kaldte ingen funktion; den **nye** kalder `is_admin()`. Anon-rollen havde ikke `EXECUTE` på `public.is_admin()`, så enhver anon-læsning af `riders` fejlede med:

```
ERROR: 42501: permission denied for function is_admin
```

Det er en **regression**: `"Public read riders"` er `TO public` (inkl. anon), og anon kunne læse riders før. At policyen nu kalder en funktion uden anon-grant brød det.

## Hvorfor det ikke ramte authenticated

`is_admin()` havde `EXECUTE` for `postgres`, `authenticated`, `service_role` — men **ikke** `anon`. Så indloggede brugere virkede; kun anonyme (og evt. offentlige sider) ville fejle.

## Fix

```sql
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon;
```

Sikkert: `is_admin()` returnerer `false` for anon (`auth.uid()` er NULL → intet `users`-opslag, ingen data-læk). `SECURITY DEFINER` ændrer ikke på at den **kaldende** rolle skal have `EXECUTE`.

## Regel fremad

Når en RLS-policy (eller en kolonne-DEFAULT/CHECK) begynder at **kalde en funktion**, så verificér at **alle roller der rammer tabellen** (typisk `anon` + `authenticated`) har `EXECUTE` på funktionen. Gælder især når man strammer en `USING (true)`-policy der før ikke kaldte noget.

## Hvordan det blev fanget

Rolle-impersonation **før** reel brugerpåvirkning:

```sql
BEGIN; SET LOCAL role anon; SELECT count(*) FROM riders; ROLLBACK;
```

Test altid en RLS-ændring som **anon + authenticated-ikke-admin + admin** via `SET LOCAL role ... ; SET LOCAL request.jwt.claims = '{"sub":"<uuid>"}'` før den betragtes som verificeret.
