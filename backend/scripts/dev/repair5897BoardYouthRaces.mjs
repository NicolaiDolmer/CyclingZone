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
//   apply (kræver BÅDE --apply og --owner-go):
//     ... node scripts/dev/repair5897BoardYouthRaces.mjs --apply --owner-go
//     → tager et frisk JSON-backup-snapshot (balance-internals) og skriver ÉN
//       transaktions-SQL (DO-blok) til balance-internals/5897/apply-<tid>.sql.
//       Backend har ingen pg-driver, og PostgREST kan ikke køre en transaktion,
//       så SQL'en køres som ét kald (Supabase SQL / MCP execute_sql). DO-blokken
//       er atomisk: backup-tabeller → UPDATE → DELETE → verify; enhver afvigelse
//       RAISE'er og ruller HELE blokken tilbage. Idempotent: 0 ungdoms-events
//       tilbage = no-op; findes backup-tabellen allerede = STOP.
//   verify (READ-ONLY, efter apply):
//     ... node scripts/dev/repair5897BoardYouthRaces.mjs --verify=5897/dry-run-<tid>.json
//
// Kolonner er slået op i database/schema-snapshot.json (board_profiles,
// board_satisfaction_events, races, teams).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
  for (const event of laterEvents) {
    if (youthEventIds.has(event.id) || !event.board_id) continue;
    const list = laterByBoard.get(event.board_id) || [];
    list.push(toMs(event.created_at));
    laterByBoard.set(event.board_id, list);
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
    plans.push({
      board_id: boardId,
      team_id: board.team_id,
      events: entry.events,
      changedAfterOwnLast,
      changedAfterWindow,
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
  const summary = {
    youthEvents: youthEvents.length,
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
    laterEvents = await fetchIn(supabase, "board_satisfaction_events", "id, board_id, created_at", "board_id", boardIds,
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
export function buildApplySql() {
  const youthEvents = `public.board_satisfaction_events e JOIN public.races r ON r.id = e.race_id WHERE r.squad <> 'senior'`;
  const repairedExpr = `(CASE WHEN (b.is_baseline IS TRUE OR b.plan_type = 'baseline')
        THEN LEAST(${BASELINE_SATISFACTION_MAX}, GREATEST(${BASELINE_SATISFACTION_MIN}, round(b.satisfaction - d.yd)))
        ELSE LEAST(100, GREATEST(0, round(b.satisfaction - d.yd))) END)`;
  return `-- #${ISSUE} · Reparation af bestyrelser flyttet af ungdomsløb. EJER-GATED.
-- Kør som ÉT kald. DO-blokken er atomisk: enhver RAISE EXCEPTION ruller alt tilbage.
-- Idempotent: 0 ungdoms-events tilbage => NOTICE + no-op. Backup findes => STOP.
DO $repair$
DECLARE
  n_events int; n_boards int; n_backup_p int; n_backup_e int; n_upd int; n_del int; n_bad int;
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

  RAISE NOTICE '#${ISSUE}: OK - % boards repareret, % events fjernet, backup i % og %',
    n_upd, n_del, '${BACKUP_PROFILES_TABLE}', '${BACKUP_EVENTS_TABLE}';
END
$repair$;
`;
}

/** READ-ONLY post-apply verify mod den private dry-run-plan. */
export function verifyAgainstPlan({ plan, youthEventsRemaining, boards }) {
  const byId = new Map(boards.map((b) => [b.id, b]));
  const mismatches = [];
  for (const p of plan.plans) {
    const board = byId.get(p.board_id);
    if (!board) { mismatches.push({ board_id: p.board_id, reason: "missing" }); continue; }
    // Kun boards der ikke er skrevet af andre siden dry-run kan sammenlignes eksakt.
    const expectedSatisfaction = p.repaired;
    if (Number(board.satisfaction) !== expectedSatisfaction) {
      mismatches.push({ board_id: p.board_id, reason: "satisfaction", expected: expectedSatisfaction, actual: Number(board.satisfaction) });
    } else if (!p.baseline && Number(board.budget_modifier) !== p.newModifier) {
      mismatches.push({ board_id: p.board_id, reason: "budget_modifier", expected: p.newModifier, actual: Number(board.budget_modifier) });
    }
  }
  return { ok: youthEventsRemaining === 0 && mismatches.length === 0, youthEventsRemaining, checked: plan.plans.length, mismatches };
}

export function parseArgs(args) {
  const options = { apply: false, ownerGo: false, verify: null, dryRun: true };
  for (const arg of args) {
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--apply") options.apply = true;
    else if (arg === "--owner-go") options.ownerGo = true;
    else if (arg.startsWith("--verify=") && arg.length > 9) options.verify = arg.slice(9);
    else throw new Error(`Ukendt argument: ${arg}`);
  }
  if (options.apply && !options.ownerGo) throw new Error("--apply kræver --owner-go (ejer-gated, #5897)");
  if (options.ownerGo && !options.apply) throw new Error("--owner-go uden --apply giver ingen mening");
  if (options.apply && options.verify) throw new Error("--apply og --verify kan ikke kombineres");
  if (options.apply || options.verify) options.dryRun = false;
  return options;
}

const fmt = (v) => (v == null ? "-" : String(v));

/** Aggregeret, repo-sikker rapport: kun antal og kvalitative udsagn. */
export function renderPublicReport(summary, { generatedAt, privateFile }) {
  const has = (n) => (n > 0 ? "ja" : "nej");
  return `# #${ISSUE} dry-run - bestyrelser flyttet af ungdomsløb

Genereret: ${generatedAt} (READ-ONLY, intet skrevet til DB)

Repoet er offentligt: denne fil har kun antal. Fordelinger, økonomi-tal og plan
pr. board ligger i \`balance-internals/${privateFile}\` (gitignoreret).

| Mål | Antal |
|---|---|
| Ungdoms-events (races.squad <> 'senior') der fjernes | ${summary.youthEvents} |
| Ungdomsløb med events | ${summary.youthRacesWithEvents} |
| Boards med invers-delta | ${summary.boards} |
| Hold berørt | ${summary.teams} |
| Heraf baseline-boards (budget_modifier røres ikke) | ${summary.baselineBoards} |
| Boards med netto-delta forskellig fra 0 | ${summary.nonZeroDeltaBoards} |
| Boards med stor bevægelse (abs. delta i top-båndet, se privat fil) | ${summary.absDeltaAtLeast10} |
| Boards ændret af andre skrivninger efter ungdomsvinduet | ${summary.changedAfterYouthWindow} |
| Boards hvor clamp bider ved reparationen | ${summary.clampedBoards} |
| Boards hvor satisfaction ændres | ${summary.satisfactionChangedBoards} |
| Boards hvor budget_modifier ændres (op / ned) | ${summary.modifierChangedBoards} (${summary.modifierUp} / ${summary.modifierDown}) |
| Hold med ændret sponsor-modifier | ${summary.economyTeams} |
| Boards der mangler (event uden board) | ${summary.missingBoards} |
| Uattribuerede gap-boards (bevægelse uden event i vinduet, IKKE i reparationen) | ${summary.silentGapBoards} |

Netto-retning: ${summary.positiveDeltaBoards} boards blev løftet og ${summary.negativeDeltaBoards} sænket af ungdomsløbene.
Økonomisk effekt findes: ${has(summary.economyTeams)} (beløb kun i privat fil).

## Metode

- Invers-delta pr. board (ikke reset): ny satisfaction = nuværende minus summen af
  boardets ungdoms-event-deltaer, med samme clamp som motoren (baseline-boards
  har deres eget smalle bånd).
- budget_modifier genberegnes via \`satisfactionToModifier\` for ikke-baseline boards.
- Ungdoms-events fjernes fra \`board_satisfaction_events\`.
- Apply er ejer-gated (\`--apply --owner-go\`) og kører som én atomisk SQL-blok med
  backup-tabeller, idempotens-tjek og verify i samme transaktion.

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
    const result = verifyAgainstPlan({ plan, youthEventsRemaining: input.youthEvents.length, boards });
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
  writeFileEnsured(resolvePrivate(privateFile), JSON.stringify({ generatedAt: new Date().toISOString(), ...plan }, null, 2) + "\n");

  if (options.apply) {
    // Backup-snapshot FØR: rå rækker for berørte boards + events (privat).
    writeFileEnsured(resolvePrivate(`5897/backup-${stamp}.json`), JSON.stringify({
      boards: input.boards, youthEvents: input.youthEvents,
    }, null, 2) + "\n");
    const sqlFile = resolvePrivate(`5897/apply-${stamp}.sql`);
    writeFileEnsured(sqlFile, buildApplySql());
    console.log(JSON.stringify(plan.summary));
    console.log(`Backup-snapshot: balance-internals/5897/backup-${stamp}.json`);
    console.log(`Transaktions-SQL: ${sqlFile}`);
    console.log("Kør SQL'en som ÉT kald (atomisk DO-blok), derefter:");
    console.log(`  node scripts/dev/repair5897BoardYouthRaces.mjs --verify=${privateFile}`);
    return;
  }

  const reportPath = fileURLToPath(new URL(`../../../docs/snapshots/5897/dry-run-${stamp}.md`, import.meta.url));
  writeFileEnsured(reportPath, renderPublicReport(plan.summary, { generatedAt: new Date().toISOString(), privateFile }));
  console.log(JSON.stringify(plan.summary));
  console.log(`Rapport: ${reportPath}`);
  console.log(`Privat plan: balance-internals/${privateFile}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
