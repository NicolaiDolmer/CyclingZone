// Dry-run af en endnu ikke koert etape med de RIGTIGE prod-data (startliste,
// roller, holdordrer, evner, etapeprofil) gennem v4, over flere seeds.
// READ-ONLY: henter fra prod, skriver kun til stdout og evt. --out (lokalt).
//
// Formaal (ejer 2/10): aegte test af reglerne foer et loeb starter, fx om
// kaptajner/hjaelpere uden "Forsoeg udbrud" holder sig ude af morgenudbruddet,
// og hvor meget tid kaptajnerne taber.
//
// Koer:
//   infisical run --env=prod -- node backend/scripts/dev/dryRunUpcomingStage.mjs --race=<id> --stage=1 [--seeds=20] [--rules=orders_gc_v1] [--out=<fil>] [--save-cache=<fil>]
//   node backend/scripts/dev/dryRunUpcomingStage.mjs --race=<id> --stage=6 --cache=<fil>   (uden prod)
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const arg = (name, fallback = null) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(`--${name}=`.length) : fallback;
};

const RACE_ID = arg("race");
const STAGE = Number(arg("stage", "1"));
const SEEDS = Number(arg("seeds", "20"));
const RULES = arg("rules", "orders_gc_v1");
const OUT = arg("out");
const CACHE = arg("cache"); // laes data fra en lokal fil i stedet for prod
const SAVE_CACHE = arg("save-cache"); // gem de hentede prod-data lokalt (gitignoreret sti)
if (!RACE_ID) throw new Error("--race=<id> kraeves");

const LEADERS = new Set(["captain", "sprint_captain", "helper"]);

async function fetchStage() {
  const { createClient } = await import("@supabase/supabase-js");
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error("Mangler SUPABASE_URL / SUPABASE_SERVICE_KEY (infisical run --env=prod)");
  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
  const { ABILITY_KEYS } = await import("../../lib/raceSimulator.js");
  const one = async (q, what) => { const { data, error } = await q; if (error) throw new Error(`${what}: ${error.message}`); return data || []; };

  const [race] = await one(db.from("races").select("id, name, stages, squad, race_class").eq("id", RACE_ID), "races");
  if (!race) throw new Error(`Loeb ${RACE_ID} findes ikke`);
  const profiles = await one(db.from("race_stage_profiles").select("*").eq("race_id", RACE_ID), "race_stage_profiles"); // pagination-safe: ét løbs etaper (< 30 rækker)
  const entries = await one(db.from("race_entries").select("rider_id, team_id, race_role").eq("race_id", RACE_ID), "race_entries"); // pagination-safe: ét løbs startliste (< 300 rækker)
  const orders = await one(db.from("race_team_orders").select("team_id, race_id, stage_number, breakaway_stance, riders").eq("race_id", RACE_ID), "race_team_orders");
  const teamIds = [...new Set(entries.map((e) => e.team_id).filter(Boolean))];
  const riderIds = entries.map((e) => e.rider_id);
  const teams = [];
  for (let i = 0; i < teamIds.length; i += 50) teams.push(...await one(db.from("teams").select("id, is_ai").in("id", teamIds.slice(i, i + 50)), "teams"));
  const abilities = [];
  for (let i = 0; i < riderIds.length; i += 50) {
    abilities.push(...await one(db.from("rider_derived_abilities").select(["rider_id", ...ABILITY_KEYS].join(", ")).in("rider_id", riderIds.slice(i, i + 50)), "abilities"));
  }
  return { race, profiles, entries, orders, teams, abilities };
}

