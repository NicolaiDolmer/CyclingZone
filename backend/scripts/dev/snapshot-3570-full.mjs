// #3570 — DATERET, READ-ONLY prod-snapshot af HELE den levende rytterbestand.
// KUN SELECT. Ingen INSERT/UPDATE/DELETE/DDL.
//
// Hvorfor denne findes ved siden af snapshot-3570-youth-reclass.mjs:
// 9/8-snapshottene bar kun wall-clock `age` og dækkede kun 16-21-årige. Begge dele
// bed: reparations-dry-runnet regnede alder på wall-clock, mens produktionen bruger
// `ageForSeason(birthdate, seasonNumber)` — 481 af de 2.356 "unge" er 22+ i
// sæson-alder og klassificeres i produktion mod VOKSEN-baselinen. Denne snapshot
// bærer derfor BÅDE `birthdate` og den aktive sæson, så sæson-alder kan regnes
// korrekt af enhver forbruger, samt `archetype_draw` (fast identitet, #3588).
//
// Rækkeformen er bevidst en SUPERMÆNGDE af youth-snapshottets, så eksisterende
// harnesses (repairYouth3570Phase2DryRun.mjs, loopFixpoint3570.mjs) kan læse den
// direkte.
//
//   infisical run --env=prod -- node scripts/dev/snapshot-3570-full.mjs [outDir]
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

import { VISIBLE_ABILITIES } from "../../lib/abilityDerivation.js";

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Mangler SUPABASE secrets (infisical run --env=prod)");
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const OUT_DIR = process.argv[2] || path.join(import.meta.dirname, `.snapshot-3570-full-${new Date().toISOString().slice(0, 10)}`);
fs.mkdirSync(OUT_DIR, { recursive: true });

async function fetchAllRange(table, cols, filterFn) {
  const out = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let q = sb.from(table).select(cols).range(from, from + PAGE - 1);
    if (filterFn) q = filterFn(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

async function readAllIn(table, cols, inCol, ids) {
  const out = [];
  const CH = 200;
  for (let i = 0; i < ids.length; i += CH) {
    const { data, error } = await sb.from(table).select(cols).in(inCol, ids.slice(i, i + CH));
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data || []));
  }
  return out;
}

// Wall-clock-alder — bevidst BEVARET som `age_wallclock`, IKKE som `age`, så ingen
// forbruger kan forveksle den med sæson-alder (det var præcis 9/8-fejlen).
function wallClockAge(birthdate, asOf) {
  if (!birthdate) return null;
  const b = new Date(birthdate);
  if (Number.isNaN(b.getTime())) return null;
  let age = asOf.getUTCFullYear() - b.getUTCFullYear();
  const before =
    asOf.getUTCMonth() < b.getUTCMonth() ||
    (asOf.getUTCMonth() === b.getUTCMonth() && asOf.getUTCDate() < b.getUTCDate());
  return before ? age - 1 : age;
}

const measuredAt = new Date();
console.log("=== #3570 fuld prod-snapshot (READ-ONLY, kun SELECT) ===");
console.log(`Målingstidspunkt: ${measuredAt.toISOString()} UTC`);

const seasons = await fetchAllRange("seasons", "number, status, start_date, end_date, race_days_completed, race_days_total");
seasons.sort((a, b) => b.number - a.number);
const activeSeason = seasons.find((s) => s.status === "active") ?? null;
if (!activeSeason) throw new Error("Ingen aktiv sæson — sæson-alder kan ikke regnes.");
console.log(`Aktiv sæson: ${activeSeason.number} (${activeSeason.race_days_completed}/${activeSeason.race_days_total} løbsdage)`);

const appConfig = await fetchAllRange("app_config", "key, value");

