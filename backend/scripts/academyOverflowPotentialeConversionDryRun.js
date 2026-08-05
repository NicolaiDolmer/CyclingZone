// Dry-run (#2699): akademi-overflow-talenter på udløbs-auktion er ikke overpowered på
// NUVÆRENDE evner (verificeret 23/7 + genverificeret 27/7), men bærer et livstidsloft
// (potentiale → hidden_potential + ability_caps) fra generatoren FØR #2064 S0's
// rekalibrering (19/7, commit 0e5f54bd). Det gamle "seriøs"-lodtrækning gav
// potentiale uniform 2.0-4.5 (65-70%) / 4.5-6.0 (30-35%, "seriøs") — middel ≈4.1 på
// 1-6-skalaen. Det nye trin (drawPotentiale, geometrisk 0.55-decay) middel ≈1.6, og
// PRODUCERER I DAG (generation_tag='s1') akademi-overflow med snit-potentiale 1.53 —
// den population dette script forsøger at matche retroaktivt.
//
// ROD-ÅRSAG (kæde): riders.potentiale (legacy-lodtrækning, for høj) →
// abilityDerivation.js hidden_potential = scoreFrac(0.60·potential + 0.25·youth + 0.15·hashNoise(id))
// → riderProgression.js buildYouthCaps/youthLoftForPotential (loftByPotential-ankre
// 1:35 … 6:88) → rider_derived_abilities.ability_caps. base_value (career-NPV v4,
// riderCareerNpv.js) fremskriver evner MOD dette loft — derfor bliver disse ryttere
// "færdigudviklede som 27-årige" over de næste sæsoner, selvom de er svage NU.
//
// SCOPE: kun ryttere der kom via akademi-intake-udløbs-auktion (auctions.status=
// 'completed' AND expired_intake_team_id IS NOT NULL) OG stadig bærer legacy-
// generation (riders.generation_tag IS NULL — s1-tag = allerede korrekt, rørt ikke).
// Fredede aktive ungdomsauktioner (44 stk, ejer-beslutning 19/7) er UDENFOR denne
// kohorte i forvejen (de har ikke expired_intake_team_id).
//
// KONVERTERING (foreslået, Option A — "redraw", se PR #2699 for Option B-sammenligning):
//   nyt potentiale = drawPotentiale(makeRng(seedFromId(rider.id)))  — SAMME funktion
//   som dagens akademi-generator bruger, seedet deterministisk pr. rytter-id (ingen
//   delt rng-strøm at holde styr på, 100% reproducerbart).
//   nyt hidden_potential + ability_caps genberegnes fra det nye potentiale via
//   PRÆCIS samme formler som findes for alle andre ryttere (abilityDerivation.js /
//   riderProgression.buildCapsForRider). GULVET i buildCapsForRider
//   (loft = max(tapered_absolut_loft, nuværende_evne)) sikrer at INGEN spiller
//   mister evne rytteren allerede har — kun det FREMTIDIGE loft sænkes.
//   Nuværende rå stats/abilities/base_value RØRES IKKE her (de er ikke problemet).
//
// DETTE SCRIPT ER READ-ONLY (ren rapport, ingen --live/apply-vej). Balance-følsom
// prod-mutation på spiller-ejede ryttere kræver ejer-godkendt kurve FØRST (jf.
// feedback_owner_reviews_live_before_destructive_ops + #2699 PR-scorecard). Når
// kurven er godkendt, tilføjes en --live-gren efter samme mønster som
// backfillAbilityProgressCaps.js — IKKE i denne PR.
//
//   node scripts/academyOverflowPotentialeConversionDryRun.js

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAllRows } from "../lib/supabasePagination.js";
import { VISIBLE_ABILITIES } from "../lib/abilityDerivation.js";
import { drawPotentiale } from "../lib/academyGenerator.js";
import { makeRng } from "../lib/fictionalRiderGenerator.js";
import { buildCapsForRider, seededUnit } from "../lib/riderProgression.js";
import { predictBaseValueV4 } from "../lib/riderCareerNpv.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const riderValuationModelV4 = JSON.parse(readFileSync(join(__dirname, "../lib/riderValuationModelV4.json"), "utf8"));

