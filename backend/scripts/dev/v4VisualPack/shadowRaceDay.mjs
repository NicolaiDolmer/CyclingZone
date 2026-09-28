// backend/scripts/dev/v4VisualPack/shadowRaceDay.mjs
// #5826 / #5804: SKYGGE-TEST af én rigtig løbsdag — v3 og v4 på samme felt og
// seed, in-memory via raceRunner.buildRaceResults (samme sti som prod). 100 %
// READ-ONLY: læser tre JSON-dumps og skriver én lokal JSON. Ingen DB-klient.
//
// Dumps (SELECT-only, fx via Supabase MCP execute_sql; alle tre som
// `select '<marker>' marker, <agg> data`, derefter data-feltet gemt som fil):
//   stages.json  — json_agg over dagens race_stage_schedule-slots join races +
//                  race_stage_profiles: { race_id, name, race_type, race_class, squad,
//                  ldiv, tier, nstages, season_id, stage: { profil-kolonner,
//                  segments, weather, scheduled_at, game_day } }
//   entries.json — json_agg over race_entries for dagens løb med
//                  { race_id, team_id, rider_id, race_role, is_ai, div_ok, team_ok,
//                  squad_ok, retired, injured, withdrawn, has_ab, form, fatigue,
//                  ab: [15 evner i ABILITY_KEYS-rækkefølge] } (samme filtre som
//                  loadEntrantsForRace; assistentens autopick køres IKKE).
//   types.json   — json_object_agg(rider_id, primary_type).
// Rytternavne og holdnavne læses aldrig.
//
// Usage (fra backend/):
//   node scripts/dev/v4VisualPack/shadowRaceDay.mjs <dataDir> <out.json> [--variant=prodpath|stored]
//   prodpath = de kolonner raceRunner.loadStageProfiles henter (STAGE_PROFILE_COLUMNS)
//   stored   = + segments/weather/race_id eksplicit
import { readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

const REPO = new URL("../../..", import.meta.url).pathname.replace(/\/$/u, "");
const { buildRaceResults } = await import(`${REPO}/lib/raceRunner.js`);
const { filterTeamsBelowMinimumEntries } = await import(`${REPO}/lib/raceFieldIntegrity.js`);
const { recordingV4Engine } = await import(`${REPO}/scripts/dev/v4VisualPack/collectS4VisualPack.mjs`);
const { ABILITY_KEYS } = await import(`${REPO}/lib/raceSimulator.js`);
const { stageSuitabilityScores } = await import(`${REPO}/lib/raceAutopick.js`);

const [dataDir, outPath] = process.argv.slice(2);
const variant = (process.argv.find((a) => a.startsWith("--variant=")) ?? "--variant=prodpath").slice(10);
const stagesRaw = JSON.parse(readFileSync(`${dataDir}/stages.json`, "utf8"));
const entriesRaw = JSON.parse(readFileSync(`${dataDir}/entries.json`, "utf8"));
const types = JSON.parse(readFileSync(`${dataDir}/types.json`, "utf8"));

// Prod's loadStageProfiles vælger KUN disse kolonner (+ game_day for etapeløb).
const { STAGE_PROFILE_COLUMNS } = await import(`${REPO}/lib/raceRunner.js`);
const PROD_COLS = STAGE_PROFILE_COLUMNS.split(",").map((c) => c.trim());

const races = new Map();
for (const r of stagesRaw) {
  if (!races.has(r.race_id)) races.set(r.race_id, { ...r, stages: [] });
  const st = r.stage;
  const row = Object.fromEntries(PROD_COLS.map((k) => [k, st[k]]));
  if (r.race_type === "stage_race") row.game_day = st.game_day;
  if (variant === "stored") { row.segments = st.segments; row.weather = st.weather; row.race_id = r.race_id; }
  row._scheduled_at = st.scheduled_at;
  races.get(r.race_id).stages.push(row);
}

const byRace = new Map();
const dropped = { div: 0, withdrawn: 0 };
for (const e of entriesRaw) {
  if (e.div_ok !== true) { dropped.div++; continue; }
  if (e.withdrawn) { dropped.withdrawn++; continue; }
  if (!e.team_ok || !e.squad_ok || e.retired || e.injured || !e.has_ab) continue;
  if (!byRace.has(e.race_id)) byRace.set(e.race_id, []);
  byRace.get(e.race_id).push(e);
}

const secs = (s) => { const m = /^\+?(\d+):(\d{2})(?::(\d{2}))?$/u.exec(String(s ?? "").trim()); if (!m) return 0; return m[3] != null ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) : (+m[1]) * 60 + (+m[2]); };
const typeOf = (id) => types[id] ?? "?";

