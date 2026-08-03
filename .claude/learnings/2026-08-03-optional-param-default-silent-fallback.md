# Valgfri parameter med default = tavs feature-amputation (#3213)

**Dato:** 2026-08-03 · **Issue:** #3213 (fundet under #3148) · **PR:** #3215

## Hvad skete

#2244 Task A3 gav `buildScoutEstimate`/`buildTypeCeilingBands` et `scout`-parameter
(`= DEFAULT_SCOUT`) så spejder-rating driver bånd-præcisionen — spec-beslutning 3,
gated med inversion-harness, fuldt unit-testet. Men INGEN af de 5 call sites i
`routes/api.js` sendte parameteren med. Defaulten gjorde udeladelsen usynlig:
ingen fejl, ingen test-rød, bare DEFAULT_SCOUT (overall 40) for alle hold i ~3 uger
i prod. Hyret chefspejder påvirkede dermed kun kapacitet + missions-shortlists —
ikke ét eneste vist bånd. Hjælpeteksten lovede effekten; koden leverede den ikke.

## Rod-årsag

1. **Plan-hul mellem slices:** A3 byggede parameteren i de rene libs, B4 byggede
   nye job-model-routes — ingen task ejede "wire holdets ægte spejder ind i de
   EKSISTERENDE display-routes". Begge slices var "færdige" per deres egen
   definition; integrationen faldt mellem stolene.
2. **Default-parameter skjulte hullet:** `scout = DEFAULT_SCOUT` er korrekt for
   hold uden spejder, men gør et glemt call site umuligt at skelne fra et bevidst.
   Unit-tests af de rene funktioner (som testede `scout`-parameteren grundigt!)
   beviser intet om at routes faktisk sender den.

## Forward-guards

- `backend/lib/scoutPrecisionWiring.routes.test.js` — kildetekst-scan: ALLE
  `buildScoutEstimate`/`buildTypeCeilingBands`-kald i api.js SKAL indeholde
  `scout`, og opslaget skal gå via `loadScout` (staff-SSOT).

## Læring (genbrugelig)

- Når en slice tilføjer en valgfri parameter der bærer en feature (ikke bare en
  tuning-knap), skal SAMME plan have en eksplicit wiring-task pr. call site-lag +
  en guard der fejler ved udeladelse. "Pure lib testet" ≠ "featuren virker".
- Symptomet er usynligt i alle grønne suiter — det findes kun ved at spørge
  "hvor KOMMER dette argument fra i praksis?" fra route-laget og ned (her: et
  hjælpetekst-spørgsmål, #3148, tvang gennemsporingen).
