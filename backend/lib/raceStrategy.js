// backend/lib/raceStrategy.js
// Race Hub S3: load + normalisér holdets strategi til generator-kernens form.
// Pure normalisering (testbar) + thin Supabase-I/O (loaders). Stale ids filtreres
// tavst mod holdets faktiske roster (L8). Skriv sker via api.js-endpoint (service_role).

import { TERRAIN_BUCKETS } from "./raceTerrain.js";
import { averageRouteVector, routeMatchScore } from "./routeMatch.js";

const VALID_RULES = new Set(["always_captain", "always_sprint_captain_if_present"]);

function dedupeInRoster(ids, rosterIds) {
  const out = [];
  const seen = new Set();
  for (const id of Array.isArray(ids) ? ids : []) {
    if (rosterIds.has(id) && !seen.has(id)) { seen.add(id); out.push(id); }
  }
  return out;
}

// Pure: rå DB-rækker → { aChain, captainPriorities, roleRules, targetRaceIds:Set }.
export function normalizeStrategy({ row, ruleRows = [], rosterIds }) {
  const aChain = dedupeInRoster(row?.a_chain, rosterIds);
  const captainPriorities = {};
  const rawCap = row?.captain_priorities || {};
  for (const bucket of TERRAIN_BUCKETS) {
    const list = dedupeInRoster(rawCap[bucket], rosterIds);
    if (list.length) captainPriorities[bucket] = list;
  }
  const roleRules = {};
  for (const r of ruleRows || []) {
    if (rosterIds.has(r.rider_id) && VALID_RULES.has(r.role_rule)) roleRules[r.rider_id] = r.role_rule;
  }
  const targetRaceIds = new Set(Array.isArray(row?.target_race_ids) ? row.target_race_ids : []);
  return { aChain, captainPriorities, roleRules, targetRaceIds };
}

// Pure: diff to assignment-maps (race_id → [{rider_id, race_role}]).
export function diffAssignments({ current = {}, proposed = {} }) {
  const out = {};
  const raceIds = new Set([...Object.keys(current), ...Object.keys(proposed)]);
  for (const raceId of raceIds) {
    const cur = current[raceId] || [];
    const pro = proposed[raceId] || [];
    const curIds = new Set(cur.map((e) => e.rider_id));
    const proIds = new Set(pro.map((e) => e.rider_id));
    const added = pro.filter((e) => !curIds.has(e.rider_id)).map((e) => e.rider_id);
    const removed = cur.filter((e) => !proIds.has(e.rider_id)).map((e) => e.rider_id);
    const curCap = cur.find((e) => e.race_role === "captain")?.rider_id ?? null;
    const proCap = pro.find((e) => e.race_role === "captain")?.rider_id ?? null;
    out[raceId] = {
      added, removed,
      captainChange: curCap !== proCap ? { from: curCap, to: proCap } : null,
    };
  }
  return out;
}

// Thin I/O: load én holds strategi, normaliseret mod holdets ryttere.
export async function loadTeamStrategy({ supabase, teamId, rosterIds }) {
  const [{ data: row }, { data: rules }] = await Promise.all([
    supabase.from("team_race_strategy").select("a_chain, captain_priorities, target_race_ids").eq("team_id", teamId).maybeSingle(),
    supabase.from("team_rider_role_rules").select("rider_id, role_rule").eq("team_id", teamId),
  ]);
  return normalizeStrategy({ row, ruleRows: rules || [], rosterIds });
}

// Thin I/O: load mange holds strategier (bulk-generator). rosterByTeam: Map<teamId, Set<riderId>>.
// Returnerer Map<teamId, strategy|null> — null hvis holdet hverken har strategi-row eller regler
// (→ uændret generator-adfærd / idempotens).
export async function loadStrategiesForTeams({ supabase, teamIds, rosterByTeam, selectInChunks }) {
  const out = new Map();
  if (!teamIds.length) return out;
  const [{ data: rows }, { data: rules }] = await Promise.all([
    selectInChunks({ supabase, table: "team_race_strategy", columns: "team_id, a_chain, captain_priorities, target_race_ids", inColumn: "team_id", ids: teamIds }),
    selectInChunks({ supabase, table: "team_rider_role_rules", columns: "team_id, rider_id, role_rule", inColumn: "team_id", ids: teamIds }),
  ]);
  const rowByTeam = new Map((rows || []).map((r) => [r.team_id, r]));
  const rulesByTeam = new Map();
  for (const r of rules || []) {
    if (!rulesByTeam.has(r.team_id)) rulesByTeam.set(r.team_id, []);
    rulesByTeam.get(r.team_id).push(r);
  }
  for (const teamId of teamIds) {
    const row = rowByTeam.get(teamId);
    const ruleRows = rulesByTeam.get(teamId) || [];
    if (!row && !ruleRows.length) { out.set(teamId, null); continue; } // ingen strategi → null
    out.set(teamId, normalizeStrategy({ row, ruleRows, rosterIds: rosterByTeam.get(teamId) || new Set() }));
  }
  return out;
}

// Per-bucket snit af sæsonens etapevektorer → per-rytter rutematch pr. bucket (0-100), samme
// model som løbets rutematch (#6207). Til kaptajn-board + auto-foreslå. buckets uden løb →
// udeladt (UI: "—"). stageProfiles: [{ bucket, vector }] (kalderen mapper profile_type →
// bucket og etapen → stageRouteVector).
export function bucketSuitabilities({ stageProfiles = [], riders = [] }) {
  const vectorsByBucket = new Map(); // bucket → etapevektorer
  for (const p of stageProfiles) {
    if (!p.bucket || !p.vector) continue;
    if (!vectorsByBucket.has(p.bucket)) vectorsByBucket.set(p.bucket, []);
    vectorsByBucket.get(p.bucket).push(p.vector);
  }
  const avgByBucket = new Map([...vectorsByBucket].map(([bucket, vectors]) => [bucket, averageRouteVector(vectors)]));
  const out = {}; // rider_id → { bucket: 0-100 }
  for (const r of riders) {
    out[r.rider_id] = {};
    for (const [bucket, avg] of avgByBucket) {
      out[r.rider_id][bucket] = routeMatchScore(r.abilities || {}, avg);
    }
  }
  return out;
}
