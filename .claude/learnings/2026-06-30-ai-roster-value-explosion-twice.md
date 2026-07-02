# Postmortem · 2026-06-30 · AI-rytter-prisen eksploderede to gange under samme opgave

## Hvad skete der?
Under opgradering af division 1/2's AI-hold til 24 ryttere med divisions-passende
kvalitet skete det samme grundlæggende fejlmønster to gange i træk på selve
prod-databasen, før det blev fanget: en kvalitetsændring der så fornuftig ud i
isolation, viste sig at producere groteske `base_value`-tal (millioner af CZ$ for
nominelt "solide" division-ryttere) først EFTER skrivning til prod.

- **Forsøg 1:** klampede alle 14 stat-felter ind i ét smalt, højt vindue (samme
  mekanik som den eksisterende svage start-pulje, bare forskudt opad). 900 ryttere
  indsat, gns. 364.188 CZ$, max 3.048.633 CZ$, 92 ryttere over 1 mio.
- **Forsøg 2:** skiftede til den ægte arketype-generator (`tierFractions: {solid:1}`)
  for at få realistisk specialisering — men brugte den UDEN at tjekke hvad
  "solid"-tierens højre-hale (konveks værdikurve + højere varians) gør ved 300
  uafhængige ruller på én gang. 300 ryttere indsat, gns. 1.520.686 CZ$, max
  8.160.444 CZ$ (over Pogačar), 220 over 1 mio.

Begge gange blev fejlen opdaget ved selvstændig verifikation (`SELECT base_value`
mod prod) FØR den blev rapporteret som færdig — ikke af ejeren, og ikke af en test.

## Root cause
**Forsøg 1:** klamping af ALLE stats til samme smalle vindue gør en rytter god til
alt på samme tid (urealistisk alsidighed). Værdimodellen (`riderValuation.js`)
vægter `mean(alle abilities)` med 50% — en kunstigt alsidig rytter får derfor et
kunstigt højt gennemsnit, selvom INGEN enkelt evne er ekstrem.

**Forsøg 2:** "solid"-tieren i `fictionalRiderGenerator.js` er kalibreret til at
udgøre 230/800 af det FRIE marked, hvor dens sjældne høj-rulninger (konveks
`c·O²`-led i værdiformlen + arketype-boost der kan ramme tæt på `STAT_CEIL`)
drukner statistisk i resten af pyramiden (12 superstar / 60 star / 230 solid /
498 domestique). Da jeg brugte 100% solid til EN HEL divisions AI-bænk (300
uafhængige ruller, ingen smoothing fra de andre tiers), blev den sjældne hale
ikke længere sjælden i absolutte tal — den ramte gentagne gange.

Fælles rod-årsag: jeg evaluerede begge ændringer på MEDIAN/typisk udfald (lokal
simulation med n=200-300, kiggede på p25/median/p75), men ikke på det
GARANTEREDE worst-case for en hel batch. En statistisk fordeling kan ikke
garantere et loft — kun en eksplicit gate kan.

## Fix
- `backend/lib/starterSquadAllocator.js`: ny `generateAiRiderBatchWithCap()` —
  genererer ÉN rytter ad gangen, beregner `base_value` LOKALT (samme kæde som
  `deriveForRiderIds`: `seedPhysiologyFromLegacy` → `deriveAbilities` →
  `computeRiderTypes` → `predictBaseValue`) FØR den accepteres, og forkaster +
  rerruller enhver rytter over `AI_TIER_VALUE_CAP[tier]`. Garanterer loftet
  UANSET tier-blandingens statistiske hale.
- `AI_TIER_FRACTIONS[1]` sænket fra 100% solid til 25% solid / 75% domestique
  (reducerer ANTALLET af risikable ruller, loftet er backstoppet uanset).
- `backend/lib/aiTeamGenerator.js` (`defaultAllocateSquadForTeam`) og
  `backend/scripts/dev/topUpAiRostersDiv1Div2.mjs` bruger nu begge den kappede
  generator — fixet både for FREMTIDIGE AI-hold og den engangs-backfill der
  allerede var kørt (rullet tilbage to gange, kørt korrekt tredje gang).
- To regressionstests i `aiTeamGenerator.test.js`: (1) stat-spredning ≥10 for
  mindst 50% af truppen (fanger forsøg-1-klassen — uniform clamping), (2) INGEN
  rytter over `AI_TIER_VALUE_CAP[1]` (fanger forsøg-2-klassen — ukappet hale).

## Forhindret-fremover
- `AI_TIER_VALUE_CAP` er nu en hård, kodet grænse — ikke en kalibreringsanbefaling.
  Enhver fremtidig ændring af `AI_TIER_FRACTIONS` (fx ejer beder om at hæve
  division 1's loft) er nu sikker AT JUSTERE, fordi loftet stadig backstopper den.
- De to regressionstests kører i CI ved enhver `aiTeamGenerator.js`-ændring.
- `backend/scripts/simAiRosterTierWindows.js` er bevaret som read-only
  kalibrerings-værktøj — brug det til at se forventet fordeling FØR en evt.
  fremtidig loft-justering, men stol ikke på det alene (se læring nedenfor).

## Læring
**En p25/median/p75-simulation viser det TYPISKE udfald, ikke det GARANTEREDE
worst-case for en hel batch.** Når man genererer N uafhængige ryttere fra en
fordeling med en højre-hale (konveks værdikurve, gaussisk varians), er
sandsynligheden for MINDST ÉN outlier i batchen meget højere end sandsynligheden
for at ÉN enkelt rytter er en outlier — selv en "lav" enkelt-sandsynlighed bliver
næsten sikker ved N=300. For batch-genererede game-data der fødes direkte til en
LIVE, observerbar prisformel: brug et eksplicit, kodet loft/gate (cap-and-reroll),
ikke kun en kalibreret gennemsnits-fordeling. Gælder bredt for ethvert fremtidigt
"generér N ryttere/items med egenskab X"-script i dette repo.
