// #5443 runde 5 · Marked v3 + den samlede værdi-begivenhed. READ-ONLY.
//
// Markedsmodellen er hidtil kun trænet på de 538 auktioner (90 dage) hvor mindst
// to forskellige hold bød prisen op, plus 191 forhandlede handler. De øvrige
// 4.918 afsluttede auktioner er smidt væk — og to af dem bærer ægte information:
//
//   TOM AUKTION (0 bud, menneske-sælger, løb fuld længde): ingen ville betale
//   startprisen. Det er en ØVRE grænse: rytteren er højst startprisen værd.
//   Kun nedad, aldrig opad.
//
//   TABENDE BUD (næsthøjeste bud fra et andet hold end vinderen): nogen var
//   villig til at betale det. Det er et GULV. Aldrig over slutprisen.
//
// Begge er BEGRÆNSNINGER på prisen, ikke rækker i regressionen — det er den
// ærlige form: en tom auktion siger "ikke mere end X", ikke "præcis X".
// Byttehandler og én-budgiver-auktioner holdes ude (ingen konkurrence).
//
// Scriptet fitter modellen, måler evidens-dækning med og uden de nye signaler,
// kører en misbrugs-prøve, og laver tørkørslen af den samlede begivenhed
// (formel + marked) ved flere markedsvægte, med og uden ugeloftet.
//
//   infisical run --env=prod --silent -- node scripts/dev/marketV3AndEvent5443.mjs \
//     --model=lib/riderValuationModelV4.candidate-5443-V5.json --out=<mappe>

import "dotenv/config";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

import { fetchAllRows } from "../../lib/supabasePagination.js";
import { selectInChunks } from "../../lib/dbChunk.js";
import { ABILITY_KEYS } from "../../lib/riderTypes.js";
import { ABILITY_KEYS as RACE_ABILITY_KEYS } from "../../lib/raceSimulator.js";
import { ageForSeason } from "../../lib/riderSeasonAge.js";
import { applyTypeDampening } from "../../lib/riderValuationTypeDampening.js";
import { recomputeRiderValue } from "../../lib/riderValueRefresh.js";
import { meanAbilityScore } from "../../lib/marketValueModel.js";
import { olsSolve } from "../../lib/riderValuationFit.js";
import { ratingFromAbilities } from "../../lib/scoutingReport.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LIB = join(__dirname, "../../lib");
const BACKEND = join(__dirname, "../..");

const arg = (name, def) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(`--${name}=`.length) : def;
};
const MODEL_PATH = resolve(join(BACKEND, String(arg("model", "lib/riderValuationModelV4.candidate-5443-V5.json"))));
const ROLE_WEIGHTS = arg("weights", "lib/weights/valuationWeights.candidate-5443-c1.json");
const OUT_DIR = resolve(arg("out", join(BACKEND, "../balance-internals/2026-09-20-5443-v4-refit/marked-v3")));
const DAYS = Number(arg("days", 90));
const K_EVIDENCE = Number(arg("k", 12));
const WEIGHTS_GRID = String(arg("weights-grid", "0,0.15,0.30,0.50")).split(",").map(Number);
const WEEKLY_CAP = Number(arg("weekly-cap", 0.25));

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ SUPABASE_URL / SUPABASE_SERVICE_KEY mangler. Kør via infisical.");
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

const n0 = (x) => Number(x) || 0;
const fmt = (x) => (x == null || !Number.isFinite(Number(x)) ? "—" : Math.round(Number(x)).toLocaleString("da-DK"));
const pct = (x) => (x == null || !Number.isFinite(x) ? "—" : `${x >= 0 ? "+" : ""}${x.toFixed(1)} %`);
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const quant = (sorted, q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : null);

