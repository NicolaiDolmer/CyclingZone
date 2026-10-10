#!/usr/bin/env node
// backend/scripts/dev/repair5897BoardYouthRaces.mjs
// ============================================================================
// #5897 · Reparér bestyrelser der blev flyttet af ungdomsløb (S4 løbsdag 1, 28/9).
//
// HVAD SKETE DER. Hvert afsluttet U23-løb kørte den fulde bestyrelsesberegning for
// alle menneskehold (#5893, forebygget i #5892). Bestyrelsen hænger på senior-
// divisionen, så de bevægelser er forkerte, og de race-mærkede events vises i
// bestyrelseshistorikken.
//
// LØSNINGEN (issue #5897, ejer-gated):
//   1. Invers-delta pr. board, IKKE reset: ny satisfaction = nuværende minus summen
//      af boardets ungdoms-event-deltaer. Boards der siden er ændret af andre
//      skrivninger bevarer de ændringer.
//   2. budget_modifier genberegnes fra den reparerede satisfaction via
//      satisfactionToModifier (samme regel som weekend-opdateringen). Baseline-
//      boards rører ikke budget_modifier (samme regel som #2521).
//   3. Events tagget med ungdomsløb (races.squad <> 'senior') fjernes.
//
// TILSTANDE
//   dry-run (default, READ-ONLY, skriver aldrig til DB):
//     infisical run --env=prod --silent -- node scripts/dev/repair5897BoardYouthRaces.mjs
//     → aggregeret rapport i docs/snapshots/5897/dry-run-<tid>.md (ingen navne/ids)
//     → fuld plan pr. board i balance-internals/5897/dry-run-<tid>.json (gitignoreret)
//   apply (ejer-gated som #6198/#5864; kræver ALLE tre):
//     ... node scripts/dev/repair5897BoardYouthRaces.mjs --apply --owner-go=5897-production \
//           --approved-list=<liste-hash fra det dry-run ejeren godkendte> --events-only
//     (--events-only er PÅKRÆVET ved apply: fuld reparation (A) er blokeret, fordi
//      token + hash ellers også ville godkende den.)
//     (--events-only = ejerens valg B 1/10: fjern kun ungdoms-events; satisfaction/
//      budget_modifier røres ikke. Se "atTargetNow" i dry-run: et board på sit
//      target har allerede absorberet ungdomsløbenes ekstra skridt mod samme
//      senior-target.)
//     → STOP før første skrivning hvis (a) den levende ungdoms-event-mængde ikke
//       har præcis den godkendte liste-hash (eksakt id-mængde, ikke kun antal),
//       eller (b) backup_board_profiles_5897 / backup_board_satisfaction_events_5897
//       allerede findes.
//     → tager et frisk JSON-backup-snapshot (balance-internals) og skriver ÉN
//       transaktions-SQL (DO-blok) til balance-internals/5897/apply-<tid>.sql.
//       Backend har ingen pg-driver, og PostgREST kan ikke køre en transaktion,
//       så SQL'en køres som ét kald (Supabase SQL / MCP execute_sql). DO-blokken
//       gentager begge gates under lås (hash-tjek + to_regclass), og er atomisk:
//       backup-tabeller → UPDATE → DELETE → verify; enhver afvigelse RAISE'er og
//       ruller HELE blokken tilbage. Idempotent: 0 ungdoms-events tilbage = no-op.
//   verify (READ-ONLY, efter apply):
//     ... node scripts/dev/repair5897BoardYouthRaces.mjs --verify=5897/dry-run-<tid>.json
//
// Kolonner er slået op i database/schema-snapshot.json (board_profiles,
// board_satisfaction_events, races, teams).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { satisfactionToModifier } from "../../lib/boardEvaluation.js";
import { clampSatisfaction } from "../../lib/boardUtils.js";
import {
  clampBaselineSatisfaction,
  BASELINE_SATISFACTION_MIN,
  BASELINE_SATISFACTION_MAX,
} from "../../lib/boardWeekendUpdate.js";
import { fetchAllRows } from "../../lib/supabasePagination.js";

export const ISSUE = 5897;
export const BACKUP_PROFILES_TABLE = "backup_board_profiles_5897";
export const BACKUP_EVENTS_TABLE = "backup_board_satisfaction_events_5897";
export const OWNER_GO_TOKEN = "5897-production";
export const OWNER_GO_FLAG = `--owner-go=${OWNER_GO_TOKEN}`;
// Forebyggelsen (#5892: ungdomsløb rører ikke bestyrelsen) blev merget her. Et
// ungdoms-event oprettet senere er en regression i forebyggelsen, ikke en del af
// 28/9-hændelsen (deploy-lag på få minutter kan give falsk alarm; tjek tidsstempler).
export const PREVENTION_MERGED_AT = "2026-09-28T19:04:10Z";
// Det dry-run ejeren tog valg B på (1/10). Tallene genbruges ikke, kun sammenlignes.
export const BASELINE_REPORT = "dry-run-2026-10-01T15-15-24-548Z.md";
const HASH_RE = /^[a-f0-9]{64}$/;
// Ejerens valg 1/10 er B. Token + liste-hash godkender KUN events-only; variant A
// (invers-delta + budget_modifier) kræver en ny ejerbeslutning og en kodeændring her.
const FULL_REPAIR_BLOCKED = `--apply kræver --events-only: ejerens valg 1/10 er B, og ${OWNER_GO_FLAG} godkender ikke fuld reparation (A)`;
// En board-skrivning (updated_at) lander et øjeblik før eventet; margin så den
// samme finalization ikke tælles som "ændret siden".
export const CHANGED_SINCE_MARGIN_MS = 60_000;
// Gap-diagnostik: vindue omkring ungdomsløbene hvor events hentes for alle boards.
export const GAP_WINDOW_PAD_MS = 60 * 60_000;
const ID_CHUNK = 100;

