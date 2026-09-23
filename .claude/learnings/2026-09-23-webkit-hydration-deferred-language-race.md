# WebKit-flaken #418 var en ægte hydration-fejl, ikke CI-støj (#4925)

**Dato:** 2026-09-23
**Symptom:** `landing-hydration.spec.js` og `seo-public-routes.spec.js` faldt med `Minified React error #418 (args: text)` kun i mobile-webkit, på PR'er der ikke rørte landing, og blev grønne ved rerun. Behandlet som "rerun, ikke fix" i to uger.

## Rod-årsag

Med ikke-minificeret React (`NODE_ENV=development` i buildet) navngav #418 teksten hver gang: klienten renderede `Spring til indhold`, server-HTML'en havde `Skip to content` (første tekstnode i LandingPage).

Forløbet: `main.jsx` hydrerer den EN-prerendrede landing på engelsk og beder `LanguageProvider` skifte til dansk bagefter. Det skifte kørte i providerens mount-effekt via `requestIdleCallback`, ellers `setTimeout(0)`. Men providerens effekt kører når SKALLEN committer; rute-indholdet ligger i `<Suspense>` i `App.jsx`, og React hydrerer en Suspense-boundarys indhold i et senere pass. Playwrights WebKit har ingen `requestIdleCallback` (målt: `typeof` = `"undefined"`), så `setTimeout(0)` kunne lande før LandingPage var hydreret. Resultat: #418, og React genopbyggede landing-træet på klienten. Det er appens kode, ikke testens: enhver dansk besøgende i en browser uden `requestIdleCallback` tager samme sti. At Safari på iPhone mangler den, er en antagelse (samme motor), ikke målt på en fysisk enhed.

Hvorfor det lignede støj: racet afhænger af hvor mange scheduler-skiver hydrationen deles i, altså af CPU-belastning. Lav belastning: sjældent. Fuld CI-shard: ofte. Chromium har `requestIdleCallback` og ramte det ikke.

## Fix

Skiftet venter nu på et signal fra selve boundary'en, ikke på tid: `PrerenderHydrationMarker` (`frontend/src/lib/prerenderHydration.ts`) er sidste barn i rute-`<Suspense>`, og dens effekt kører først når boundary'ens indhold er committet. Idle-udsættelsen er bevaret ovenpå, men bærer ikke længere korrektheden.

## Forward-guard

`landing-hydration.spec.js` har fået en deterministisk variant hvor "idle" fyrer med det samme. Den fejlede i alle kørsler på alle tre projekter med den gamle kode og består med fixet. Begge tests tjekker desuden at den prerendrede `<h1>`-node er den samme efter hydration, altså at React ikke smed server-HTML'en væk.

## Lære

- "Grøn ved rerun" på en hydration-fejl er ikke evidens for harmløshed. Byg med ikke-minificeret React og læs diffen, før du kalder det flaky.
- En timer (idle, `setTimeout`, et antal ms) er aldrig et bevis for at React er færdig med at hydrere. Brug et signal fra en komponent inde i den boundary der skal være færdig.
