# Postmortem · 2026-09-23 · First-touch attribution tabt på marketing-forsiden (#5310)

## Hvad skete der?
Fra 14/9 serverer marketing-sitet den anonyme forside på cyclingzone.org. Et UTM-tagget link til forsiden mistede sin kanal på vejen til signup: `signup_attribution` fik vores egen side som referrer og ingen `utm_source`, og den eksterne referrer (fx Reddit) forsvandt. Opdaget ved en browser-audit 16/9, ikke af et dashboard.

## Root cause
First-touch blev kun fanget i SPA'en (`captureFirstTouch()` i `frontend/src/main.jsx`). Da forsiden flyttede til marketing-sitet, kørte SPA'en først på `/login`, efter klikket. Marketing-siderne skrev ingen first-touch, og deres signup-links var faste uden UTM. SPA'en gemte så den same-origin referrer som kanal.

## Fix
- `marketing/lib/attribution.ts`: samme capture som inline-script forrest i begge root-layouts, samme nøgle og format, skriver kun hvis nøglen mangler. `AppLink` bærer utm_* videre til login/signup.
- `frontend/src/lib/attribution.js`: en same-origin referrer gemmes aldrig som kanal; dens utm_* udledes.
- Læse-siden (`backend/lib/attributionDashboard.js`, `scripts/monday-numbers.mjs`): UTM fra egen-site-referrer når `utm_source` er NULL, ellers "ukendt (tabt i marketing)". Ingen backfill.

## Forhindret-fremover
- Paritetstest i marketing-helperens unit-test: marketing og SPA skal skrive byte-identiske rækker for samme input.
- Unit-tests på same-origin-reglen i begge skrivere og begge læsere.
- `docs/GROWTH_STACK.md` §3.1 beskriver nu begge capture-steder; §3.5 beskriver bruddet.

## Læring
Når en ny flade overtager en indgangs-URL (proxy, rewrite, nyt site), flytter alt der "fanges ved første besøg" med. Tjek first-touch, beacons og UTM-bærende links som en del af routing-ændringen, ikke bagefter. En same-origin referrer er altid et måle-artefakt, aldrig en kanal.
