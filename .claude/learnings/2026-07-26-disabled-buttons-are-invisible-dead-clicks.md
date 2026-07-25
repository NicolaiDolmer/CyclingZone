# En `disabled` knap er usynlig for spilleren

**Dato:** 2026-07-26 · **Issues:** #2718, #2719, #2254 · **PR:** fix/2718-2719-2254-dead-clicks

## Symptom

Microsoft Clarity målte en spiller der klikkede "Forlæng kontrakt" → "Bekræft
forlængelse" ~15 gange på ca. 30 sekunder, efterfulgt af et rage-click. Samme uge:
dead click på "Gem" i auktionernes autobud-dialog. **Nul JS-fejl i Sentry i begge
perioder.**

## Rod-årsag

To forskellige tilstande blev håndteret med den samme mekanisme:

| Tilstand | Hvad vi gjorde | Hvad spilleren så |
|---|---|---|
| Kaldet kører (in-flight) | `disabled` + label `"..."` | En knap der ikke reagerer |
| Blokeret af validering | `disabled` + `opacity-50` | En knap der ikke reagerer |

`disabled` fjerner click-eventet i browseren. Spilleren får derfor **intet svar
overhovedet** — ikke engang en fejl. Han konkluderer at spillet er i stykker og
klikker igen. Og igen.

Konkret på auktionerne: autobud-panelet forudfylder inputtet med dit **gemte**
loft, og prisen stiger mens auktionen kører. Loftet er derfor ofte allerede under
minimumsbuddet i det sekund panelet åbner — Gem-knappen fødes død. Målt i prod
(SELECT mod `auction_proxy_bids` join `auctions`): **101 af 354 gemte lofter lå på
eller under auktionens aktuelle pris.**

## Hvorfor Sentry var tom

Hele frontenden fangede fejl fra spiller-handlinger, viste dem som lokaliseret
UI-tekst og smed dem væk. Der var ingen telemetri på "handlingen blev afvist" —
og på de blokerede knapper skete der slet ingen handling at fejle. Nul events var
derfor et *korrekt* signal på et helt ubemærket problem.

## Regel fremover

1. **In-flight → ægte `disabled` + spinner + label** ("Henter vilkår…"). Det er
   selv-forklarende, og det forhindrer dobbelt-submit.
2. **Blokeret → ALDRIG `disabled`.** Brug `aria-disabled`, bind en synlig
   begrundelse med `aria-describedby`, og lad klikket ramme en handler der
   kvitterer. Se `frontend/src/lib/useBlockedAction.js` +
   `frontend/src/components/ui/BlockedNote.jsx`.
3. **Enhver fejlet spiller-handling rapporteres** via
   `frontend/src/lib/actionTelemetry.js` (`player_action`-tag), uanset om UI'et
   allerede viste noget.
4. **En mutation hvis resultat ikke læses, er en tavs fejl.** `await fetch(...)`
   uden `res.ok`-tjek er en bug, ikke en forkortelse. `npm run
   lint:silent-mutations` fanger nye tilfælde.

## Fælde for næste gang

Playwright's `expect(x).toBeDisabled()` regner **`aria-disabled` med**. Testen af
invarianten "browseren sluger ikke klikket" skal derfor bruge
`toHaveJSProperty("disabled", false)` — ellers ser en korrekt fix ud som en fejl.
