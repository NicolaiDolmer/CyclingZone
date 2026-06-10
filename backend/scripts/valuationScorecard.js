#!/usr/bin/env node
// Værdimodel-scorecard (#1196) — koger de ~9.000 base_value-værdier ned til én
// ejer-beslutning på ~10 minutter: "Godkend cutover? ja/nej" (#1101 slice 2-gate).
//
// READ-ONLY mod prod (kun SELECT — skriver ALDRIG). Harness-standard jf. #1144:
// input = prod base_value + riderValuationModel.json (+anchors) · runner = denne CLI ·
// orakel = ejeren · rapport = markdown-artefakt · feedback = ja → gate kvitteret;
// nej → outlier-/anchor-tabellerne er fejl-rapporten.
//
//   node scripts/valuationScorecard.js                 # rapport til stdout
//   node scripts/valuationScorecard.js --out <fil.md>  # rapport til fil (committes)
//
// Exit 1 hvis en hård sanity-gate fejler (NULL/0-værdier, negative, determinisme-
// drift på aktive, monotoni-brud, hårde anchor-ordensbrud).

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAllRows } from "../lib/supabasePagination.js";
import { blendedOutput, meanAbilityScore, outputScore, predictBaseValue } from "../lib/riderValuation.js";
import { checkAnchorOrdering } from "../lib/riderValuationFit.js";
import {
  DESIGN_PYRAMID,
  PYRAMID_BANDS,
  bandCounts,
  buildOutlierRows,
  fmtCZ,
  percentile,
  riderAge,
} from "../lib/valuationScorecard.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env"), quiet: true });

const OUT_IDX = process.argv.indexOf("--out");
const OUT_PATH = OUT_IDX !== -1 ? process.argv[OUT_IDX + 1] : null;

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const model = JSON.parse(readFileSync(join(__dirname, "../lib/riderValuationModel.json"), "utf8"));
const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").trim();
const fmtM = (n) => (n / 1e6).toFixed(1) + "M";
const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Copenhagen" }).format(new Date());

