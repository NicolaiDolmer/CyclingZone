# 2026-05-10 — Slice 14 "Udvikling"-fane viste tom-state i 14 dage pga. manglende RLS-policy

**Issue:** [#279](https://github.com/NicolaiDolmer/CyclingZone/issues/279)
**Migration:** `slice14_rls_select_authenticated_for_history_tables`

## Hvad gik galt

Slice 14 (UCI/stats-historik på rytter-side) blev shipped 2026-04-26 med:
- ✅ DB-tabeller `rider_uci_history` + `rider_stat_history`
- ✅ Backend-hooks i `sheetsSync.js` + `dynCyclistSync.js` (skriver via service_role)
- ✅ Scraper-cron `.github/workflows/uci_sync.yml`
- ✅ Frontend `RiderDevelopmentTab.jsx` + recharts + fane "Udvikling"

Tabellerne fik RLS enabled men **0 policies**. Scraper skrev fint (service_role bypass'er RLS), så data akkumulerede i 14 dage. Men frontend læser via authenticated-rolle, og PostgreSQL default uden policies = deny → 0 rows til alle managers.

`RiderDevelopmentTab.jsx` har empty-state copy *"Ingen historik endnu — data akkumuleres fra næste ugentlige sync"* — så fejlen lignede normal "endnu ingen data"-tilstand. Ingen alarm gik af. Slice 14 stod som "DONE" i memory.

## Hvordan det blev fanget

Bruger spurgte direkte: *"Kan du bevise at denne del virker?"* — og krævede end-to-end-bevis i stedet for kode-trace alene.

Verifikations-trin der afslørede bug'en:
1. Curl af prod-bundle bekræftede komponenten er deployed
2. SQL-query bekræftede DB-data findes
3. **`SET LOCAL ROLE authenticated; SELECT COUNT(*) FROM rider_uci_history` → 0** ← her sprang bug'en frem
4. Curl af Supabase REST med publishable anon key → `[]` (bekræftede)

## Læringspunkter

1. **"DONE"-claim kræver authenticated-perspektiv-test, ikke bare service_role.** Når scraper-data lander fint i DB betyder det IKKE at frontend kan se det. Tjek RLS-policies eksplicit eller smoke-test som `SET LOCAL ROLE authenticated`.

2. **Empty-state copy kan maskere data-pipeline-bugs.** "Ingen data endnu — kommer næste sync" lyder uskyldigt, men hvis det vedvarer længere end forventet sync-cyklus er det et signal. Overvej at logge "rendered empty Udvikling-fane" i analytics for at fange systemiske RLS-fejl.

3. **Memory om slice-status er ikke evidens.** Mit memory sagde "Slice 14 DONE" baseret på shipped-state — ikke runtime-verifikation. Memory om feature-status bør altid checkes mod runtime før det citeres som faktum.

## Handlinger fremad

- [x] Migration anvendt + verificeret
- [x] Issue #279 filed + closed med audit-trail
- [x] Memory `project_slice14_uci_history.md` opdateret tidligere — bør nu inkludere note om RLS-verifikation
- [ ] Overvej at audit alle nye tabeller siden 2026-04-15 for samme pattern (RLS enabled, 0 policies, auth-rolle-blind)