const BOARD_COLUMNS = "id, team_id, plan_type, is_baseline, negotiation_status, satisfaction, budget_modifier, updated_at";
const EVENT_COLUMNS = "id, board_id, team_id, season_id, race_id, satisfaction_before, satisfaction_after, satisfaction_delta, created_at";

export function isBaselineBoard(board) {
  return board?.is_baseline === true || board?.plan_type === "baseline";
}

/**
 * Fingeraftryk af præcis den ungdoms-event-mængde ejeren har set: sha256 over
 * de unikke event-ids, sorteret i kodepunkt-orden og join'et med "\n". Samme
 * formel kører i apply-SQL'en (ORDER BY id::text COLLATE "C"), så en mængde der
 * har ændret sig siden dry-run'et stopper apply, også ved samme antal.
 */
export function eventIdSetHash(events) {
  const ids = [...new Set(events.map((e) => String(e.id)))].sort();
  return createHash("sha256").update(ids.join("\n"), "utf8").digest("hex");
}

function toMs(value) {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function round(value, digits = 2) {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

export function describeDistribution(values) {
  if (!values.length) return { count: 0, mean: null, median: null, min: null, max: null };
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return {
    count: sorted.length,
    mean: round(sorted.reduce((s, v) => s + v, 0) / sorted.length),
    median,
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

/** Repareret satisfaction for ét board (invers-delta + samme clamp som motoren). */
export function repairBoard(board, youthDelta) {
  const current = Number(board.satisfaction);
  const baseline = isBaselineBoard(board);
  const raw = current - youthDelta;
  const repaired = baseline ? clampBaselineSatisfaction(raw) : clampSatisfaction(raw);
  const oldModifier = board.budget_modifier == null ? null : Number(board.budget_modifier);
  const newModifier = baseline ? oldModifier : satisfactionToModifier(repaired);
  return {
    baseline,
    current,
    youthDelta,
    repaired,
    clamped: repaired !== raw,
    oldModifier,
    newModifier,
    modifierChanged: !baseline && newModifier !== oldModifier,
  };
}

/**
 * Ren planlægger (ingen DB). Input er rå rækker; output er plan pr. board +
 * aggregeret resumé. Kaster aldrig på manglende board — det tælles.
 */
export function planRepair({
  youthEvents = [],
  boards = [],
  teamBoards = [],
  teams = [],
  laterEvents = [],
  windowEvents = [],
} = {}) {
  const boardById = new Map(boards.map((b) => [b.id, b]));
  const youthEventIds = new Set(youthEvents.map((e) => e.id));

  const byBoard = new Map();
  for (const event of youthEvents) {
    if (!event.board_id) continue;
    const entry = byBoard.get(event.board_id) || { delta: 0, events: 0, lastAt: null };
    entry.delta += Number(event.satisfaction_delta) || 0;
    entry.events += 1;
    const at = toMs(event.created_at);
    if (at != null && (entry.lastAt == null || at > entry.lastAt)) entry.lastAt = at;
    byBoard.set(event.board_id, entry);
  }
  const youthTimes = youthEvents.map((e) => toMs(e.created_at)).filter((v) => v != null);
  const windowStart = youthTimes.length ? Math.min(...youthTimes) : null;
  const windowEnd = youthTimes.length ? Math.max(...youthTimes) : null;

  const laterByBoard = new Map();
  const lastRaceEventByBoard = new Map();
  for (const event of laterEvents) {
    if (youthEventIds.has(event.id) || !event.board_id) continue;
    const at = toMs(event.created_at);
    const list = laterByBoard.get(event.board_id) || [];
    list.push(at);
    laterByBoard.set(event.board_id, list);
    // Seneste (senior-)løbs-event efter ungdomsløbene: weekend-opdateringen er
    // target-tracking, så et 0-skridt betyder at boardet står PÅ sit target.
    if (event.race_id && at != null) {
      const prev = lastRaceEventByBoard.get(event.board_id);
      if (!prev || at > prev.at) lastRaceEventByBoard.set(event.board_id, { at, event });
    }
  }

  const plans = [];
  let missingBoards = 0;
  for (const [boardId, entry] of byBoard) {
    const board = boardById.get(boardId);
    if (!board) { missingBoards += 1; continue; }
    const repair = repairBoard(board, entry.delta);
    const updatedAt = toMs(board.updated_at);
    const later = laterByBoard.get(boardId) || [];
    const changedAfterOwnLast = (updatedAt != null && updatedAt > entry.lastAt + CHANGED_SINCE_MARGIN_MS)
      || later.some((t) => t != null && t > entry.lastAt);
    const changedAfterWindow = (updatedAt != null && updatedAt > windowEnd + CHANGED_SINCE_MARGIN_MS)
      || later.some((t) => t != null && t > windowEnd);
    // Konvergens: står boardet i dag på det target senior-standingen giver?
    // (seneste senior-event havde 0-skridt OG nuværende værdi = dets "after").
    // Ungdomsløbene evaluerede samme senior-standing, så deres skridt var ekstra
    // skridt mod SAMME target; et konvergeret board vil blive trukket tilbage af
    // næste løb hvis invers-delta flytter det væk fra target.
    const lastRace = lastRaceEventByBoard.get(boardId)?.event;
    const atTargetNow = Boolean(lastRace)
      && Number(lastRace.satisfaction_delta) === 0
      && Number(lastRace.satisfaction_after) === repair.current;
    plans.push({
      board_id: boardId,
      team_id: board.team_id,
      events: entry.events,
      changedAfterOwnLast,
      changedAfterWindow,
      raceEventsSince: later.length,
      atTargetNow,
      ...repair,
    });
  }

  // Økonomi: sponsor bruger gennemsnittet af budget_modifier over holdets
  // completed boards (sponsorEngine lag 1). Estimeret effekt pr. sæson =
  // sponsor_income × (nyt snit − gammelt snit).
  const planByBoard = new Map(plans.map((p) => [p.board_id, p]));
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const boardsByTeam = new Map();
  for (const b of teamBoards) {
    if (b.negotiation_status !== "completed") continue;
    const list = boardsByTeam.get(b.team_id) || [];
    list.push(b);
    boardsByTeam.set(b.team_id, list);
  }
  const economy = [];
  for (const teamId of new Set(plans.map((p) => p.team_id))) {
    const list = boardsByTeam.get(teamId) || [];
    if (!list.length) continue;
    const avg = (pick) => list.reduce((s, b) => s + pick(b), 0) / list.length;
    const oldAvg = avg((b) => Number(b.budget_modifier ?? 1.0));
    const newAvg = avg((b) => {
      const p = planByBoard.get(b.id);
      return p && !p.baseline ? p.newModifier : Number(b.budget_modifier ?? 1.0);
    });
    if (oldAvg === newAvg) continue;
    const sponsor = Number(teamById.get(teamId)?.sponsor_income) || 0;
    economy.push({ team_id: teamId, oldAvg: round(oldAvg, 4), newAvg: round(newAvg, 4), sponsorDelta: Math.round(sponsor * (newAvg - oldAvg)) });
  }

  // Gap-diagnostik: boards UDEN ungdoms-events hvis satisfaction flyttede sig
  // uden et logget event i ungdomsvinduet (events skrives kun ved pulje-match,
  // #3144). Kun rapporteret — ikke en del af reparationen (ingen attribuerbar
  // event-kilde). Ejer-beslutning.
  const gaps = new Map();
  if (windowStart != null) {
    const sortedByBoard = new Map();
    for (const e of windowEvents) {
      if (!e.board_id || byBoard.has(e.board_id)) continue;
      const list = sortedByBoard.get(e.board_id) || [];
      list.push(e);
      sortedByBoard.set(e.board_id, list);
    }
    for (const [boardId, list] of sortedByBoard) {
      list.sort((a, b) => (toMs(a.created_at) - toMs(b.created_at)) || String(a.id).localeCompare(String(b.id)));
      let gap = 0;
      for (let i = 1; i < list.length; i += 1) {
        const prevAt = toMs(list[i - 1].created_at);
        const at = toMs(list[i].created_at);
        if (prevAt < windowEnd && at > windowStart) {
          gap += Number(list[i].satisfaction_before) - Number(list[i - 1].satisfaction_after);
        }
      }
      if (gap !== 0) gaps.set(boardId, gap);
    }
  }

  const deltas = plans.map((p) => p.youthDelta);
  const sponsorDeltas = economy.map((e) => e.sponsorDelta);
  const preventionAt = toMs(PREVENTION_MERGED_AT);
  const summary = {
    listHash: eventIdSetHash(youthEvents),
    youthEvents: youthEvents.length,
    youthEventsAfterPrevention: youthEvents.filter((e) => {
      const at = toMs(e.created_at);
      return at != null && at > preventionAt;
    }).length,
    youthRacesWithEvents: new Set(youthEvents.map((e) => e.race_id)).size,
    boards: plans.length,
    missingBoards,
    teams: new Set(plans.map((p) => p.team_id)).size,
    baselineBoards: plans.filter((p) => p.baseline).length,
    nonZeroDeltaBoards: plans.filter((p) => p.youthDelta !== 0).length,
    delta: describeDistribution(deltas),
    absDeltaAtLeast10: deltas.filter((d) => Math.abs(d) >= 10).length,
    positiveDeltaBoards: deltas.filter((d) => d > 0).length,
    negativeDeltaBoards: deltas.filter((d) => d < 0).length,
    changedAfterOwnLastYouthEvent: plans.filter((p) => p.changedAfterOwnLast).length,
    changedAfterYouthWindow: plans.filter((p) => p.changedAfterWindow).length,
    eventsSinceYouthWindow: describeDistribution(plans.map((p) => p.raceEventsSince)),
    atTargetNow: plans.filter((p) => p.atTargetNow).length,
    atTargetNowWithNonZeroDelta: plans.filter((p) => p.atTargetNow && p.youthDelta !== 0).length,
    clampedBoards: plans.filter((p) => p.clamped).length,
    satisfactionChangedBoards: plans.filter((p) => p.repaired !== p.current).length,
    modifierChangedBoards: plans.filter((p) => p.modifierChanged).length,
    modifierDown: plans.filter((p) => p.modifierChanged && p.newModifier < p.oldModifier).length,
    modifierUp: plans.filter((p) => p.modifierChanged && p.newModifier > p.oldModifier).length,
    economyTeams: economy.length,
    sponsorDelta: sponsorDeltas.length
      ? { sum: sponsorDeltas.reduce((s, v) => s + v, 0), min: Math.min(...sponsorDeltas), max: Math.max(...sponsorDeltas) }
      : { sum: 0, min: null, max: null },
    silentGapBoards: gaps.size,
    silentGap: describeDistribution([...gaps.values()]),
    window: windowStart == null ? null : { start: new Date(windowStart).toISOString(), end: new Date(windowEnd).toISOString() },
  };
  return { summary, plans, economy, silentGaps: [...gaps].map(([board_id, gap]) => ({ board_id, gap })) };
}

function chunk(list, size = ID_CHUNK) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

async function fetchIn(supabase, table, columns, column, ids, extra = (q) => q) {
  const rows = [];
  for (const part of chunk([...new Set(ids)])) {
    rows.push(...await fetchAllRows(() => extra(supabase.from(table).select(columns).in(column, part)).order("id")));
  }
  return rows;
}

/** READ-ONLY loader. Kun select-kald. */
export async function loadRepairInput(supabase) {
  const youthRaces = await fetchAllRows(() => supabase.from("races").select("id, squad").neq("squad", "senior").order("id"));
  const youthRaceIds = youthRaces.map((r) => r.id);
  const youthEvents = youthRaceIds.length
    ? await fetchIn(supabase, "board_satisfaction_events", EVENT_COLUMNS, "race_id", youthRaceIds)
    : [];
  const boardIds = [...new Set(youthEvents.map((e) => e.board_id).filter(Boolean))];
  const boards = boardIds.length ? await fetchIn(supabase, "board_profiles", BOARD_COLUMNS, "id", boardIds) : [];
  const teamIds = [...new Set(boards.map((b) => b.team_id).filter(Boolean))];
  const teamBoards = teamIds.length ? await fetchIn(supabase, "board_profiles", BOARD_COLUMNS, "team_id", teamIds) : [];
  const teams = teamIds.length ? await fetchIn(supabase, "teams", "id, sponsor_income", "id", teamIds) : [];

  const times = youthEvents.map((e) => toMs(e.created_at)).filter((v) => v != null);
  let laterEvents = [];
  let windowEvents = [];
  if (times.length) {
    const start = Math.min(...times);
    const end = Math.max(...times);
    laterEvents = await fetchIn(supabase, "board_satisfaction_events", "id, board_id, race_id, satisfaction_after, satisfaction_delta, created_at", "board_id", boardIds,
      (q) => q.gt("created_at", new Date(start).toISOString()));
    windowEvents = await fetchAllRows(() => supabase.from("board_satisfaction_events")
      .select("id, board_id, satisfaction_before, satisfaction_after, created_at")
      .gte("created_at", new Date(start - GAP_WINDOW_PAD_MS).toISOString())
      .lte("created_at", new Date(end + GAP_WINDOW_PAD_MS).toISOString())
      .order("id"));
  }
  return { youthRaces, youthEvents, boards, teamBoards, teams, laterEvents, windowEvents };
}

/** satisfactionToModifier som SQL-CASE, afledt af JS-funktionen (én kilde). */
export function modifierCaseSql(expr) {
  const bands = [];
  let start = 0;
  let current = satisfactionToModifier(0);
  for (let s = 1; s <= 100; s += 1) {
    const value = satisfactionToModifier(s);
    if (value !== current) { bands.push({ from: start, value: current }); start = s; current = value; }
  }
  bands.push({ from: start, value: current });
  const whens = bands.slice(1).reverse().map((b) => `WHEN ${expr} >= ${b.from} THEN ${b.value}`).join(" ");
  return `(CASE ${whens} ELSE ${bands[0].value} END)`;
}

/**
 * Én atomisk DO-blok: lås → no-op-tjek → backup-tabeller → UPDATE → DELETE →
 * verify. Indeholder ingen ids/holdnavne — alt afledes live i transaktionen.
 */
export function buildApplySql({ eventsOnly = false, approvedHash } = {}) {
  if (!HASH_RE.test(String(approvedHash ?? ""))) {
    throw new Error("buildApplySql kræver approvedHash (64 tegn liste-hash fra det godkendte dry-run)");
  }
  const youthEvents = `public.board_satisfaction_events e JOIN public.races r ON r.id = e.race_id WHERE r.squad <> 'senior'`;
  const repairedExpr = `(CASE WHEN (b.is_baseline IS TRUE OR b.plan_type = 'baseline')
        THEN LEAST(${BASELINE_SATISFACTION_MAX}, GREATEST(${BASELINE_SATISFACTION_MIN}, round(b.satisfaction - d.yd)))
        ELSE LEAST(100, GREATEST(0, round(b.satisfaction - d.yd))) END)`;
  const sql = `-- #${ISSUE} · Reparation af bestyrelser flyttet af ungdomsløb. EJER-GATED.
-- Kør som ÉT kald. DO-blokken er atomisk: enhver RAISE EXCEPTION ruller alt tilbage.
-- Idempotent: 0 ungdoms-events tilbage => NOTICE + no-op. Backup findes => STOP.
-- Godkendt liste-hash: ${approvedHash} (afviger den levende event-mængde => STOP).
DO $repair$
DECLARE
  n_events int; n_boards int; n_backup_p int; n_backup_e int; n_upd int; n_del int; n_bad int;
  live_hash text;
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);
  LOCK TABLE public.board_profiles, public.board_satisfaction_events IN SHARE ROW EXCLUSIVE MODE;

  SELECT count(*), count(DISTINCT e.board_id) INTO n_events, n_boards FROM ${youthEvents};
  IF n_events = 0 THEN
    RAISE NOTICE '#${ISSUE}: 0 ungdoms-events tilbage - intet at reparere (no-op)';
    RETURN;
  END IF;
  IF to_regclass('public.${BACKUP_PROFILES_TABLE}') IS NOT NULL OR to_regclass('public.${BACKUP_EVENTS_TABLE}') IS NOT NULL THEN
    RAISE EXCEPTION 'STOP #${ISSUE}: backup-tabel findes allerede, men der er stadig % ungdoms-events. Undersøg før ny kørsel.', n_events;
  END IF;
  -- Liste-gate under lås: samme formel som eventIdSetHash (unikke ids, kodepunkt-orden, "\\n").
  SELECT encode(sha256(convert_to(string_agg(x.id_text, E'\\n' ORDER BY x.id_text COLLATE "C"), 'UTF8')), 'hex')
    INTO live_hash
    FROM (SELECT DISTINCT e.id::text AS id_text FROM ${youthEvents}) x;
  IF live_hash IS DISTINCT FROM '${approvedHash}' THEN
    RAISE EXCEPTION 'STOP #${ISSUE}: levende ungdoms-event-mængde (% events) matcher ikke den godkendte liste-hash. Kør nyt dry-run og vis ejeren.', n_events;
  END IF;

  -- 1. Backup FØR skrivning (i samme transaktion; RLS slået til, ingen policies).
  CREATE TABLE public.${BACKUP_EVENTS_TABLE} AS SELECT e.* FROM ${youthEvents};
  CREATE TABLE public.${BACKUP_PROFILES_TABLE} AS
    SELECT b.* FROM public.board_profiles b
    WHERE b.id IN (SELECT e.board_id FROM ${youthEvents});
  ALTER TABLE public.${BACKUP_EVENTS_TABLE} ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.${BACKUP_PROFILES_TABLE} ENABLE ROW LEVEL SECURITY;
  SELECT count(*) INTO n_backup_e FROM public.${BACKUP_EVENTS_TABLE};
  SELECT count(*) INTO n_backup_p FROM public.${BACKUP_PROFILES_TABLE};
  IF n_backup_e <> n_events THEN
    RAISE EXCEPTION 'STOP #${ISSUE}: event-backup % <> % events', n_backup_e, n_events;
  END IF;

  --@profiles-begin
  -- 2. Invers-delta pr. board + budget_modifier fra repareret satisfaction.
  --    Plan beregnes fra backup-rækkerne (= værdien lige før UPDATE, under lås).
  CREATE TEMP TABLE _repair_${ISSUE} ON COMMIT DROP AS
    SELECT b.id AS board_id, d.yd,
      (b.is_baseline IS TRUE OR b.plan_type = 'baseline') AS baseline,
      ${repairedExpr}::int AS repaired
    FROM public.${BACKUP_PROFILES_TABLE} b
    JOIN (SELECT e.board_id, sum(e.satisfaction_delta)::numeric AS yd
          FROM public.${BACKUP_EVENTS_TABLE} e WHERE e.board_id IS NOT NULL GROUP BY e.board_id) d
      ON d.board_id = b.id;

  UPDATE public.board_profiles p SET
    satisfaction = r.repaired,
    budget_modifier = CASE WHEN r.baseline THEN p.budget_modifier ELSE ${modifierCaseSql("r.repaired")} END,
    updated_at = now()
  FROM _repair_${ISSUE} r
  WHERE p.id = r.board_id;
  GET DIAGNOSTICS n_upd = ROW_COUNT;
  IF n_upd <> n_backup_p THEN
    RAISE EXCEPTION 'STOP #${ISSUE}: opdaterede % boards, backup har %', n_upd, n_backup_p;
  END IF;

  --@profiles-end
  -- 3. Fjern ungdoms-events fra historikken.
  DELETE FROM public.board_satisfaction_events e USING public.races r
  WHERE r.id = e.race_id AND r.squad <> 'senior';
  GET DIAGNOSTICS n_del = ROW_COUNT;
  IF n_del <> n_events THEN
    RAISE EXCEPTION 'STOP #${ISSUE}: slettede % events, forventede %', n_del, n_events;
  END IF;

  -- 4. Verify i transaktionen.
  IF EXISTS (SELECT 1 FROM ${youthEvents}) THEN
    RAISE EXCEPTION 'STOP #${ISSUE}: ungdoms-events tilbage efter DELETE';
  END IF;
  --@profiles-begin
  SELECT count(*) INTO n_bad
  FROM public.${BACKUP_PROFILES_TABLE} b
  JOIN _repair_${ISSUE} r ON r.board_id = b.id
  JOIN public.board_profiles n ON n.id = b.id
  WHERE n.satisfaction IS DISTINCT FROM r.repaired
     OR (NOT r.baseline AND n.budget_modifier IS DISTINCT FROM ${modifierCaseSql("r.repaired")})
     OR (r.baseline AND n.budget_modifier IS DISTINCT FROM b.budget_modifier);
  IF n_bad > 0 THEN
    RAISE EXCEPTION 'STOP #${ISSUE}: % boards matcher ikke den forventede værdi', n_bad;
  END IF;
  --@profiles-end

  RAISE NOTICE '#${ISSUE}: OK - % boards repareret, % events fjernet, backup i % og %',
    COALESCE(n_upd, 0), n_del, '${BACKUP_PROFILES_TABLE}', '${BACKUP_EVENTS_TABLE}';
END
$repair$;
`;
  if (!eventsOnly) return sql.replace(/^ {2}--@profiles-(begin|end)\n/gm, "");
  return sql
    .replace(/^ {2}--@profiles-begin\n[\s\S]*?^ {2}--@profiles-end\n/gm, "")
    .replace("-- #" + ISSUE + " · Reparation", "-- #" + ISSUE + " · EVENTS-ONLY (satisfaction/budget_modifier røres ikke) · Reparation");
}

/** READ-ONLY post-apply verify mod den private dry-run-plan. */
export function verifyAgainstPlan({ plan, youthEventsRemaining, boards, eventsOnly = false }) {
  const byId = new Map(boards.map((b) => [b.id, b]));
  const mismatches = [];
  for (const p of plan.plans) {
    const board = byId.get(p.board_id);
    if (!board) { mismatches.push({ board_id: p.board_id, reason: "missing" }); continue; }
    // Kun boards der ikke er skrevet af andre siden dry-run kan sammenlignes eksakt.
    const expectedSatisfaction = eventsOnly ? p.current : p.repaired;
    if (Number(board.satisfaction) !== expectedSatisfaction) {
      mismatches.push({ board_id: p.board_id, reason: "satisfaction", expected: expectedSatisfaction, actual: Number(board.satisfaction) });
    } else {
      // events-only og baseline: budget_modifier skal være uændret.
      const expectedModifier = eventsOnly || p.baseline ? p.oldModifier : p.newModifier;
      const actualModifier = board.budget_modifier == null ? null : Number(board.budget_modifier);
      if (expectedModifier !== undefined && actualModifier !== expectedModifier) {
        mismatches.push({ board_id: p.board_id, reason: "budget_modifier", expected: expectedModifier, actual: actualModifier });
      }
    }
  }
  return { ok: youthEventsRemaining === 0 && mismatches.length === 0, youthEventsRemaining, checked: plan.plans.length, mismatches };
}

export function parseArgs(args) {
  const options = { apply: false, ownerGo: false, approvedHash: null, verify: null, dryRun: true, eventsOnly: false };
  for (const arg of args) {
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--apply") options.apply = true;
    else if (arg === OWNER_GO_FLAG) options.ownerGo = true;
    else if (arg === "--owner-go" || arg.startsWith("--owner-go=")) {
      throw new Error(`Forkert owner-go-token: brug ${OWNER_GO_FLAG} (ejer-gated, #5897)`);
    } else if (arg.startsWith("--approved-list=")) {
      const hash = arg.slice("--approved-list=".length);
      if (!HASH_RE.test(hash)) throw new Error("--approved-list skal være den 64-tegns liste-hash som dry-run'et skrev");
      options.approvedHash = hash;
    } else if (arg === "--events-only") options.eventsOnly = true;
    else if (arg.startsWith("--verify=") && arg.length > 9) options.verify = arg.slice(9);
    else throw new Error(`Ukendt argument: ${arg}`);
  }
  if (options.apply && !options.ownerGo) throw new Error(`--apply kræver ${OWNER_GO_FLAG} (ejer-gated, #5897)`);
  if (options.apply && !options.approvedHash) {
    throw new Error("--apply kræver --approved-list=<liste-hash fra det dry-run ejeren godkendte>");
  }
  if (options.apply && !options.eventsOnly) throw new Error(FULL_REPAIR_BLOCKED);
  if (options.ownerGo && !options.apply) throw new Error("--owner-go uden --apply giver ingen mening");
  if (options.approvedHash && !options.apply) throw new Error("--approved-list uden --apply giver ingen mening");
  if (options.apply && options.verify) throw new Error("--apply og --verify kan ikke kombineres");
  if (options.eventsOnly && !options.apply && !options.verify) throw new Error(`--events-only kræver --apply ${OWNER_GO_FLAG} eller --verify`);
  if (options.apply || options.verify) options.dryRun = false;
  return options;
}

// PostgREST svarer PGRST205 (ukendt i schema-cachen) eller 42P01 for en tabel der
// ikke findes. Alt andet er en ukendt fejl og skal stoppe apply, ikke tolkes som "fri".
function isMissingTableError(error) {
  if (!error) return false;
  if (error.code === "PGRST205" || error.code === "42P01") return true;
  return /could not find the table|does not exist/i.test(String(error.message ?? ""));
}

/** READ-ONLY: hvilke af de to backup-tabeller findes allerede? */
export async function existingBackupTables(supabase) {
  const found = [];
  for (const table of [BACKUP_PROFILES_TABLE, BACKUP_EVENTS_TABLE]) {
    const { error } = await supabase.from(table).select("*").limit(1);
    if (!error) { found.push(table); continue; }
    if (isMissingTableError(error)) continue;
    throw new Error(`STOP #${ISSUE}: kunne ikke afgøre om ${table} findes (${error.message}). Intet skrevet.`);
  }
  return found;
}

/**
 * Apply-gate (#6198-mønster). Kører FØR første skrivning, også før private
 * filer: token, eksakt liste-hash mod den levende mængde, og ingen eksisterende
 * backup-tabel. Returnerer SQL'en der selv gentager hash- og backup-tjek under lås.
 */
export async function prepareApply({ supabase, input, ownerGo, approvedHash, eventsOnly = false, checkBackups = existingBackupTables }) {
  if (!ownerGo) throw new Error(`STOP #${ISSUE}: apply kræver ${OWNER_GO_FLAG}. Intet skrevet.`);
  if (!eventsOnly) throw new Error(`STOP #${ISSUE}: ${FULL_REPAIR_BLOCKED}. Intet skrevet.`);
  if (!HASH_RE.test(String(approvedHash ?? ""))) {
    throw new Error(`STOP #${ISSUE}: apply kræver --approved-list=<liste-hash>. Intet skrevet.`);
  }
  const liveHash = eventIdSetHash(input.youthEvents);
  if (liveHash !== approvedHash) {
    throw new Error(`STOP #${ISSUE}: den levende ungdoms-event-mængde (${input.youthEvents.length} events, hash ${liveHash}) afviger fra den godkendte liste. Kør nyt dry-run og vis ejeren. Intet skrevet.`);
  }
  const existing = await checkBackups(supabase);
  if (existing.length) {
    throw new Error(`STOP #${ISSUE}: backup-tabel findes allerede (${existing.join(", ")}). Undersøg før ny kørsel. Intet skrevet.`);
  }
  return { liveHash, sql: buildApplySql({ eventsOnly, approvedHash }) };
}


const AFTER_PREVENTION_LABEL = "Ungdoms-events oprettet efter forebyggelsen (#5892), forventet 0";

/** Tabelrækker [label, værdi]. Labels er nøglen for sammenligningen mod 1/10. */
export function reportRows(summary) {
  return [
    ["Ungdoms-events (races.squad <> 'senior') der fjernes", summary.youthEvents],
    [AFTER_PREVENTION_LABEL, summary.youthEventsAfterPrevention],
    ["Ungdomsløb med events", summary.youthRacesWithEvents],
    ["Boards med invers-delta", summary.boards],
    ["Hold berørt", summary.teams],
    ["Heraf baseline-boards (budget_modifier røres ikke)", summary.baselineBoards],
    ["Boards med netto-delta forskellig fra 0", summary.nonZeroDeltaBoards],
    ["Boards med stor bevægelse (abs. delta i top-båndet, se privat fil)", summary.absDeltaAtLeast10],
    ["Boards ændret af andre skrivninger efter ungdomsvinduet", summary.changedAfterYouthWindow],
    ["Boards der i dag står PÅ deres target (seneste senior-skridt = 0)", summary.atTargetNow],
    ["Heraf med netto-delta forskellig fra 0 (invers-delta flytter dem væk fra target)", summary.atTargetNowWithNonZeroDelta],
    ["Boards hvor clamp bider ved reparationen", summary.clampedBoards],
    ["Boards hvor satisfaction ændres", summary.satisfactionChangedBoards],
    ["Boards hvor budget_modifier ændres (op / ned)", `${summary.modifierChangedBoards} (${summary.modifierUp} / ${summary.modifierDown})`],
    ["Hold med ændret sponsor-modifier", summary.economyTeams],
    ["Boards der mangler (event uden board)", summary.missingBoards],
    ["Uattribuerede gap-boards (bevægelse uden event i vinduet, IKKE i reparationen)", summary.silentGapBoards],
  ];
}

/** Læser "| label | værdi |"-rækkerne fra en tidligere offentlig rapport. */
export function parseReportCounts(markdown) {
  const counts = new Map();
  for (const line of String(markdown ?? "").split(/\r?\n/)) {
    const cells = line.split("|").map((c) => c.trim());
    // "| a | b |" giver ["", "a", "b", ""]; header og separator springes over.
    if (cells.length < 4 || cells[0] !== "" || !cells[1] || /^-+$/.test(cells[1]) || cells[1] === "Mål") continue;
    counts.set(cells[1], cells[2]);
  }
  return counts;
}

/** Ændring mod 1/10 for én række: "uændret", "+N"/"-N", "ændret" eller "ny". */
export function compareCell(now, before) {
  if (before === undefined) return "ny";
  const a = String(now);
  const b = String(before);
  if (a === b) return "uændret";
  if (/^-?\d+$/.test(a) && /^-?\d+$/.test(b)) {
    const diff = Number(a) - Number(b);
    return diff > 0 ? `+${diff}` : String(diff);
  }
  return "ændret";
}

/** Aggregeret, repo-sikker rapport: kun antal og kvalitative udsagn. */
export function renderPublicReport(summary, { generatedAt, privateFile, baseline = null, baselineName = BASELINE_REPORT }) {
  const has = (n) => (n > 0 ? "ja" : "nej");
  const rows = reportRows(summary);
  const table = baseline
    ? ["| Mål | Nu | 1/10 | Ændring |", "|---|---|---|---|",
      ...rows.map(([label, value]) => `| ${label} | ${value} | ${baseline.get(label) ?? "-"} | ${compareCell(value, baseline.get(label))} |`)]
    : ["| Mål | Antal |", "|---|---|", ...rows.map(([label, value]) => `| ${label} | ${value} |`)];
  const changed = baseline
    ? rows.filter(([label, value]) => baseline.has(label) && compareCell(value, baseline.get(label)) !== "uændret").map(([label]) => label)
    : [];
  const regression = summary.youthEventsAfterPrevention > 0;
  const windowLine = summary.window
    ? `Ungdoms-events ligger mellem ${summary.window.start} og ${summary.window.end} (UTC).`
    : "Ingen ungdoms-events fundet.";
  return `# #${ISSUE} dry-run - bestyrelser flyttet af ungdomsløb

Genereret: ${generatedAt} (READ-ONLY, intet skrevet til DB)

Repoet er offentligt: denne fil har kun antal. Fordelinger, økonomi-tal og plan
pr. board ligger i \`balance-internals/${privateFile}\` (gitignoreret).

## Apply-gate

- Liste-hash (apply kræver \`--approved-list=\` med netop denne): \`${summary.listHash}\`
- Hashen dækker den eksakte mængde af ${summary.youthEvents} ungdoms-event-ids. Er der kommet et
  event til eller faldet et væk siden dette dry-run, stopper apply før første skrivning,
  også ved samme antal. Det samme gør en eksisterende \`${BACKUP_PROFILES_TABLE}\` eller
  \`${BACKUP_EVENTS_TABLE}\`.
- Kommando fra \`backend/\` via \`infisical run --env=prod --silent --\` (ejerens valg B 1/10,
  kun efter særskilt ejer-go på DETTE dry-run):
  \`node scripts/dev/repair5897BoardYouthRaces.mjs --apply ${OWNER_GO_FLAG} --approved-list=${summary.listHash} --events-only\`

## Forebyggelsen (#5892)

${windowLine}
Ungdoms-events oprettet efter forebyggelsen blev merget (${PREVENTION_MERGED_AT}): **${summary.youthEventsAfterPrevention}**.
${regression
    ? "**REGRESSION: ungdomsløb skriver stadig til bestyrelsen efter #5892. Reparationen må ikke køres før det er undersøgt** (eller tidsstemplerne viser at det kun er deploy-lag lige efter merge)."
    : "Forventet 0: forebyggelsen holder, mængden vokser ikke."}

## Tal${baseline ? ` (nu mod 1/10-dry-run'et \`${baselineName}\`)` : ""}

${table.join("\n")}

${baseline
    ? (changed.length ? `Ændret siden 1/10: ${changed.length} rækker (se kolonnen Ændring). 1/10-tallene må ikke genbruges til go.` : "Uændret siden 1/10 i alle rækker. Tallene her (ikke 1/10's) er grundlaget for go.")
    : "Ingen 1/10-baseline fundet til sammenligning."}

Netto-retning: ${summary.positiveDeltaBoards} boards blev løftet og ${summary.negativeDeltaBoards} sænket af ungdomsløbene.
Økonomisk effekt findes: ${has(summary.economyTeams)} (beløb kun i privat fil).

## Vigtigt fund: bevægelsen er allerede absorberet

Weekend-opdateringen er target-tracking: hvert løb flytter satisfaction et begrænset
skridt mod et target beregnet ud fra holdets SENIOR-standing. Ungdomsløbene brugte
samme senior-standing, så deres skridt var ekstra skridt mod SAMME target, ikke en
anden retning. Siden er der kørt mange seniorløb, og når et board står på sit target
(seneste skridt = 0), har ungdomsløbene kun gjort konvergensen hurtigere.

Konsekvens for et konvergeret board: invers-delta flytter det VÆK fra target, og de
næste seniorløb trækker det tilbage igen (med budget_modifier-udsving undervejs).
Scriptet har to apply-varianter; ejeren valgte B 1/10:

- **A. Fuld reparation** (issuets forslag): invers-delta + budget_modifier + fjern events.
  Blokeret i apply: kræver en ny ejerbeslutning og en kodeændring.
- **B. Kun events** (\`--events-only\`, valgt og påkrævet ved apply): fjern ungdoms-events fra historikken;
  satisfaction og budget_modifier røres ikke, fordi de allerede står hvor
  senior-resultaterne siger.

## Metode

- Invers-delta pr. board (ikke reset): ny satisfaction = nuværende minus summen af
  boardets ungdoms-event-deltaer, med samme clamp som motoren (baseline-boards
  har deres eget smalle bånd). Kun relevant for variant A.
- budget_modifier genberegnes via \`satisfactionToModifier\` for ikke-baseline boards (A).
- Ungdoms-events fjernes fra \`board_satisfaction_events\` (A og B).
- Apply er ejer-gated (\`--apply ${OWNER_GO_FLAG} --approved-list=<hash>\`), stopper før
  første skrivning ved hash-afvigelse eller eksisterende backup-tabel, og kører som én
  atomisk SQL-blok der gentager begge tjek under lås, tager backup-tabeller og
  verificerer i samme transaktion.

## Ikke dækket

- Uattribuerede gap-boards: boards uden ungdoms-events hvis satisfaction flyttede sig
  i vinduet uden logget event (events skrives kun ved pulje-match). De kan være
  ungdomsløbs-bevægelser, men har ingen event-kilde. Ejer-beslutning om de skal med.
- Skyggemodellen (\`board_relations\`) røres ikke.
- Sponsor allerede udbetalt på den forkerte modifier korrigeres ikke her.
`;
}

function privateRoot() {
  return fileURLToPath(new URL("../../../balance-internals/", import.meta.url));
}

function resolvePrivate(rel) {
  const root = privateRoot();
  const out = resolve(root, rel);
  const r = relative(root, out);
  if (!r || r.startsWith("..") || isAbsolute(r)) throw new Error("Sti skal ligge i balance-internals");
  return out;
}

function writeFileEnsured(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { createClient } = await import("@supabase/supabase-js");
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY mangler");
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");

  if (options.verify) {
    const plan = JSON.parse(readFileSync(resolvePrivate(options.verify), "utf8"));
    const input = await loadRepairInput(supabase);
    const boards = await fetchIn(supabase, "board_profiles", BOARD_COLUMNS, "id", plan.plans.map((p) => p.board_id));
    const result = verifyAgainstPlan({ plan, youthEventsRemaining: input.youthEvents.length, boards, eventsOnly: options.eventsOnly });
    console.log(JSON.stringify({ ok: result.ok, youthEventsRemaining: result.youthEventsRemaining, checked: result.checked, mismatches: result.mismatches.length }));
    if (result.mismatches.length) {
      const file = resolvePrivate(`5897/verify-${stamp}.json`);
      writeFileEnsured(file, JSON.stringify(result, null, 2) + "\n");
      console.log(`Afvigelser (fx boards skrevet af løb efter dry-run) i ${file}`);
    }
    if (!result.ok) process.exitCode = 1;
    return;
  }

  const input = await loadRepairInput(supabase);
  const plan = planRepair(input);
  const privateFile = `5897/dry-run-${stamp}.json`;

  if (options.apply) {
    // Gate FØR enhver skrivning (også private filer): token, liste-hash, backup-tabeller.
    const { sql } = await prepareApply({
      supabase, input, ownerGo: options.ownerGo, approvedHash: options.approvedHash, eventsOnly: options.eventsOnly,
    });
    writeFileEnsured(resolvePrivate(privateFile), JSON.stringify({ generatedAt: new Date().toISOString(), ...plan }, null, 2) + "\n");
    // Backup-snapshot FØR: rå rækker for berørte boards + events (privat).
    writeFileEnsured(resolvePrivate(`5897/backup-${stamp}.json`), JSON.stringify({
      boards: input.boards, youthEvents: input.youthEvents,
    }, null, 2) + "\n");
    const sqlFile = resolvePrivate(`5897/apply-${stamp}.sql`);
    writeFileEnsured(sqlFile, sql);
    console.log(`Mode: ${options.eventsOnly ? "B (events-only)" : "A (fuld reparation)"} · liste-hash matcher`);
    console.log(JSON.stringify(plan.summary));
    console.log(`Backup-snapshot: balance-internals/5897/backup-${stamp}.json`);
    console.log(`Transaktions-SQL: ${sqlFile}`);
    console.log("Kør SQL'en som ÉT kald (atomisk DO-blok), derefter:");
    console.log(`  node scripts/dev/repair5897BoardYouthRaces.mjs --verify=${privateFile}`);
    return;
  }

  writeFileEnsured(resolvePrivate(privateFile), JSON.stringify({ generatedAt: new Date().toISOString(), ...plan }, null, 2) + "\n");
  const snapshotDir = fileURLToPath(new URL("../../../docs/snapshots/5897/", import.meta.url));
  const baselinePath = resolve(snapshotDir, BASELINE_REPORT);
  const baseline = existsSync(baselinePath) ? parseReportCounts(readFileSync(baselinePath, "utf8")) : null;
  const reportPath = resolve(snapshotDir, `dry-run-${stamp}.md`);
  writeFileEnsured(reportPath, renderPublicReport(plan.summary, { generatedAt: new Date().toISOString(), privateFile, baseline }));
  console.log(JSON.stringify(plan.summary));
  console.log(`Liste-hash (til --approved-list): ${plan.summary.listHash}`);
  if (plan.summary.youthEventsAfterPrevention > 0) {
    console.log(`ADVARSEL: ${plan.summary.youthEventsAfterPrevention} ungdoms-events efter forebyggelsen (#5892) - regression?`);
  }
  console.log(`Rapport: ${reportPath}`);
  console.log(`Privat plan: balance-internals/${privateFile}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
