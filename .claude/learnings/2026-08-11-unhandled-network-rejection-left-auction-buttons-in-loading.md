# Et tabt net efterlod auktions-knapperne i "loading" for evigt

**Dato:** 2026-08-11 · **Issue:** [#3619](https://github.com/NicolaiDolmer/CyclingZone/issues/3619) · **Sentry:** CYCLINGZONE-4E
**Fundet af:** daglig Sentry/Railway-triage

## Symptom

Én spiller, Firefox iOS 150.3 på iPhone, 10/8 kl. 20:33 dansk tid: `TypeError: Load failed`
som **unhandled rejection** (`mechanism: auto.browser.global_handlers.onunhandledrejection`),
culprit `AuctionsPage.jsx:1334` = `handleSetProxy`. "Load failed" er WebKits besked for en
`fetch` der aldrig nåede frem — altså et netværksudfald, ikke en server-fejl.

Spiller-oplevelsen: du gemmer et autobud-loft, knappen går i "loading" — og bliver der.
Ingen fejl, ingen bekræftelse. Eneste udvej er at genindlæse siden og kigge efter om
loftet blev gemt.

## Rodårsag

`frontend/src/lib/useAuctionBidding.js` satte `setProxyStatus("loading")` og lavede
derefter et bart `await onSetProxy(...)`. Kalder-siderne (`AuctionsPage.jsx`,
`RiderStatsPage.jsx`) har ingen `try/catch` om deres `fetch`, så en netværksfejl bobler
hele vejen ud af `onConfirm`. Ingen fanger den → loading-status ryddes aldrig.

Præcis samme klasse som [#2719](https://github.com/NicolaiDolmer/CyclingZone/issues/2719).

## Det interessante: fixet var der allerede — for én af tre

`handleRemoveProxy` fik try/catch + lokaliseret fejltekst + `reportActionFailure` i #2719.
`handleBid` og `handleSaveProxy` — de to naboer i samme fil, med samme form og samme
kalder-kontrakt — fik det ikke. Fejlklassen blev diagnosticeret rigtigt og så repareret
ét sted ud af tre.

**Læringen:** når en fejl skyldes en form (her: "await ud af hooket uden try"), er fixet
ikke det sted symptomet blev observeret. Det er alle steder formen optræder. Den
backwards-check koster to minutter og var ikke lavet.

## Forward-guard

Regressionsværnet i `useBlockedAction.test.js` er nu skrevet som en **invariant over
listen** i stedet for en assertion om ét kald:

```js
const OUTBOUND_CALLS = [
  { call: "onBid", ... }, { call: "onSetProxy", ... }, { call: "onRemoveProxy", ... },
];
for (const { call, start, end, statusReset } of OUTBOUND_CALLS) { ... }
```

Et fjerde udgående kald tilføjet til hooket kræver en linje i den liste for at blive
dækket — men de tre der findes, kan ikke længere miste deres try/catch i tavshed.
Verificeret rød→grøn: uden fixet fejler 3 af 12 tests i filen.

## Note om Sentry-støj

Fejlen så ud som klassisk "mobil mistede nettet"-støj, og præcis derfor er den værd at
skrive ned: den var reelt et UI-hul. En unhandled rejection fra en spiller-handling er
aldrig bare støj — den betyder pr. definition at ingen kode-sti tog ansvar for fejlen,
og så gjorde UI'et det heller ikke.