const out = { variant, dropped, races: [] };
for (const [raceId, race] of races) {
  let entries = byRace.get(raceId) ?? [];
  entries.sort((a, b) => String(a.team_id).localeCompare(String(b.team_id)) || String(a.rider_id).localeCompare(String(b.rider_id)));
  const { kept, droppedTeamIds } = filterTeamsBelowMinimumEntries({ entries });
  const entrants = kept.map((e) => {
    const abilities = { rider_id: e.rider_id };
    ABILITY_KEYS.forEach((k, i) => { abilities[k] = e.ab[i]; });
    const ent = { rider_id: e.rider_id, team_id: e.team_id, team_name: null, rider_name: null, is_u25: false, abilities };
    if (e.race_role) ent.race_role = e.race_role;
    if (e.is_ai === true) ent.team_is_ai = true;
    if (e.form != null) { ent.form = e.form; ent.fatigue = e.fatigue; }
    return ent;
  });
  const stagesSorted = race.stages.map(({ _scheduled_at, ...s }) => s).sort((a, b) => a.stage_number - b.stage_number);
  const raceObj = { id: raceId, season_id: race.season_id, league_division_id: race.ldiv, name: race.name, race_class: race.race_class, race_type: race.race_type, stages: race.nstages, squad: race.squad };
  const rec = { race_id: raceId, name: race.name, squad: race.squad, tier: race.tier, race_type: race.race_type, field: entrants.length, teamsBelowMin: droppedTeamIds.length, stages: [] };
  try {
    let t = performance.now();
    const v3 = buildRaceResults({ race: raceObj, stages: stagesSorted, entrants, pointsLookup: {}, v3: true, timeline: true });
    rec.v3ms = Math.round(performance.now() - t);
    const r4 = recordingV4Engine();
    t = performance.now();
    const v4 = buildRaceResults({ race: raceObj, stages: stagesSorted, entrants, pointsLookup: {}, v3: true, timeline: true, v4Engine: r4.engine, teamOrderRows: [] });
    rec.v4ms = Math.round(performance.now() - t);
    const isSR = race.race_type === "stage_race";
    for (const st of stagesSorted) {
      const sn = st.stage_number;
      const pick = (rows) => rows.filter((r) => r.result_type === (isSR ? "stage" : "gc") && r.stage_number === (isSR ? sn : 1) && r.rider_id).sort((a, b) => a.rank - b.rank);
      const v3rows = pick(v3.resultRows), v4rows = pick(v4.resultRows);
      const got = r4.recorded.get(sn);
      const v4res = got?.v4Output?.results ?? [];
      const nan = v4res.filter((r) => !Number.isFinite(r.time_seconds)).length;
      const status = {}; for (const r of v4res) status[r.status] = (status[r.status] ?? 0) + 1;
      const fin = v4res.filter((r) => r.status === "finished").map((r) => r.time_seconds).sort((a, b) => a - b);
      const v3inc = v3.incidents.filter((i) => i.stage_number === sn).length;
      const v4inc = (got?.v4Output?.incidents ?? []).length;
      const v3gap = v3rows.map((r) => secs(r.finish_time));
      const v4bw = v4rows.slice(0, 10).filter((r) => r.in_breakaway).length;
      const v4bwWin = !!v4rows[0]?.in_breakaway && !v4rows[0]?.breakaway_caught;
      const v3bwWin = !!v3rows[0]?.in_breakaway && !v3rows[0]?.breakaway_caught;
      const v4bwCaught = v4rows.filter((r) => r.breakaway_caught).length;
      const breakawayEvents = (got?.v4Output?.timeline?.events ?? []).filter((e) => /breakaway|catch|caught/u.test(e.type)).map((e) => e.type);
      const suit = entrants.map((e) => ({ id: e.rider_id, sc: stageSuitabilityScores(e.abilities, [st])[0] ?? 0 })).sort((a, b) => b.sc - a.sc);
      const srank = (id) => { if (!id) return null; const sc = suit.find((x) => x.id === id)?.sc; return 1 + suit.filter((x) => x.sc > sc).length; };
      const fav5 = new Set(suit.slice(0, 5).map((x) => x.id));
      const favIn10 = (rows) => rows.slice(0, 10).filter((r) => fav5.has(r.rider_id)).length;
      rec.stages.push({
        v3wRank: srank(v3rows[0]?.rider_id), v4wRank: srank(v4rows[0]?.rider_id), v3fav10: favIn10(v3rows), v4fav10: favIn10(v4rows),
        v4top3rank: v4rows.slice(0, 3).map((r) => srank(r.rider_id)), v3top3rank: v3rows.slice(0, 3).map((r) => srank(r.rider_id)),
        sn, profile: st.profile_type, finale: st.finale_type, km: st.distance_km,
        v3win: typeOf(v3rows[0]?.rider_id), v4win: typeOf(v4rows[0]?.rider_id),
        v3top3: v3rows.slice(0, 3).map((r) => typeOf(r.rider_id)), v4top3: v4rows.slice(0, 3).map((r) => typeOf(r.rider_id)),
        v3top10gap: v3gap[9] ?? null, v4top10gap: fin.length >= 10 ? Math.round(fin[9] - fin[0]) : null,
        v3lastgap: v3gap.length ? Math.max(...v3gap) : null, v4lastgap: fin.length ? Math.round(fin[fin.length - 1] - fin[0]) : null,
        v4gap2: fin.length >= 2 ? Math.round(fin[1] - fin[0]) : null,
        v4status: status, v4nan: nan, v3inc, v4inc, v4bwInTop10: v4bw, v4bwWin, v3bwWin, v4bwCaught,
        v4bwEvents: [...new Set(breakawayEvents)],
        v4trace: got?.trace?.breakaway_win ?? null,
        winnerSame: v3rows[0]?.rider_id === v4rows[0]?.rider_id,
        timelineValid: got?.timelineValid ?? null,
      });
    }
  } catch (err) {
    rec.error = String(err?.stack ?? err).slice(0, 800);
  }
  out.races.push(rec);
  console.error(`${race.squad} ${race.race_type} ${race.name}: field=${rec.field} v3=${rec.v3ms}ms v4=${rec.v4ms}ms ${rec.error ? "ERROR" : ""}`);
}
writeFileSync(outPath, JSON.stringify(out, null, 1));
