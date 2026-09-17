# Et droppet fejlsignal skjulte omfanget — og jeg gættede rodårsagen tre gange

**Dato:** 2026-09-17 · **Issue:** #5312 · **PR:** #5324

## Hvad skete der

En spiller (@snorkalot) rapporterede 16/9 at han ikke kunne åbne sit dashboard. Han vedlagde to skærmbilleder. Den daglige Discord-sweep oprettede issuet med analysen "formodet: CORS-headere mangler eller matcher ikke origin" — **uden at åbne skærmbillederne**, som lå som direkte links i sweep-filen og kunne hentes med ét `curl`.

Da ejeren spurgte "er du sikker?", hentede jeg billederne. Konsollen sagde `Status code: (null)`, altså **intet HTTP-svar overhovedet**. Det udelukker allowlisten: en afvisning derfra ville have givet en statuskode. Hele den oprindelige analyse var forkert.

## Rodårsag (i vores kode)

`frontend/src/lib/sentry.jsx` linje 62 droppede `NetworkError when attempting to fetch resource` helt:

```js
if (/ResizeObserver loop completed|NetworkError when attempting to fetch resource/i.test(value)) {
  return null;
}
```

Det er **Firefox' ordlyd** for præcis den transport-fejl Chrome og Safari kalder `Failed to fetch` og `Load failed`. Spilleren er på Firefox. Alle hans ~11 fejlende kald blev til Sentry-events — og smidt væk.

Chrome/Safari-ordlyden lå allerede i Sentry på flere ANDRE spillere (CYCLINGZONE-57, -4Y, -50, -5T, -5K, senest samme dag). Problemet var altså kendt, men systematisk undertalt, og vi kunne ikke afgøre om det rammer 3 spillere eller 30.

## Læringen der allerede stod i filen

To linjer under det droppede filter står kommentaren fra #4545, om chunk-fejl der FØR blev droppet helt:

> "Det kostede to ting paa én gang: fejl-id'et fallbacken viser spilleren pegede paa et event der aldrig blev sendt, og omfanget var umaaleligt — foerste signal paa haendelsen 1/9 var en Discord-besked fra en spiller, ikke dashboardet."

Første signal på hændelsen 16/9 var en Discord-besked fra en spiller. Samme fejlmønster, ét filter længere oppe i den samme funktion, seksten dage senere.

**Regel:** et fejlsignal man dropper i klienten kan ikke måles, og så opdages hændelsen af en spiller. Dæmp i stedet (`level: "warning"` + fast fingerprint) — så kan støjen arkiveres i Sentry, hvor man kan SE hvad man slår fra.

## Faldgruben i fixet

`ChunkLoadError`-beskeden indeholder selv strengen "Failed to fetch dynamically imported module". En naiv netværks-klassifikation ville derfor fange chunk-fejl og vise et deploy-skred for spilleren som et netværksproblem hos ham selv. Chunk vinder nu altid, med det BREDE `isChunkLoadError`: i tvivl er det en chunk.

## Mine egne procesfejl (den dyreste del)

Fire gange i samme session påstod jeg noget før jeg tjekkede:

1. Skrev #5312's analyse uden at åbne skærmbillederne der lå i mine egne data.
2. Anbefalede `api.cyclingzone.org` som *løsningen* uden at teste om den rammer fejlmåden. Det gør den kun for én af fire mulige årsager — ved en brudt rute til Railways edge peger det nye domæne samme sted hen.
3. Påstod at der ikke fandtes en delt `apiFetch` — ud fra en forældet kodekommentar. Den findes (#5089), og #5242 er dens opfølger.
4. Meldte at Railway-MCP'en ikke kunne nås. Den virkede fint; jeg havde sendt id'et på en `SKIPPED` deploy.

Fællesnævneren: jeg havde adgang til beviset i alle fire tilfælde og brugte det ikke. Det står allerede som regel ([[feedback_runtime_verify_first]]) — den blev ikke fulgt.

**Forward-guard:** når en spillerrapport indeholder et billede, hentes og læses billedet FØR issuet skrives. Sweep-skillen bør sige det eksplicit.

## Bonus: testene fangede mine egne antagelser

Mine første seks e2e-tests fejlede alle. Ikke koden — testene:
- Den ene antog at dashboardets fejlflade har `role="alert"`. Det har den kanoniske `ErrorState` ikke (→ #5325).
- Den anden antog at et 500-svar udløser dashboardets fejl-tilstand. Det gør det ikke; hvert kald er enkeltvis afskærmet, så fladen renderer bare uden de data.

Begge antagelser var mine. Ingen af dem ville være opdaget uden testene.

## Relaterede
#4545 (præcedensen), #5017 (punkt 2 leveret her), #5322, #5323, #5325, #5326, #3601 (webkit-flaken i fuld suite)
