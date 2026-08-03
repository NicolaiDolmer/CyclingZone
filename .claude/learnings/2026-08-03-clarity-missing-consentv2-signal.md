# Postmortem · 2026-08-03 · Clarity manglede consentv2-signal → session/bruger-stitching brudt

## Hvad skete der?
Microsoft Clarity viste "returning users" ~0 (#2041) og et absurd sessions:users-forhold tæt på 1:1 med ~1 sidevisning pr. "session" i flere uger, på tværs af flere undersøgelser (16/6, 3/7, 6/7, 25/7, 27/7). #1797's `identify()`-fix (merged 25/6, commit `87db298b`) ændrede intet på symptomet.

## Root cause
`identify()` var mistænkt som årsagen i lang tid, men var reelt aldrig problemet — det blev endeligt afkræftet 25/7 (identisk symptom målt FØR identify() overhovedet fandtes) og igen 3/8 (#3189: identify fyrer korrekt med stabilt id ved hver route-change). Den faktiske rod-årsag: appen sendte aldrig et consent-signal til Clarity selv. Uden `clarity('consentv2', {...})` tildeler Clarity ét nyt ID **pr. sidevisning** for EEA/UK/CH-trafik (hovedparten af vores spillere) — uanset at vores egen consent-gate (`consent.jsx`) korrekt forhindrede Clarity i at loade uden samtykke. Vi gatede korrekt OM Clarity loadede, men fortalte aldrig Clarity HVAD brugeren havde besluttet.

## Fix
`frontend/src/lib/clarityConsent.js` (ny): eksporterer `CLARITY_CONSENT_V2_PAYLOAD = { ad_Storage: "denied", analytics_Storage: "granted" }`. `frontend/src/lib/clarityIntegration.jsx` `startClarity()`: kalder `Clarity.consentV2(CLARITY_CONSENT_V2_PAYLOAD)` umiddelbart efter `Clarity.init()`, før noget identify/pageview-signal kan nå at blive registreret. `identify()`-logikken er urørt.

## Forhindret-fremover
`clarityConsent.test.js` unit-tester payload-formen (feltnavne + værdier + frozen), så en fremtidig tastefejl (fx forkert case på `analytics_Storage`) fejler i CI i stedet for at gen-introducere bugget stille. Ugentlig Clarity-triage bør efter denne fix specifikt tjekke sessions:users-forholdet falder markant inden for ~1 uge — hvis det ikke gør, er consentv2-hypotesen selv afkræftet, og næste skridt er DevTools-reproduktion af `_clck`/`_clsk`-cookie-persistens (jf. #3189's næste-skridt-liste).

## Læring
Når en gate ("load kun ved samtykke") og et signal ("fortæl tredjepartsværktøjet hvad samtykket var") forveksles, kan man bruge uger på at undersøge en helt anden mistænkt (identify-timing/custom-id) fordi symptomet — "hver session tælles som ny" — passer lige godt til begge hypoteser. Når et symptom overlever en "sikker" fix uændret (identify() 25/6 → stadig 1:1 den 3/7), er det stærkt bevis for at man undersøger den forkerte lag af stakken; tjek om tredjepartens EGEN dokumentation nævner et separat signal-krav ud over selve load-gaten.
