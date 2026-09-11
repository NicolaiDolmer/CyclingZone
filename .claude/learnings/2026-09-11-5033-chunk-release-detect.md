# Postmortem · 2026-09-11 · Chunk-fejl lag 3: opdag ny release foer navigationen (#5033)

## Hvad skete der?
CYCLINGZONE-56 (ChunkLoadError efter deploy) blev ved med at ramme spillere efter at lag 1 (stabile chunk-navne, #4970/#5021) og lag 2 (recovery efter fejlen, `lazyWithRetry` + `chunkErrors.js`, #4595/#5014) var inde: 869 events / 48 brugere paa 7 dage, den stoerste fejl i spillet. Symptomet for spilleren er en enkelt doed rute (fx `/patch-notes`) eller en sort side, typisk efter at fanen har ligget aaben hen over et deploy.

## Root cause
Ikke en ny kodefejl, men et hul i forsvaret. Lag 1 og 2 daekker hver sin ende:

- Lag 1 goer at et deploy UDEN frontend-aendringer ikke roterer asset-hashene. Et deploy MED frontend-aendringer roterer dem stadig — det er meningen.
- Lag 2 er reaktivt. Det taeller foerst naar `import()` allerede er fejlet, og prisen er enten et synligt reload eller en fejlside.

Imellem dem staar selve vinduet: en fane loadet paa release A, som navigerer efter at release B er gaaet live. Klienten sidder paa A's `index.html`, og den peger paa asset-filer der ikke laengere findes. Ingen af de to lag spoerger nogensinde "er der kommet en ny release?" FOER navigationen. Vercel Skew Protection, som lukker samme vindue paa platform-niveau, er fravalgt (#2423, ejer-beslutning), saa detektionen skal ligge i appen.

## Fix
`frontend/src/lib/releaseWatch.js` (ren logik) + `frontend/src/hooks/useReleaseWatch.js` (wiring, kaldt fra `App.jsx`). Buildet skriver `/version.json` med samme sha som `<meta name="cz-release">` (`versionFilePlugin` i `frontend/vite.config.js`). Ved route-skift og ved tab-fokus efter mere end 5 min i baggrunden — hoejst ét tjek pr. 60 s — sammenlignes klientens egen release med edgens. Er de forskellige, laves et fuldt dokument-load (`location.assign`) af den URL brugeren staar paa, saa den nye HTML og dens asset-graf kommer med.

Lag 2 er uroert og er stadig sikkerhedsnettet.

## Forhindret-fremover
- `releaseWatch.test.js` (23 unit-tests): versions-sammenligning, throttle, reload-sikkerhed, loop-guard, telemetri.
- `5033-release-detect-reload.spec.js` (e2e): to mockede versioner ind, ét ekstra dokument-load ud — og NUL reloads naar versionerne er ens.
- Maalbar effekt i prod: hvert `app_version_reload`-event i `player_events` er en fane der genindlaeste roligt i stedet for at ramme en ChunkLoadError. Forholdet mellem den kurve og CYCLINGZONE-56 er kvitteringen.

## Læring
Tre designvalg baerer hele mekanikken, og de er vaerd at genbruge alle de steder hvor kode paa klienten selv beslutter at gribe ind:

1. **Fail-closed paa ukendte vaerdier.** `release.js` falder tilbage til `"dev"`/`"unknown"` naar der ikke er en sha. Havde sammenligningen behandlet dem som "bare en anden vaerdi", ville hver dev-session og hvert build uden commit-sha genindlaese sig selv i ring. Kan mekanikken ikke BEVISE at der er noget galt, gaar den ikke i gang.
2. **En loop-guard pr. maal-tilstand, ikke pr. forsoeg.** Samme princip som `getChunkReloadKey` i `chunkErrors.js`: én handling pr. release pr. session. Naar reloadet mod forventning ikke loeser noget, ender brugeren paa den gamle side med lag 2 som net — ikke i en reload-spiral.
3. **Telemetri der overlever sin egen handling.** Et `logEvent` afsendt lige foer et dokument-teardown naar ikke Supabase. Markoeren skrives derfor i `sessionStorage` foer reloadet og fyres fra den nye side. Enhver maaling af "vi navigerede vaek" har samme problem.