async function main() {
  // --- Hent (READ-ONLY) ---
  const [riders, abilities] = await Promise.all([
    fetchAllRows(() => supabase
      .from("riders")
      .select("id, firstname, lastname, primary_type, base_value, birthdate, pcm_id, is_retired")
      .order("id")),
    fetchAllRows(() => supabase.from("rider_derived_abilities").select("*").order("rider_id")),
  ]);
  const abilityByRider = new Map(abilities.map((a) => [a.rider_id, a]));

  const active = riders.filter((r) => !r.is_retired);
  const enrich = (r) => {
    const ab = abilityByRider.get(r.id);
    return {
      ...r,
      name: `${r.firstname} ${r.lastname}`,
      age: riderAge(r.birthdate),
      fictional: r.pcm_id == null,
      baseValue: Number(r.base_value),
      output: ab ? blendedOutput(ab, r.primary_type, model.alpha ?? 1) : null,
      spec: ab ? outputScore(ab, r.primary_type) : null,
      mean: ab ? meanAbilityScore(ab) : null,
      predicted: ab ? predictBaseValue(r, ab, model) : null,
    };
  };
  const activeRows = active.map(enrich);
  const valued = activeRows.filter((r) => Number.isFinite(r.baseValue) && r.output != null);

  // --- Sanity-gates (hårde) ---
  const gates = [];
  const badBase = activeRows.filter((r) => !(r.baseValue > 0));
  gates.push({
    name: "Ingen aktive med base_value NULL/0",
    ok: badBase.length === 0,
    detail: badBase.length === 0 ? "0 fundet" : `${badBase.length} fundet (fx ${badBase.slice(0, 3).map((r) => r.name).join(", ")})`,
  });
  const negative = activeRows.filter((r) => Number.isFinite(r.baseValue) && r.baseValue < 0);
  gates.push({ name: "Ingen negative værdier", ok: negative.length === 0, detail: `${negative.length} fundet` });

  const drift = valued.filter((r) => r.predicted != null && r.predicted !== r.baseValue);
  gates.push({
    name: "Determinisme: gemt base_value = model-output (aktive)",
    ok: drift.length === 0,
    detail: drift.length === 0
      ? `0 afvigelser på ${valued.length} ryttere`
      : `${drift.length} afvigelser (fx ${drift.slice(0, 3).map((r) => `${r.name} ${fmtCZ(r.baseValue)}→${fmtCZ(r.predicted)}`).join(", ")})`,
  });

  // Monotoni: d/dO [a + bO + cO²] = b + 2cO skal være ≥0 på hele det aktive
  // domæne [0, output_max] (derover klamper predictBaseValue).
  const c = Number(model.c) || 0;
  const oMax = Number(model.output_max) || 99;
  const minSlope = c >= 0 ? model.b : model.b + 2 * c * oMax;
  gates.push({ name: `Monotoni-guard på [0, ${oMax}]`, ok: minSlope >= 0, detail: `min. hældning ${minSlope.toFixed(4)}` });

  const predictAnchor = (an) => {
    const O = Math.min(an.output, oMax);
    return Math.exp(model.a + model.b * O + c * O * O + (model.offset?.[an.type] ?? 0));
  };
  const { hard, soft } = checkAnchorOrdering(model.anchors_fit, predictAnchor);
  gates.push({
    name: "Ordens-guard: anchors ≥15M i ejer-rækkefølge",
    ok: hard.length === 0,
    detail: `${hard.length} hårde brud · ${soft.length} bløde (midterfelt, rapporteres kun)`,
  });

  const allGatesOk = gates.every((g) => g.ok);

  // --- Fordeling ---
  const vals = valued.map((r) => r.baseValue).sort((a, b) => a - b);
  const pcts = [0.01, 0.05, 0.10, 0.25, 0.50, 0.75, 0.90, 0.95, 0.99, 0.999];
  const bands = bandCounts(vals);
  const bandFor = (v) => PYRAMID_BANDS.find((b) => v >= b.min && v < b.max);

  // --- Top/bund ---
  const byValue = [...valued].sort((a, b) => b.baseValue - a.baseValue);
  const top20 = byValue.slice(0, 20);
  const bottom20 = byValue.slice(-20).reverse();

  // --- Outliers: uden for anchor-støtten [laveste anchor-output, output_max] ---
  const anchorOMin = Math.min(...model.anchors_fit.map((a) => a.output));
  const range = { min: anchorOMin, max: oMax };
  const outliers = buildOutlierRows(valued, range, 10);
  const below = valued.filter((r) => r.output < range.min);
  const nBelow = below.length;
  const nAbove = valued.filter((r) => r.output > range.max).length;
  const valueBelow = below.reduce((s, r) => s + r.baseValue, 0);
  const valueTotal = valued.reduce((s, r) => s + r.baseValue, 0);

  // --- Anchors: fit-predicted vs mål + prod-værdi nu ---
  const allByName = riders.map((r) => ({ r, key: norm(`${r.firstname} ${r.lastname}`) }));
  const anchorRows = model.anchors_fit.map((an) => {
    const hit = allByName.find((x) => x.key.includes(norm(an.name)));
    return { ...an, prodNow: hit ? Number(hit.r.base_value) : null, ratio: an.predicted / an.target };
  });
  const anchorFlags = anchorRows.filter((a) => a.ratio > 2 || a.ratio < 0.5);

  // --- Markdown ---
  const L = [];
  L.push("# Værdimodel-scorecard — ejer-verify af `base_value` (v3)");
  L.push("");
  L.push(`> Genereret ${today} af \`node backend/scripts/valuationScorecard.js\` (READ-ONLY mod prod) · Refs #1196, #1101, #1144, #1194`);
  L.push(`> Model: v3 (fittet ${model.fitted_at}, ${model.n_anchor} anchors, R²(log) ${model.r2_log}) · Population: ${riders.length} ryttere, ${active.length} aktive, ${valued.length} værdisat`);
  L.push(">");
  L.push("> **Status-kontekst:** cutoveren (#1101 slice 2) blev udført 10/6 med ejer-go i session (PR #1201) — `base_value` driver nu økonomien. Dette scorecard gør den fulde 8.994-værdi-verifikation billig: det ratificerer gaten endeligt og er skabelonen for ejer-verify ved alle fremtidige re-fits (fase 2/3).");
  L.push("");

  L.push("## 0. Sanity-gates (hårde — scriptet fejler hvis en er rød)");
  L.push("");
  L.push("| Gate | Status | Detalje |");
  L.push("|---|:--:|---|");
  for (const g of gates) L.push(`| ${g.name} | ${g.ok ? "✅" : "❌"} | ${g.detail} |`);
  L.push("");

  L.push("## 1. Top-20 — ser toppen rigtig ud?");
  L.push("");
  L.push("| # | Rytter | Type | Alder | Felt | base_value (CZ$) |");
  L.push("|--:|---|---|--:|---|--:|");
  top20.forEach((r, i) => L.push(
    `| ${i + 1} | ${r.name} | ${r.primary_type ?? "?"} | ${r.age ?? "?"} | ${r.fictional ? "fiktiv" : "virkelig"} | ${fmtCZ(r.baseValue)} |`
  ));
  L.push("");

  L.push("## 2. Bund-20 — ser bunden rigtig ud?");
  L.push("");
  L.push("Ingen-bund-direktivet (ejer 7/6): dårligste ryttere må gerne ligge spredt under/over ~1.000 CZ$.");
  L.push("");
  L.push("| # | Rytter | Type | Alder | Felt | base_value (CZ$) |");
  L.push("|--:|---|---|--:|---|--:|");
  bottom20.forEach((r, i) => L.push(
    `| ${valued.length - i} | ${r.name} | ${r.primary_type ?? "?"} | ${r.age ?? "?"} | ${r.fictional ? "fiktiv" : "virkelig"} | ${fmtCZ(r.baseValue)} |`
  ));
  L.push("");

  L.push("## 3. Fordeling — percentil-kurve mod pyramide-båndene (#1194)");
  L.push("");
  L.push("| Percentil | base_value (CZ$) | Bånd |");
  L.push("|---|--:|---|");
  for (const p of pcts) {
    const v = percentile(vals, p);
    L.push(`| p${(p * 100).toString().replace(".", ",")} | ${fmtCZ(v)} | ${bandFor(v)?.label ?? "?"} |`);
  }
  L.push(`| max | ${fmtCZ(vals[vals.length - 1])} | ${bandFor(vals[vals.length - 1])?.label ?? "?"} |`);
  L.push("");
  const maxShare = Math.max(...Object.values(bands)) / vals.length;
  L.push("| Bånd | Antal | Andel | |");
  L.push("|---|--:|--:|---|");
  for (const b of PYRAMID_BANDS) {
    const n = bands[b.key];
    const share = n / vals.length;
    const bar = "█".repeat(Math.max(1, Math.round((share / maxShare) * 30)));
    L.push(`| ${b.label} | ${fmtCZ(n)} | ${(share * 100).toFixed(1)}% | \`${bar}\` |`);
  }
  L.push("");
  L.push(`Design-pyramiden 12/60/230/500 (#1194) gælder det FIKTIVE launch-felt på 800 (genereres ved relaunch-swap 20/6; verificeret i \`fictionalLaunchPopulation.test.js\`: 12/68/203/517). Tabellen her er hele prod-feltet (${valued.filter((r) => !r.fictional).length} virkelige + ${valued.filter((r) => r.fictional).length} fiktive aktive) — forventningen er en bund-tung peloton-pyramide, ikke 12/60/230/500.`);
  L.push("");

  L.push("## 4. Outliers — de 10 ryttere hvor modellen gætter mest");
  L.push("");
  L.push(`Modellen er anchor-kalibreret på output-intervallet [${range.min.toFixed(1)}, ${range.max.toFixed(1)}]. Udenfor er værdien ekstrapoleret (under bund-anchoren) eller klampet (over \`output_max\`, Ward-guarden fra 10/6). ${fmtCZ(nBelow)} aktive (${((nBelow / valued.length) * 100).toFixed(1)}% af feltet) ligger under intervallet, ${fmtCZ(nAbove)} over — men de ${fmtCZ(nBelow)} under udgør kun ${((valueBelow / valueTotal) * 100).toFixed(2)}% af feltets samlede værdi: ekstrapolationen gætter altså udelukkende i den billige ende. Overlap med bund-20 er forventet — bunden ER der hvor modellen har mindst anchor-støtte.`);
  L.push("");
  L.push("| Rytter | Type | Alder | Output O | Speciale | Snit | Type-offset | base_value (CZ$) | Hvorfor |");
  L.push("|---|---|--:|--:|--:|--:|--:|--:|---|");
  for (const r of outliers) {
    const offMult = Math.exp(model.offset?.[r.primary_type] ?? 0);
    const why = r.direction === "under"
      ? `O ${r.distance.toFixed(1)} under bund-anchor (${range.min.toFixed(1)}) — ekstrapoleret`
      : `O ${r.distance.toFixed(1)} over output_max (${range.max.toFixed(1)}) — klampet til Pogačar-niveau`;
    L.push(
      `| ${r.name} | ${r.primary_type ?? "?"} | ${r.age ?? "?"} | ${r.output.toFixed(1)} | ${r.spec.toFixed(1)} | ${r.mean.toFixed(1)} | ×${offMult.toFixed(2)} | ${fmtCZ(r.baseValue)} | ${why} |`
    );
  }
  L.push("");
  L.push("Værdi-drivere pr. række: `ln(v) = a + b·O + c·O² + offset[type]`, hvor O = 0,5·speciale + 0,5·snit. Kolonnerne viser præcis de inputs der sætter værdien.");
  L.push("");

  L.push(`## 5. Anchor-afvigelser — de ${model.n_anchor} fit-anchors (predicted vs dit mål)`);
  L.push("");
  L.push("| Anchor | Type | Output | Mål (CZ$) | Predicted (CZ$) | × af mål | Prod nu (CZ$) |");
  L.push("|---|---|--:|--:|--:|--:|--:|");
  for (const a of anchorRows) {
    const flag = a.ratio > 2 || a.ratio < 0.5 ? " ⚠" : "";
    L.push(
      `| ${a.name} | ${a.type} | ${a.output.toFixed(1)} | ${fmtCZ(a.target)} | ${fmtCZ(a.predicted)} | ×${a.ratio.toFixed(2)}${flag} | ${a.prodNow != null ? fmtCZ(a.prodNow) : "ikke fundet"} |`
    );
  }
  L.push("");
  L.push(`${anchorFlags.length} anchors afviger mere end ×2/÷2 fra dit mål${anchorFlags.length ? ` (${anchorFlags.map((a) => a.name).join(", ")})` : ""}. R²(log) ${model.r2_log} betyder at kurven samlet følger dine anchors tæt; enkelt-afvigelser er anchor/ability-uenigheder, ikke fit-fejl.`);
  L.push("");

  L.push("## 6. Ejer-beslutning");
  L.push("");
  L.push("**Godkend cutover? (ja/nej)**");
  L.push("");
  L.push("- **Ja** → #1101 slice 2-gaten er endeligt kvitteret (cutoveren kørte 10/6, PR #1201, og står). #1196 kan lukkes.");
  L.push("- **Nej** → tabel 4+5 ER fejl-rapporten: justér/tilføj anchors i `backend/lib/riderValuationAnchors.json` → `node scripts/fitRiderValuationModel.js` → `node scripts/backfillRiderBaseValue.js` → kør dette scorecard igen.");
  L.push("");

  const md = L.join("\n") + "\n";

  // --- Output ---
  if (OUT_PATH) {
    writeFileSync(OUT_PATH, md);
    console.log(`✅ Skrev rapport: ${OUT_PATH}`);
  } else {
    console.log(md);
  }
  console.log(`Scorecard: ${valued.length} værdisatte aktive · gates: ${gates.filter((g) => g.ok).length}/${gates.length} grønne`);
  for (const g of gates) console.log(`  ${g.ok ? "✅" : "❌"} ${g.name} — ${g.detail}`);

  if (!allGatesOk) {
    console.error("\n❌ SCORECARD: mindst én hård sanity-gate fejlede (se ovenfor).");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("❌", err);
  process.exit(1);
});
