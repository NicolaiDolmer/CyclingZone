# Forward-guarden mod "RLS-policy kalder funktion uden EXECUTE" fik et andet ben (#2671 punkt 2+3)

**Dato:** 2026-09-18 · **Issue:** #2671 · **Bygger videre på:** `.claude/learnings/2026-08-31-rls-policy-fn-execute-forward-guard.md`

## Hvad blev bygget

Punkt 1 (#4464, 30/8) var en STATISK kontrol: parse funktionsnavne ud af
`pg_get_expr(polqual)` med en regex, slå `has_function_privilege()` op. Den
fanger alle tilfælde regexen rammer rigtigt — men er blind for en policy
skrevet på en måde regexen ikke matcher.

`scripts/security-rls-role-smoketest.sql` er den anden halvdel: ingen
tekstanalyse, den GØR rent faktisk det en anon/authenticated-klient ville
gøre — `BEGIN; SET LOCAL ROLE <rolle>; SELECT 1 FROM <tabel> LIMIT 1;
ROLLBACK;` — for hver (tabel, rolle) en funktions-kaldende RLS-policy rammer
(samme opdagelseslogik som punkt 1, uden grant-filtret). Ingen prod-mutation:
hele scriptet er én transaktion der altid ROLLBACK'es. Kørt af samme
`.github/workflows/security-grants-audit.yml` hver 6. time, ved siden af
punkt 1's tjek.

## Fælden der blev fanget FØR den nåede prod: en funktions-nøglet whitelist er flaky

Første udkast whitelistede `(riders, anon, is_admin)` og
`(riders, anon, is_offered_intake_rider)` separat, ligesom punkt 1's
whitelist. Kørt read-only mod prod 18/9: samme (riders, anon)-par gav
`permission denied for function is_admin` i én kørsel og
`is_offered_intake_rider` var slet ikke i fejlbeskeden den kørsel — fordi
policyen er `a() OR b()`, og Postgres er ikke forpligtet til at evaluere
begge grene i samme rækkefølge hver gang. En whitelist nøglet på
funktionsnavn ville derfor rapportere `whitelist_stale` for den "manglende"
funktion, uafhængigt af databasens faktiske tilstand — en FLAKY falsk
positiv hver 6. time, som ville lære folk at ignorere den røde check.

**Fix:** whitelisten er nøglet på (tabel, rolle) alene. Runtime-testen kan
kun observere HVILKEN funktion der rent faktisk fejlede først, ikke om ALLE
kandidat-funktioner mangler EXECUTE — så (tabel, rolle) er den eneste
granularitet den kan bevise noget om.

## Selvsync mellem to uafhængige metoder

`scripts/security-rls-role-smoketest.test.mjs` kræver at whitelisten her er
en delmængde af (tabel, rolle)-parrene i punkt 1's whitelist
(`security-rls-policy-fn-grants.sql`). To uafhængige metoder for samme
fejlklasse der er uenige om hvad der er en bevidst fail-closed-beslutning
betyder at mindst én af dem tager fejl — testen fanger den drift statisk,
uden at skulle køre mod en database.

## Punkt 3: en dokumenteret "skal verificeres for sig" blev lukket

`scripts/security-grants.sql` havde siden #5153 en kommentar om at
`is_beta_tester()` var ekskluderet fra tjekket "så et gen-opstået
klient-grant IKKE fanges", med noten at fjerne ekskluderingen var "en oplagt
opstramning, men skal verificeres for sig". Genverificeret read-only mod
prod 18/9: 0 grants (anon+authenticated), ingen RLS-policy kalder den, ingen
`.rpc("is_beta_tester")`-kaldested i hverken frontend eller backend.
Funktionen er fjernet fra undtagelseslisten — no-op i dag, men et
gen-opstået grant fanges nu i stedet for at blive udelukket tavst.

## Regel fremad

En runtime-baseret guard der whitelister et fund, må ALDRIG nøgle whitelisten
finere end det den faktisk kan observere. Test hvad guarden VIL sige på
flere kørsler mod den samme kendte tilstand, før den lander i CI — en
non-deterministisk evalueringsrækkefølge (short-circuit OR, join-rækkefølge,
query-planlægning) kan gøre en for-fin whitelist flaky uden at nogen ændrer
databasen.