const teamsRaw = await fetchAllRange("teams", "id, name, division, is_ai, is_test_account, is_frozen, user_id");
const userIds = [...new Set(teamsRaw.map((t) => t.user_id).filter(Boolean))];
const users = userIds.length ? await readAllIn("users", "id, username", "id", userIds) : [];
const userById = new Map(users.map((u) => [u.id, u]));
const teamById = new Map(teamsRaw.map((t) => [t.id, t]));

const ridersRaw = await fetchAllRange(
  "riders",
  "id, firstname, lastname, birthdate, potentiale, archetype_draw, primary_type, secondary_type, valuation_type, " +
    "team_id, base_value, market_value, current_production_value, salary, is_academy, is_retired",
  (q) => q.or("is_retired.is.null,is_retired.eq.false"),
);
console.log(`riders (levende): ${ridersRaw.length}`);

const abilitiesRaw = await readAllIn("rider_derived_abilities", "*", "rider_id", ridersRaw.map((r) => r.id));
const abilityById = new Map(abilitiesRaw.map((a) => [a.rider_id, a]));
const missing = ridersRaw.filter((r) => !abilityById.has(r.id)).length;
if (missing) console.log(`ADVARSEL: ${missing} ryttere uden rider_derived_abilities-række`);

const rows = ridersRaw.map((r) => {
  const ab = abilityById.get(r.id) || null;
  const team = r.team_id ? teamById.get(r.team_id) : null;
  const abilities = {};
  if (ab) for (const k of VISIBLE_ABILITIES) if (ab[k] != null) abilities[k] = Number(ab[k]);
  return {
    rider_id: r.id,
    firstname: r.firstname,
    lastname: r.lastname,
    birthdate: r.birthdate,
    // SÆSON-alder (produktionens konvention, riderSeasonAge.ageForSeason). Feltet
    // hedder `age`, fordi det er den alder alle motor-stier bruger.
    age: r.birthdate ? 2026 + (activeSeason.number - 1) - new Date(r.birthdate).getUTCFullYear() : null,
    age_wallclock: wallClockAge(r.birthdate, measuredAt),
    potentiale: r.potentiale != null ? Number(r.potentiale) : null,
    archetype_draw: r.archetype_draw,
    team_id: r.team_id,
    manager_user_id: team?.user_id ?? null,
    manager_display_name: team?.user_id ? userById.get(team.user_id)?.username ?? null : null,
    owner_kind: !r.team_id ? "free" : team?.is_ai ? "ai" : "human",
    is_test_account: !!team?.is_test_account,
    division: team?.division ?? null,
    is_academy: !!r.is_academy,
    primary_type: r.primary_type,
    secondary_type: r.secondary_type,
    valuation_type: r.valuation_type,
    base_value: r.base_value,
    market_value: r.market_value,
    current_production_value: r.current_production_value,
    salary: r.salary,
    abilities,
    ability_caps: ab?.ability_caps ?? null,
  };
});

const byOwner = rows.reduce((a, r) => ((a[r.owner_kind] = (a[r.owner_kind] || 0) + 1), a), {});
const meta = {
  takenAt: measuredAt.toISOString(),
  activeSeasonNumber: activeSeason.number,
  activeSeason,
  seasons,
  appConfig: Object.fromEntries(appConfig.map((c) => [c.key, c.value])),
  n: rows.length,
  withArchetypeDraw: rows.filter((r) => r.archetype_draw != null).length,
  withCaps: rows.filter((r) => r.ability_caps).length,
  ownerKind: byOwner,
  ageConvention: "age = ageForSeason(birthdate, activeSeasonNumber); age_wallclock er KUN til sammenligning med 9/8-snapshots",
};

fs.writeFileSync(path.join(OUT_DIR, "riders_full.json"), JSON.stringify(rows));
fs.writeFileSync(path.join(OUT_DIR, "meta.json"), JSON.stringify(meta, null, 2));
console.log(JSON.stringify(meta, null, 2));
console.log(`\nSkrev ${rows.length} ryttere → ${OUT_DIR}`);
