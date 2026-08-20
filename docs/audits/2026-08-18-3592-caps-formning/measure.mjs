// #3592 — engangsscript, KUN i scratchpad. Måler hvor mange pot-5-6-ryttere der
// reelt er "uafgjorte" mellem tt/gc hhv. rouleur/brostensrytter PÅ CAPS-NIVEAU,
// ved brug af de FAKTISKE funktioner fra backend/lib (ingen re-implementering af
// signatureFactor/youthRoleFactor/buildYouthCaps).
//
// Metode: for hver pot-5-6 human-owned rytter beregnes buildYouthCaps (det RENE,
// anlægs-formede loft, upåvirket af current-ability-gulvet/alders-taper) for
// rytterens EGET primær+sekundær-anlæg. Derefter beregnes en "caps-type-score" pr.
// af de 8 typer = vægtet snit af de POSITIVE CAPS_SHAPING_WEIGHTS-vægte anvendt på
// caps-objektet — SAMME formel-mønster som outputScore (riderValuation.js) og
// ratingForRole (displayRecipes.js), men på capsShapingWeights i stedet for deres
// egne tabeller (der er IKKE en eksporteret "capsTypeScore" i repoet i dag — den
// bygges her lokalt, kun til måling, rører intet i repoet).
//
// "Uafgjort" = |scoreA - scoreB| < 1.0 (samme enhed som caps, 0-99) — samme
// tærskel issuet selv brugte ("under 1 rating-point").
//
// Krydstjek: samme måling gentages med buildCapsForRider (LIVE-loftet, med
// gulv+alders-taper) for at se om current-ability/alder camouflerer noget.

import fs from "node:fs";
import { pathToFileURL } from "node:url";

const riderProgressionUrl = pathToFileURL("C:/Dev/CyclingZone/backend/lib/riderProgression.js").href;
const capsShapingWeightsUrl = pathToFileURL("C:/Dev/CyclingZone/backend/lib/weights/capsShapingWeights.js").href;

const { buildYouthCaps, buildCapsForRider } = await import(riderProgressionUrl);
const { CAPS_SHAPING_WEIGHTS } = await import(capsShapingWeightsUrl);

const WEIGHTS_BY_TYPE = Object.fromEntries(CAPS_SHAPING_WEIGHTS.map((t) => [t.key, t.weights]));
const TYPE_KEYS = CAPS_SHAPING_WEIGHTS.map((t) => t.key);

// Samme formel-form som outputScore (riderValuation.js) / ratingForRole
// (displayRecipes.js): vægtet snit af de POSITIVE vægte i tabellen, anvendt på
// et vilkårligt evne/caps-objekt. Ingen normalisering, ingen anker.
function capsTypeScore(capsObj, typeKey) {
  const weights = WEIGHTS_BY_TYPE[typeKey];
  if (!weights) return null;
  let sum = 0, wsum = 0;
  for (const [k, w] of Object.entries(weights)) {
    if (w <= 0) continue;
    const v = Number(capsObj?.[k]);
    if (Number.isFinite(v)) { sum += v * w; wsum += w; }
  }
  return wsum > 0 ? sum / wsum : null;
}

const PAIRS = [
  ["tt", "gc"],
  ["rouleur", "brostensrytter"],
];

const UAFGJORT_GAP = 1.0; // samme tærskel som issuets egen måling

const raw = fs.readFileSync("C:/Dev/CyclingZone/docs/snapshots/3591/riders_full.json", "utf8");
const riders = JSON.parse(raw);

const pot56 = riders.filter((r) => r.owner_kind === "human" && Number(r.potentiale) >= 5);

console.log(`Total ryttere i snapshot: ${riders.length}`);
console.log(`Human-owned pot-5-6: ${pot56.length}`);

function analyzePair(pairKey, useLiveCaps) {
  const [a, b] = pairKey;
  let uafgjort = 0;
  let uafgjortHigh = 0; // uafgjort OG begge >= 85 (reelt "topmættede" par)
  const gaps = [];
  const bothHighGaps = [];

  for (const r of pot56) {
    let capsObj;
    if (useLiveCaps) {
      const age = Number(r.age);
      capsObj = buildCapsForRider(
        r.abilities,
        { potentiale: r.potentiale, age: Number.isFinite(age) ? age : null },
        r.primary_type,
        r.secondary_type,
      );
    } else {
      capsObj = buildYouthCaps(r.potentiale, r.primary_type, r.secondary_type);
    }
    const scoreA = capsTypeScore(capsObj, a);
    const scoreB = capsTypeScore(capsObj, b);
    if (scoreA == null || scoreB == null) continue;
    const gap = Math.abs(scoreA - scoreB);
    gaps.push(gap);
    if (gap < UAFGJORT_GAP) {
      uafgjort += 1;
      if (Math.min(scoreA, scoreB) >= 85) {
        uafgjortHigh += 1;
        bothHighGaps.push(gap);
      }
    }
  }

  gaps.sort((x, y) => x - y);
  const median = gaps.length ? gaps[Math.floor(gaps.length / 2)] : null;
  const p10 = gaps.length ? gaps[Math.floor(gaps.length * 0.1)] : null;
  const p90 = gaps.length ? gaps[Math.floor(gaps.length * 0.9)] : null;

  return {
    pair: `${a}/${b}`,
    n: pot56.length,
    uafgjort,
    uafgjortPct: pot56.length ? (100 * uafgjort / pot56.length).toFixed(1) : "n/a",
    uafgjortHigh,
    uafgjortHighPct: pot56.length ? (100 * uafgjortHigh / pot56.length).toFixed(1) : "n/a",
    medianGap: median?.toFixed(2),
    p10Gap: p10?.toFixed(2),
    p90Gap: p90?.toFixed(2),
  };
}

