// #7088 · Engangs-genberegning af bestyrelsens tillid (board_relations.confidence).
//
// Baggrund: indtil #7088 lagde mandat-motoren sæsonens `satisfaction_delta`
// (et målniveau i forhold til sæsonstart) oveni den løbende tillid ved HVER
// løbsafslutning og igen ved sæsonslut, så tilliden mættede på 0 eller 100.
// Rettelsen i boardMandateEngine.js gælder fremad. Dette script genskaber den
// tillid den rettede model ville have givet, ved at genafspille historikken:
//
//   1. Start: tilliden før motorens første bevægelse for holdet
//      (`satisfaction_before` på holdets første tillids-kvittering).
//   2. Pr. afsluttet sæson: dommen = sæsonens anker + 1yr-planens sæson-delta
//      (`board_plan_snapshots.satisfaction_delta`, samme evaluering motoren
//      brugte), derefter milepælene oveni med deres ægte (ikke-klampede)
//      belønning/straf fra `computeMilestoneHitReward`/`computeMilestoneMissPenalty`.
//   3. Aktiv sæson: anker = værdien efter forrige sæson; target = anker +
//      den løbende sæson-delta. Delta'en aflæses eksakt af holdets seneste
//      løbs-kvittering når den ikke er mættet, ellers af 1yr-planens
//      `satisfaction - season_start_satisfaction` (board_profiles følger samme
//      evaluering korrekt ankret). Tilliden sættes til target, og ankeret
//      gemmes i `confidence_source.season_anchor`, så motoren fortsætter derfra.
//
// SIKKERHED
//  - DRY-RUN er default. Intet skrives uden `--apply --owner-go`.
//  - `--apply` skriver FØRST en JSON-backup af alle berørte relations-rækker
//    (`--backup-dir`, default `balance-internals/7088/` i repo-roden, gitignoreret).
//  - Optimistisk vagt: en række opdateres kun hvis dens confidence stadig er
//    den værdi dry-run'et så (`.eq("confidence", before)`).
//  - Hvert flyttet tal får en kvittering i board_satisfaction_events
//    (reason_category `correction_7088`, uden mandate_id: auditspor, ikke et
//    formandscitat i Boardroom).
//  - Kør først EFTER at #7088-rettelsen er deployet: den gamle kode ville
//    straks lægge delta'en oveni igen.
//  - Output indeholder kun team-id'er og tal, ingen hold- eller managernavne.
//
// Brug (fra backend/):
//   infisical run --env=prod -- node scripts/ops/recomputeBoardConfidence7088.mjs                  # dry-run
//   infisical run --env=prod -- node scripts/ops/recomputeBoardConfidence7088.mjs --json=<fil>     # dry-run + rapport til fil
//   infisical run --env=prod -- node scripts/ops/recomputeBoardConfidence7088.mjs --apply --owner-go   # KUN efter ejerens "kør"

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { computeMilestoneHitReward, computeMilestoneMissPenalty } from "../../lib/boardMandate.js";
import { clampSatisfaction } from "../../lib/boardUtils.js";
import { fetchAllRows } from "../../lib/supabasePagination.js";

export const MILESTONE_REASONS = Object.freeze([
  "mandate.milestone.achieved",
  "mandate.milestone.achieved_early",
  "mandate.milestone.missed",
]);
export const CONFIDENCE_REASONS = Object.freeze(["weekend_update", "season_end", ...MILESTONE_REASONS]);
export const CORRECTION_REASON = "correction_7088";

const isUnsaturated = (value) => Number.isFinite(value) && value > 0 && value < 100;
const toNum = (value) => (value === null || value === undefined ? NaN : Number(value));

