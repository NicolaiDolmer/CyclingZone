# `Number(null) === 0`, og 0 er finit — samme fejlklasse to dage i træk

**Dato:** 2026-07-23 · **Issues:** [#2804](https://github.com/NicolaiDolmer/CyclingZone/issues/2804), forudgået af [#2786](https://github.com/NicolaiDolmer/CyclingZone/issues/2786) · **PR:** #2807

## Hvad skete der

`distanceFactor()` i `raceSimulator.js` returnerede **0,85 i stedet for 1** på alle 1.060 sæson-1-etapeprofiler. Det aktiverede `longDayComponent` med et falsk "kort dag"-signal, så udholdenhed talte med **omvendt fortegn**: endurance 99 gav −0,0975, endurance 0 gav +0,0995.

196 etaper var planlagt til at køre på det mellem fundet og 26/7 — de sidste etaper før op- og nedrykning beregnes.

Dagen før havde #2786 den samme rodårsag: passage-gaten lækkede på legacy-etaper og gav 25 løb fantom-point i syv timer.

## Rodårsagen

```js
const d = Number(stageProfile?.distance_km);
if (!Number.isFinite(d) || !mid) return 1;   // ← passeres når d er NULL
return clamp(d / mid, 0.85, 1.2);            // ← clamp(0/170) = 0.85
```

`Number(null)` er `0`. `Number.isFinite(0)` er `true`. Guarden fanger derfor `undefined` (→ `NaN`) men ikke `null`.

Produktionens legacy-etaper har præcis den form: `profile_type` sat, `distance_km` NULL.

## Hvorfor bit-identitets-gaten ikke fangede det

Det er den interessante del. `scripts/dev/genRouteAwareGolden.js` siger det selv i sin egen header:

> *"stageProfile-objekterne her er bevidst BARE — profile_type, finale_type, demand_vector, stage_number — INGEN rutefelter."*

Fixturerne **udelader** felterne. Produktionen har dem som **NULL**. Gaten testede en tilstand der ikke findes i virkeligheden, og bestod derfor med glans mens produktionen var forkert.

**En golden-fil er kun et anker for den datatilstand den faktisk indeholder.**

## Hvorfor #2786's backwards-check ikke fangede den anden forekomst

Postmortem for #2786 listede 19 forekomster af klassen. Samme grep gav flere i dag. Checket var scopet til den fil hvor fejlen blev fundet, ikke til klassen på tværs af motoren.

## Fixet

Én delt helper som eneste sandhed:

```js
export function finiteDistanceKm(stageProfile) {
  const raw = stageProfile?.distance_km;
  if (raw == null || raw === "") return null;
  const d = Number(raw);
  return Number.isFinite(d) ? d : null;
}
```

Brugt alle fire steder: `distanceFactor`, `isTechnicalFinale`, `finaleModifier`, `routeBreakawayFactor`.

**Forward-guard der faktisk lukker hullet:** golden-gaten kører nu hver case to gange — bar (`undefined`) og med rutefelterne eksplicit sat til `null`. Testen asserter samtidig at fixturen *er* bar, så den ikke kan råddne.

Verificeret ved at køre de nye tests mod den **gamle** kode: 21 af 42 golden-cases fejler. Mod den nye: 107/107 grønne.

## Læringer

1. **`Number(x)` på et DB-felt der kan være NULL er en fælde.** Mønsteret `if (raw == null || !Number.isFinite(Number(raw)))` fandtes allerede korrekt to steder i samme fil (`formComponent`, `fatigueComponent`) — men blev ikke genbrugt de fire nye steder. Korrekt kode i nabolinjen er ikke nok; det skal være én delt funktion.

2. **Test-fixturer skal spejle produktionens datatilstand, ikke en idealiseret udgave.** Spørg altid: *hvordan ser den her række faktisk ud i prod?* En NULL og et manglende felt er to forskellige ting for JavaScript.

3. **Et backwards-check efter en incident skal scopes til fejlKLASSEN, ikke til filen.** #2786's check dækkede sin egen fil. Havde det grepet efter `Number.isFinite(Number(` på tværs af `backend/lib/`, ville #2804 være fundet et døgn tidligere — før den nåede at påvirke resultater.

4. **Motorændringer stablet tæt oven på hinanden koster.** Sub-1, Sub-2 og Sub-3 landede over tre dage. Begge fejl kom af den kadence. Cutover-ugen er nu frosset for motor-arbejde.

## Relateret

- `.claude/learnings/` — postmortem for #2786 (samme klasse, dagen før)
- [#2811](https://github.com/NicolaiDolmer/CyclingZone/issues/2811) — Sub-2's passage-persistens er stadig ubevist
- [#2812](https://github.com/NicolaiDolmer/CyclingZone/issues/2812) — `generator_version=4` stemples på profiler uden rutefelter; kan genskabe legacy-klassen inde i sæson 2
