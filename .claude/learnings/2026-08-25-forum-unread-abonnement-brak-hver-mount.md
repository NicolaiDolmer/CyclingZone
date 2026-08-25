# Forum-abonnementet brækkede hver mount — og hele verifikationskæden sagde grønt

**Dato:** 2026-08-25 · **Issue:** [#4244](https://github.com/NicolaiDolmer/CyclingZone/issues/4244) · **Regression fra:** [#4238](https://github.com/NicolaiDolmer/CyclingZone/pull/4238) · **Fix:** [#4247](https://github.com/NicolaiDolmer/CyclingZone/pull/4247)

## Hvad skete der

Forum L1 "puls" (#4238) tilføjede et realtime-abonnement i `Layout.jsx` til den gule ulæst-prik:

```js
return subscribeAuthedChannel("layout-forum-unread", channel => {
  const refetch = async () => { ... };
  channel                      // <- intet return
    .on("postgres_changes", { ..., table: "forum_posts" }, refetch);
});
```

`subscribeAuthedChannel`s `configure`-callback **skal returnere kanalen** — kontrakten står i JSDoc'en på `realtimeChannelCore.js:45`. Callbacken har blok-body og glemte `return`, så `configure(...)` gav `undefined`, og `undefined.subscribe()` kastede.

Konsekvens: en unhandled `TypeError` **ved hver mount af appen** for hver spiller — og forum-kanalen blev aldrig abonneret, så den funktion PR'en var bygget for, virkede ikke. Sentry `CYCLINGZONE-4X`, escalating, `handled: no`: 17 spillere på under en time.

## Hvorfor det slap igennem

Dette er den vigtige del. PR #4238 blev verificeret med fuld lokal suite **og** 24 CI-checks, alt grønt:

- backend `node --test`: 7.149 pass
- frontend `node --test`: 2.342 pass
- `npm run test:e2e`: 561 passed, alle 3 Playwright-projekter
- `npm run lint`: clean
- `preflight-pr.ps1`: grøn

Alligevel gik en fejl igennem, som rammer **100 % af sessioner**. To huller forklarer det fuldstændigt:

1. **E2E-suiten lytter ikke på `pageerror` eller console-fejl.** Der er ingen `page.on("pageerror")` nogen steder i `tests/e2e/` eller i `playwright.config.js`. En unhandled `TypeError` er derfor usynlig for alle 561 tests, så længe DOM'en stadig renderer — og det gjorde den, fordi fejlen sker i en effekt, ikke i render. Testene tjekker hvad der står på skærmen, ikke om konsollen brænder.

2. **Eslint har ikke `consistent-return`.** En callback med blok-body, der glemmer `return`, er fuldt lovlig for linteren. Kontrakten levede kun i en JSDoc-kommentar, som intet håndhæver.

Med andre ord: verifikationen var grundig på det, den måler, og fuldstændig blind på en hel fejlklasse.

## Hvad der blev gjort

Fixet i #4247 gør to ting — og det er den rigtige rækkefølge:

1. Retter callbacken (`return channel`).
2. **Hærder kontrakten**, så fejlen ikke kan gentages: `channel = configure(fresh) ?? fresh`. En glemt `return` koster nu læsbarhed i stedet for et produktionsbrud. Plus regressionstest der kalder `configure` uden `return` og bekræfter, at kanalen abonneres alligevel.

## Læring

**Grøn verifikation beviser kun det, verifikationen måler.** Da jeg rapporterede #4238 som færdig, listede jeg fem grønne kommandoer som bevis. De var sande, men de dækkede ikke fejlklassen "unhandled JS-fejl i en effekt" — og jeg spurgte ikke, hvad de *ikke* dækkede. Antallet af grønne checks føltes som dækning; det var det ikke.

Ved næste flade, der tilføjer et abonnement, et interval eller anden effekt-kode: spørg eksplicit hvilken test der ville fange, at effekten kaster. Findes den ikke, så er den manglende test en del af opgaven.

**Forward-guard slår symptom-fix.** Den mest værdifulde del af #4247 er ikke det manglende `return` — det er `?? fresh` og regressionstesten, som lukker hele klassen for alle fremtidige kaldere.

## Opfølgning

- [#4248](https://github.com/NicolaiDolmer/CyclingZone/issues/4248) — global `pageerror`-guard i Playwright, så unhandled JS-fejl fejler e2e-suiten i stedet for at passere ubemærket. Det er den guard, der ville have fanget denne fejl før merge.