/**
 * Ren kerne for ét hold. Ingen I/O.
 *
 * @param {object} args
 * @param {{ team_id: string, confidence: number }} args.relation
 * @param {{ id: string, number: number }} args.activeSeason
 * @param {Map<string, number>} args.seasonNumberById
 * @param {object|null} args.firstEvent        første tillids-kvittering (alle sæsoner)
 * @param {object[]} args.verdictEvents         season_end + milepæls-kvitteringer, stigende tid
 * @param {object|null} args.lastActiveWeekend seneste weekend_update i aktiv sæson
 * @param {Map<number, number>} args.oneYearDeltaBySeasonNumber 1yr-snapshot-delta pr. sæson
 * @param {Map<string, object>} args.milestonesById
 * @param {object|null} args.oneYearBoard       holdets 1yr board_profiles-række
 */
export function replayTeamConfidence({
  relation,
  activeSeason,
  seasonNumberById,
  firstEvent = null,
  verdictEvents = [],
  lastActiveWeekend = null,
  oneYearDeltaBySeasonNumber = new Map(),
  milestonesById = new Map(),
  oneYearBoard = null,
}) {
  const before = clampSatisfaction(toNum(relation?.confidence ?? 50));
  const base = { team_id: relation.team_id, before, flags: [] };
  if (!firstEvent) return { ...base, status: "no_history", after: before, anchor: null, active_delta: null };

  const startSeason = seasonNumberById.get(firstEvent.season_id);
  if (!Number.isFinite(startSeason)) {
    return { ...base, status: "unknown_start_season", after: before, anchor: null, active_delta: null };
  }

  const flags = [];
  let confidence = clampSatisfaction(toNum(firstEvent.satisfaction_before));
  const seasonsReplayed = [];
  for (let season = startSeason; season < activeSeason.number; season += 1) {
    const seasonAnchor = confidence;
    const inSeason = verdictEvents.filter((e) => seasonNumberById.get(e.season_id) === season);
    const seasonEnd = inSeason.find((e) => e.reason_category === "season_end");
    let verdictDelta = null;
    if (seasonEnd) {
      if (oneYearDeltaBySeasonNumber.has(season)) {
        verdictDelta = Number(oneYearDeltaBySeasonNumber.get(season));
      } else if (isUnsaturated(toNum(seasonEnd.satisfaction_before)) && isUnsaturated(toNum(seasonEnd.satisfaction_after))) {
        verdictDelta = toNum(seasonEnd.satisfaction_after) - toNum(seasonEnd.satisfaction_before);
        flags.push(`s${season}_delta_from_receipt`);
      } else {
        verdictDelta = 0;
        flags.push(`s${season}_delta_unknown`);
      }
      confidence = clampSatisfaction(seasonAnchor + verdictDelta);
    } else {
      flags.push(`s${season}_no_season_end`);
    }

    let milestoneSum = 0;
    for (const event of inSeason.filter((e) => MILESTONE_REASONS.includes(e.reason_category))) {
      const milestone = event.milestone_id ? milestonesById.get(event.milestone_id) : null;
      let raw;
      if (milestone) {
        raw = event.reason_category === "mandate.milestone.missed"
          ? -computeMilestoneMissPenalty(milestone.goal ?? {}, Number(milestone.weight ?? 1))
          : computeMilestoneHitReward(milestone.goal ?? {}, Number(milestone.weight ?? 1));
      } else {
        raw = Number(event.satisfaction_delta ?? 0);
        flags.push(`s${season}_milestone_missing`);
      }
      const prev = confidence;
      confidence = clampSatisfaction(confidence + raw);
      milestoneSum += confidence - prev;
    }
    seasonsReplayed.push({ season, anchor: seasonAnchor, verdict_delta: verdictDelta, milestone_delta: milestoneSum, end: confidence });
  }

  const anchor = startSeason === activeSeason.number
    ? clampSatisfaction(toNum(firstEvent.satisfaction_before))
    : confidence;

  // Aktiv sæsons løbende delta.
  let activeDelta = null;
  const lastAfter = toNum(lastActiveWeekend?.satisfaction_after);
  const lastBefore = toNum(lastActiveWeekend?.satisfaction_before);
  const bpValid = oneYearBoard
    && oneYearBoard.season_start_anchor_season_id === activeSeason.id
    && Number.isFinite(toNum(oneYearBoard.season_start_satisfaction))
    && Number.isFinite(toNum(oneYearBoard.satisfaction));
  if (lastActiveWeekend && isUnsaturated(lastAfter) && Number.isFinite(lastBefore)) {
    activeDelta = lastAfter - lastBefore;
  } else if (bpValid) {
    const bpNow = toNum(oneYearBoard.satisfaction);
    activeDelta = bpNow - toNum(oneYearBoard.season_start_satisfaction);
    flags.push("active_delta_from_plan");
    if (!isUnsaturated(bpNow)) flags.push("active_delta_bound");
  } else if (lastActiveWeekend) {
    activeDelta = 0;
    flags.push("active_delta_unknown");
  } else {
    activeDelta = 0;
  }

  const after = clampSatisfaction(anchor + activeDelta);
  return {
    ...base,
    status: "replayed",
    flags,
    start_season: startSeason,
    start: clampSatisfaction(toNum(firstEvent.satisfaction_before)),
    seasons: seasonsReplayed,
    anchor,
    active_delta: activeDelta,
    after,
  };
}

