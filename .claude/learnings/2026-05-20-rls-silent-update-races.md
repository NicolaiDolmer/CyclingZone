# 2026-05-20 — RLS silent-update på `races` blokerede admin edit-flow

## Symptom

Brugeren rapporterede: "kan ikke få det til at virke at skrive årgange på løbene" (edition_year-input via /admin → Løbskalender → ✏ Rediger).

UI'et viste success-toast "✅ Løb gemt" og lukkede editoren — men ved næste reload var feltet stadig blankt. Ingen fejl i browser console. Ingen fejl i backend logs (fordi requesten gik aldrig gennem backend).

## Rod-årsag

`AdminPage.jsx:saveRaceEdit` skrev direkte til `races`-tabellen fra klienten:

```js
const { error } = await supabase.from("races").update({...}).eq("id", editingRace.id);
```

`races`-tabellen har RLS enabled, men kun én policy findes:

```sql
CREATE POLICY "Public read races" ON races FOR SELECT USING (true);
```

Ingen `UPDATE`-policy → Supabase blokerer skrivningen, men returnerer `{ data: null, error: null }` med 0 rows updated. Frontend tjekker kun `error`, så success-toast vises selvom intet blev gemt.

## Hvorfor det blev opdaget nu (men ikke i v3.65)

`edition_year` blev introduceret i #502/v3.65 sammen med admin-editor-flowet. Tests i v3.65 (656 backend grøn, playwright 3/3 grøn) testede ikke RLS-side-effekter på admin-skrivninger. v3.66-v3.71 leverede yderligere admin-features uden at ramme dette code path. v3.68/#505 (race_points editor) ramte samme pattern men fixede DET specifikke flow til backend-endpoint — uden at fixe race-editoren der lå lige ved siden af i samme fil.

Brugeren prøvede edit-flowet første gang i dag (2026-05-20 deadline-fyldning af edition_year for 26 sæson 1-løb).

## Fix

Backend `PUT /api/admin/races/:raceId` (auth-gated, rate-limited, audit-logged) erstatter direkte supabase-skrivning. Migration tilføjer `race_edited` til admin_log CHECK constraint. Frontend refactored.

## Forward-guards

1. **Source-parsing test** (`raceEditAdminRoute.test.js`): verificerer at `saveRaceEdit` i AdminPage.jsx IKKE bruger `supabase.from("races").update`. Hvis nogen genintroducerer det, fejler testen.

2. **Bredere lære:** Tabeller med RLS-policies kun for `SELECT` (men ikke `INSERT/UPDATE/DELETE`) bliver silently-blocked på skrivninger via anon/authenticated keys. Hvis admin-UI laver writes, skal det gå gennem backend-endpoint med service_role.

   **Audit-mulighed:** Kør SQL mod `pg_policies` for at finde tabeller med RLS enabled men kun SELECT-policies — så vi proaktivt kan spotte næste version af dette bug. (Ikke automatiseret endnu — overvej follow-up issue hvis vi rammer det igen.)

3. **Frontend pattern:** Når admin-UI skal mutere data, skal det defaulte til backend `fetch(`${API}/api/admin/...`)` med `getAuth()`-headers — IKKE direkte supabase. Direkte supabase er kun OK til pure-read.

## Hvad jeg gjorde anderledes denne gang

- Verificerede rod-årsag via `pg_policies` SQL FØR jeg foreslog fix (per "Verificér FØR claim")
- Lavede backwards-check (er der andre direkte supabase.update i admin-flowet?) — race_points blev fixed i #505, og det her var det resterende sted

## Bredere lære (skal måske promoveres til memory hvis det bider igen)

WARM-tier memory-kandidat: "Når admin-UI muterer DB skal det gennem backend, ikke direkte supabase (RLS silent-blokerer skrivninger uden UPDATE-policy)."
