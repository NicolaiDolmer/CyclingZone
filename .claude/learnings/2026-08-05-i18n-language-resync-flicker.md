# Postmortem · 2026-08-05 · In-app sprog-flimmer (#2045)

## Hvad skete der?
Dansk spiller rapporterede at UI-teksten "blinker rundt og skifter flere gange" ved sprogskift og ved sideload. Bekræftet: klik på sprogvælgeren kunne synligt flippe tilbage til det forrige sprog lige efter et eksplicit skift, og i nogle tilfælde efterlod flippet localStorage/DB i disharmoni, så det gentog sig ved næste load.

## Root cause
`LanguageProvider`'s DB-resync-effekt (`frontend/src/lib/language.jsx`) genstartede sig selv ved ethvert sprogskift — inklusive brugerens EGET klik, som allerede skriver `users.language` i samme kald. Genstarten kaldte `syncFromSession()` PÅ NY, et uafhængigt HTTP-opslag på `users.language` uden ordre-garanti overfor den skrivning der lige var i gang. To mekanismer bidrog:

1. `language` (React-state) stod i effektens dependency-array.
2. **Overraskende:** selv med `language` fjernet blev effekten ved med at genstarte, fordi den hook-returnerede `i18n` fra `useTranslation()` (react-i18next v17) IKKE er en stabil reference — biblioteket returnerer bevidst et NYT wrapper-objekt (`createI18nWrapper`, `Object.create`-kopi) hver gang `i18n.language` ændrer sig. `i18n` i et dependency-array er derfor en skjult proxy for `language`.

Målt (Playwright, mocket netværk): klik → `languageChanged("en")` ved t=1165ms, uopfordret revert til `languageChanged("da")` ved t=1197ms (32ms senere) fra en stale DB-læsning.

De eksisterende e2e-mocks (`frontend/src/preview/seedData.js`/`mockHandlers.js`) har aldrig haft et `language`-felt på `users`-tabellen, så resync-grenen var et permanent no-op i hele test-suiten — bugget var usynligt for CI i over to måneder siden #410 (Fase 1 i18n-foundation).

## Fix
`frontend/src/lib/language.jsx`: importerer den delte i18next-singleton direkte (`import i18n from "../i18n"`, samme modul som `main.jsx`/`entry-server.jsx` bruger) i stedet for `const { i18n } = useTranslation()`, og sætter DB-resync-effektens dependency-array til `[]`. Effekten kører nu kun ved mount og reagerer på ægte Supabase auth-events (`onAuthStateChange`), aldrig på sit eget resultat.

## Forhindret-fremover
`frontend/tests/e2e/language-resync-flicker.spec.js`: mocker `users`-tabellen med et deterministisk `language`-felt (altid "da", uanset klientens skrivning) og asserter at et klik på "English" giver PRÆCIS ét `languageChanged`-event uden revert. Fejler pålideligt mod før-koden, består efter fixet — kørt grønt på alle 3 Playwright-projekter.

## Læring
`react-i18next`'s `useTranslation()`-hook returnerer IKKE en stabil `i18n`-reference — den er identitets-ustabil ved hvert sprogskift (v17: `createI18nWrapper`). Enhver `useEffect`/`useCallback`/`useMemo` der har den hook-returnerede `i18n` i sit dependency-array vil derfor genstarte ved ethvert sprogskift, som en skjult proxy for `language`-state — selv hvis `language` selv ikke er i arrayet. Skal en effekt IKKE reagere på sprogskift, brug den delte modul-singleton (`import i18n from ".../i18n"`) i stedet for hook-værdien. Ingen andre steder i kodebasen har p.t. samme mønster (kun `language.jsx` brugte `i18n` fra `useTranslation()` i et effekt-dependency-array), men værd at huske hvis flere provider-lignende komponenter bygges omkring i18next fremover.

Sekundært: e2e-mocks der aldrig sætter et felt (`users.language` i dette tilfælde) gør den kode-gren der læser feltet til et permanent, usynligt no-op i test — en reel bug kan gemme sig bag "grøn" CI i månedsvis. Når man tilføjer en ny DB-kolonne en frontend-flow afhænger af, bør mock-seedet opdateres i samme PR (matcher eksisterende regel: test ægte kontrakt, ikke kun mocket).