/** Fordeling i ti spande (0-9, 10-19, ..., 90-100) + yderværdierne for sig. */
export function histogram(values) {
  const buckets = Array.from({ length: 10 }, (_, i) => ({ range: i === 9 ? "90-100" : `${i * 10}-${i * 10 + 9}`, count: 0 }));
  let zero = 0;
  let hundred = 0;
  for (const raw of values) {
    const v = clampSatisfaction(Number(raw));
    if (v === 0) zero += 1;
    if (v === 100) hundred += 1;
    buckets[Math.min(9, Math.floor(v / 10))].count += 1;
  }
  return { buckets, at_0: zero, at_100: hundred, n: values.length };
}

export function buildPlan(rows) {
  const changed = rows.filter((r) => r.status === "replayed" && r.after !== r.before);
  const flagCounts = {};
  for (const r of rows) for (const f of r.flags || []) flagCounts[f] = (flagCounts[f] || 0) + 1;
  return {
    summary: {
      relations: rows.length,
      replayed: rows.filter((r) => r.status === "replayed").length,
      no_history: rows.filter((r) => r.status === "no_history").length,
      would_change: changed.length,
      flags: flagCounts,
    },
    before: histogram(rows.map((r) => r.before)),
    after: histogram(rows.map((r) => r.after)),
    rows,
  };
}

/** Byg rapportens anker-felt til confidence_source (samme form som motoren læser). */
export function buildCorrectedSource(existingSource, row, activeSeasonId, nowIso) {
  const prev = existingSource && typeof existingSource === "object" && !Array.isArray(existingSource) ? existingSource : {};
  const next = {
    ...prev,
    method: CORRECTION_REASON,
    delta: row.after - row.before,
    season_delta: row.active_delta,
    target: row.after,
    season_anchor: { season_id: activeSeasonId, confidence: row.anchor },
    corrected_at: nowIso,
  };
  // En sæson der allerede er dømt, skal ikke låses af et gammelt mærke for en
  // anden sæson; et mærke for den aktive sæson bevares ikke (dommen er genberegnet).
  if (next.season_end_season_id === activeSeasonId) delete next.season_end_season_id;
  return next;
}

// ---------------------------------------------------------------------------
// I/O
// ---------------------------------------------------------------------------

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const i = index;
      index += 1;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

function must({ data, error }, label) {
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
}

