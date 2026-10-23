# Postmortem · 2026-10-17 · #6698 Firefox "too much recursion" paa loebssiden (CYCLINGZONE-9H)

## Hvad skete der?
Sentry fangede ét `InternalError: too much recursion` (Firefox 158, Windows, browser-sprog `zh-Hans-CN`) paa `/races/<id>`. Stakken endte i `CareerFirstMomentRow` -> `t()` -> i18next `looksLikeObjectPath`. Issuet gaettede paa et render-loop, i18next sprog-fallback eller en engangs-hændelse.

## Hypotese (ikke bevist)
Vi har ikke fundet rekursion i appens kode, men aarsagen er IKKE fastslaaet. Tre ting i eventet peger paa et browser-/miljoe-udloest stak-fejlsignal snarere end et loop:

1. **Stakken er kun ca. 15 frames dyb**, fra `performWorkUntilDeadline` (frisk MessageChannel-task) til `looksLikeObjectPath`. React's arbejdsloekke er iterativ, saa et dybt komponent-trae gør ikke JS-stakken dybere. Ægte JS-rekursion ville vise hundredvis af gentagne frames.
2. **Toppen er en regex-test** (`looksLikeObjectPath` koerer `r.test(key)` paa `( |,|\?|!|;)` mod en kort, fast noegle). Den kan ikke backtracke dybt. Firefox rapporterer altsaa stakken som opbrugt her, men en 15-frames trace viser hvor det skete, ikke noedvendigvis hvad der brugte stakken.
3. **React kom sig selv.** Eventet er to-delt: `InternalError` + "There was an error during concurrent rendering but React was able to recover by instead synchronously rendering the entire root". React melder selv at den synkrone gen-rendering lykkedes. Sentry fik den som `onerror` fordi React 19 rapporterer recoverable errors dertil. Tab'en havde desuden staaet aaben i mindst ca. 5,5 timer (5-minutters polling i breadcrumbs) foer fejlen.

Reproduktion: rigtig Firefox 158 (samme version som spilleren) mod en preview-mock-build, `intl.accept_languages=zh-Hans-CN,zh` (`navigator.language` = `zh-Hans-CN`, i18next lander paa `en`), `/races/<seed-loeb>?v2=off` (den side der renderer `CareerFirstMomentRow`). Siden renderer fejlfrit, ingen konsol-fejl, ingen `too much recursion`. **Begraensning:** det er en frisk render mod mock-data; den daekker ikke ophobet state efter timers polling eller prod-eventets data, saa den udelukker ikke en intermitterende fejl. Se `pr-screens/6698/firefox158-zh-Hans-CN-race-page.png`.

Stock-Firefox kan ikke styres af Playwright (kraever Playwrights patchede build, som ikke er installeret her), saa reproduktionen blev koert direkte via WebDriver BiDi mod system-Firefox.

## Fix (opdateret 23/10, PR #7060)
**17/10:** ingen kodeændring; årsagen var ikke fastslået.

**22-23/10, ny evidens:** et andet event (CYCLINGZONE-AD) med **samme top-frame** (`looksLikeObjectPath` i i18next, `r.test(key)`), men en anden spiller, en anden side (dashboard, komponent `DashboardPage`) og et andet sprog (`da-DK`). Begge Firefox 158 på Windows. Det udelukker løbssiden og zh-locale som årsag og peger på Firefox 158's regex-motor, som sporadisk kaster fra netop den regex-test, der køres på hvert `t()`-kald.

**Rettelse:** `frontend/src/i18n/index.js` sætter `nsSeparator: ":"` og `keySeparator: "."` eksplicit (i18nexts egne standardværdier). Med eksplicitte separatorer springer i18next heuristikken `looksLikeObjectPath` over, så den regex aldrig køres. Opslag er uændrede (alle nøgler er `ns:sti.nøgle`; ingen naturligt-sprog-nøgler med mellemrum eller kolon). Regressionstest `frontend/src/lib/raceRecursion6698.test.ts`: lader netop den regex kaste; uden rettelsen dør `t()`, med den ikke; opslag er identiske med og uden separatorerne.

**Begrænsning:** ikke reproduceret i rigtig Firefox 158 (Playwright har intet firefox-projekt her). Rettelsen bygger på stakken fra to events og en simuleret regex-fejl. Verifikation efter merge: nye "too much recursion"-events i Sentry fra Firefox skal forsvinde; dukker de op med en anden top-frame, åbnes sporet igen.

## Forhindret-fremover
Kommer der nye `too much recursion`-events efter #7060, undersøges top-framen: er det en anden native funktion (regex, JSON, ICU), er det samme miljø-mønster. Forslaget om at nedgradere en React-recoverable `too much recursion` i `sentry.jsx` `beforeSend` (som chunk-fejl #4545 og netværksfejl #5312) står stadig åbent.

## Læring
`too much recursion` i et Sentry-event er ikke automatisk et rekursions-bug, men en frisk reproduktion udelukker heller ikke en fejl der kraever lang levetid. Tjek stak-DYBDEN foer du leder efter loops: en kort stak med en native funktion (regex, JSON, ICU) i toppen er et miljoe-signal. Og hvis React selv skriver "was able to recover", er brugeren ikke blevet ramt af et crash.
