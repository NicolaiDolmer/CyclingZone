# 2026-06-12 — SeasonCycleSection: `Bearer undefined` pga. prop-kontrakt-misforståelse

## Symptom
Admin-UI'ets Sæson-fane → "🔄 Sæson-cyklus" viste altid "Ingen forhåndsvisning tilgængelig".
Backend svarede 401 på `GET /api/admin/season-transition/preview` og `POST /api/admin/season-transition`.

## Rod-årsag
`SeasonCycleSection.jsx` antog at `getAuth()` (prop fra `useAdminAuth`) returnerer `{ token }`,
og byggede selv `Authorization: Bearer ${auth.token}`. Kontrakten er et **færdigt headers-objekt**
(`{ "Content-Type": ..., Authorization: "Bearer <token>" }`) — `auth.token` er `undefined`,
så headeren blev `"Bearer undefined"` → 401. Fejlen har eksisteret siden komponentens
oprettelse (3601b11b, slice-08/#239); den gamle AdminPage.jsx's getAuth havde samme kontrakt.

## Fix
Brug headers-objektet direkte som de øvrige admin-sektioner (fx `DeadlineReadinessSection.jsx`):
`const headers = await getAuth(); fetch(url, { headers })`. Content-Type er allerede med i objektet.

## Hvorfor slap den igennem
- Ingen unit-/E2E-test rammer admin-sektionernes fetch-headere; 401 manifesterer kun runtime som en fejlbesked i UI.
- Prop-kontrakten `getAuth` er udokumenteret og u-typet — intet fanger `auth.token` mod et objekt uden `token`-felt.

## Forward-guard
- Backwards-check udført 12/6: `auth.token` / `Bearer ${auth.token}` findes ikke andre steder i `frontend/src`.
- Mønster-regel: admin-sektioner bruger ALTID `getAuth()`-resultatet direkte som `headers` — byg aldrig Authorization manuelt.
