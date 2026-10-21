#!/usr/bin/env node
// #6818/#6156 Formtest-data: henter READ-ONLY fra prod de data motoren bruger til
// form og formtoppe i de kommende S5-loeb, saa formtesten kan koeres offline
// (formTestCaches.mjs + motorTestport --from-dir).
//
// Henter for rytterne og loebene i en testport-eksport (<race_id>/cache.json):
//   - rider_condition.form (0-100) pr. rytter (formen motoren laeser)
//   - formtoppe (rider_peak_plans) for loebets saeson, med traeningskvaliteten
//     regnet af spillets egen resolvePeakTrainingQualities (samme som raceRunner),
//     men PAA KOERSELSDAGEN: for et kommende loeb er optakten (dagene foer vinduet)
//     ikke koert endnu, saa kvaliteten er en NEDRE graense. Antallet af vinduer med
//     ufaerdig optakt staar i outputtet (leadup); formTestCaches --peaks=tq1 er den oevre.
//   - formen er dagens rider_condition.form, ikke formen paa loebsdagen
//   - etapedagene (race_stage_schedule.scheduled_at -> dag-ordinal) pr. loeb og etape
//   - #6158-tjek: formtoppe pr. saeson, S5-planer oprettet foer S5 startede,
//     planer hvis maalloeb ligger i en anden saeson, og S4-vinduer der rager ind i S5.
//
// HARD RULE 17: output er private maalinger og skrives KUN til balance-internals/
// (gitignoreret). Klienten kan kun laese (readOnlyDb: insert/update/upsert/delete
// og rpc kaster). Intet secret printes; kun antal og stier.
//
// Koer (ejeren, PowerShell):
//   infisical run --env=prod --silent -- node backend/scripts/dev/formTestData.mjs --from-dir=<testport-eksport>/races --out=<fil.json>
//
// Refs #6818 #6156 #6158
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readOnlyDb } from "./lib/motorTestportInputs.mjs";
import { copenhagenDate } from "./lib/motorTestportReport.mjs";
import { assertPrivateOutDir, prodDb } from "./motorTestport.mjs";
import { dateStringToOrdinal, loadPeakPlans, loadStageDayOrdinals, resolvePeakTrainingQualities } from "../../lib/racePeakPlans.js";

const IN_CHUNK = 200;

export function parseArgs(argv) {
  const get = (name) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
  const fromDir = get("from-dir");
  const out = get("out");
  if (!fromDir) throw new Error("--from-dir=<mappe med <race_id>/cache.json> kraeves");
  if (!out) throw new Error("--out=<fil.json> kraeves (under balance-internals/)");
  // Hard rule 17: et af stiens mappe-segmenter skal hedde balance-internals (samme vagt som testporten).
  assertPrivateOutDir(path.dirname(path.resolve(out)));
  return { fromDir, out };
}

/** Loeb og ryttere i eksporten (race_id -> {riders:[{rider_id, team_id}]}). Ren. */
export function readExport(fromDir) {
  const races = new Map();
  for (const id of readdirSync(fromDir)) {
    const file = path.join(fromDir, id, "cache.json");
    if (!existsSync(file)) continue;
    const c = JSON.parse(readFileSync(file, "utf8"));
    races.set(c.race?.id ?? id, { stages: (c.profiles ?? []).map((p) => p.stage_number), riders: (c.entries ?? []).map((e) => ({ rider_id: e.rider_id, team_id: e.team_id ?? null })) });
  }
  return races;
}

async function selectIn(db, table, columns, key, values) {
  const rows = [];
  const list = [...new Set(values)];
  for (let i = 0; i < list.length; i += IN_CHUNK) {
    const { data, error } = await db.from(table).select(columns).in(key, list.slice(i, i + IN_CHUNK));
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data ?? []));
  }
  return rows;
}

async function allRows(db, table, columns) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(columns).order("id").range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

/** #6158-tjek paa alle formtoppe (rene tal, ingen ryttere). Ren. */
export function peakPlanDiagnostics({ plans, seasons, raceSeason }) {
  const byId = new Map(seasons.map((s) => [s.id, s]));
  const num = (id) => byId.get(id)?.number ?? null;
  const s5 = seasons.find((s) => s.number === 5) ?? null;
  const s4 = seasons.find((s) => s.number === 4) ?? null;
  const out = { perSeason: {}, s5PlansCreatedBeforeS5Start: 0, targetInOtherSeason: 0, targetMissing: 0, s4WindowsEndingAfterS4End: 0, s4WindowsEndingAfterS5Start: 0 };
  for (const p of plans) {
    const n = String(num(p.season_id));
    out.perSeason[n] = (out.perSeason[n] ?? 0) + 1;
    // created_at er UTC; sammenlign paa den danske dato (start_date er en dansk kalenderdag).
    if (s5 && p.season_id === s5.id && s5.start_date && p.created_at && copenhagenDate(new Date(p.created_at)) < s5.start_date) out.s5PlansCreatedBeforeS5Start += 1;
    if (!p.target_race_id) out.targetMissing += 1;
    else if (raceSeason.has(p.target_race_id) && raceSeason.get(p.target_race_id) !== p.season_id) out.targetInOtherSeason += 1;
    if (s4 && p.season_id === s4.id) {
      if (s4.end_date && p.window_end > s4.end_date) out.s4WindowsEndingAfterS4End += 1;
      if (s5?.start_date && p.window_end >= s5.start_date) out.s4WindowsEndingAfterS5Start += 1;
    }
  }
  return out;
}