export async function loadData(supabase, { concurrency = 8 } = {}) {
  const seasons = must(await supabase.from("seasons").select("id, number, status").order("number"), "seasons");
  const activeSeason = seasons.find((s) => s.status === "active");
  if (!activeSeason) throw new Error("Ingen aktiv sæson");
  const seasonNumberById = new Map(seasons.map((s) => [s.id, Number(s.number)]));

  const relations = await fetchAllRows(() => supabase.from("board_relations")
    .select("id, team_id, confidence, confidence_source").order("id"));
  const boards = await fetchAllRows(() => supabase.from("board_profiles")
    .select("id, team_id, plan_type, satisfaction, season_start_satisfaction, season_start_anchor_season_id").order("id"));
  const oneYearBoardIds = new Set(boards.filter((b) => b.plan_type === "1yr").map((b) => b.id));
  const oneYearBoardByTeam = new Map(boards.filter((b) => b.plan_type === "1yr").map((b) => [b.team_id, b]));
  const snapshots = await fetchAllRows(() => supabase.from("board_plan_snapshots")
    .select("id, team_id, board_id, season_number, satisfaction_delta").order("id"));
  const deltaByTeamSeason = new Map();
  for (const s of snapshots) {
    if (!oneYearBoardIds.has(s.board_id)) continue;
    if (!deltaByTeamSeason.has(s.team_id)) deltaByTeamSeason.set(s.team_id, new Map());
    deltaByTeamSeason.get(s.team_id).set(Number(s.season_number), Number(s.satisfaction_delta));
  }
  const milestones = await fetchAllRows(() => supabase.from("board_vision_milestones")
    .select("id, goal, weight, status").neq("status", "pending").order("id"));
  const milestonesById = new Map(milestones.map((m) => [m.id, m]));

  const perTeam = await mapLimit(relations, concurrency, async (relation) => {
    const eventCols = "id, season_id, reason_category, satisfaction_before, satisfaction_after, satisfaction_delta, milestone_id, created_at";
    const [first, verdicts, lastActive] = await Promise.all([
      supabase.from("board_satisfaction_events").select(eventCols)
        .eq("team_id", relation.team_id).in("reason_category", CONFIDENCE_REASONS)
        .order("created_at", { ascending: true }).limit(1),
      supabase.from("board_satisfaction_events").select(eventCols)
        .eq("team_id", relation.team_id).in("reason_category", ["season_end", ...MILESTONE_REASONS])
        .order("created_at", { ascending: true }),
      supabase.from("board_satisfaction_events").select(eventCols)
        .eq("team_id", relation.team_id).eq("reason_category", "weekend_update").eq("season_id", activeSeason.id)
        .order("created_at", { ascending: false }).limit(1),
    ]);
    return {
      relation,
      firstEvent: must(first, "events (first)")?.[0] ?? null,
      verdictEvents: must(verdicts, "events (verdicts)") ?? [],
      lastActiveWeekend: must(lastActive, "events (last active)")?.[0] ?? null,
    };
  });

  return { activeSeason, seasonNumberById, perTeam, deltaByTeamSeason, milestonesById, oneYearBoardByTeam };
}

export function computeRows(data) {
  return data.perTeam.map(({ relation, firstEvent, verdictEvents, lastActiveWeekend }) => ({
    relation_id: relation.id,
    ...replayTeamConfidence({
      relation,
      activeSeason: data.activeSeason,
      seasonNumberById: data.seasonNumberById,
      firstEvent,
      verdictEvents,
      lastActiveWeekend,
      oneYearDeltaBySeasonNumber: data.deltaByTeamSeason.get(relation.team_id) ?? new Map(),
      milestonesById: data.milestonesById,
      oneYearBoard: data.oneYearBoardByTeam.get(relation.team_id) ?? null,
    }),
  }));
}

/**
 * Skriv genberegningen. Kræver at kalderen har tjekket `--owner-go`.
 * `now` injiceres (ingen skjult ur).
 */
