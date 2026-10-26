// #6110 Udvikling 2.0: read-only prod-snapshot til potentiale-skøn-harnessen.
// KUN SELECT, INGEN INSERT/UPDATE/DELETE/DDL.
// Kør: infisical run --env=prod -- node backend/scripts/dev/snapshot-6110-potential-estimate.mjs
// Output: SNAPSHOT_OUT_DIR (sæt den til en privat mappe under balance-internals/6110/),
// ellers en dateret ".snapshots-6110-*"-mappe her (git-ignoreret, committes ALDRIG).
//
// Skriver:
//   riders.json     levende ryttere { id, age, potentiale, team_id, rating }
//   knowledge.json  ét element pr. (hold, rytter) som holdet ved noget om:
//                   egne ryttere { own, trainingDates, coachTier, facilityTier }
//                   scoutede ryttere { own:false, looks, bestScoutTier }
//
// Kendte forenklinger (står også i harness-rapporten):
//   - bestScoutTier = holdets BEDSTE aktive scout i dag; hvilken scout der lavede
//     hvert kig gemmes ikke historisk.
//   - trainingDates = antal forskellige tick_date i training_rider_ticks for
//     (rytterens nuværende hold, rytter) inden for de seneste TRAINING_WINDOW_DAYS.
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
  path.join(import.meta.dirname, `.snapshots-6110-${new Date().toISOString().slice(0, 10)}`);
fs.mkdirSync(OUT_DIR, { recursive: true });

// `order`: kolonner der tilsammen er UNIKKE pr. raekke. Uden en stabil, unik
// sortering kan PostgREST give overlappende eller manglende raekker mellem sider
// (se backend/lib/supabasePagination.js).
async function fetchAll(table, cols, order, filterFn) {
  const out = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let q = sb.from(table).select(cols);
    if (filterFn) q = filterFn(q);
    for (const col of order) q = q.order(col, { ascending: true });
    q = q.range(from, from + PAGE - 1);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

function ageOn(birthdate, asOf) {
  if (!birthdate) return null;
  const b = new Date(birthdate);
  let age = asOf.getUTCFullYear() - b.getUTCFullYear();
  if (asOf.getUTCMonth() < b.getUTCMonth() || (asOf.getUTCMonth() === b.getUTCMonth() && asOf.getUTCDate() < b.getUTCDate())) age -= 1;
  return age;
}

const measuredAt = new Date();
console.log(`=== #6110 snapshot (READ-ONLY) ${measuredAt.toISOString()} UTC ===`);

const teams = await fetchAll("teams", "id, is_ai, is_test_account", ["id"]);
const humanTeamIds = new Set(teams.filter((t) => !t.is_ai && !t.is_test_account).map((t) => t.id));

const ridersRaw = await fetchAll(
  "riders",
  "id, birthdate, potentiale, team_id, best_role_rating",
  ["id"],
  (q) => q.or("is_retired.is.null,is_retired.eq.false"),
);
const riders = ridersRaw
  .filter((r) => r.potentiale != null)
  .map((r) => ({
    id: r.id,
    age: ageOn(r.birthdate, measuredAt),
    potentiale: Number(r.potentiale),
    team_id: r.team_id,
    rating: r.best_role_rating ?? null,
  }));
const riderById = new Map(riders.map((r) => [r.id, r]));
fs.writeFileSync(path.join(OUT_DIR, "riders.json"), JSON.stringify(riders));
console.log(`riders.json: ${riders.length}`);

const staff = await fetchAll("team_staff", "id, team_id, role, tier", ["id"], (q) => q.eq("status", "active"));
const bestTier = (role) => {
  const m = new Map();
  for (const s of staff) if (s.role === role) m.set(s.team_id, Math.max(m.get(s.team_id) ?? 0, s.tier ?? 0));
  return m;
};
const scoutTierByTeam = bestTier("scouting");
const coachTierByTeam = bestTier("training");
const facilities = await fetchAll("team_facilities", "id, team_id, track, tier", ["id"], (q) => q.eq("track", "training"));
const facilityTierByTeam = new Map(facilities.map((f) => [f.team_id, f.tier ?? 0]));

// Scout-kig pr. (hold, rytter), kun menneskehold og kun fremmede ryttere.
const actions = await fetchAll("scout_actions", "id, team_id, rider_id", ["id"]);
const looks = new Map();
for (const a of actions) {
  if (!humanTeamIds.has(a.team_id)) continue;
  const r = riderById.get(a.rider_id);
  if (!r || r.team_id === a.team_id) continue;
  const key = `${a.team_id}|${a.rider_id}`;
  looks.set(key, (looks.get(key) ?? 0) + 1);
}

// Afregnede træningsdatoer for egne ryttere på menneskehold.
// Kun de seneste TRAINING_WINDOW_DAYS (standard 60) datoer: viden mætter langt før,
// og hele historikken er for stor til at hente side for side.
const windowDays = Number(process.env.TRAINING_WINDOW_DAYS || 60);
const cutoff = new Date(measuredAt.getTime() - windowDays * 86400000).toISOString().slice(0, 10);
const ticks = await fetchAll(
  "training_rider_ticks",
  "team_id, rider_id, tick_date, game_day, season_id",
  ["rider_id", "season_id", "game_day"], // primaernoeglen: unik pr. raekke
  (q) => q.not("team_id", "is", null).gte("tick_date", cutoff),
);
const datesByPair = new Map();
for (const t of ticks) {
  const r = riderById.get(t.rider_id);
  if (!r || r.team_id !== t.team_id || !humanTeamIds.has(t.team_id)) continue;
  const key = `${t.team_id}|${t.rider_id}`;
  if (!datesByPair.has(key)) datesByPair.set(key, new Set());
  datesByPair.get(key).add(t.tick_date);
}

const knowledge = [];
for (const r of riders) {
  if (!r.team_id || !humanTeamIds.has(r.team_id)) continue;
  knowledge.push({
    team_id: r.team_id,
    rider_id: r.id,
    own: true,
    trainingDates: datesByPair.get(`${r.team_id}|${r.id}`)?.size ?? 0,
    coachTier: coachTierByTeam.get(r.team_id) ?? 0,
    facilityTier: facilityTierByTeam.get(r.team_id) ?? 0,
  });
}
for (const [key, n] of looks) {
  const [teamId, riderId] = key.split("|");
  knowledge.push({ team_id: teamId, rider_id: riderId, own: false, looks: n, bestScoutTier: scoutTierByTeam.get(teamId) ?? null });
}
fs.writeFileSync(path.join(OUT_DIR, "knowledge.json"), JSON.stringify(knowledge));
fs.writeFileSync(path.join(OUT_DIR, "meta.json"), JSON.stringify({ measured_at_utc: measuredAt.toISOString(), riders: riders.length, knowledge_rows: knowledge.length, ticks_read: ticks.length }, null, 2));
console.log(`knowledge.json: ${knowledge.length} (egne + scoutede par)`);