export async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  const races = readExport(opts.fromDir);
  if (!races.size) throw new Error(`ingen <race_id>/cache.json i ${opts.fromDir}`);
  const db = readOnlyDb(await prodDb());

  const { data: seasons, error: sErr } = await db.from("seasons").select("id, number, status, start_date, end_date");
  if (sErr) throw new Error(`seasons: ${sErr.message}`);
  const raceRows = await selectIn(db, "races", "id, season_id, stages_completed", "id", [...races.keys()]);
  const raceSeasonOf = new Map(raceRows.map((r) => [r.id, r.season_id]));

  // Formen (rider_condition.form) for alle ryttere i felterne.
  const riderIds = [...new Set([...races.values()].flatMap((r) => r.riders.map((x) => x.rider_id)))];
  const conditions = {};
  for (const r of await selectIn(db, "rider_condition", "rider_id, form", "rider_id", riderIds)) conditions[r.rider_id] = { form: r.form };

  // Etapedage pr. loeb (samme ordinal som raceRunner's attachPeakContext).
  const stageDays = {};
  for (const raceId of races.keys()) stageDays[raceId] = Object.fromEntries(await loadStageDayOrdinals({ supabase: db, raceId }));

  // Formtoppe pr. saeson med spillets egen traeningskvalitet (resolvePeakTrainingQualities muterer vinduerne).
  // Kvaliteten regnes i dag: et vindue der starter efter i dag har en ufaerdig optakt (nedre graense).
  const todayOrdinal = dateStringToOrdinal(copenhagenDate());
  const leadup = { windows: 0, leadupIncomplete: 0, todayOrdinal };
  const peaksBySeason = {};
  const bySeason = new Map();
  for (const [raceId, r] of races) {
    const sid = raceSeasonOf.get(raceId);
    if (!sid) continue;
    if (!bySeason.has(sid)) bySeason.set(sid, new Map());
    for (const e of r.riders) bySeason.get(sid).set(e.rider_id, e);
  }
  for (const [sid, ridersById] of bySeason) {
    const entrants = [...ridersById.values()];
    const plans = await loadPeakPlans({ supabase: db, seasonId: sid, riderIds: entrants.map((e) => e.rider_id) });
    await resolvePeakTrainingQualities({ supabase: db, entrants, peakPlansByRider: plans });
    for (const ws of plans.values()) for (const w of ws) { leadup.windows += 1; if (w.start > todayOrdinal) leadup.leadupIncomplete += 1; }
    peaksBySeason[sid] = Object.fromEntries([...plans].map(([rid, ws]) => [rid, ws.map((w) => ({ start: w.start, end: w.end, targetRaceId: w.targetRaceId ?? null, trainingQuality: w.trainingQuality ?? null }))]));
  }

  // #6158: alle formtoppe (kun taelling, ingen ryttere i rapporten).
  const allPlans = await allRows(db, "rider_peak_plans", "id, season_id, target_race_id, window_start, window_end, created_at");
  const targetIds = [...new Set(allPlans.map((p) => p.target_race_id).filter(Boolean))];
  const targetRaces = await selectIn(db, "races", "id, season_id", "id", targetIds);
  const diagnostics = peakPlanDiagnostics({ plans: allPlans, seasons, raceSeason: new Map(targetRaces.map((r) => [r.id, r.season_id])) });

  const result = {
    format: "cz-form-test-data/v1",
    generatedAt: new Date().toISOString(),
    fromDir: opts.fromDir,
    seasons: seasons.map((s) => ({ id: s.id, number: s.number, status: s.status, start_date: s.start_date, end_date: s.end_date })),
    raceSeason: Object.fromEntries(raceSeasonOf),
    conditions,
    stageDays,
    peaksBySeason,
    leadup,
    diagnostics,
  };
  mkdirSync(path.dirname(path.resolve(opts.out)), { recursive: true });
  writeFileSync(opts.out, JSON.stringify(result));
  const peakRiders = Object.values(peaksBySeason).reduce((n, m) => n + Object.keys(m).length, 0);
  console.log(`formtest-data: ${races.size} loeb, ${Object.keys(conditions).length} ryttere med form, ${peakRiders} ryttere med formtop -> ${opts.out}`);
  console.log(`formtoppe: ${leadup.windows} vinduer, ${leadup.leadupIncomplete} med ufaerdig optakt (traeningskvaliteten er en nedre graense for dem)`);
  console.log(`#6158-tjek: ${JSON.stringify(diagnostics)}`);
  return result;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main();
}
