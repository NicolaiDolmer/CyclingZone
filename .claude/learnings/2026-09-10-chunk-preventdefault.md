# Postmortem: vores egen `preventDefault()` var rod-årsagen til CYCLINGZONE-56

- **Dato:** 2026-09-10 (CEST)
- **Issue:** #4595 (chunk-fejl), Sentry `CYCLINGZONE-56`
- **Omfang ved fund:** 954 events / 50 spillere på 7 dage — ca. 99,5 % af alt uløst i Sentry. De øvrige seks uløste issues havde 1 event / 1 bruger hver.
- **Levetid:** fejlen blev indført sammen med den globale `vite:preloadError`-handler (#906) og overlevede fem forsøg på at fjerne symptomet (#4725, #4745/#2423, #4760, #4970, #5021).

## Rod-årsag

Vites genererede preload-helper (vite 8.2.2, `node_modules/vite/dist/node/chunks/node.js`, `preload()`):

```js
function handlePreloadError(err) {
  const e = new Event("vite:preloadError", { cancelable: true });
  e.payload = err;
  window.dispatchEvent(e);
  if (!e.defaultPrevented) throw err;      // kaster KUN hvis ingen preventDefault'er
}
return promise.then((res) => {
  for (const item of res || []) {
    if (item.status !== "rejected") continue;
    handlePreloadError(item.reason);
  }
  return baseModule().catch(handlePreloadError);   // en .catch() der ikke kaster ⇒ resolver undefined
});
```

Vores handler i `frontend/src/lib/chunkErrors.js`:

```js
const onPreloadError = (event) => {
  event?.preventDefault?.();
  reloadOncePerRelease();
};
```

Kæden, hver eneste gang en chunk-load fejlede:

1. `import()` fejler → Vite kalder `handlePreloadError`.
2. Vi `preventDefault()`'er → Vite kaster **ikke**.
3. `.catch(handlePreloadError)` returnerer `undefined` → hele `__vitePreload(...)`-promisen **resolver med `undefined`**.
4. `lazyWithRetry.validateModule(undefined)` minter sin egen fejl: `"resolved to an invalid module without a default export"` — **uden URL**.
5. Retry'et rammer nøjagtig samme sti og fejler identisk.
6. `purgeStaleChunkFromCache()` kan ikke finde en URL i den syntetiske streng og renser i stedet dokumentets entry-/preload-URL'er — aldrig det chunk der faktisk fejlede.

Den ægte fejl — med chunk-URL'en — lå hele tiden i `event.payload` og blev smidt væk.

## Hvorfor det ikke blev fanget

- **Fejlteksten var vores egen.** `"resolved to an invalid module without a default export"` findes ikke i nogen browser. Alle læste den som "stale chunk efter deploy" og gik efter hash-rotationen. Fem PR'er i træk behandlede symptomet (cache-headere, skew protection, selvheling, release-sha ud af bundlen, `release.inject: false`) uden at fejlklassen kunne forsvinde.
- **Fordelingen lignede skew.** ~30 forskellige releases med 1-4 brugere hver, alle browsere, alle platforme. Det ligner et deploy-problem — men var i virkeligheden en deterministisk defekt der udløstes hver gang en chunk-load fejlede, uanset årsag.
- **Testene testede hver halvdel for sig.** `lazyWithRetry.test.js` kaldte `validateModule` med almindelige objekter; `chunkErrors.test.js` dispatchede et bart `{ preventDefault }`-event uden `payload`. Ingen test kørte de to sammen, og ingen test gengav `__vitePreload`. Samspillet var præcis den blinde plet.
- **Kommentaren i koden bekræftede den forkerte model.** Der stod at `preventDefault()` betød at "VI styrer recovery". Det var forkert: `reloadOncePerRelease()` kaldes uanset. Det eneste `preventDefault()` gjorde, var at forvandle en ærlig rejection til et tavst `undefined`.

## Fix

1. `onPreloadError` gemmer `event.payload` (`recordPreloadError`) og kalder **ikke** `preventDefault()`. Vite kaster videre, så den rigtige fejl med den rigtige URL bobler op ad den sti den hører til.
2. `validateModule` kaster den gemte payload i stedet for den syntetiske streng, hvis der er en frisk (≤ 2 s). Den syntetiske fejl er kun tilbage for et modul der reelt mangler sin default-export.
3. `purgeStaleChunkFromCache` falder tilbage til payload'ens URL før den falder tilbage til dokumentets modul-URL'er.
4. `"Unable to preload CSS for <url>"` er tilføjet som utvetydigt chunk-mønster. Uden `preventDefault()` kaster Vite også ved en fejlet CSS-preload; uden mønsteret ville den blive klassificeret `render_error` og give fuldskærms-fallbacken i stedet for det ene retry der faktisk redder den (Vites `seen`-map springer dep'en over anden gang).

Uændret: Sentry-fingerprintet `frontend-chunk-load-error`, `release.inject: false` (#5021), skew protection-opsætningen, cache-/asset-headerne og #5033.

## Forward-guard

`frontend/src/lib/vitePreloadContract.4595.test.js` gengiver `__vitePreload` ordret og kører **begge** grene:

- **kaste-stien** (det vi kører nu): den ægte fejl med chunk-URL når `loadWithRetry`, og cache-purgen rammer netop det chunk.
- **preventDefault-stien**: en tredjeparts-listener der `preventDefault`'er må ikke kunne genskabe fejlen — loaderen skal stadig kaste browserens fejl.
- **CSS-preload-stien**: en fejlet stylesheet-preload må ikke tage siden ned.
- **ægte manglende default-export**: den syntetiske fejl skal stadig være der.

Målt regressions-bevis 10/9: med `preventDefault()` genindsat og payload-opslaget slået fra fejler de to første tests med præcis Sentry-strengen
`Failed to fetch dynamically imported module (chunk reload needed): Failed to fetch dynamically imported module: resolved to an invalid module without a default export`.
Med fixet er alle fire grønne.

Derudover: `chunkErrors.test.js` asserterer nu `prevented === 0` — den gamle test asserterede det modsatte (`prevented === 2`) og cementerede fejlen som "ønsket adfærd".

## Læring

En handler der undertrykker en fejl skal bevise hvad den undertrykker. `preventDefault()` på et framework-event er ikke gratis: kig i frameworkets kode og læs hvad `defaultPrevented` styrer, før du kalder det. Og når en fejlstreng i Sentry er vores egen, er den første mistænkte vores egen kode — ikke infrastrukturen.
