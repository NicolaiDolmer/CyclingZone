# Forward-guard mod "RLS-policy kalder funktion uden EXECUTE" er nu automatisk

**Dato:** 2026-08-31 · **Issue:** #2671 · **Klassen bed 3x, fanget 0 gange af automatik**

## Fejlklassen

En RLS-policy evalueres med **kalderens** rettigheder. Kalder policyen `is_admin()`, skal enhver rolle der rammer tabellen have `EXECUTE` på `is_admin()`. Mangler grantet, fejler **hver eneste adgang til tabellen** for den rolle med `42501 permission denied for function`. Det ligner ikke en RLS-afvisning, og det rammer kun roller ingen tester i hånden.

Tre bid på præcis samme policy, `riders / "Public read riders"`:

| Dato | Hvad skete der | Hvordan blev det fanget |
|---|---|---|
| 31/5 | Policyen begyndte at kalde `is_admin()` uden anon-grant | Manuel rolle-impersonation |
| 29/6 | Hardening-migration revokede anon-EXECUTE. Backwards-checken greppede kun `.rpc()`-kaldssteder og overså policy-stien | Ved held, efter ~3 ugers tavshed |
| 5/8 | `is_offered_intake_rider` blev tilføjet policyen uden at arve anon-grantet fra søsterfunktionen | Ved held, mens et scorecard kørte |

Rod-årsagen bag alle tre er den samme: **grant-siden og policy-siden lever i hver sin migration**, og intet led i kæden læste `pg_get_expr(polqual)`.

## Hvorfor det eksisterende værn ikke dækkede

`scripts/security-grants.sql` bruger allerede `has_function_privilege`, men i **modsat retning**: den flager SECURITY DEFINER-funktioner som klienten *kan* kalde (over-grants). Under-grants var et blindt punkt. `rls-audit.yml` dækker tabel-grants, ikke funktions-grants. Det statiske lint ser kun filer, ikke hånd-anvendt SQL.

## Fix

`scripts/security-rls-policy-fn-grants.sql`, kørt hver 6. time mod prod fra `.github/workflows/security-grants-audit.yml`. For hver RLS-policy i `public` udtrækkes funktionsnavne fra `pg_get_expr(polqual)` + `pg_get_expr(polwithcheck)`, og `has_function_privilege(<rolle>, fn, 'EXECUTE')` verificeres for hver rolle policyen rammer (`anon` + `authenticated` ved `polroles = '{0}'`, ellers de navngivne).

Målt mod prod 30/8: 189 policies, 257 funktioner, 64 (policy, funktion, rolle)-tripler evalueret. Ét fund, som er whitelistet: `riders / "Public read riders" / is_offered_intake_rider / anon`, den bevidste fail-closed fra [2026-07-18](2026-07-18-anon-riders-select-fail-closed-42501.md).

## Læringen der gjorde guarden bedre end en ren query

En whitelist er selv en risiko: klassen bed tre gange, og hver gang så det ud som om ét enkelt undtagelsestilfælde var uskadeligt. Derfor to ekstra mekanismer:

1. **`policy_fn_whitelist_stale`** fyrer hvis en whitelist-post ikke længere matcher et fund. Det holder whitelisten ren, men er samtidig guardens eget livstegn: går udtræks-logikken i stå og finder nul, går tjekket rødt i stedet for grønt. En guard der ikke kan skelne "intet fund" fra "jeg kigger ikke længere" er ikke en guard.
2. **`scripts/security-rls-policy-fn-grants.test.mjs`** kræver at hver whitelist-post peger på en learning-fil der faktisk findes, at `authenticated` aldrig kan whitelistes (indloggede spillere må aldrig fail-close), og at scriptet stadig er wiret ind i workflowet.

Begge er verificeret ved negativ kontrol: whitelist-posten fjernet giver fundet tilbage, og en forkert learning-sti får selvtesten til at fejle.

## Regel fremad

Uændret fra 31/5 og 18/7, men nu håndhævet: ændrer du en RLS-policy eller en funktions grants, skal `anon` og `authenticated` stadig kunne eksekvere alt policyen kalder. Du behøver ikke længere huske det. Bliver det glemt, går `Security grants audit` rødt inden for 6 timer.
