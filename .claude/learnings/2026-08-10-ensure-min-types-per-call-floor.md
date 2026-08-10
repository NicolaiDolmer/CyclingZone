# 2026-08-10 — Et gulv kalibreret til 800 blev håndhævet på 8

**Issue:** #3570 (spor S2) · **Fil:** `backend/lib/fictionalRiderGenerator.js`
**Live i:** 51 dage (2026-06-20 → 2026-08-10) · **Berørte:** 5.550 af 8.199 levende ryttere

## Symptom

Hver ny manager fik en start-trup hvor alle 12 ryttere var trukket som enten sprinter eller
klassementsrytter — 72,7 % / 27,3 %, og nul af de øvrige seks arketyper. Ingen klatrer, ingen
enkeltstartsspecialist, ingen puncheur, ingen rouleur. Samme for nye AI-holds trupper.

## Rod-årsag

```js
const ENSURE_MIN_TYPES = { gc: 30, sprinter: 40 };   // "mindst 30 gc og 40 sprintere"
```

Gulvet er ejer-spec for et felt på **~800 ryttere** ("alle 8 repræsenteret, gulv gc≥30,
sprinter≥40"), men det blev håndhævet som et **absolut antal pr. generator-kald**. Så længe
det eneste kaldsted var launch-populationen (count 800, #669 7/6) var det harmløst — gulvet
var endda næsten inaktivt, fordi det naturlige træk allerede giver ~34 gc og ~128 sprintere.

Fra 20/6 begyndte trup-stierne at kalde den samme generator med små counts:

| dato | commit | kaldsted | count |
|---|---|---|---:|
| 20/6 | `fe8562b4` (#1560) | start-trup ved hold-oprettelse | **8** |
| 23/6 | `adf5aef0` (#1820) | hale-puljen | **4** |
| 30/6 | `081c64ff` (#2065) | AI-hold tier 3/4 | **8** og **16** |

"Mindst 30 gc" i et træk på 8 promoverer hele trækket. Loopet tager gc først (alle slots hvis
tieren tillader det), sprinter tager resten, og der er ingen slots tilbage. Målt: **100 %
sprinter+gc og præcis 2 arketyper ved alle counts ≤ 48**. Degenerationen aftager først omkring
count 96 og er væk ved 240.

## Fix

Gulvet er en **andel** af feltet, ikke et antal:

```js
const ENSURE_MIN_REFERENCE_COUNT = 800;
export function scaleMinTypes(count, mins = ENSURE_MIN_TYPES, reference = ENSURE_MIN_REFERENCE_COUNT) {
  const scaled = {};
  for (const [type, min] of Object.entries(mins)) {
    const n = Math.round((min * count) / reference);
    if (n > 0) scaled[type] = n;   // et gulv der runder til 0 håndhæves ikke
  }
  return scaled;
}
```

Ved count = 800 giver skaleringen præcis 30/40 igen, funktionen forbruger ingen rng, og
relaunch-populationen er byte-identisk (verificeret på 5 seeds mod pre-fix-modulet).

## Læringer

1. **En konstant kalibreret til én skala er en fælde så snart funktionen får en ny kaldskontekst.**
   Ingen af de tre PR'er der tilføjede små-count-kaldsteder gjorde noget forkert isoleret set —
   de kaldte bare en eksisterende, testet funktion. Fejlen var at gulvet var et ANTAL uden at
   dokumentere hvilken skala det var et antal AF. **Forward-guard:** når en konstant kun giver
   mening ved én batch-størrelse, skal den enten skaleres eller kaste ved uventet input.

2. **Alle floor-tests lå ved count = 800.** Suiten havde en test på "gc≥30, sprinter≥40 @ 800"
   og en på "tier-kvote summerer ved skæve tal (37/113/500/1234)" — men ingen der målte
   *sammensætningen* ved de counts produktionen faktisk bruger. **Forward-guard:** når man
   tester en funktions output-egenskab, skal testen køre på de argumenter kaldsstederne
   bruger, ikke kun på det argument specen blev skrevet mod. De nye defekt-vagter kører ved
   count 4/8/16 — præcis produktionens tal.

3. **En bug kan gemme sig bag et andet fix.** `generateAiRiderBatchWithCap` batcher
   `max(needed*6, 30)` — indført 1/7 for at redde GUARANTEED-nationaliteterne (alle 300
   division-1-ryttere blev "CN" ved count=1). Den utilsigtede sideeffekt var at AI-tier-1/2-
   stien blev den *mindst* degenererede. Uden det fix ville også den have været 100 %
   sprinter+gc. Brief'en til dette spor antog count=24; koden siger 144.

4. **Rækkefølgen mellem to fixes kan vende fortegnet.** Målt: persisteres det trukne anlæg i
   `riders.archetype_draw` FØR gulv-fixet, cementeres 73 % sprintere som permanent, synlig
   identitet (L1 152 — værre end i dag). Efter gulv-fixet giver samme handling L1 23,5. Når to
   ændringer rører samme kæde, skal rækkefølgen måles, ikke antages.

5. **En port kan være matematisk umulig.** Min præregistrerede dæknings-port (alle 8 arketyper
   ≥ 3 %) kan ikke nås ved count = 4: tier-kvoten er `{solid: 1, domestique: 3}` og gc findes
   kun i de stærke tiers, så gc's strukturelle loft er 2,27 %. Målt 2,29 %. Porten blev
   rapporteret som et fald med den strukturelle forklaring, ikke tunet væk i stilhed.

## Verifikation

- Paritet: variant-kopi mod repoets `generateFictionalRiders` — 27.114 ryttere, 0 afvigelser.
  In-memory klassifikations-kæde mod `deriveForRiderIds` (produktionsfunktionen, stub-DB) —
  15.840 sammenligninger, 0 afvigelser.
- Negativ-test: 3 nye tests fejler på den muterede (pre-fix) linje, alle 37 består efter.
- `npm test` backend 5.771/5.771 · `node --test` frontend 1.846/1.846 · e2e 392 passed.
- count = 800 byte-identisk, 5/5 seeds.
