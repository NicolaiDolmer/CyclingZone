#!/usr/bin/env node
// Overall 1-99 rytter-rating SIMULERING (#2000 slice 2) — READ-ONLY analyse.
//
// Beregner en overall rating "relativ til bedste ryttertype" mod HELE prod-
// populationen under TO normaliserings-varianter og producerer et scorecard
// ejeren kan beslutte ud fra. INGEN prod-mutation, INGEN skema-ændring — kun
// SELECT + et lokalt markdown-scorecard.
//
//   node scripts/overallRatingScorecard.js                 # rapport til stdout + default-fil
//   node scripts/overallRatingScorecard.js --out <fil.md>  # rapport til given fil
//
// Genbrug (ingen ny model opfundet):
//   - riderValuation.js: outputScore (= speciale_output, vægtet snit af POSITIVE
//     type-vægte) + meanAbilityScore. O_best = alpha·max(speciale) + (1-alpha)·mean,
//     alpha=0.5 (samme blend som værdimodellen → rating ↔ value konsistent).
//   - riderTypes.js: RIDER_TYPES / RIDER_TYPE_KEYS (per-type vægte).
//
// Note om "15 evner": prompten/#2000 definerer mean_all over de 15 game-abilities
// (climbing, time_trial, flat, tempo, sprint, acceleration, punch, endurance,
// recovery, durability, descending, cobblestone, positioning, aggression, tactics).
// riderValuation.meanAbilityScore bruger ABILITY_KEYS fra riderTypes.js, som KUN
// har 13 (mangler positioning + tactics). For at følge #2000-definitionen bruger
// dette script en eksplicit 15-evne-liste til mean_all. speciale_output (outputScore)
// genbruges urørt — den slår kun på de evner type-vægtene refererer til, så de to
// ekstra evner påvirker den ikke. Afvigelsen rapporteres i scorecardet.

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAllRows } from "../lib/supabasePagination.js";
import { outputScore } from "../lib/riderValuation.js";
import { RIDER_TYPE_KEYS } from "../lib/riderTypes.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env"), quiet: true });

const OUT_IDX = process.argv.indexOf("--out");
const OUT_PATH = OUT_IDX !== -1 ? process.argv[OUT_IDX + 1]
  : join(__dirname, "../../scratchpad-overall-rating-scorecard.md");

const ALPHA = 0.5; // samme blend som værdimodellen (O = 0,5·speciale + 0,5·mean)

// De 15 game-abilities (#2000). mean_all beregnes over disse, ikke de 13 i
// riderTypes.ABILITY_KEYS.
const ABILITIES_15 = [
  "climbing", "time_trial", "flat", "tempo", "sprint", "acceleration",
  "punch", "endurance", "recovery", "durability", "descending",
  "cobblestone", "positioning", "aggression", "tactics",
];

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Copenhagen" }).format(new Date());

// --- små hjælpere -----------------------------------------------------------

// mean over de 15 evner (ikke riderTypes' 13).
function mean15(ab) {
  let sum = 0, n = 0;
  for (const k of ABILITIES_15) {
    const v = Number(ab?.[k]);
    if (Number.isFinite(v)) { sum += v; n += 1; }
  }
  return n > 0 ? sum / n : 0;
}