export async function applyPlan(supabase, { plan, data, now, backupDir, writeFile = writeFileSync, makeDir = mkdirSync, log = console.log }) {
  const nowIso = now.toISOString();
  const targets = plan.rows.filter((r) => r.status === "replayed" && r.after !== r.before);
  const relationsById = new Map(data.perTeam.map((t) => [t.relation.id, t.relation]));

  makeDir(backupDir, { recursive: true });
  const backupPath = join(backupDir, `board-relations-backup-${nowIso.replace(/[:.]/g, "-")}.json`);
  writeFile(backupPath, JSON.stringify(targets.map((r) => relationsById.get(r.relation_id)), null, 2));
  log(`Backup: ${backupPath} (${targets.length} rækker)`);

  let updated = 0;
  let skipped = 0;
  for (const row of targets) {
    const existing = relationsById.get(row.relation_id);
    const { data: hit, error } = await supabase.from("board_relations")
      .update({
        confidence: row.after,
        confidence_source: buildCorrectedSource(existing?.confidence_source, row, data.activeSeason.id, nowIso),
        last_event_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", row.relation_id)
      .eq("confidence", row.before)
      .select("id");
    if (error) throw new Error(`board_relations ${row.relation_id}: ${error.message}`);
    if (!hit?.length) { skipped += 1; continue; }
    const { error: eventError } = await supabase.from("board_satisfaction_events").insert({
      team_id: row.team_id,
      season_id: data.activeSeason.id,
      satisfaction_before: row.before,
      satisfaction_after: row.after,
      satisfaction_delta: row.after - row.before,
      goals_met: 0,
      goals_total: 0,
      reason_category: CORRECTION_REASON,
    });
    if (eventError) throw new Error(`board_satisfaction_events ${row.team_id}: ${eventError.message}`);
    updated += 1;
  }
  return { updated, skipped, backupPath };
}

export function parseArgs(argv) {
  const flags = new Set(argv.filter((a) => !a.includes("=")));
  const value = (name) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
  return {
    apply: flags.has("--apply"),
    ownerGo: flags.has("--owner-go"),
    json: value("json"),
    backupDir: value("backup-dir"),
  };
}

async function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const backendRoot = resolve(here, "..", "..");
  dotenv.config({ path: join(backendRoot, ".env"), quiet: true });
  const args = parseArgs(process.argv.slice(2));
  if (args.apply && !args.ownerGo) {
    console.error("--apply kræver --owner-go (ejerens ordrette \"kør\" efter at have set dry-run'et).");
    process.exit(2);
  }
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
    process.exit(2);
  }
  const now = new Date();
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
  const data = await loadData(supabase);
  const plan = buildPlan(computeRows(data));

  console.log(`#7088 tillids-genberegning, aktiv sæson ${data.activeSeason.number} (${args.apply ? "APPLY" : "DRY-RUN"})`);
  console.table(plan.summary.flags);
  console.log(JSON.stringify({ ...plan.summary, flags: undefined }, null, 2));
  console.log("Før:  ", plan.before.buckets.map((b) => `${b.range}:${b.count}`).join("  "), `| 0:${plan.before.at_0} 100:${plan.before.at_100}`);
  console.log("Efter:", plan.after.buckets.map((b) => `${b.range}:${b.count}`).join("  "), `| 0:${plan.after.at_0} 100:${plan.after.at_100}`);
  if (args.json) {
    writeFileSync(args.json, JSON.stringify({ generated_at: now.toISOString(), active_season: data.activeSeason.number, ...plan }, null, 2));
    console.log(`Rapport: ${args.json}`);
  }

  if (args.apply) {
    const backupDir = args.backupDir ?? join(backendRoot, "..", "balance-internals", "7088");
    const result = await applyPlan(supabase, { plan, data, now, backupDir });
    console.log(`APPLY: ${result.updated} relationer opdateret, ${result.skipped} sprunget over (tallet flyttede sig siden dry-run).`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((err) => { console.error(err?.message || err); process.exit(1); });
}
