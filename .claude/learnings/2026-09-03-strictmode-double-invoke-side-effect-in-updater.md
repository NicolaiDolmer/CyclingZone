# Postmortem · 2026-09-03 · logEvent i setState-updater dobbelt-taeller under StrictMode

## Hvad skete der?
PR #4732 (#4557 S-M2d) instrumenterede kvitterings-aabninger i boardroomens MandateCard
(`board_receipt_opened`, #1141-funnel) ved at kalde `logEvent(...)` INDE i
`setExpandedId`'s updater-funktion. En uafhaengig reviewer fandt det i ret-runden,
foer det naaede prod-maaling.

## Root cause
`setExpandedId((cur) => { logEvent(...); return ...; })` — en side effect placeret
INDE i en React `useState`-updater. `<React.StrictMode>` (frontend/src/main.jsx:97)
kalder med vilje updater-funktioner to gange i dev, for netop at afsloere urenheder
som denne. I dev-sessioner ville hver kvitterings-aabning dermed dobbelt-taelle
#1141-tallet — mens selve UI-adfaerden (expand/collapse) saa korrekt ud, fordi
React kasserer det ekstra kald til selve state-opdateringen.

## Fix
`frontend/src/pages/boardroom/MandateCard.jsx` — logEvent-kaldet flyttet ud af
updateren og ind i `onToggle`s ydre arrow-funktion (koeres praecis én gang pr. klik,
foer `setExpandedId` kaldes), med expandedId laest fra closure i stedet for fra
updaterens `cur`-parameter.

## Forhindret-fremover
Ingen automatisk vagt fanger dette moenster i dag (ESLint's `react-hooks`-regler
flager ikke side effects i en updater-funktion). Foreslaaet, ikke implementeret her
(ude af scope for ret-runden): en lille custom ESLint-regel eller grep-baseret guard
der flager `set[A-Z]\w*\(\s*\([^)]*\)\s*=>\s*\{[^}]*\b(logEvent|fetch|track)\(` i
`frontend/src/**` — samme moenster som andre `check-*`-guards i `scripts/`.

## Læring
Enhver side effect (analytics, fetch, tracking) hoerer i selve event-handleren,
ALDRIG inde i en `useState`-updater-funktion — updateren skal vaere ren, fordi
React (i StrictMode, og ved concurrent-features) kan kalde den flere gange uden at
det maa have observerbare bivirkninger. Et hurtigt selv-tjek foer merge: "vil dette
kald staa korrekt hvis React kalder funktionen den staar i to gange?"