// Deterministisk 32-bit seed pr. rytter-id (samme FNV-1a-familie som
// abilityDerivation.hashNoise / riderProgression.seededUnit — ingen ny hash-algoritme).
function seedFromId(id) {
  const s = String(id ?? "");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function scoreFrac(f) {
  return Math.max(1, Math.min(99, Math.round(1 + Math.max(0, Math.min(1, f)) * 98)));
}

// Spejler abilityDerivation.js' hidden_potential-formel (private i den fil — dupliceret
// bevidst minimalt her frem for at eksportere en intern helper for ét kald-sted).
function computeHiddenPotential(potentiale, age, id) {
  const youth = Math.max(0, Math.min(1, (32 - age) / (32 - 21)));
  const potential = Math.max(0, Math.min(1, (Number(potentiale) - 1) / 5));
  return scoreFrac(0.6 * potential + 0.25 * youth + 0.15 * seededUnit(id));
}

function ageFromBirthdate(birthdate, asOfDate) {
  if (!birthdate) return null;
  const bd = new Date(birthdate);
  let age = asOfDate.getFullYear() - bd.getFullYear();
  const m = asOfDate.getMonth() - bd.getMonth();
  if (m < 0 || (m === 0 && asOfDate.getDate() < bd.getDate())) age--;
  return age;
}

function capMax(caps) {
  return Math.max(...VISIBLE_ABILITIES.map((k) => caps?.[k] ?? 0));
}

function mean(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

// REN orkestrering (DB + model injiceres) — testbar uden createClient.
export async function computeAcademyOverflowConversionPlan({ supabase, model = riderValuationModelV4, asOfDate = new Date(), log = console.log }) {
  // 1) Kohorte: legacy (generation_tag NULL) ryttere solgt via akademi-udløbs-auktion.
  const auctionRows = await fetchAllRows(() =>
    supabase
      .from("auctions")
      .select("rider_id, current_price, starting_price")
      .not("expired_intake_team_id", "is", null)
      .eq("status", "completed")
      .order("id"));
  const riderIds = auctionRows.map((a) => a.rider_id);
  if (riderIds.length === 0) {
    log("Ingen fuldførte akademi-udløbs-auktioner fundet.");
    return { candidates: 0, results: [] };
  }
  const priceByRider = new Map(auctionRows.map((a) => [a.rider_id, a.current_price]));

  const riderCols = "id, firstname, lastname, birthdate, potentiale, primary_type, secondary_type, base_value, generation_tag";
  const abilityCols = ["rider_id", "ability_caps", "hidden_potential", ...VISIBLE_ABILITIES].join(", ");

  const riderRows = await fetchAllRows(() =>
    supabase.from("riders").select(riderCols).in("id", riderIds).is("generation_tag", null).order("id"));
  const abilityRows = await fetchAllRows(() =>
    supabase.from("rider_derived_abilities").select(abilityCols).in("rider_id", riderRows.map((r) => r.id)).order("rider_id"));
  const abilitiesById = new Map(abilityRows.map((a) => [a.rider_id, a]));

  log(`Kohorte (legacy akademi-overflow, generation_tag NULL, solgt via udløbs-auktion): ${riderRows.length}`);

  const results = [];
  for (const r of riderRows) {
    const abilityRow = abilitiesById.get(r.id);
    if (!abilityRow) continue;
    const age = ageFromBirthdate(r.birthdate, asOfDate);
    if (age == null) continue;

    const abilities = {};
    for (const k of VISIBLE_ABILITIES) abilities[k] = abilityRow[k] ?? null;

    const oldPot = Number(r.potentiale);
    const rng = makeRng(seedFromId(r.id));
    const newPot = drawPotentiale(rng);

    const oldHidden = abilityRow.hidden_potential;
    const newHidden = computeHiddenPotential(newPot, age, r.id);

    const oldCaps = abilityRow.ability_caps;
    const newCaps = buildCapsForRider(abilities, { potentiale: newPot, age }, r.primary_type, r.secondary_type);

    const ctx = (pot) => ({ primary_type: r.primary_type, potentiale: pot, age });
    const oldBaseSim = predictBaseValueV4(ctx(oldPot), abilities, model);
    const newBaseSim = predictBaseValueV4(ctx(newPot), abilities, model);

    results.push({
      id: r.id,
      name: `${r.firstname} ${r.lastname}`,
      age,
      primaryType: r.primary_type,
      oldPot, newPot,
      oldHidden, newHidden,
      oldCapMax: capMax(oldCaps), newCapMax: capMax(newCaps),
      oldBaseSim, newBaseSim,
      prodBaseValue: r.base_value,
      finalAuctionPrice: priceByRider.get(r.id) ?? null,
    });
  }

  const oldPots = results.map((r) => r.oldPot);
  const newPots = results.map((r) => r.newPot);
  const oldCaps = results.map((r) => r.oldCapMax);
  const newCaps = results.map((r) => r.newCapMax);
  const oldBaseSum = results.reduce((a, r) => a + (r.oldBaseSim || 0), 0);
  const newBaseSum = results.reduce((a, r) => a + (r.newBaseSim || 0), 0);
  const affected = results.filter((r) => r.newPot < r.oldPot).length;

  log(`Potentiale — foer middel ${mean(oldPots).toFixed(2)} / efter middel ${mean(newPots).toFixed(2)}`);
  log(`Evneloft (max) — foer median ${median(oldCaps)} / efter median ${median(newCaps)}`);
  log(`Simuleret base_value (uaendrede nuvaerende evner, kun potentiale skiftet) — sum foer ${Math.round(oldBaseSum)} / efter ${Math.round(newBaseSum)} (${(((newBaseSum - oldBaseSum) / oldBaseSum) * 100).toFixed(1)}%)`);
  log(`Ryttere ramt: ${affected} / ${results.length}`);
  log("DRY-RUN — ingen writes. Ingen --live-gren findes endnu (afventer ejer-godkendt kurve, se PR #2699).");

  return { candidates: results.length, affected, oldBaseSum, newBaseSum, results };
}

// ── CLI ───────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith("academyOverflowPotentialeConversionDryRun.js")) {
  dotenv.config({ path: join(__dirname, "../.env"), quiet: true });
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("FEJL: Mangler SUPABASE_URL eller SUPABASE_SERVICE_KEY");
    process.exit(1);
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  console.log("=== #2699 akademi-overflow potentiale-konvertering (DRY-RUN) ===");
  computeAcademyOverflowConversionPlan({ supabase })
    .then((r) => { console.log(`OK: ${r.candidates} kandidater, ${r.affected} ramt.`); process.exit(0); })
    .catch((err) => { console.error("FEJL:", err.message); process.exit(1); });
}