// percentil på et SORTERET (stigende) array, lineær interpolation.
function percentile(sorted, p) {
  if (!sorted.length) return NaN;
  if (sorted.length === 1) return sorted[0];
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

// rating 1-99 fra en rå-værdi, lineær mod en (lo→1, hi→99)-skala, klampet.
function scaleTo199(raw, lo, hi) {
  if (!(hi > lo)) return 99;
  const t = (raw - lo) / (hi - lo);
  return Math.max(1, Math.min(99, Math.round(1 + t * 98)));
}

// tekst-histogram over 1-99 i 10-bånd.
function histogram(values) {
  const bands = Array.from({ length: 10 }, (_, i) => ({
    lo: i === 0 ? 1 : i * 10,
    hi: i === 9 ? 99 : i * 10 + 9,
    n: 0,
  }));
  for (const v of values) {
    let bi = Math.floor(v / 10);
    if (bi > 9) bi = 9;
    if (bi < 0) bi = 0;
    bands[bi].n += 1;
  }
  const max = Math.max(1, ...bands.map((b) => b.n));
  return bands.map((b) => {
    const bar = "█".repeat(Math.round((b.n / max) * 40));
    return `  ${String(b.lo).padStart(2)}-${String(b.hi).padStart(2)} | ${String(b.n).padStart(5)} ${bar}`;
  }).join("\n");
}

function fmtDist(values) {
  const s = [...values].sort((a, b) => a - b);
  return {
    min: s[0],
    median: percentile(s, 0.5),
    p90: percentile(s, 0.90),
    p99: percentile(s, 0.99),
    max: s[s.length - 1],
  };
}

async function main() {
  // --- Hent (READ-ONLY) ---
  const [riders, abilities] = await Promise.all([
    fetchAllRows(() => supabase
      .from("riders")
      .select("id, firstname, lastname, primary_type, is_retired, pcm_id")
      .order("id")),
    fetchAllRows(() => supabase
      .from("rider_derived_abilities")
      .select("*")
      .order("rider_id")),
  ]);
  const abilityByRider = new Map(abilities.map((a) => [a.rider_id, a]));

  // Aktive (ikke-pensionerede) ryttere med abilities.
  const rows = [];
  for (const r of riders) {
    if (r.is_retired) continue;
    const ab = abilityByRider.get(r.id);
    if (!ab) continue;

    // speciale_output for ALLE 8 typer → max (robust mod label-bug #1378).
    let bestType = null, bestSpec = -Infinity;
    const perType = {};
    for (const t of RIDER_TYPE_KEYS) {
      const s = outputScore(ab, t); // vægtet snit af POSITIVE vægte for type t
      perType[t] = s;
      if (s > bestSpec) { bestSpec = s; bestType = t; }
    }
    const meanAll = mean15(ab);
    const oBest = ALPHA * bestSpec + (1 - ALPHA) * meanAll;

    rows.push({
      id: r.id,
      name: `${r.firstname} ${r.lastname}`,
      storedType: r.primary_type ?? null,
      bestType,
      bestSpec,
      meanAll,
      oBest,
      fictional: r.pcm_id == null,
      sprint: Number(ab.sprint),
      ab,
      perType,
    });
  }

  if (!rows.length) {
    console.error("❌ Ingen aktive ryttere med abilities fundet.");
    process.exit(1);
  }

  // --- Variant V1 — absolut --------------------------------------------------
  // Skalér O_best GLOBALT så den absolutte elite rammer ~99 OG krydstype-rangeringen
  // overlever (en GC-stjerne på O≈81 skal rate over en sprinter-stjerne på O≈67).
  //
  // Ankervalg er kritisk: p99 er FORKERT her, fordi populationen domineres af to
  // enorme kohorter (sprinter+baroudeur) hvis O_best topper ~67 — p99 lander derfor
  // ~67 og alle 280+ ryttere derover (inkl. hele tt/gc-eliten) cappes til 99, så
  // krydstype-styrken forsvinder. Vi ankrer i stedet på den absolutte MAX O_best
  // (anker-max → 99), så hele 1-99-spændet bruges og eliten spredes korrekt.
  const oVals = rows.map((r) => r.oBest).sort((a, b) => a - b);
  const v1Lo = oVals[0];
  const v1Hi = oVals[oVals.length - 1]; // anker-max → 99
  for (const r of rows) r.v1 = scaleTo199(r.oBest, v1Lo, v1Hi);

  // --- Variant V2 — per-type relativ ----------------------------------------
  // Skalér O_best inden for rytterens BEDSTE-type-kohorte (p99 i kohorten → ~99,
  // p-bund i kohorten → lavt). Hver types top ≈ 99 ⇒ ren krydstype-sammenlignelighed.
  const cohort = new Map(); // bestType -> sorterede O_best i kohorten
  for (const t of RIDER_TYPE_KEYS) {
    const vals = rows.filter((r) => r.bestType === t).map((r) => r.oBest).sort((a, b) => a - b);
    cohort.set(t, vals);
  }
  const cohortScale = new Map(); // bestType -> { lo, hi }
  for (const t of RIDER_TYPE_KEYS) {
    const vals = cohort.get(t);
    if (!vals.length) { cohortScale.set(t, { lo: 0, hi: 1 }); continue; }
    cohortScale.set(t, { lo: vals[0], hi: percentile(vals, 0.99) });
  }
  for (const r of rows) {
    const { lo, hi } = cohortScale.get(r.bestType);
    r.v2 = scaleTo199(r.oBest, lo, hi);
  }

  // --- #1378-signal: beregnet bedste-type vs lagret primary_type -------------
  const withStored = rows.filter((r) => r.storedType != null);
  const mismatches = withStored.filter((r) => r.bestType !== r.storedType);
  const mismatchByPair = new Map(); // "stored→best" -> count
  for (const r of mismatches) {
    const key = `${r.storedType} → ${r.bestType}`;
    mismatchByPair.set(key, (mismatchByPair.get(key) || 0) + 1);
  }
  const topPairs = [...mismatchByPair.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);

  // --- Navngivne eksempler ---------------------------------------------------
  const byId = (frag) => rows.find((r) => r.id.startsWith(frag));
  const ayoub = byId("b896912d");
  const maxSprint = [...rows].sort((a, b) => b.sprint - a.sprint)[0];
  // "bedste GC" = højeste O_best blandt ryttere hvis BEREGNEDE bedste-type er gc.
  const bestGc = [...rows].filter((r) => r.bestType === "gc").sort((a, b) => b.oBest - a.oBest)[0];
  const bestSprinterCalc = [...rows].filter((r) => r.bestType === "sprinter").sort((a, b) => b.oBest - a.oBest)[0];
  // median-rytter på O_best.
  const byO = [...rows].sort((a, b) => a.oBest - b.oBest);
  const medianRider = byO[Math.floor(byO.length / 2)];

  // --- Top-5 samlet (V1) + top-3 pr. beregnet bedste-type --------------------
  const topV1 = [...rows].sort((a, b) => b.v1 - a.v1 || b.oBest - a.oBest).slice(0, 5);
  const top3ByType = {};
  for (const t of RIDER_TYPE_KEYS) {
    top3ByType[t] = [...rows]
      .filter((r) => r.bestType === t)
      .sort((a, b) => b.oBest - a.oBest)
      .slice(0, 3);
  }

  // --- Sanity-flags ----------------------------------------------------------
  const v1Dist = fmtDist(rows.map((r) => r.v1));
  const v2Dist = fmtDist(rows.map((r) => r.v2));
  const sanity = [];

  // GC-stjerne > sprinter-stjerne i V1? (strengt — V1 skal afspejle sand styrke)
  if (bestGc && bestSprinterCalc) {
    sanity.push({
      q: "V1: GC-stjerne rater STRENGT højere end sprinter-stjerne?",
      ok: bestGc.v1 > bestSprinterCalc.v1,
      detail: `GC-stjerne ${bestGc.name} V1=${bestGc.v1} (O=${bestGc.oBest.toFixed(1)}) vs sprinter-stjerne ${bestSprinterCalc.name} V1=${bestSprinterCalc.v1} (O=${bestSprinterCalc.oBest.toFixed(1)})`,
    });
    sanity.push({
      q: "V2: begge ≈99? (per-type relativ ⇒ hver types top ~99)",
      ok: bestGc.v2 >= 90 && bestSprinterCalc.v2 >= 90,
      detail: `GC-stjerne V2=${bestGc.v2}, sprinter-stjerne V2=${bestSprinterCalc.v2}`,
    });
  }
  // svage ryttere lave i begge?
  if (ayoub) {
    sanity.push({
      q: "Svag rytter (Ayoub Cherif) lav i BEGGE varianter?",
      ok: ayoub.v1 <= 30 && ayoub.v2 <= 40,
      detail: `Ayoub V1=${ayoub.v1}, V2=${ayoub.v2} (O=${ayoub.oBest.toFixed(1)}, bedste-type ${ayoub.bestType})`,
    });
  }
  // absurde udfald: nogen over 99 / under 1? (kan ikke ske pga klamp — men tjek O-spredning)
  const v1AtCap = rows.filter((r) => r.v1 >= 99).length;
  const v2AtCap = rows.filter((r) => r.v2 >= 99).length;
  sanity.push({
    q: "V1: hvor mange ryttere rammer cap 99? (forventet: kun ekstrem-elite)",
    ok: v1AtCap < rows.length * 0.05,
    detail: `${v1AtCap} ryttere (${((v1AtCap / rows.length) * 100).toFixed(1)}%) på 99`,
  });
  sanity.push({
    q: "V2: hvor mange ryttere rammer cap 99? (forventet: top ~1% pr. kohorte)",
    ok: v2AtCap < rows.length * 0.10,
    detail: `${v2AtCap} ryttere (${((v2AtCap / rows.length) * 100).toFixed(1)}%) på 99`,
  });

  // --- Markdown --------------------------------------------------------------
  const L = [];
  const fmtRow = (r, variant) =>
    `| ${r.name} | ${r[variant]} | beregnet **${r.bestType}** / lagret ${r.storedType ?? "?"} | ${r.oBest.toFixed(1)} | ${r.bestSpec.toFixed(1)} | ${r.meanAll.toFixed(1)} |`;

  L.push("# Overall 1-99 rytter-rating — simulering (#2000 slice 2)");
  L.push("");
  L.push(`> Genereret ${today} af \`node backend/scripts/overallRatingScorecard.js\` (READ-ONLY mod prod). INGEN mutation, INGEN skema-ændring.`);
  L.push(`> Population: ${rows.length} aktive ryttere med abilities (${rows.filter((r) => r.fictional).length} fiktive, ${rows.filter((r) => !r.fictional).length} virkelige).`);
  L.push(`> Model: O_best = ${ALPHA}·max(speciale_output over alle 8 typer) + ${1 - ALPHA}·mean(15 evner). Samme α som værdimodellen.`);
  L.push("");
  L.push("**Rating-definition:**");
  L.push("- **Bedste type:** pr. rytter beregnes `speciale_output` (genbrugt `outputScore`) for ALLE 8 typer; den højeste vinder. Robust mod label-bug (#1378).");
  L.push(`- **V1 — absolut:** O_best skaleret globalt (global min ${v1Lo.toFixed(1)} → 1, anker-max ${v1Hi.toFixed(1)} → 99). Stærkeste profiler på tværs rater højest.`);
  L.push("- **V2 — per-type relativ:** O_best skaleret inden for rytterens bedste-type-kohorte (kohorte-min → 1, kohorte-p99 → 99). Hver types top ≈99.");
  L.push("");
  L.push("> **Bemærk (15 vs 13 evner):** `mean_all` er her snit af de 15 game-abilities (#2000 inkl. `positioning` + `tactics`). Den genbrugte `meanAbilityScore` bruger kun 13 (mangler de to). `speciale_output` er urørt genbrug — type-vægtene rører ikke positioning/tactics, så max-speciale er identisk med produktionskoden.");
  L.push("");

  // 1. Fordeling
  L.push("## 1. Fordeling");
  L.push("");
  L.push("| Variant | min | median | p90 | p99 | max |");
  L.push("|---|--:|--:|--:|--:|--:|");
  L.push(`| V1 absolut | ${v1Dist.min} | ${v1Dist.median.toFixed(1)} | ${v1Dist.p90.toFixed(1)} | ${v1Dist.p99.toFixed(1)} | ${v1Dist.max} |`);
  L.push(`| V2 per-type | ${v2Dist.min} | ${v2Dist.median.toFixed(1)} | ${v2Dist.p90.toFixed(1)} | ${v2Dist.p99.toFixed(1)} | ${v2Dist.max} |`);
  L.push("");
  L.push("**Histogram V1 (absolut):**");
  L.push("```");
  L.push(histogram(rows.map((r) => r.v1)));
  L.push("```");
  L.push("**Histogram V2 (per-type relativ):**");
  L.push("```");
  L.push(histogram(rows.map((r) => r.v2)));
  L.push("```");
  L.push("");

  // 2. Top-5 samlet (V1)
  L.push("## 2. Top-5 ryttere samlet (V1 absolut)");
  L.push("");
  L.push("| Rytter | V1 | Bedste-type (beregnet/lagret) | O_best | speciale | mean15 |");
  L.push("|---|--:|---|--:|--:|--:|");
  for (const r of topV1) L.push(fmtRow(r, "v1"));
  L.push("");

  // 3. Top-3 pr. type
  L.push("## 3. Top-3 pr. beregnet bedste-type");
  L.push("");
  for (const t of RIDER_TYPE_KEYS) {
    const list = top3ByType[t];
    L.push(`**${t}** (${rows.filter((r) => r.bestType === t).length} ryttere i kohorten)`);
    if (!list.length) { L.push("- (ingen)"); L.push(""); continue; }
    L.push("");
    L.push("| Rytter | V1 | V2 | O_best | speciale | mean15 |");
    L.push("|---|--:|--:|--:|--:|--:|");
    for (const r of list) L.push(`| ${r.name} | ${r.v1} | ${r.v2} | ${r.oBest.toFixed(1)} | ${r.bestSpec.toFixed(1)} | ${r.meanAll.toFixed(1)} |`);
    L.push("");
  }

  // 4. Navngivne eksempler
  L.push("## 4. Navngivne eksempler");
  L.push("");
  L.push("| Rytter | Rolle i tjek | V1 | V2 | Bedste-type (beregnet) | Lagret type | O_best | speciale | mean15 |");
  L.push("|---|---|--:|--:|---|---|--:|--:|--:|");
  const exRow = (r, role) => r
    ? `| ${r.name} | ${role} | ${r.v1} | ${r.v2} | ${r.bestType} | ${r.storedType ?? "?"} | ${r.oBest.toFixed(1)} | ${r.bestSpec.toFixed(1)} | ${r.meanAll.toFixed(1)} |`
    : `| — | ${role} | — | — | — | — | — | — | — |`;
  L.push(exRow(ayoub, "Ayoub Cherif (b896912d…)"));
  L.push(exRow(maxSprint, `max sprint (${maxSprint?.sprint})`));
  L.push(exRow(bestGc, "bedste GC (beregnet)"));
  L.push(exRow(medianRider, "median-rytter (på O_best)"));
  L.push("");

  // 5. Sanity
  L.push("## 5. Sanity-tjek");
  L.push("");
  L.push("| Tjek | Status | Detalje |");
  L.push("|---|:--:|---|");
  for (const s of sanity) L.push(`| ${s.q} | ${s.ok ? "✅" : "⚠️"} | ${s.detail} |`);
  L.push("");

  // 6. #1378-signal
  L.push("## 6. #1378-signal — beregnet bedste-type vs lagret primary_type");
  L.push("");
  L.push(`${mismatches.length} af ${withStored.length} ryttere (${((mismatches.length / withStored.length) * 100).toFixed(1)}%) har en beregnet bedste-type der AFVIGER fra den lagrede \`primary_type\`.`);
  L.push("");
  L.push("> Vigtig nuance: den lagrede `primary_type` bruger en ANDEN metode (z-score + KONTRAST mod populationen, `riderTypes.computeRiderTypes`), mens dette scripts bedste-type er rå max `speciale_output` (vægtet snit af positive vægte, INGEN z-score, INGEN guards). En del af afvigelsen er derfor metode-forskel, ikke nødvendigvis en bug. Signalet er stadig relevant: rå-speciale-max er hvad rating-rå-scoren bygger på.");
  L.push("");
  L.push("Top afvigelses-par (lagret → beregnet):");
  L.push("");
  L.push("| Lagret → Beregnet | Antal |");
  L.push("|---|--:|");
  for (const [pair, n] of topPairs) L.push(`| ${pair} | ${n} |`);
  L.push("");

  const md = L.join("\n") + "\n";
  writeFileSync(OUT_PATH, md);

  // --- stdout-summary --------------------------------------------------------
  console.log(md);
  console.log(`\n✅ Skrev scorecard: ${OUT_PATH}`);
  console.log(`Population: ${rows.length} aktive ryttere · #1378-afvigelse: ${mismatches.length}/${withStored.length} (${((mismatches.length / withStored.length) * 100).toFixed(1)}%)`);
}

main().catch((err) => {
  console.error("❌", err);
  process.exit(1);
});
