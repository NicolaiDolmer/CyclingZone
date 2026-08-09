// Read-only prod-snapshot til #3570 omklassificerings-dry-run (16-21-årige).
// KUN SELECT — INGEN INSERT/UPDATE/DELETE/DDL.
// Kør: infisical run --env=prod -- node backend/scripts/dev/snapshot-3570-youth-reclass.mjs
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Mangler SUPABASE secrets (infisical run --env=prod)");
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const OUT_DIR =
  process.env.SNAPSHOT_OUT_DIR ||
  path.join(import.meta.dirname, `.snapshots-3570-${new Date().toISOString().slice(0, 10)}`);
fs.mkdirSync(OUT_DIR, { recursive: true });

// Spejler backend/lib/valuationScorecard.js riderAge() / snapshot-3564's riderAge().
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
console.log("=== #3570 prod-snapshot 16-21-årige (READ-ONLY, kun SELECT) ===");
console.log(`Målingstidspunkt: ${measuredAt.toISOString()} UTC`);

// ── teams.json (til owner_kind + manager-navn) ────────────────────────────
const teamsRaw = await fetchAllRange(
  "teams",
  "id, name, division, is_ai, is_test_account, is_frozen, user_id"
);
const userIds = [...new Set(teamsRaw.map((t) => t.user_id).filter(Boolean))];
const users = userIds.length ? await readAllIn("users", "id, username", "id", userIds) : [];
const userById = new Map(users.map((u) => [u.id, u]));
const teamById = new Map(teamsRaw.map((t) => [t.id, t]));

// ── riders (levende, dvs. is_retired ikke true) ───────────────────────────
const ridersRaw = await fetchAllRange(
  "riders",
  "id, firstname, lastname, birthdate, potentiale, primary_type, secondary_type, valuation_type, team_id, base_value, market_value, current_production_value, is_academy",
  (q) => q.or("is_retired.is.null,is_retired.eq.false")
);
console.log(`riders (levende, raw): ${ridersRaw.length}`);

const youthRaw = ridersRaw
  .map((r) => ({ ...r, age: riderAge(r.birthdate, measuredAt) }))
  .filter((r) => r.age != null && r.age >= 16 && r.age <= 21);
console.log(`16-21-årige (levende): ${youthRaw.length}`);

const youthIds = youthRaw.map((r) => r.id);
// select * for at fange alle kolonner i rider_derived_abilities (13 ability-felter
// + ability_caps jsonb + ability_progress jsonb m.fl.) uden at gætte kolonnenavne.
const abilitiesRaw = await readAllIn("rider_derived_abilities", "*", "rider_id", youthIds);
const abilityById = new Map(abilitiesRaw.map((a) => [a.rider_id, a]));

const missingAbilities = youthRaw.filter((r) => !abilityById.has(r.id));
if (missingAbilities.length) {
  console.log(`ADVARSEL: ${missingAbilities.length} 16-21-årige uden rider_derived_abilities-række (udelades fra reklassifikation)`);
}

const rows = youthRaw.map((r) => {
  const ab = abilityById.get(r.id) || null;
  const team = r.team_id ? teamById.get(r.team_id) : null;
  return {
    rider_id: r.id,
    firstname: r.firstname,
    lastname: r.lastname,
    birthdate: r.birthdate,
    age: r.age,
    potentiale: r.potentiale != null ? Number(r.potentiale) : null,
    team_id: r.team_id,
    manager_user_id: team?.user_id ?? null,
    manager_display_name: team?.user_id ? userById.get(team.user_id)?.username ?? null : null,
    owner_kind: !r.team_id ? "free" : team?.is_ai ? "ai" : "human",
    is_test_account: !!team?.is_test_account,
    is_academy: !!r.is_academy,
    primary_type: r.primary_type,
    secondary_type: r.secondary_type,
    valuation_type: r.valuation_type,
    base_value: r.base_value,
    market_value: r.market_value,
    current_production_value: r.current_production_value,
    abilities: ab
      ? {
          climbing: ab.climbing, time_trial: ab.time_trial, flat: ab.flat, tempo: ab.tempo,
          sprint: ab.sprint, acceleration: ab.acceleration, punch: ab.punch, endurance: ab.endurance,
          recovery: ab.recovery, durability: ab.durability, descending: ab.descending,
          cobblestone: ab.cobblestone, aggression: ab.aggression,
        }
      : null,
    ability_caps: ab?.ability_caps ?? null,
  };
});

fs.writeFileSync(path.join(OUT_DIR, "youth_16_21.json"), JSON.stringify(rows, null, 2));
console.log(`youth_16_21.json: ${rows.length} rækker`);

const summary = {
  measured_at_utc: measuredAt.toISOString(),
  total_16_21: rows.length,
  with_abilities_and_caps: rows.filter((r) => r.abilities && r.ability_caps).length,
  missing_abilities_or_caps: rows.filter((r) => !r.abilities || !r.ability_caps).length,
  owner_split: {
    human: rows.filter((r) => r.owner_kind === "human").length,
    ai: rows.filter((r) => r.owner_kind === "ai").length,
    free: rows.filter((r) => r.owner_kind === "free").length,
  },
  valuation_type_null: rows.filter((r) => r.valuation_type == null).length,
  valuation_type_set: rows.filter((r) => r.valuation_type != null).length,
  primary_type_dist: Object.fromEntries(
    [...new Set(rows.map((r) => r.primary_type))].map((t) => [
      t, rows.filter((r) => r.primary_type === t).length,
    ])
  ),
};
fs.writeFileSync(path.join(OUT_DIR, "summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
process.exit(0);