async function main() {
  console.log("=== #5443 runde 5 · marked v3 + samlet begivenhed (READ-ONLY) ===");

  const baseline = JSON.parse(readFileSync(join(LIB, "riderTypesBaseline.json"), "utf8"));
  const youthBaseline = JSON.parse(readFileSync(join(LIB, "riderTypesBaselineYouth.json"), "utf8"));
  const formulaModel = applyTypeDampening(JSON.parse(readFileSync(MODEL_PATH, "utf8")));
  console.log(`Formel-model: ${MODEL_PATH}`);

  const { data: season } = await sb.from("seasons").select("number").eq("status", "active").maybeSingle();
  const seasonNumber = season?.number ?? 3;

  const riders = await fetchAllRows(() => sb.from("riders")
    .select("id, firstname, lastname, team_id, is_retired, is_academy, primary_type, secondary_type, valuation_type, base_value, birthdate, potentiale, popularity, archetype_draw")
    .order("id"));
  for (const r of riders) r.age = ageForSeason(r.birthdate, seasonNumber);
  const riderById = new Map(riders.map((r) => [r.id, r]));

  const teams = await fetchAllRows(() => sb.from("teams").select("id, name, is_ai, is_bank, is_test_account, is_frozen").order("id"));
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const isHumanTeam = (id) => { const t = id ? teamById.get(id) : null; return Boolean(t && t.is_ai === false && t.is_bank !== true && t.is_test_account !== true && t.is_frozen !== true); };

  const abilityCols = [...new Set([...ABILITY_KEYS, ...RACE_ABILITY_KEYS])];
  const abilities = await fetchAllRows(() => sb.from("rider_derived_abilities")
    .select(`rider_id, ability_caps, ${abilityCols.join(", ")}`).order("rider_id"));
  const abById = new Map(abilities.map((a) => [a.rider_id, a]));

  // ── Handelsdata ───────────────────────────────────────────────────────────
  const sinceIso = new Date(Date.now() - DAYS * 86400000).toISOString();
  const auctions = await fetchAllRows(() => sb.from("auctions")
    .select("id, rider_id, seller_team_id, starting_price, current_price, current_bidder_id, status, is_guaranteed_sale, extension_count, actual_end, calculated_end")
    .gte("actual_end", sinceIso).eq("status", "completed").order("id"));
  const { data: bidsRaw, error: bidErr } = await selectInChunks({
    supabase: sb, table: "auction_bids", columns: "auction_id, team_id, amount, bid_time",
    inColumn: "auction_id", ids: auctions.map((a) => a.id),
  });
  if (bidErr) throw new Error(`auction_bids: ${bidErr.message}`);
  const bidsByAuction = new Map();
  for (const b of bidsRaw || []) {
    if (!bidsByAuction.has(b.auction_id)) bidsByAuction.set(b.auction_id, []);
    bidsByAuction.get(b.auction_id).push(b);
  }
  const transfers = await fetchAllRows(() => sb.from("transfer_offers")
    .select("id, rider_id, seller_team_id, buyer_team_id, offer_amount, status, updated_at")
    .eq("status", "accepted").gte("updated_at", sinceIso).order("id"));
  console.log(`Auktioner: ${auctions.length} · bud: ${(bidsRaw || []).length} · accepterede forhandlede handler: ${transfers.length}`);

  // ── Klassificér ───────────────────────────────────────────────────────────
  const qualified = [];     // traener modellen
  const emptyCaps = [];     // OEVRE graenser
  const bidFloors = [];     // NEDRE graenser
  const funnel = { auktioner: auctions.length, uden_bud: 0, uden_bud_menneske_fuld_laengde: 0, een_budgiver: 0, kvalificeret: 0, garanteret_salg: 0, transfers: transfers.length, transfers_menneske: 0 };

  for (const a of auctions) {
    if (a.is_guaranteed_sale) { funnel.garanteret_salg++; continue; }
    const bids = bidsByAuction.get(a.id) || [];
    const bidders = new Set(bids.map((b) => b.team_id));
    const sellerHuman = isHumanTeam(a.seller_team_id);
    // "Loeb fuld laengde" = auktionen naaede sin beregnede sluttid (ikke annulleret
    // eller afkortet). Uden det ville en afbrudt auktion taelle som "ingen ville
    // betale", hvilket den ikke er.
    const ranFull = a.actual_end && a.calculated_end && new Date(a.actual_end) >= new Date(a.calculated_end);
    if (bidders.size === 0) {
      funnel.uden_bud++;
      if (sellerHuman && ranFull && n0(a.starting_price) > 0) {
        funnel.uden_bud_menneske_fuld_laengde++;
        emptyCaps.push({ rider_id: a.rider_id, cap: n0(a.starting_price), auction_id: a.id, at: a.actual_end });
      }
      continue;
    }
    if (bidders.size === 1) { funnel.een_budgiver++; continue; }
    if (n0(a.current_price) > n0(a.starting_price)) {
      funnel.kvalificeret++;
      qualified.push({ rider_id: a.rider_id, price: n0(a.current_price), at: a.actual_end, kind: "auction" });
      // Tabende bud: hoejeste bud fra et ANDET hold end vinderen.
      const losing = bids.filter((b) => b.team_id !== a.current_bidder_id).map((b) => n0(b.amount));
      if (losing.length) {
        const floor = Math.min(Math.max(...losing), n0(a.current_price));
        if (floor > 0) bidFloors.push({ rider_id: a.rider_id, floor, auction_id: a.id, at: a.actual_end });
      }
    }
  }
  for (const t of transfers) {
    if (!isHumanTeam(t.seller_team_id) || !isHumanTeam(t.buyer_team_id)) continue;
    funnel.transfers_menneske++;
    qualified.push({ rider_id: t.rider_id, price: n0(t.offer_amount), at: t.updated_at, kind: "transfer" });
  }
  console.log(`Tragt: ${JSON.stringify(funnel)}`);
  console.log(`Kvalificeret: ${qualified.length} · tomme auktioner som loft: ${emptyCaps.length} · tabende bud som gulv: ${bidFloors.length}`);

  // ── Features + fit (hedonisk OLS paa den NYE basis) ────────────────────────
  // O = rytterens rating i sin PRIMAERE rolle (visnings-opskriften) - samme tal
  // spilleren ser, og samme basis som formel-modellen. v2 brugte det flade snit
  // af alle evner og `valuation_type`; begge dele er afloest.
  const featuresFor = (riderId) => {
    const r = riderById.get(riderId);
    const ab = r ? abById.get(riderId) : null;
    if (!r || !ab || !r.primary_type || r.age == null) return null;
    const O = ratingFromAbilities(ab, r.primary_type);
    if (!Number.isFinite(O)) return null;
    return { O, flatO: meanAbilityScore(ab), age: r.age, potentiale: n0(r.potentiale), is_youth: r.is_academy === true, type: r.primary_type, popularity: n0(r.popularity) };
  };

  const TYPES = [...new Set(riders.map((r) => r.primary_type).filter(Boolean))].sort();
  const refType = "climber";
  const rows = [];
  for (const q of qualified) {
    const f = featuresFor(q.rider_id);
    if (!f || !(q.price > 0)) continue;
    rows.push({ ...q, ...f, y: Math.log(q.price) });
  }
  rows.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  console.log(`Fit-raekker med features: ${rows.length}`);

  const design = (f) => [1, f.O, f.O * f.O, f.age, f.age * f.age, f.potentiale, f.is_youth ? 1 : 0,
    ...TYPES.filter((t) => t !== refType).map((t) => (f.type === t ? 1 : 0))];

  // Tidsbaseret holdout: sidste 20 % er testdata (ikke-cirkulaert: modellen ser
  // dem aldrig, og de er alle konkurrenceprissatte).
  const cut = Math.floor(rows.length * 0.8);
  const train = rows.slice(0, cut);
  const test = rows.slice(cut);
  const coefVec = olsSolve(train.map(design), train.map((r) => r.y));
  const predictLn = (f) => design(f).reduce((s, x, i) => s + x * coefVec[i], 0);
  const predict = (f) => Math.exp(predictLn(f));

  const errs = test.map((r) => predict(r) - r.price);
  const absErrs = errs.map(Math.abs).sort((a, b) => a - b);
  const apes = test.map((r) => Math.abs(predict(r) - r.price) / r.price).sort((a, b) => a - b);
  const holdout = {
    n: test.length,
    mae: absErrs.length ? absErrs.reduce((a, b) => a + b, 0) / absErrs.length : null,
    median_abs_err: median(absErrs),
    median_err_signed: median(errs),
    mape: apes.length ? apes.reduce((a, b) => a + b, 0) / apes.length : null,
    median_ape: median(apes),
  };
  console.log(`Holdout (n=${holdout.n}): MAE ${fmt(holdout.mae)} · median abs-fejl ${fmt(holdout.median_abs_err)} · median fortegns-fejl ${fmt(holdout.median_err_signed)} · MAPE ${(holdout.mape * 100).toFixed(1)} % · median APE ${(holdout.median_ape * 100).toFixed(1)} %`);

  // ── Evidens pr. rytter ────────────────────────────────────────────────────
  // n = kvalificerede handler med SAMME type inden for ±5 O-point og ±3 aar.
  // De nye signaler taeller med som evidens for netop DEN rytter (direkte
  // observation), ikke som nabolags-evidens.
  const salesIndex = rows.map((r) => ({ O: r.O, age: r.age, type: r.type }));
  const capsByRider = new Map();
  for (const e of emptyCaps) {
    if (!capsByRider.has(e.rider_id)) capsByRider.set(e.rider_id, []);
    capsByRider.get(e.rider_id).push(e.cap);
  }
  const floorsByRider = new Map();
  for (const e of bidFloors) {
    if (!floorsByRider.has(e.rider_id)) floorsByRider.set(e.rider_id, []);
    floorsByRider.get(e.rider_id).push(e.floor);
  }

  const active = riders.filter((r) => !r.is_retired && abById.has(r.id) && r.base_value > 0);
  const evidence = [];
  for (const r of active) {
    const f = featuresFor(r.id);
    if (!f) continue;
    let nNeighbours = 0;
    for (const s of salesIndex) {
      if (s.type !== f.type) continue;
      if (Math.abs(s.O - f.O) > 5) continue;
      if (Math.abs(s.age - f.age) > 3) continue;
      nNeighbours++;
    }
    const nOwnCaps = (capsByRider.get(r.id) || []).length;
    const nOwnFloors = (floorsByRider.get(r.id) || []).length;
    evidence.push({ id: r.id, f, nNeighbours, nOwnCaps, nOwnFloors });
  }
  const Z = (n) => n / (n + K_EVIDENCE);
  const withOld = evidence.filter((e) => e.nNeighbours > 0).length;
  const withNew = evidence.filter((e) => e.nNeighbours + e.nOwnCaps + e.nOwnFloors > 0).length;
  const zOld = evidence.map((e) => Z(e.nNeighbours));
  const zNew = evidence.map((e) => Z(e.nNeighbours + e.nOwnCaps + e.nOwnFloors));
  const meanOf = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  console.log(`Evidens: ${withOld}/${evidence.length} ryttere uden de nye signaler, ${withNew}/${evidence.length} med. Gns. Z ${meanOf(zOld).toFixed(3)} → ${meanOf(zNew).toFixed(3)}`);

  // ── Markedsprædiktion med graenser ────────────────────────────────────────
  function marketPredFor(e) {
    let p = predict(e.f);
    const caps = capsByRider.get(e.id);
    const floors = floorsByRider.get(e.id);
    let capped = false;
    let floored = false;
    if (caps?.length) { const c = Math.min(...caps); if (p > c) { p = c; capped = true; } }
    if (floors?.length) { const fl = Math.max(...floors); if (p < fl) { p = fl; floored = true; } }
    return { pred: p, capped, floored };
  }
  let nCapped = 0;
  let nFloored = 0;
  const capPull = [];
  for (const e of evidence) {
    const raw = predict(e.f);
    const { pred, capped, floored } = marketPredFor(e);
    if (capped) { nCapped++; capPull.push((pred / raw - 1) * 100); }
    if (floored) nFloored++;
    e.marketPred = pred;
    e.marketRaw = raw;
  }
  capPull.sort((a, b) => a - b);
  console.log(`Graenser: ${nCapped} ryttere traekkes NED af en tom auktion (median ${median(capPull)?.toFixed(1)} %), ${nFloored} loeftes af et tabende bud.`);

  // ── Den samlede begivenhed ────────────────────────────────────────────────
  const evById = new Map(evidence.map((e) => [e.id, e]));
  const scenarios = [];
  for (const w of WEIGHTS_GRID) {
    for (const useCap of [true, false]) {
      if (w === 0 && useCap === false) continue; // identisk med w=0 med loft
      const out = { weight: w, weekly_cap: useCap ? WEEKLY_CAP : null, rows: [] };
      for (const r of active) {
        const ab = abById.get(r.id);
        const res = recomputeRiderValue({ ...r, valuation_type: r.primary_type }, ab, baseline, formulaModel,
          { typeAbilities: ab.ability_caps, youthBaseline });
        const formula = res?.base_value;
        if (!formula) continue;
        const e = evById.get(r.id);
        const z = e ? Z(e.nNeighbours + e.nOwnCaps + e.nOwnFloors) : 0;
        const wEff = w * z;
        let target = (1 - wEff) * formula + wEff * (e?.marketPred ?? formula);
        if (useCap && formula > 0) {
          // Ugeloftet gaelder KUN markedsdelen. Saadan koerer det ogsaa i
          // produktionen: soendags-pipelinen skriver FOERST formel-vaerdien, og
          // markedsblendet clamper derefter mod DEN (marketValueSundaySweep:
          // applyWeeklyCap(current = den friske v4-vaerdi, target = blendet)).
          // Loftet bremser altsaa ikke selve formel-begivenheden - kun hvor
          // langt markedet maa trække vaerdien vaek fra formlen paa een uge.
          const lo = formula * (1 - WEEKLY_CAP);
          const hi = formula * (1 + WEEKLY_CAP);
          const capped = Math.max(lo, Math.min(hi, target));
          out.rows.push({ id: r.id, stored: r.base_value, formula, target, final: Math.max(1, Math.round(capped)), bound: capped !== target, human: isHumanTeam(r.team_id), z });
        } else {
          out.rows.push({ id: r.id, stored: r.base_value, formula, target, final: Math.max(1, Math.round(target)), bound: false, human: isHumanTeam(r.team_id), z });
        }
      }
      scenarios.push(out);
    }
  }

  const summarize = (rows2) => {
    const sumB = rows2.reduce((s, x) => s + x.stored, 0);
    const sumA = rows2.reduce((s, x) => s + x.final, 0);
    const ratios = rows2.map((x) => x.final / x.stored);
    return {
      n: rows2.length,
      sum_pct: sumB ? (sumA / sumB - 1) * 100 : null,
      up: ratios.filter((r) => r > 1.01).length,
      down: ratios.filter((r) => r < 0.99).length,
      lose_25: ratios.filter((r) => r <= 0.75).length,
      lose_50: ratios.filter((r) => r <= 0.5).length,
      double: ratios.filter((r) => r > 2).length,
      median_pct: median(ratios.map((r) => (r - 1) * 100)),
      bound: rows2.filter((x) => x.bound).length,
    };
  };

  const table = [];
  for (const sc of scenarios) {
    const all = summarize(sc.rows);
    const human = summarize(sc.rows.filter((x) => x.human));
    // Hvor binder loftet? Top- vs bund-decil paa dagens vaerdi.
    const sorted = [...sc.rows].sort((a, b) => a.stored - b.stored);
    const d1 = sorted.slice(0, Math.floor(sorted.length / 10));
    const d10 = sorted.slice(-Math.floor(sorted.length / 10));
    table.push({
      weight: sc.weight, cap: sc.weekly_cap, all, human,
      bound_bottom_decile: d1.filter((x) => x.bound).length,
      bound_top_decile: d10.filter((x) => x.bound).length,
    });
    console.log(`vaegt ${(sc.weight * 100).toFixed(0)} % ${sc.weekly_cap ? "med loft" : "UDEN loft"}: Σ alle ${pct(all.sum_pct)} · Σ menneske ${pct(human.sum_pct)} · ned ${human.down} · ≥25 % ${human.lose_25} · ≥50 % ${human.lose_50} · loft binder ${all.bound} (bund-decil ${d1.filter((x) => x.bound).length}, top-decil ${d10.filter((x) => x.bound).length})`);
  }

  // ── Misbrugs-proeve ───────────────────────────────────────────────────────
  // Hvor meget kan EEN observation flytte een rytters vaerdi ved hver vaegt?
  // Testrytteren er medianrytteren blandt dem UDEN evidens i dag (n=0), fordi
  // det er der en enkelt observation har stoerst relativ vaegt.
  const noEvidence = evidence.filter((e) => e.nNeighbours === 0 && e.nOwnCaps === 0 && e.nOwnFloors === 0)
    .sort((a, b) => (riderById.get(a.id).base_value ?? 0) - (riderById.get(b.id).base_value ?? 0));
  const probe = noEvidence[Math.floor(noEvidence.length / 2)] ?? evidence[0];
  const probeRider = riderById.get(probe.id);
  const abuse = { rider: `${probeRider.firstname} ${probeRider.lastname}`.trim(), stored: probeRider.base_value, cases: [] };
  const probeAb = abById.get(probe.id);
  const probeFormula = recomputeRiderValue({ ...probeRider, valuation_type: probeRider.primary_type }, probeAb, baseline, formulaModel, { typeAbilities: probeAb.ability_caps, youthBaseline })?.base_value ?? probeRider.base_value;
  for (const w of WEIGHTS_GRID.filter((x) => x > 0)) {
    for (const [label, nObs, predOverride] of [
      ["een aftalt handel til 10x", 1, probeFormula * 10],
      ["eet hoejt tabende bud til 10x (gulv)", 1, probeFormula * 10],
      ["een bevidst tom auktion med lav startpris (loft)", 1, probeFormula * 0.1],
    ]) {
      const z = nObs / (nObs + K_EVIDENCE);
      const target = (1 - w * z) * probeFormula + w * z * predOverride;
      abuse.cases.push({ weight: w, label, z, uden_loft_pct: (target / probeFormula - 1) * 100, med_loft_pct: Math.max(-WEEKLY_CAP, Math.min(WEEKLY_CAP, target / probeFormula - 1)) * 100 });
    }
  }
  for (const c of abuse.cases) console.log(`misbrug @${(c.weight * 100).toFixed(0)} %: ${c.label} → ${c.uden_loft_pct.toFixed(1)} % uden loft / ${c.med_loft_pct.toFixed(1)} % med loft`);

  mkdirSync(OUT_DIR, { recursive: true });
  const json = {
    meta: { ran_at: new Date().toLocaleString("da-DK", { timeZone: "Europe/Copenhagen" }), model: MODEL_PATH, days: DAYS, K: K_EVIDENCE, weekly_cap: WEEKLY_CAP, season: seasonNumber, role_weights: ROLE_WEIGHTS },
    funnel, n_qualified: rows.length, n_empty_caps: emptyCaps.length, n_bid_floors: bidFloors.length,
    holdout,
    coefficients: { terms: ["a", "O", "O2", "age", "age2", "potentiale", "is_youth", ...TYPES.filter((t) => t !== refType).map((t) => `type_${t}`)], values: coefVec, reference_type: refType },
    evidence: { n_riders: evidence.length, with_old: withOld, with_new: withNew, mean_Z_old: meanOf(zOld), mean_Z_new: meanOf(zNew) },
    bounds: { capped: nCapped, floored: nFloored, cap_pull_median_pct: median(capPull), cap_pull_p10_pct: quant(capPull, 0.1) },
    scenarios: table, abuse,
  };
  writeFileSync(join(OUT_DIR, "marked-v3.json"), JSON.stringify(json, null, 2), "utf8");
  console.log(`\n✅ Skrevet: ${join(OUT_DIR, "marked-v3.json")}`);
  console.log("INTET er skrevet til databasen.");
}

main().catch((e) => { console.error("❌", e.message); console.error(e.stack); process.exit(1); });
