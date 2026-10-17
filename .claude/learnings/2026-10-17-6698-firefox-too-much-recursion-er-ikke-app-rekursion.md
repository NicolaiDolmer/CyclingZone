# Postmortem · 2026-10-17 · #6698 Firefox "too much recursion" paa loebssiden (CYCLINGZONE-9H)

## Hvad skete der?
Sentry fangede ét `InternalError: too much recursion` (Firefox 158, Windows, browser-sprog `zh-Hans-CN`) paa `/races/<id>`. Stakken endte i `CareerFirstMomentRow` -> `t()` -> i18next `looksLikeObjectPath`. Issuet gaettede paa et render-loop, i18next sprog-fallback eller en engangs-hændelse.

## Root cause
Ingen rekursion i appens kode. Tre ting i selve eventet peger paa et browser-/miljoe-udloest stak-fejlsignal, ikke et loop:

1. **Stakken er kun ca. 15 frames dyb**, fra `performWorkUntilDeadline` (frisk MessageChannel-task) til `looksLikeObjectPath`. React's arbejdsloekke er iterativ, saa et dybt komponent-trae gør ikke JS-stakken dybere. Ægte JS-rekursion ville vise hundredvis af gentagne frames.
2. **Toppen er en regex-test** (`looksLikeObjectPath` koerer `r.test(key)` paa `( |,|\?|!|;)` mod en kort, fast noegle). Den kan ikke backtracke dybt. Fejlen kommer altsaa fra Firefox' egen native stak-kontrol, ikke fra vores kode.
3. **React kom sig selv.** Eventet er to-delt: `InternalError` + "There was an error during concurrent rendering but React was able to recover by instead synchronously rendering the entire root". React melder selv at den synkrone gen-rendering lykkedes. Sentry fik den som `onerror` fordi React 19 rapporterer recoverable errors dertil. Tab'en havde desuden staaet aaben i mindst ca. 5,5 timer (5-minutters polling i breadcrumbs) foer fejlen.

Reproduktion: rigtig Firefox 158 (samme version som spilleren) mod en preview-mock-build, `intl.accept_languages=zh-Hans-CN,zh` (`navigator.language` = `zh-Hans-CN`, i18next lander paa `en`), `/races/<seed-loeb>?v2=off` (den side der renderer `CareerFirstMomentRow`). Siden renderer fejlfrit, ingen konsol-fejl, ingen `too much recursion`. Se `pr-screens/6698/firefox158-zh-Hans-CN-race-page.png`.

Stock-Firefox kan ikke styres af Playwright (kraever Playwrights patchede build, som ikke er installeret her), saa reproduktionen blev koert direkte via WebDriver BiDi mod system-Firefox.

## Fix
Ingen kodeaendring. Der er ingen rekursiv funktion at goere iterativ, og en regressionstest for en fejl vi ikke kan fremkalde ville vaere kosmetik.

## Forhindret-fremover
Hvis fejlen gentager sig (CYCLINGZONE-9H faar flere events fra FLERE spillere/maskiner) eller dukker op med en dyb stak, saa genaabnes sporet. Forslag, ikke lavet her: i `sentry.jsx` `beforeSend` kan en React-recoverable `too much recursion` (eventet indeholder "React was able to recover") nedgraderes til warning under eget fingerprint, praecis som chunk-fejl (#4545) og netvaerksfejl (#5312), saa den kan maales uden at bede om et alarm-respons.

## Læring
`too much recursion` i et Sentry-event er ikke ensbetydende med et rekursions-bug. Tjek stak-DYBDEN foer du leder efter loops: en kort stak med en native funktion (regex, JSON, ICU) i toppen er et miljoe-signal. Og hvis React selv skriver "was able to recover", er brugeren ikke blevet ramt af et crash.
