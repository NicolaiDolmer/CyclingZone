// Read-only prod-snapshot til #3564 progressionskaede-analyser (frontloading-maaling,
// kvantil-remap dry-run, #2798-konsekvens-sim). KUN SELECT — INGEN INSERT/UPDATE/DELETE/DDL.
// Kør: infisical run --env=prod -- node backend/scripts/dev/snapshot-3564-progression-chain.mjs
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Mangler SUPABASE secrets (infisical run --env=prod)");
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Output-mappe: sæt SNAPSHOT_OUT_DIR, ellers en dateret mappe under scripts/dev/
// (".snapshots-" er git-ignoreret lokal-only data — snapshots committes ALDRIG).
const OUT_DIR =
  process.env.SNAPSHOT_OUT_DIR ||
  path.join(import.meta.dirname, `.snapshots-3564-${new Date().toISOString().slice(0, 10)}`);
fs.mkdirSync(OUT_DIR, { recursive: true });

const PHYSICAL_KEYS = [
  "climbing", "time_trial", "flat", "tempo", "sprint",
  "acceleration", "punch", "endurance", "recovery", "durability",
];

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Spejler backend/lib/valuationScorecard.js riderAge().
function riderAge(birthdate, asOf) {
  if (!birthdate) return null;
  const b = new Date(birthdate);
  if (Number.isNaN(b.getTime())) return null;
  let age = asOf.getUTCFullYear() - b.getUTCFullYear();
  const beforeBirthday =
    asOf.getUTCMonth() < b.getUTCMonth() ||
    (asOf.getUTCMonth() === b.getUTCMonth() && asOf.getUTCDate() < b.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

function ageBand(age) {
  if (age == null) return "ukendt";
  if (age <= 17) return "16-17";
  if (age <= 19) return "18-19";
  if (age <= 21) return "20-21";
  if (age <= 25) return "22-25";
  if (age <= 30) return "26-30";
  return "31+";
}

async function fetchAllRange(table, cols, filterFn) {
  const out = [];
  const PAGE = 1000;
  let from = 0;
  for (;;) {
    let q = sb.from(table).select(cols).range(from, from + PAGE - 1);
    if (filterFn) q = filterFn(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

async function readAllIn(table, cols, inCol, ids, extra) {
  const out = [];
  const CH = 200;
  for (let i = 0; i < ids.length; i += CH) {
    let q = sb.from(table).select(cols).in(inCol, ids.slice(i, i + CH));
    if (extra) q = extra(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data || []));
  }
  return out;
}

const measuredAt = new Date();
console.log("=== #3564 prod-snapshot (READ-ONLY, kun SELECT) ===");
console.log(`Målingstidspunkt: ${measuredAt.toISOString()} UTC`);

// ── teams.json ──────────────────────────────────────────────────────────
const teamsRaw = await fetchAllRange(
  "teams",
  "id, name, division, league_division_id, is_ai, is_test_account, is_frozen, user_id"
);
const userIds = [...new Set(teamsRaw.map((t) => t.user_id).filter(Boolean))];
const users = userIds.length ? await readAllIn("users", "id, username", "id", userIds) : [];
const userById = new Map(users.map((u) => [u.id, u]));
const teams = teamsRaw.map((t) => ({
  team_id: t.id,
  name: t.name,
  division: t.division,
  league_division_id: t.league_division_id,
  is_ai: t.is_ai,
  is_test_account: !!t.is_test_account,
  is_frozen: !!t.is_frozen,
  manager_user_id: t.user_id,
  manager_display_name: t.user_id ? userById.get(t.user_id)?.username ?? null : null,
}));
fs.writeFileSync(path.join(OUT_DIR, "teams.json"), JSON.stringify(teams, null, 2));
console.log(`teams.json: ${teams.length} rækker`);

const teamById = new Map(teamsRaw.map((t) => [t.id, t]));

// ── riders.json (alle levende, dvs. is_retired ikke true) ────────────────
const ridersRaw = await fetchAllRange(
  "riders",
  "id, firstname, lastname, birthdate, potentiale, primary_type, secondary_type, team_id, base_value, market_value, created_at, salary, is_academy, owner_is_ai, current_production_value",
  (q) => q.or("is_retired.is.null,is_retired.eq.false")
);
console.log(`riders (levende, raw): ${ridersRaw.length}`);

const riderIds = ridersRaw.map((r) => r.id);
const abilitiesRaw = await readAllIn(
  "rider_derived_abilities",
  ["rider_id", ...PHYSICAL_KEYS, "ability_caps"].join(", "),
  "rider_id",
  riderIds
);
const abilityById = new Map(abilitiesRaw.map((a) => [a.rider_id, a]));

const riders = ridersRaw.map((r) => {
  const ab = abilityById.get(r.id);
  const vals = ab ? PHYSICAL_KEYS.map((k) => ab[k]).filter(Number.isFinite) : [];
  const capVals = ab?.ability_caps
    ? PHYSICAL_KEYS.map((k) => ab.ability_caps[k]).filter(Number.isFinite)
    : [];
  const team = r.team_id ? teamById.get(r.team_id) : null;
  return {
    id: r.id,
    firstname: r.firstname,
    lastname: r.lastname,
    birthdate: r.birthdate,
    age: riderAge(r.birthdate, measuredAt),
    potentiale: r.potentiale != null ? Number(r.potentiale) : null,
    primary_type: r.primary_type,
    secondary_type: r.secondary_type,
    team_id: r.team_id,
    owner_kind: !r.team_id ? "free" : team?.is_ai ? "ai" : "human",
    base_value: r.base_value,
    market_value: r.market_value,
    salary: r.salary,
    current_production_value: r.current_production_value,
    created_at: r.created_at,
    is_academy: !!r.is_academy,
    abilities: ab ? Object.fromEntries(PHYSICAL_KEYS.map((k) => [k, ab[k]])) : null,
    best_physical: vals.length ? Math.max(...vals) : null,
    core_median: vals.length ? median(vals) : null,
    max_ability_cap_physical: capVals.length ? Math.max(...capVals) : null,
  };
});
fs.writeFileSync(path.join(OUT_DIR, "riders.json"), JSON.stringify(riders, null, 2));
console.log(`riders.json: ${riders.length} rækker`);

// ── reference384.json ─────────────────────────────────────────────────────
const CUTOFF = "2026-08-09T00:00:00.000Z";
const intakeOffered = await fetchAllRange(
  "academy_intake",
  "id, team_id, rider_id, season_id, is_serious, status, created_at",
  (q) => q.eq("status", "offered").lt("created_at", CUTOFF)
);
const intakeByRider = new Map(intakeOffered.map((i) => [i.rider_id, i]));
// "aldrig fik hold" verificeret via nuværende rider.team_id === null
const refRiders = riders.filter((r) => intakeByRider.has(r.id) && !r.team_id);
const reference384 = refRiders.map((r) => {
  const intake = intakeByRider.get(r.id);
  return {
    id: r.id,
    firstname: r.firstname,
    lastname: r.lastname,
    birthdate: r.birthdate,
    age: r.age,
    potentiale: r.potentiale,
    abilities: r.abilities,
    best_physical: r.best_physical,
    core_median: r.core_median,
    intake_created_at: intake.created_at,
    intake_status: intake.status,
  };
});
fs.writeFileSync(path.join(OUT_DIR, "reference384.json"), JSON.stringify(reference384, null, 2));
const refBest = reference384.map((r) => r.best_physical).filter(Number.isFinite);
const refBestMean = refBest.length ? refBest.reduce((a, b) => a + b, 0) / refBest.length : null;
const refBestMedian = median(refBest);
console.log(`reference384.json: ${reference384.length} rækker (facit: 384, snit 19,4 / median 18)`);
console.log(`  målt: n=${reference384.length}, snit=${refBestMean?.toFixed(2)}, median=${refBestMedian}`);

// ── academy_cohorts.json (ALLE akademi-intake-rækker, alle stier) ─────────
const allIntake = await fetchAllRange(
  "academy_intake",
  "rider_id, team_id, season_id, status, created_at"
);
fs.writeFileSync(path.join(OUT_DIR, "academy_cohorts.json"), JSON.stringify(allIntake, null, 2));
console.log(`academy_cohorts.json: ${allIntake.length} rækker`);

// ── trade_evidence.json ───────────────────────────────────────────────────
const completedAuctions = await fetchAllRange(
  "auctions",
  "rider_id, current_price, actual_end, created_at, status",
  (q) => q.eq("status", "completed")
);
const acceptedOffers = await fetchAllRange(
  "transfer_offers",
  "rider_id, offer_amount, counter_amount, updated_at, created_at, status",
  (q) => q.eq("status", "accepted")
);
const tradeEvidence = [
  ...completedAuctions.map((a) => ({
    rider_id: a.rider_id,
    price: a.current_price,
    date: a.actual_end || a.created_at,
    type: "auction",
  })),
  ...acceptedOffers.map((o) => ({
    rider_id: o.rider_id,
    price: o.counter_amount ?? o.offer_amount,
    date: o.updated_at || o.created_at,
    type: "transfer",
  })),
].filter((t) => t.rider_id);
fs.writeFileSync(path.join(OUT_DIR, "trade_evidence.json"), JSON.stringify(tradeEvidence, null, 2));
console.log(
  `trade_evidence.json: ${tradeEvidence.length} rækker (${completedAuctions.length} auktioner + ${acceptedOffers.length} transfers)`
);

// ── summary.json ────────────────────────────────────────────────────────
const tradedRiderIds = new Set(tradeEvidence.map((t) => t.rider_id));

const ownedCount = riders.filter((r) => r.owner_kind === "human").length;
const aiCount = riders.filter((r) => r.owner_kind === "ai").length;
const freeCount = riders.filter((r) => r.owner_kind === "free").length;

// tier = Math.ceil(potentiale) — matcher facit-tallene (tier6={5.5,6.0}=248, tier5={4.5,5.0}=713).
function tierOfPotentiale(p) {
  if (p == null) return null;
  return Math.ceil(p);
}
const tierCounts = {};
for (let t = 1; t <= 6; t++) tierCounts[t] = riders.filter((r) => tierOfPotentiale(r.potentiale) === t).length;

const bands = ["16-17", "18-19", "20-21", "22-25", "26-30", "31+"];
const tierByBand = {};
for (const b of bands) {
  tierByBand[b] = {};
  for (let t = 1; t <= 6; t++) {
    tierByBand[b][t] = riders.filter((r) => ageBand(r.age) === b && tierOfPotentiale(r.potentiale) === t).length;
  }
}

const pot56Owned = riders.filter((r) => tierOfPotentiale(r.potentiale) >= 5 && r.owner_kind === "human").length;
const pot56Free = riders.filter((r) => tierOfPotentiale(r.potentiale) >= 5 && r.owner_kind === "free").length;
const pot56Ai = riders.filter((r) => tierOfPotentiale(r.potentiale) >= 5 && r.owner_kind === "ai").length;

const under22NoEvidence = riders.filter((r) => r.age != null && r.age < 22 && !tradedRiderIds.has(r.id)).length;
const under22Total = riders.filter((r) => r.age != null && r.age < 22).length;

const dkFormatter = new Intl.DateTimeFormat("da-DK", {
  timeZone: "Europe/Copenhagen",
  dateStyle: "full",
  timeStyle: "long",
});

const pct1617Pot56 = (() => {
  const b = riders.filter((r) => ageBand(r.age) === "16-17");
  if (!b.length) return null;
  const hi = b.filter((r) => tierOfPotentiale(r.potentiale) >= 5).length;
  return Number(((hi / b.length) * 100).toFixed(2));
})();

const summary = {
  measured_at_utc: measuredAt.toISOString(),
  measured_at_copenhagen: dkFormatter.format(measuredAt),
  rows: {
    "riders.json": riders.length,
    "teams.json": teams.length,
    "reference384.json": reference384.length,
    "academy_cohorts.json": allIntake.length,
    "trade_evidence.json": tradeEvidence.length,
  },
  owner_split: { human_owned: ownedCount, ai_owned: aiCount, free_agent: freeCount, total: riders.length },
  potentiale_tier_counts: tierCounts,
  potentiale_tier_note:
    "tier = Math.ceil(potentiale); potentiale er 11 diskrete trin 1.0-6.0 i 0.5-skridt i DB (numeric)",
  potentiale_tier_by_age_band: tierByBand,
  pot5_6: { human_owned: pot56Owned, free_agent: pot56Free, ai_owned: pot56Ai, total: pot56Owned + pot56Free + pot56Ai },
  under22_no_trade_evidence: { count: under22NoEvidence, total_under22: under22Total },
  reference384_check: {
    measured_n: reference384.length,
    facit_n: 384,
    measured_best_physical_mean: refBestMean,
    facit_best_physical_mean: 19.4,
    measured_best_physical_median: refBestMedian,
    facit_best_physical_median: 18,
  },
  facit_crosscheck_9_8: {
    population_total_facit: 8186,
    population_total_measured: riders.length,
    pot6_facit: 248,
    pot6_measured: tierCounts[6],
    pot6_owned_facit: 224,
    pot6_owned_measured: riders.filter((r) => tierOfPotentiale(r.potentiale) === 6 && r.owner_kind === "human").length,
    pot5_facit: 713,
    pot5_measured: tierCounts[5],
    pct_16_17_pot5_6_facit: 21.7,
    pct_16_17_pot5_6_measured: pct1617Pot56,
  },
  note_updated_at:
    "updated_at er IKKE brugt som markør (98,3% urørt trods bulk-updates, jf. spec §3). created_at + dette snapshots målingstidspunkt er sandheden.",
};
fs.writeFileSync(path.join(OUT_DIR, "summary.json"), JSON.stringify(summary, null, 2));
console.log("summary.json skrevet.");
console.log(JSON.stringify(summary.facit_crosscheck_9_8, null, 2));
console.log(JSON.stringify(summary.reference384_check, null, 2));
process.exit(0);
