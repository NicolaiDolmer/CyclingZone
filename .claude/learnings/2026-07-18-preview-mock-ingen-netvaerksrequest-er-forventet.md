# Preview-mock: "ingen /auth/v1/token i netværksloggen" er BEVIS PÅ at mocken virker — ikke at den fejler

**Dato:** 2026-07-18 · **Kontekst:** Verifikation af PR #2644 del 2 strandede fordi en session tolkede "login navigerer ikke + ingen `/auth/v1/token`-request i netværksloggen" som at mock-harnesset (`VITE_PREVIEW_MOCK=1`) var i stykker.

## Hvad der faktisk var sandt

1. **Login-mocken virkede hele tiden.** `installPreviewMock()` patcher `window.fetch` og returnerer et syntetisk `Response` for `/auth/v1/token` — der udgår ALDRIG en rigtig netværksrequest, så browserens netværkslog er tom for auth-kald *pr. design*. En tom netværkslog er her succes-signalet, ikke fejl-signalet.
2. **Hypotesen "supabase-js fangede fetch før patchen" holdt ikke:** `@supabase/auth-js`' `resolveFetch` er lazy (`return (...args) => fetch(...args)`), så klient-konstruktion FØR mock-installation er harmløs — patchen slår igennem alligevel.
3. Den oprindelige fejlrapports manglende navigation kunne ikke reproduceres (frisk server + form-fill + submit → `/dashboard` med det samme). Sandsynligvis automation-artefakt (stale refs efter HMR).
4. **Den ÆGTE blocker for #2644-verifikation var en anden:** `/api/scouting/me`-mocken manglede `scoutSystemEnabled`, og `/api/scouting/central` var umocket → Scouting-centralen viste altid gated tom-state i preview. Fixet med statefuld `scoutingMock.js` (clubMock-mønster).

## Regel fremadrettet

- Ved fejlsøgning af preview-mocken: tjek **konsollen** for `[preview-mock] aktiv`-linjen og verificér adfærd (navigation/DOM), ikke netværksloggen — mock-hits er usynlige dér.
- Når en side viser tom/gated state i preview: tjek FØRST om sidens gate-felt (feature-flag i API-payload) overhovedet serveres af mocken, før login/auth mistænkes.