console.log("\n=== PURE caps-shaping (buildYouthCaps, uden gulv/alders-taper) ===");
for (const pair of PAIRS) {
  console.log(JSON.stringify(analyzePair(pair, false), null, 2));
}

console.log("\n=== LIVE caps (buildCapsForRider, med gulv+alders-taper) — krydstjek ===");
for (const pair of PAIRS) {
  console.log(JSON.stringify(analyzePair(pair, true), null, 2));
}

// Type-specifik nedbrydning: for hvert par (A,B) hvor A's positive-vægte er ⊆ B's,
// er det B-siden (den superset-formede type) der reelt "camouflerer" A — en
// B-primær rytters caps læses nødvendigvis (næsten) lige så højt som A, fordi A's
// eneste signatur-evne(r) også er B's. Dette er den population issuet konkret
// bekymrer sig om ("kan ikke skelnes fra sit naboloft"): B-primær ELLER
// B-sekundær ryttere, målt på gap mellem deres egen B-score og A-score.
function analyzePairByOwnType(pairKey, dominantSide, useLiveCaps) {
  const [a, b] = pairKey;
  const filterType = dominantSide === "b" ? b : a;
  const subset = pot56.filter(
    (r) => r.primary_type === filterType || r.secondary_type === filterType,
  );
  let uafgjort = 0;
  const gaps = [];
  for (const r of subset) {
    let capsObj;
    if (useLiveCaps) {
      const age = Number(r.age);
      capsObj = buildCapsForRider(
        r.abilities,
        { potentiale: r.potentiale, age: Number.isFinite(age) ? age : null },
        r.primary_type,
        r.secondary_type,
      );
    } else {
      capsObj = buildYouthCaps(r.potentiale, r.primary_type, r.secondary_type);
    }
    const scoreA = capsTypeScore(capsObj, a);
    const scoreB = capsTypeScore(capsObj, b);
    if (scoreA == null || scoreB == null) continue;
    const gap = Math.abs(scoreA - scoreB);
    gaps.push(gap);
    if (gap < UAFGJORT_GAP) uafgjort += 1;
  }
  gaps.sort((x, y) => x - y);
  const median = gaps.length ? gaps[Math.floor(gaps.length / 2)] : null;
  return {
    pair: `${a}/${b}`,
    filterType,
    n: subset.length,
    uafgjort,
    uafgjortPct: subset.length ? (100 * uafgjort / subset.length).toFixed(1) : "n/a",
    medianGap: median?.toFixed(2),
  };
}

console.log("\n=== Type-specifik nedbrydning (PURE caps) — hvor B (superset-type) camouflerer A ===");
const byType = {
  pure: [
    analyzePairByOwnType(["tt", "gc"], "b", false),   // gc-primær/sekundær ryttere
    analyzePairByOwnType(["tt", "gc"], "a", false),   // tt-primær/sekundær ryttere (kontrol)
    analyzePairByOwnType(["rouleur", "brostensrytter"], "b", false), // brostensrytter-siden
    analyzePairByOwnType(["rouleur", "brostensrytter"], "a", false), // rouleur-siden (kontrol)
  ],
  live: [
    analyzePairByOwnType(["tt", "gc"], "b", true),
    analyzePairByOwnType(["tt", "gc"], "a", true),
    analyzePairByOwnType(["rouleur", "brostensrytter"], "b", true),
    analyzePairByOwnType(["rouleur", "brostensrytter"], "a", true),
  ],
};
for (const row of byType.pure) console.log(JSON.stringify(row));
console.log("--- live ---");
for (const row of byType.live) console.log(JSON.stringify(row));

// Ekstra: type-fordeling i pot-5-6 populationen (for kontekst i forslag.md/scorecard.md)
const typeDist = {};
for (const r of pot56) {
  typeDist[r.primary_type] = (typeDist[r.primary_type] || 0) + 1;
}
console.log("\n=== Primær-type-fordeling, human pot-5-6 ===");
console.log(JSON.stringify(typeDist, null, 2));

fs.writeFileSync(
  "C:/Users/Nicolai/AppData/Local/Temp/claude/C--Dev-CyclingZone/82bfa4aa-694a-4b0e-8385-ae53af7e028b/scratchpad/3592/measure-output.json",
  JSON.stringify(
    {
      totalRiders: riders.length,
      pot56N: pot56.length,
      pure: PAIRS.map((p) => analyzePair(p, false)),
      live: PAIRS.map((p) => analyzePair(p, true)),
      byType,
      typeDist,
    },
    null,
    2,
  ),
);