function median(xs) {
  const v = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

const { readFileSync, existsSync } = await import("node:fs");
const data = CACHE && existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : await fetchStage();
if (SAVE_CACHE) { mkdirSync(dirname(SAVE_CACHE), { recursive: true }); writeFileSync(SAVE_CACHE, JSON.stringify(data)); }
const profile = data.profiles.find((p) => p.stage_number === STAGE);
if (!profile) throw new Error(`Ingen profil for etape ${STAGE}`);
const aiByTeam = new Map(data.teams.map((t) => [t.id, t.is_ai === true]));
const abilitiesById = new Map(data.abilities.map((a) => [a.rider_id, a]));
const stageOrders = data.orders.filter((o) => o.stage_number === STAGE);
const tryBreakById = new Map();
for (const o of stageOrders) for (const r of o.riders || []) if (r && r.rider_id) tryBreakById.set(r.rider_id, r.try_break);

const entrants = data.entries.filter((e) => abilitiesById.has(e.rider_id)).map((e) => {
  const { rider_id: _r, ...abilities } = abilitiesById.get(e.rider_id);
  return { rider_id: e.rider_id, team_id: e.team_id ?? null, team_is_ai: aiByTeam.get(e.team_id) === true, race_role: e.race_role ?? null, effort: "normal", abilities };
});
const roleById = new Map(entrants.map((e) => [e.rider_id, e.race_role]));
const teamById = new Map(entrants.map((e) => [e.rider_id, e.team_id]));

const { loadRaceEngineV4 } = await import("../../lib/raceEngineV4Bridge.js");
const v4 = await loadRaceEngineV4();

const perSeed = [];
for (let s = 1; s <= SEEDS; s++) {
  const res = v4.simulateStage({
    entrants, stageProfile: profile, seedString: `${RACE_ID}:${STAGE}:dry${s}`, stageNumber: STAGE,
    teamOrderRows: data.orders, isStageRace: (data.race.stages || 1) > 1,
    raceStages: data.profiles.slice().sort((a, b) => a.stage_number - b.stage_number),
    squad: data.race.squad ?? null, rulesRevision: RULES,
  });
  const ranked = res.ranked || [];
  const breakIds = ranked.filter((r) => r.components?.breakaway).map((r) => r.rider_id);
  // #6097: AI-holdenes egne udbrudsforsoeg (M14 under orders_gc_v2) er ikke overtraedelser; de taelles separat.
  const isAiRider = (id) => aiByTeam.get(teamById.get(id)) === true;
  const violators = breakIds.filter((id) => !isAiRider(id) && LEADERS.has(roleById.get(id)) && tryBreakById.get(id) !== true);
  const aiInBreak = breakIds.filter((id) => isAiRider(id)).length;
  const capGaps = ranked.filter((r) => roleById.get(r.rider_id) === "captain" || roleById.get(r.rider_id) === "sprint_captain")
    .map((r) => Number(r.stageGap)).filter(Number.isFinite);
  const roles = {};
  for (const id of breakIds) {
    const role = roleById.get(id) ?? "?";
    const tag = role === "hunter" ? (tryBreakById.get(id) === false ? "hunter(fravalgt!)" : "hunter")
      : tryBreakById.get(id) === true ? `${role}+ordre` : role;
    roles[tag] = (roles[tag] || 0) + 1;
  }
  const gapsOf = (role) => ranked.filter((r) => roleById.get(r.rider_id) === role).map((r) => Number(r.stageGap)).filter(Number.isFinite);
  const gc = gapsOf("captain"), sp = gapsOf("sprint_captain");
  perSeed.push({ aiInBreak, gcCapMedian: median(gc), gcCapOver5: gc.filter((g) => g > 300).length, gcCapN: gc.length, spCapMedian: median(sp), seed: s, breakSize: breakIds.length, roles, violators: violators.length, capGapMedian: median(capGaps), capGapMax: capGaps.length ? Math.max(...capGaps) : null, capOver5min: capGaps.filter((g) => g > 300).length, nCaptains: capGaps.length,
    // #6089: broen saetter components.breakaway til 1/0 (ikke true/false), saa
    // `=== true` var altid falsk. Motorens egen dom (breakaway_win) foerst.
    winnerInBreak: typeof ranked[0]?.breakaway_win === "boolean" ? ranked[0].breakaway_win : Number(ranked[0]?.components?.breakaway) > 0,
    winnerInMorningBreak: Number(ranked[0]?.components?.breakaway) > 0,
    // Udbruddet foran favoritterne: en morgenudbryder i maal foer den foerste kaptajn uden for udbruddet.
    breakAheadOfFavourites: (() => { const b = ranked.findIndex((r) => Number(r.components?.breakaway) > 0); const c = ranked.findIndex((r) => roleById.get(r.rider_id) === "captain" && !(Number(r.components?.breakaway) > 0)); return b >= 0 && c >= 0 && b < c; })() });
}

const summary = {
  race: data.race.name, stage: STAGE, profile_type: profile.profile_type, rules: RULES, seeds: SEEDS, field: entrants.length,
  roles_in_field: entrants.reduce((m, e) => { m[e.race_role] = (m[e.race_role] || 0) + 1; return m; }, {}),
  try_break_true: [...tryBreakById.values()].filter((v) => v === true).length,
  violators_total: perSeed.reduce((s, r) => s + r.violators, 0),
  ai_in_break_total: perSeed.reduce((s, r) => s + r.aiInBreak, 0),
  no_break_seeds: perSeed.filter((r) => r.breakSize === 0).length,
  breakSize_median: median(perSeed.map((r) => r.breakSize)),
  winner_from_break: perSeed.filter((r) => r.winnerInBreak).length,
  winner_in_morning_break: perSeed.filter((r) => r.winnerInMorningBreak).length,
  break_ahead_of_favourites: perSeed.filter((r) => r.breakAheadOfFavourites).length,
  captain_gap_median_s: median(perSeed.map((r) => r.capGapMedian)),
  captain_gap_max_s: Math.max(...perSeed.map((r) => r.capGapMax ?? 0)),
  captains_over_5min_per_seed: median(perSeed.map((r) => r.capOver5min)),
  gc_captain_gap_median_s: median(perSeed.map((r) => r.gcCapMedian)),
  gc_captains_over_5min_per_seed: median(perSeed.map((r) => r.gcCapOver5)),
  gc_captains_n: perSeed[0]?.gcCapN,
  sprint_captain_gap_median_s: median(perSeed.map((r) => r.spCapMedian)),
  break_roles_total: perSeed.reduce((m, r) => { for (const [k, v] of Object.entries(r.roles)) m[k] = (m[k] || 0) + v; return m; }, {}),
};
console.log(JSON.stringify(summary, null, 2));
if (OUT) { mkdirSync(dirname(OUT), { recursive: true }); writeFileSync(OUT, JSON.stringify({ summary, perSeed }, null, 2)); }
