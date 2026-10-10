/**
 * #5904 · Load-test-gate: simulér en fuld løbsdag på staging før hvert sæsonskifte.
 *
 * Startes KUN via isolations-wrapperen (aldrig direkte, aldrig mod prod), fra en PowerShell-
 * session med `&` (`pwsh -File ... --` fra en anden shell sender ikke --flag'ene videre):
 *   & ./scripts/staging/with-loadtest-staging.ps1 -Cwd . -- node scripts/loadtest/race-day-sim.mjs `
 *     --clock 2026-10-06T00:00:00+02:00 --season 4 --min-results <frisk prod-estimat> `
 *     --viewer-token-file <sti til staging-JWT>
 *
 * Fail-closed, i denne rækkefølge (en fejl stopper alt; intet job startes):
 *   1) wrapper-markør + CZ_TARGET_ENV (scriptet nægter at køre uden wrapperen)
 *   2) assertLoadtestIsolation (miljø uden sideeffekt-nøgler + renset staging-DB)
 *   3) check-staging-prerequisites (#6170: schema + resultatvolumen >= --min-results)
 *   4) plan: aktiv sæson = --season, alle tre trupper (senior/U23/junior) har slots i
 *      vinduet, ingen forfalden backlog før uret, ingen halv afslutning, dagen er ikke kørt,
 *      motor/scheduler/auto-præmie er tændt i STAGINGS app_config (scriptet skriver aldrig flag)
 *
 * Derefter afvikles løbsdagen med det eksplicit pinnede ur: tick-gitteret fra
 * backend/lib/schedulerTick.js, og hvert tick kalder backend/lib/stageScheduler.js med
 * `now` = tick-tidspunktet. Samme proces kører backendens HTTP-flade (server.js, cron
 * blokeres af cronRuntimeGuard), og samtidige spillerlæsninger rammer den hele vejen.
 *
 * Faser (alle skal være målt, ellers loadTestPassed=false):
 *   normal           0 5xx, 0 lock-timeouts, etaperesultater straks, ranglister <= 5 min
 *   fault_auth       Auth utilgængelig: entydigt 503, aldrig 200 fra cache, aldrig 401
 *   fault_db         DB utilgængelig: entydigt 503, ingen afvikling går halvt igennem
 *   restart_recovery afbrudt afslutning midt i en etape + genstart: genoptages uden dobbelt
 * Oracle: præcis én afvikling pr. etape-slot og præcis én afregning pr. (løb, hold).
 *
 * Rapport: docs/snapshots/5904/race-day-<tid>.md. Ingen hold-/managernavne, ingen id'er:
 * løb vises som aliaser (R01...). Volumengrænsen har ingen default og sænkes aldrig her.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertIsolation, checkEnv, STAGING_REF, PROD_REF } from '../../backend/scripts/staging/assertLoadtestIsolation.mjs';
import { checkStagingPrerequisites } from './check-staging-prerequisites.mjs';
import { nextClockAlignedTickMs, STAGE_TICK_PERIOD_MS } from '../../backend/lib/schedulerTick.js';
import { copenhagenMidnightUTC } from '../../backend/lib/copenhagenTime.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const STAGING_ORIGIN = `https://${STAGING_REF}.supabase.co`;

export const WRAPPER_MARKER = 'CZ_LOADTEST_WRAPPER';
export const MAX_URL_BYTES = 8 * 1024;
export const RANKING_SLA_MS = 5 * 60 * 1000;
// Ranglistens refresh-cron tikker hvert minut i prod; i den komprimerede simulering
// lægges den værste ventetid til, så en lag-måling aldrig er pænere end virkeligheden.
export const RANKING_CRON_CADENCE_MS = 60 * 1000;
export const SQUADS = ['senior', 'u23', 'junior'];
export const PHASES = ['normal', 'fault_auth', 'fault_db', 'restart_recovery'];
export const FAULT_PHASES = ['fault_auth', 'fault_db'];
export const DEFAULT_READ_PATHS = ['/api/rankings/global', '/api/rankings/standings', '/api/races/calendar'];
const DB_SAMPLE_EVERY_TICKS = 6;
const GRACE_MS = 60 * 60 * 1000;
// Lease i adminSimulateRace (STAGE_CLAIM_LEASE_MS) + to tick-perioder: så længe må et
// afbrudt løb være om at komme i gang igen, før genstart-fasen er dumpet.
export const RECOVERY_WALL_TIMEOUT_MS = 15 * 60 * 1000 + 2 * STAGE_TICK_PERIOD_MS;
const RECOVERY_SLEEP_MS = 30 * 1000;
const CHUNK = 50;

// ─── Argumenter ──────────────────────────────────────────────────────────────

export const USAGE = 'node scripts/loadtest/race-day-sim.mjs --clock <ISO med offset> --season <n> --min-results <n> '
  + '--viewer-token-file <sti> [--until <ISO med offset>] [--readers <1-64>] [--fault-ticks <1-12>] [--out <mappe>]';
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const POSITIVE_INT = /^[1-9]\d*$/;
const FLAGS = new Set(['clock', 'until', 'season', 'min-results', 'viewer-token-file', 'readers', 'fault-ticks', 'out']);

function intIn(value, min, max) {
  if (!POSITIVE_INT.test(value ?? '')) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : null;
}

/** Copenhagen-midnat efter den dag `ms` ligger i (23/24/25-timersdage håndteres). */
export function nextCopenhagenMidnightMs(ms) {
  const today = copenhagenMidnightUTC(new Date(ms)).getTime();
  return copenhagenMidnightUTC(new Date(today + 30 * 60 * 60 * 1000)).getTime();
}

export function parseArgs(argv) {
  const raw = {};
  const errors = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) { errors.push('USAGE_UNEXPECTED_ARG'); continue; }
    const key = arg.slice(2);
    if (!FLAGS.has(key)) { errors.push(`USAGE_UNKNOWN_FLAG:${key}`); continue; }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) { errors.push(`USAGE_MISSING_VALUE:${key}`); continue; }
    raw[key] = value;
    i++;
  }
  const clockMs = ISO_WITH_OFFSET.test(raw.clock ?? '') ? Date.parse(raw.clock) : NaN;
  if (!Number.isFinite(clockMs)) errors.push('USAGE_REQUIRE_PINNED_CLOCK');
  let untilMs = Number.isFinite(clockMs) ? nextCopenhagenMidnightMs(clockMs) : NaN;
  if (raw.until !== undefined) {
    untilMs = ISO_WITH_OFFSET.test(raw.until) ? Date.parse(raw.until) : NaN;
    if (!Number.isFinite(untilMs) || !(untilMs > clockMs) || untilMs - clockMs > 36 * 60 * 60 * 1000) errors.push('USAGE_INVALID_UNTIL');
  }
  const season = intIn(raw.season, 1, 999);
  if (season == null) errors.push('USAGE_REQUIRE_SEASON');
  // Ingen default og ingen tolerance: grænsen er et frisk prod-tal, givet eksplicit.
  const minResults = intIn(raw['min-results'], 1, Number.MAX_SAFE_INTEGER);
  if (minResults == null) errors.push('USAGE_REQUIRE_MIN_RESULTS');
  if (!raw['viewer-token-file']) errors.push('USAGE_REQUIRE_VIEWER_TOKEN_FILE');
  const readers = raw.readers === undefined ? 8 : intIn(raw.readers, 1, 64);
  if (readers == null) errors.push('USAGE_INVALID_READERS');
  const faultTicks = raw['fault-ticks'] === undefined ? 3 : intIn(raw['fault-ticks'], 1, 12);
  if (faultTicks == null) errors.push('USAGE_INVALID_FAULT_TICKS');
  return {
    errors,
    options: {
      clockMs, untilMs, season, minResults, readers, faultTicks,
      viewerTokenFile: raw['viewer-token-file'] ?? null,
      outDir: resolve(REPO_ROOT, raw.out ?? 'docs/snapshots/5904'),
    },
  };
}

// ─── Fetch-instrumentering ───────────────────────────────────────────────────

export function urlBytes(url) {
  return Buffer.byteLength(String(url), 'utf8');
}

/** Hvilken upstream et kald rammer. Kun Supabase-fladerne kan fault-injiceres. */
export function classifyRequest(url) {
  let parsed;
  try { parsed = new URL(url); } catch { return { surface: 'other', name: null }; }
  if (parsed.origin !== STAGING_ORIGIN) return { surface: 'other', name: null };
  const rpc = /^\/rest\/v1\/rpc\/([^/?]+)/.exec(parsed.pathname);
  if (rpc) return { surface: 'rpc', name: rpc[1] };
  const rest = /^\/rest\/v1\/([^/?]+)/.exec(parsed.pathname);
  if (rest) return { surface: 'rest', name: rest[1] };
  if (parsed.pathname.startsWith('/auth/v1/')) return { surface: 'auth', name: parsed.pathname.slice(9) || null };
  return { surface: 'supabase_other', name: null };
}

export function isBoardCall({ surface, name }) {
  return (surface === 'rest' && /^board_/.test(name ?? '')) || (surface === 'rpc' && /board/.test(name ?? ''));
}

// Bestyrelses-dublet = samme bestyrelse (board_id) to gange for samme løb, som
// unik-indekset board_satisfaction_events_board_race_uniq (board_id, race_id).
// Et hold har normalt flere bestyrelser (plan_type baseline/1yr/3yr/5yr) og
// dermed flere rækker pr. (løb, hold) — det er IKKE en dublet.
// Returnerer race_id'er med mindst én dublet (hver kun én gang).
export function boardDuplicateRaceIds(rows) {
  const seen = new Map();
  for (const r of rows ?? []) {
    const key = `${r.race_id}|${r.board_id}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return [...new Set([...seen].filter(([, n]) => n > 1).map(([k]) => k.split('|')[0]))];
}

// Den atomiske resultat-skrivning: etape-stien (stageResultRpc.applyStageResultAtomic)
// og hel-løbs-stien (applyRaceResultsBatchAtomic).
const RESULT_WRITE_RPCS = new Set(['apply_stage_result', 'apply_race_results_batch']);
export const MID_FINALIZATION_CRASH_POINTS = new Set(['after_results_write_and_marker', 'after_results_write_no_marker']);

/**
 * Fault-styring. `mode` slukker en hel upstream for hele processen (backend + scheduler);
 * `armCrash` afbryder ÉN afvikling midt i afslutningen: efter den atomiske
 * resultat-skrivning og trin-markeringen fejler alle dens videre Supabase-kald.
 */
export function createFaultController() {
  let mode = null;
  let crash = null;
  return {
    setMode(next) { mode = next; },
    mode: () => mode,
    armCrash({ fallbackAfter = 60 } = {}) { crash = { state: 'armed', fallbackAfter, count: 0, afterWrite: 0, race: null, point: null }; },
    crash: () => crash,
    disarmCrash() { const c = crash; crash = null; return c; },
    decide(rec, store) {
      // Simulatorens egne kontrol-læsninger rammes aldrig: de er måleinstrumentet.
      if (rec.surface === 'other' || store?.kind === 'sim') return null;
      if (mode === 'auth_down' && rec.surface === 'auth') return 'unreachable';
      if (mode === 'db_down' && (rec.surface === 'rest' || rec.surface === 'rpc')) return 'unreachable';
      if (crash && store?.kind === 'tick' && store.race) {
        if (crash.race == null) crash.race = store.race;
        if (crash.race === store.race) {
          if (crash.state === 'tripped') return 'unreachable';
          crash.count++;
          if (crash.state === 'write_seen' && ++crash.afterWrite > 5) {
            // Ingen trin-markering kort efter skrivningen (fx genoptagelse slukket): afbryd alligevel.
            crash.state = 'tripped'; crash.point = 'after_results_write_no_marker'; return 'unreachable';
          }
          if (crash.count > crash.fallbackAfter) { crash.state = 'tripped'; crash.point = 'fallback_request_count'; return 'unreachable'; }
        }
      }
      return null;
    },
    observe(rec, store) {
      if (!crash || crash.state === 'tripped' || crash.race !== store?.race) return;
      if (!(rec.status >= 200 && rec.status < 300)) return;
      if (crash.state === 'armed' && rec.surface === 'rpc' && RESULT_WRITE_RPCS.has(rec.name)) crash.state = 'write_seen';
      else if (crash.state === 'write_seen' && rec.surface === 'rest' && rec.name === 'races' && rec.method === 'PATCH') {
        crash.state = 'tripped';
        crash.point = 'after_results_write_and_marker';
      }
    },
  };
}

function emptyPhaseStats() {
  return {
    ticks: 0, wallMs: 0, stagesRun: 0, recovered: 0, resumed: 0, tickErrors: 0, benignSkips: 0, skipped: {},
    requests: 0, upstream5xx: 0, upstream4xx: 0, lockTimeouts: 0, statementTimeouts: 0, networkErrors: 0, injectedFaults: 0,
    maxUrlBytes: 0, urlOverLimit: 0, maxInFlight: 0, maxRequestMs: 0, totalRequestMs: 0,
    tickMs: [], tickDbCalls: [],
    http: { requests: 0, byStatus: {}, codes503: {}, maxMs: 0, totalMs: 0 },
    resources: { maxRssMb: 0, fsReadOps: null, fsWriteOps: null, cpuUserMs: null, cpuSystemMs: null },
    db: { samples: 0, maxConnections: null, maxWaitingLocks: null, blksRead: null, blksHit: null, tempBytes: null, deadlocks: null },
  };
}

/** Samler alle målinger pr. fase. `sim`-bucket'en er simulatorens egne kontrol-læsninger. */
export function createRecorder() {
  const phases = {};
  const boardCallsByRace = {};
  let inFlight = 0;
  const stats = (p) => (phases[p] ??= emptyPhaseStats());
  return {
    phases,
    boardCallsByRace,
    stats,
    begin(rec) {
      inFlight++;
      const s = stats(rec.kind === 'sim' ? 'sim' : rec.phase);
      if (inFlight > s.maxInFlight) s.maxInFlight = inFlight;
    },
    end(rec, store) {
      inFlight--;
      const bucket = rec.kind === 'sim' ? 'sim' : rec.phase;
      const s = stats(bucket);
      s.requests++;
      s.totalRequestMs += rec.ms;
      if (rec.ms > s.maxRequestMs) s.maxRequestMs = rec.ms;
      if (rec.urlBytes > s.maxUrlBytes) s.maxUrlBytes = rec.urlBytes;
      if (rec.urlBytes > MAX_URL_BYTES) s.urlOverLimit++;
      if (rec.status >= 500) s.upstream5xx++;
      else if (rec.status >= 400) s.upstream4xx++;
      if (rec.lockTimeout) s.lockTimeouts++;
      if (rec.statementTimeout) s.statementTimeouts++;
      if (rec.error === 'FAULT_INJECTED') s.injectedFaults++;
      else if (rec.error) s.networkErrors++;
      if (store?.counter && rec.surface !== 'other') store.counter.dbCalls++;
      if (store?.raceAlias && isBoardCall(rec)) boardCallsByRace[store.raceAlias] = (boardCallsByRace[store.raceAlias] ?? 0) + 1;
    },
    recordHttp(phase, { status, ms, code503 = null }) {
      const h = stats(phase).http;
      h.requests++;
      h.byStatus[status] = (h.byStatus[status] ?? 0) + 1;
      if (status === 503) h.codes503[code503 ?? 'none'] = (h.codes503[code503 ?? 'none'] ?? 0) + 1;
      h.totalMs += ms;
      if (ms > h.maxMs) h.maxMs = ms;
    },
  };
}

export function createInstrumentedFetch({ baseFetch, als, getPhase, recorder, faults }) {
  return async function instrumentedFetch(input, init) {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
    const method = String(init?.method ?? (typeof input === 'object' && input?.method) ?? 'GET').toUpperCase();
    const store = als.getStore();
    const cls = classifyRequest(url);
    const rec = {
      phase: getPhase(), kind: store?.kind ?? 'other', method, surface: cls.surface, name: cls.name,
      urlBytes: urlBytes(url), status: null, ms: 0, error: null, lockTimeout: false, statementTimeout: false,
    };
    const fault = faults.decide(rec, store);
    recorder.begin(rec);
    const t0 = performance.now();
    try {
      if (fault) {
        // Samme form som undici ved et rent netværksudfald, så backendens egne
        // klassificeringer (fx authTokenVerification) ser et ægte "unreachable".
        const err = new TypeError('fetch failed');
        err.cause = { code: 'CZ_LOADTEST_FAULT' };
        throw err;
      }
      const res = await baseFetch(input, init);
      rec.status = res.status;
      if (res.status >= 400 && cls.surface !== 'other') {
        const body = await res.clone().text().catch(() => '');
        rec.lockTimeout = /"code"\s*:\s*"55P03"|lock timeout/i.test(body);
        rec.statementTimeout = /"code"\s*:\s*"57014"|statement timeout/i.test(body);
      }
      faults.observe(rec, store);
      return res;
    } catch (err) {
      rec.error = fault ? 'FAULT_INJECTED' : 'NETWORK';
      throw err;
    } finally {
      rec.ms = performance.now() - t0;
      recorder.end(rec, store);
    }
  };
}

// ─── Plan + tick-gitter ──────────────────────────────────────────────────────

/** Tick-tidspunkter på produktions-gitteret (hh:00:05, hh:05:05 ...) i [fromMs, toMs]. */
export function computeTicks(fromMs, toMs) {
  const ticks = [];
  let t = nextClockAlignedTickMs(fromMs - 1);
  while (t <= toMs) { ticks.push(t); t = nextClockAlignedTickMs(t); }
  return ticks;
}

/** Fail-closed planvalidering. Returnerer blockers; tom liste = planen må køres. */
export function validatePlan(plan, { season, clockMs, untilMs }) {
  const blockers = [];
  if (plan.activeSeasonCount !== 1) blockers.push('PLAN_ACTIVE_SEASON_NOT_UNIQUE');
  else if (plan.activeSeasonNumber !== season) blockers.push('PLAN_SEASON_MISMATCH');
  if (!plan.slots.length) blockers.push('PLAN_NO_SLOTS_IN_WINDOW');
  for (const squad of SQUADS) {
    if (!plan.slots.some(s => s.squad === squad)) blockers.push(`PLAN_SQUAD_WITHOUT_SLOTS:${squad}`);
  }
  if (plan.slots.some(s => !(s.scheduledAtMs >= clockMs && s.scheduledAtMs < untilMs))) blockers.push('PLAN_SLOT_OUTSIDE_WINDOW');
  if (plan.backlogBeforeClock > 0) blockers.push('PLAN_BACKLOG_BEFORE_CLOCK');
  if (plan.finalizeStatePresent > 0) blockers.push('PLAN_FINALIZE_STATE_PRESENT');
  if (plan.existingRunsForSlots > 0) blockers.push('PLAN_DAY_ALREADY_RUN');
  if (plan.capBaselineRuns > 0) blockers.push('PLAN_DAILY_CAP_BASELINE_NOT_ZERO');
  for (const [flag, on] of Object.entries(plan.flags ?? {})) if (on !== true) blockers.push(`PLAN_STAGING_FLAG_OFF:${flag}`);
  if (new Set(plan.slots.map(s => s.dueTickIndex)).size < 4) blockers.push('PLAN_TOO_FEW_SLOT_TICKS');
  return blockers;
}

/** Hvor fault-vinduerne starter: ved det due-tick der ligger ca. 40 % inde i dagen. */
export function faultStartTickIndex(slots) {
  const due = [...new Set(slots.map(s => s.dueTickIndex))].sort((a, b) => a - b);
  return due[Math.floor(due.length * 0.4)] ?? 0;
}

export function assignDueTicks(slots, ticks) {
  return slots.map(s => ({ ...s, dueTickIndex: ticks.findIndex(t => t >= s.scheduledAtMs) }));
}

// ─── Evaluering (ren) ────────────────────────────────────────────────────────

function count(map) { return Object.values(map ?? {}).reduce((a, b) => a + b, 0); }

/**
 * Oracles. `data` er indsamlet efter afviklingen:
 *   runsBySlot     { 'R01#1': n }   race_simulation_runs pr. planlagt etape-slot
 *   races          [{ alias, status, finalizeState, prizePaid }]
 *   financeDup     [{ alias, type }]  (løb, hold, type) med mere end én række
 *   boardDup       [alias]            (løb, bestyrelse) med mere end én bestyrelses-hændelse
 *   resultCounts   { 'R01#1': { first, final } }
 */
export function evaluateOracles(data) {
  if (!data) return { passed: false, blockers: ['ORACLE_MISSING'], details: {} };
  const blockers = [];
  const notOnce = Object.entries(data.runsBySlot ?? {}).filter(([, n]) => n !== 1).map(([k, n]) => `${k}=${n}`);
  if (!Object.keys(data.runsBySlot ?? {}).length) blockers.push('ORACLE_NO_SLOTS');
  if (notOnce.length) blockers.push('ORACLE_RUNS_NOT_EXACTLY_ONCE');
  const completed = (data.races ?? []).filter(r => r.status === 'completed');
  const unsettled = completed.filter(r => !r.prizePaid).map(r => r.alias);
  if (unsettled.length) blockers.push('ORACLE_SETTLEMENT_MISSING');
  if ((data.financeDup ?? []).length) blockers.push('ORACLE_SETTLEMENT_DUPLICATE');
  if ((data.boardDup ?? []).length) blockers.push('ORACLE_BOARD_DUPLICATE');
  const leftMarkers = (data.races ?? []).filter(r => r.finalizeState).map(r => r.alias);
  if (leftMarkers.length) blockers.push('ORACLE_FINALIZE_STATE_LEFT');
  const changed = Object.entries(data.resultCounts ?? {}).filter(([, c]) => c.first !== c.final).map(([k]) => k);
  if (changed.length) blockers.push('ORACLE_RESULTS_CHANGED_AFTER_FIRST_READ');
  return { passed: blockers.length === 0, blockers, details: { notOnce, unsettled, leftMarkers, changed, completed: completed.length } };
}

/**
 * Samlet dom. loadTestPassed er KUN true når preflight er grøn, alle faser er målt og
 * alle accept-regler + oracles består. Alt der mangler, tæller som en fejl.
 */
export function evaluateRun(run) {
  const blockers = [...(run.preflightBlockers ?? [])];
  const phases = run.phases ?? {};
  for (const p of PHASES) {
    const s = phases[p];
    if (!s || s.ticks === 0) { blockers.push(`PHASE_MISSING:${p}`); continue; }
    if (s.http.requests === 0) blockers.push(`HTTP_NOT_EXERCISED:${p}`);
    if (s.db.samples === 0) blockers.push(`MEASUREMENT_MISSING:db_resources:${p}`);
    if (s.resources.fsReadOps == null) blockers.push(`MEASUREMENT_MISSING:process_resources:${p}`);
  }
  for (const [p, s] of Object.entries(phases)) {
    if (s.urlOverLimit > 0 || s.maxUrlBytes > MAX_URL_BYTES) blockers.push(`URL_OVER_8KB:${p}`);
  }
  // Normaldriftens accept. Genstart-fasen har kun ét bevidst afbrudt løb; alt andet i den
  // (backend, læsere, de øvrige løb) skal holde samme standard, under eget navn.
  for (const [p, prefix] of [['normal', 'NORMAL'], ['restart_recovery', 'RESTART']]) {
    const s = phases[p];
    if (!s || s.ticks === 0) continue;
    if (s.upstream5xx > 0) blockers.push(`${prefix}_UPSTREAM_5XX`);
    const http5xx = Object.entries(s.http.byStatus).filter(([st]) => Number(st) >= 500).reduce((a, [, c]) => a + c, 0);
    if (http5xx > 0) blockers.push(`${prefix}_HTTP_5XX`);
    if ((s.http.byStatus[401] ?? 0) > 0) blockers.push(`${prefix}_HTTP_401`);
    if (s.lockTimeouts > 0) blockers.push(`${prefix}_LOCK_TIMEOUT`);
    if (s.statementTimeouts > 0) blockers.push(`${prefix}_STATEMENT_TIMEOUT`);
  }
  const n = phases.normal;
  if (n && n.ticks > 0) {
    if (n.networkErrors > 0) blockers.push('NORMAL_NETWORK_ERRORS');
    if (n.tickErrors > 0) blockers.push('NORMAL_TICK_ERRORS');
    if (n.stagesRun === 0) blockers.push('NORMAL_NO_STAGES_RUN');
  }
  for (const [p, s] of Object.entries(phases)) {
    for (const reason of Object.keys(s.skipped ?? {})) {
      // Under et bevidst udfald er flag-opslagets fail-safe OFF den forventede opførsel.
      if (reason === 'no_due_stages' || (FAULT_PHASES.includes(p) && reason !== 'daily_cap_reached')) continue;
      blockers.push(`SCHEDULER_SKIPPED:${reason}:${p}`);
    }
  }
  for (const p of FAULT_PHASES) {
    const s = phases[p];
    if (!s || s.ticks === 0) continue;
    if (s.injectedFaults === 0) blockers.push(`FAULT_NOT_INJECTED:${p}`);
    const nonOk = Object.entries(s.http.byStatus).filter(([st]) => Number(st) !== 503).reduce((a, [, c]) => a + c, 0);
    if (nonOk > 0) blockers.push(`FAULT_NOT_503:${p}`);
    // Auth nede + 200 = noget har autoriseret uden Auth (fx en cache). DB nede + 200 =
    // gammelt svar til en verificeret bruger; ikke et sikkerhedshul, men ikke entydigt.
    if ((s.http.byStatus[200] ?? 0) > 0) blockers.push(p === 'fault_auth' ? 'FAULT_CACHE_AUTHORIZED:fault_auth' : `FAULT_STALE_200:${p}`);
    if ((s.http.byStatus[401] ?? 0) > 0) blockers.push(`FAULT_LOGOUT_401:${p}`);
    if (Object.keys(s.http.codes503).length > 1) blockers.push(`FAULT_503_AMBIGUOUS:${p}`);
  }
  const slaPhases = new Set(['normal', 'restart_recovery']);
  const results = run.stageChecks ?? [];
  if (results.some(c => slaPhases.has(c.phase) && !(c.count > 0))) blockers.push('RESULTS_NOT_IMMEDIATE');
  const lags = (run.rankingLags ?? []).filter(l => slaPhases.has(l.phase));
  if (lags.some(l => !(l.lagMs <= RANKING_SLA_MS))) blockers.push('RANKINGS_OVER_5_MIN');
  if ((run.rankingsNeverReady ?? []).length) blockers.push('RANKINGS_NOT_READY');
  if (run.rankingStateUnavailable) blockers.push('MEASUREMENT_MISSING:ranking_state');
  const crash = run.crash;
  if (!crash || crash.state !== 'tripped') blockers.push('RESTART_CRASH_NOT_INJECTED');
  else {
    // Kun et afbrud EFTER resultat-skrivningen tester en halv afslutning; et afbrud
    // fra tælleren alene beviser ikke genoptagelsen.
    if (!MID_FINALIZATION_CRASH_POINTS.has(crash.point)) blockers.push('RESTART_CRASH_NOT_MID_FINALIZATION');
    if (!run.recovery?.recovered) blockers.push('RESTART_NOT_RECOVERED');
  }
  const oracle = evaluateOracles(run.oracleData);
  blockers.push(...oracle.blockers);
  const unique = [...new Set(blockers)];
  return { loadTestPassed: unique.length === 0, blockers: unique, oracle };
}

// ─── Rapport ─────────────────────────────────────────────────────────────────

function pct(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}
const fmt = (v, digits = 0) => (v == null || Number.isNaN(v) ? 'n/a' : Number(v).toFixed(digits));

export function renderReport(result) {
  const lines = [];
  const v = result.verdict;
  lines.push(`# Race-day load-test #5904: ${result.status}`);
  lines.push('');
  lines.push(`- **loadTestPassed: ${v.loadTestPassed}**`);
  lines.push(`- Startet (væg-ur): ${new Date(result.startedAtMs).toISOString()} · kode: \`${result.codeSha ?? 'ukendt'}\``);
  lines.push(`- Pinned ur: ${result.options?.clockIso ?? 'n/a'} til ${result.options?.untilIso ?? 'n/a'} · sæson ${result.options?.season ?? 'n/a'}`);
  lines.push(`- Staging-ref: ${STAGING_REF} · minimum resultatrækker: ${result.options?.minResults ?? 'n/a'} · faktiske: ${result.prerequisites?.resultRows ?? 'n/a'}`);
  lines.push(`- Isolation: ${result.isolation?.status ?? 'ikke kørt'} · prerequisites: ${result.prerequisites?.status ?? 'ikke kørt'}`);
  if (result.plan) {
    const bySquad = SQUADS.map(sq => `${sq} ${result.plan.slots.filter(s => s.squad === sq).length}`).join(', ');
    lines.push(`- Plan: ${result.plan.slots.length} etape-slots (${bySquad}) i ${result.plan.raceCount} løb · ${result.ticks ?? 0} ticks`);
    lines.push(`- Flag på staging: ${Object.entries(result.plan.flags ?? {}).map(([k, on]) => `${k}=${on ? 'on' : 'off'}`).join(', ') || 'n/a'}`);
  }
  lines.push('');
  lines.push('## Blockers');
  lines.push('');
  lines.push(v.blockers.length ? v.blockers.map(b => `- \`${b}\``).join('\n') : '- ingen');
  lines.push('');
  if (result.phases && Object.keys(result.phases).length) {
    lines.push('## Faser');
    lines.push('');
    lines.push('| Fase | Ticks | Etaper | Tick p95 ms | Tick max ms | DB-kald/tick max | Upstream-kald | 5xx | Lock-timeouts | Max URL bytes | Max samtidige | HTTP (status:antal) | RSS max MB | DB-forbindelser max | Ventende låse max |');
    lines.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|---:|');
    for (const [p, s] of Object.entries(result.phases)) {
      const http = Object.entries(s.http.byStatus).map(([st, c]) => `${st}:${c}`).join(' ') || '-';
      lines.push(`| ${p} | ${s.ticks} | ${s.stagesRun} | ${fmt(pct(s.tickMs, 95))} | ${fmt(pct(s.tickMs, 100))} | ${fmt(pct(s.tickDbCalls, 100))} | ${s.requests} | ${s.upstream5xx} | ${s.lockTimeouts} | ${s.maxUrlBytes} | ${s.maxInFlight} | ${http} | ${fmt(s.resources.maxRssMb)} | ${fmt(s.db.maxConnections)} | ${fmt(s.db.maxWaitingLocks)} |`);
    }
    lines.push('');
    lines.push('IO pr. fase (deltas): proces fs read/write ops, CPU ms; DB blks_read/blks_hit/temp_bytes/deadlocks.');
    lines.push('');
    for (const [p, s] of Object.entries(result.phases)) {
      const r = s.resources; const d = s.db;
      lines.push(`- ${p}: fs ${fmt(r.fsReadOps)}/${fmt(r.fsWriteOps)} · CPU ${fmt(r.cpuUserMs)}+${fmt(r.cpuSystemMs)} ms · DB ${fmt(d.blksRead)}/${fmt(d.blksHit)}/${fmt(d.tempBytes)}/${fmt(d.deadlocks)}`);
    }
    lines.push('');
  }
  if (result.boardCallsByRace && Object.keys(result.boardCallsByRace).length) {
    const calls = Object.values(result.boardCallsByRace);
    lines.push(`Bestyrelseskald pr. løb: max ${Math.max(...calls)}, gennemsnit ${fmt(calls.reduce((a, b) => a + b, 0) / calls.length, 1)} (${calls.length} løb).`);
    lines.push('');
  }
  if (result.rankingLags?.length) {
    const lags = result.rankingLags.map(l => l.lagMs);
    lines.push(`Rangliste-forsinkelse efter afslutning (inkl. ${RANKING_CRON_CADENCE_MS / 1000} s cron-kadence): p95 ${fmt(pct(lags, 95) / 1000, 1)} s, max ${fmt(pct(lags, 100) / 1000, 1)} s, grænse ${RANKING_SLA_MS / 1000} s.`);
    lines.push('');
  }
  if (result.crash) {
    lines.push(`Genstart: afbrudt ved \`${result.crash.point ?? 'ikke udløst'}\` på ${result.crash.alias ?? 'n/a'} · genoptaget: ${result.recovery?.recovered ?? false} efter ${fmt((result.recovery?.wallMs ?? NaN) / 1000)} s.`);
    lines.push('');
  }
  lines.push('## Oracles');
  lines.push('');
  lines.push(`- Præcis én afvikling pr. slot: ${v.oracle.details.notOnce?.length ? `NEJ (${v.oracle.details.notOnce.slice(0, 20).join(', ')})` : (result.oracleData ? 'ja' : 'ikke målt')}`);
  lines.push(`- Afregning: ${v.oracle.details.completed ?? 0} afsluttede løb, mangler ${v.oracle.details.unsettled?.length ?? 'n/a'}, dubletter ${result.oracleData?.financeDup?.length ?? 'n/a'}`);
  lines.push(`- Bestyrelses-dubletter: ${result.oracleData?.boardDup?.length ?? 'n/a'} · halve afslutninger tilbage: ${v.oracle.details.leftMarkers?.length ?? 'n/a'}`);
  lines.push('');
  lines.push('## Dækker ikke');
  lines.push('');
  for (const item of result.notCovered ?? []) lines.push(`- ${item}`);
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify({ status: result.status, loadTestPassed: v.loadTestPassed, blockers: v.blockers }, null, 2));
  lines.push('```');
  lines.push('');
  return lines.join('\n');
}

export const NOT_COVERED = [
  'Discord-/mail-levering: notifyDiscord er null i simuleringen, og wrapperen fjerner alle kanal-nøgler.',
  'Genstart er en in-process-simulering: modul-cache i processen overlever; DB-tilstand (claims, trin-markeringer) er den ægte.',
  'Motorens interne ur: kun scheduleren får det pinnede ur; kode der selv læser new Date() ser væg-uret.',
  'Spillerlæsninger går via backendens HTTP-flade med én syntetisk staging-bruger, ikke direkte PostgREST-læsninger fra frontenden.',
];

// ─── Orkestrering ────────────────────────────────────────────────────────────

function blockedResult(base, blockers) {
  return { ...base, status: 'BLOCKED', verdict: { loadTestPassed: false, blockers, oracle: evaluateOracles(null) } };
}

function envBlockers(env) {
  const blockers = [];
  if (env[WRAPPER_MARKER] !== '1' || env.CZ_TARGET_ENV !== 'loadtest-staging') blockers.push('NOT_STARTED_VIA_WRAPPER');
  if (env.CRON_FORCE_LOCAL || Object.keys(env).some(k => /^RAILWAY_/.test(k))) blockers.push('ENV_CRON_WOULD_START');
  const dbUrl = String(env.SUPABASE_DB_URL ?? '');
  if (!dbUrl.includes(STAGING_REF) || dbUrl.includes(PROD_REF)) blockers.push('ENV_DB_URL_NOT_STAGING');
  return blockers;
}

/** Validerer et staging-JWT uden at verificere signaturen (det gør Auth); værdien printes aldrig. */
export function checkViewerToken(token, nowMs) {
  const parts = String(token ?? '').trim().split('.');
  if (parts.length !== 3) return ['VIEWER_TOKEN_INVALID'];
  let payload;
  try { payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); } catch { return ['VIEWER_TOKEN_INVALID']; }
  const blockers = [];
  if (!String(payload.iss ?? '').includes(STAGING_REF) || String(payload.iss ?? '').includes(PROD_REF)) blockers.push('VIEWER_TOKEN_NOT_STAGING');
  if (!(Number(payload.exp) * 1000 > nowMs + 30 * 60 * 1000)) blockers.push('VIEWER_TOKEN_EXPIRES_TOO_SOON');
  return blockers;
}

function snapshotProcess() {
  const u = process.resourceUsage();
  return { fsRead: u.fsRead, fsWrite: u.fsWrite, user: u.userCPUTime / 1000, system: u.systemCPUTime / 1000 };
}

/**
 * Kører hele gaten. Alt med sideeffekt kommer ind via `deps`, så testene kan
 * bevise fail-closed-rækkefølgen uden netværk:
 *   env, now(), assertIsolation(env), checkPrerequisites(config), readFile(path),
 *   createLive({ env, options, recorder, faults, als, getPhase }), writeReport(dir, name, md), sleep(ms)
 */
export async function runRaceDaySim(options, deps) {
  const startedAtMs = deps.now();
  const base = {
    startedAtMs,
    options: {
      clockIso: Number.isFinite(options.clockMs) ? new Date(options.clockMs).toISOString() : null,
      untilIso: Number.isFinite(options.untilMs) ? new Date(options.untilMs).toISOString() : null,
      season: options.season, minResults: options.minResults,
    },
    // Gaten gælder den kode der blev målt: rapporten bærer commit'en.
    codeSha: deps.gitSha?.() ?? null,
    notCovered: NOT_COVERED,
  };
  const finish = (result) => {
    const name = `race-day-${new Date(startedAtMs).toISOString().replace(/[:.]/g, '-')}.md`;
    result.reportPath = deps.writeReport(options.outDir, name, renderReport(result));
    return result;
  };

  const eb = envBlockers(deps.env);
  if (eb.length) return finish(blockedResult(base, eb));

  const isolation = await deps.assertIsolation(deps.env);
  base.isolation = { status: isolation.status };
  if (isolation.status !== 'ISOLATED') return finish(blockedResult(base, isolation.blockers.map(b => `ISOLATION:${b}`)));

  const prerequisites = await deps.checkPrerequisites({
    ref: STAGING_REF, url: deps.env.SUPABASE_URL, key: deps.env.SUPABASE_SERVICE_KEY, minResults: options.minResults,
  });
  base.prerequisites = { status: prerequisites.status, resultRows: prerequisites.resultRows };
  if (prerequisites.status !== 'DATA_PREREQUISITES_READY') {
    return finish(blockedResult(base, prerequisites.blockers.map(b => `PREREQUISITE:${b}`)));
  }

  let token;
  try { token = deps.readFile(options.viewerTokenFile).trim(); } catch { return finish(blockedResult(base, ['VIEWER_TOKEN_UNREADABLE'])); }
  const tokenBlockers = checkViewerToken(token, startedAtMs);
  if (tokenBlockers.length) return finish(blockedResult(base, tokenBlockers));

  const als = new AsyncLocalStorage();
  const recorder = createRecorder();
  const faults = createFaultController();
  let phase = 'preflight';
  const getPhase = () => phase;
  let live;
  try {
    live = await deps.createLive({ env: deps.env, options, recorder, faults, als, getPhase, token });
  } catch (err) {
    return finish(blockedResult(base, [`LIVE_SETUP_FAILED:${err?.code ?? 'UNKNOWN'}`]));
  }

  try {
    const ticks = computeTicks(options.clockMs, options.untilMs + GRACE_MS);
    const rawPlan = await als.run({ kind: 'sim' }, () => live.loadPlan({ clockMs: options.clockMs, untilMs: options.untilMs }));
    const plan = { ...rawPlan, slots: assignDueTicks(rawPlan.slots, ticks) };
    base.plan = plan;
    base.ticks = ticks.length;
    const planBlockers = validatePlan(plan, options);
    if (planBlockers.length) return finish(blockedResult(base, planBlockers));
    const result = await executeDay({ options, deps, live, plan, ticks, recorder, faults, als, setPhase: (p) => { phase = p; } });
    return finish({ ...base, ...result });
  } finally {
    try { await live.close?.(); } catch { /* best-effort: processen afsluttes alligevel */ }
  }
}

async function executeDay({ options, deps, live, plan, ticks, recorder, faults, als, setPhase }) {
  const aliasOf = new Map(plan.races.map(r => [r.id, r.alias]));
  const raceIds = plan.races.map(r => r.id);
  const faultStart = faultStartTickIndex(plan.slots);
  const stageChecks = [];
  const rankingLags = [];
  const resultFirst = {};
  const pendingRankings = new Map();
  let rankingStateUnavailable = false;
  let crashInfo = null;
  const recovery = { recovered: false, wallMs: null };
  let crashTrippedAtWall = null;
  let lastStates = new Map((await als.run({ kind: 'sim' }, () => live.raceStates(raceIds))).map(s => [s.id, s]));

  let phase = 'preflight';
  let phaseSnap = null;
  let dbAtPhaseStart = null;
  const enterPhase = (next) => {
    if (next === phase) return;
    closePhase();
    phase = next;
    setPhase(next);
    phaseSnap = { proc: snapshotProcess(), wall: deps.now() };
    dbAtPhaseStart = sampleDbInto(next);
    faults.setMode(next === 'fault_auth' ? 'auth_down' : next === 'fault_db' ? 'db_down' : null);
  };
  const sampleDbInto = (p) => {
    const sample = live.sampleDb();
    if (!sample) return null;
    const d = recorder.stats(p).db;
    d.samples++;
    d.maxConnections = Math.max(d.maxConnections ?? 0, sample.connections);
    d.maxWaitingLocks = Math.max(d.maxWaitingLocks ?? 0, sample.waitingLocks);
    return sample;
  };
  const closePhase = () => {
    if (phase === 'preflight' || !phaseSnap) return;
    const s = recorder.stats(phase);
    const now = snapshotProcess();
    s.wallMs += deps.now() - phaseSnap.wall;
    s.resources.fsReadOps = (s.resources.fsReadOps ?? 0) + (now.fsRead - phaseSnap.proc.fsRead);
    s.resources.fsWriteOps = (s.resources.fsWriteOps ?? 0) + (now.fsWrite - phaseSnap.proc.fsWrite);
    s.resources.cpuUserMs = (s.resources.cpuUserMs ?? 0) + (now.user - phaseSnap.proc.user);
    s.resources.cpuSystemMs = (s.resources.cpuSystemMs ?? 0) + (now.system - phaseSnap.proc.system);
    const end = sampleDbInto(phase);
    if (end && dbAtPhaseStart) {
      for (const [k, src] of [['blksRead', 'blksRead'], ['blksHit', 'blksHit'], ['tempBytes', 'tempBytes'], ['deadlocks', 'deadlocks']]) {
        s.db[k] = (s.db[k] ?? 0) + (end[src] - dbAtPhaseStart[src]);
      }
    }
  };

  const rssTimer = setInterval(() => {
    if (phase === 'preflight') return;
    const mb = process.memoryUsage().rss / 1024 / 1024;
    const r = recorder.stats(phase).resources;
    if (mb > r.maxRssMb) r.maxRssMb = mb;
  }, 1000);
  rssTimer.unref?.();

  const readers = live.startReaders({ count: options.readers, paths: DEFAULT_READ_PATHS, getPhase: () => phase });

  const runOneTick = async (tickMs, idx) => {
    const s = recorder.stats(phase);
    const t = await live.runTick(new Date(tickMs), idx);
    s.ticks++;
    s.tickMs.push(t.ms);
    s.tickDbCalls.push(t.dbCalls);
    if (t.threw) s.tickErrors++;
    const r = t.result ?? {};
    s.stagesRun += r.ran ?? 0;
    s.recovered += r.recovered ?? 0;
    s.resumed += r.resumed ?? 0;
    s.tickErrors += r.errors ?? 0;
    s.benignSkips += r.benignSkips ?? 0;
    if (r.skipped) s.skipped[r.skipped] = (s.skipped[r.skipped] ?? 0) + 1;
    if (idx % DB_SAMPLE_EVERY_TICKS === 0) sampleDbInto(phase);

    // Etaperesultater SKAL kunne læses straks efter tick'et; ranglisten må komme bagefter.
    const wallNow = deps.now();
    const states = await als.run({ kind: 'sim' }, () => live.raceStates(raceIds));
    for (const st of states) {
      const prev = lastStates.get(st.id);
      const alias = aliasOf.get(st.id);
      for (let stage = (prev?.stagesCompleted ?? 0) + 1; stage <= (st.stagesCompleted ?? 0); stage++) {
        const key = `${alias}#${stage}`;
        if (resultFirst[key] != null) continue;
        const n = await als.run({ kind: 'sim' }, () => live.stageResultCount(st.id, stage));
        resultFirst[key] = n;
        stageChecks.push({ alias, stage, count: n, phase });
      }
      if (st.status === 'completed' && prev?.status !== 'completed') pendingRankings.set(st.id, { at: wallNow, phase });
      lastStates.set(st.id, st);
    }
    const ready = await als.run({ kind: 'sim' }, () => live.rankingsReady());
    if (ready == null) rankingStateUnavailable = true;
    if (ready === true) {
      const doneAt = deps.now();
      for (const [id, p] of pendingRankings) rankingLags.push({ alias: aliasOf.get(id), lagMs: doneAt - p.at + RANKING_CRON_CADENCE_MS, phase: p.phase });
      pendingRankings.clear();
    }
    return t;
  };

  const crashedRecovered = async () => {
    if (!crashInfo?.race) return false;
    const [st] = await als.run({ kind: 'sim' }, () => live.raceStates([crashInfo.race]));
    return !!st && !st.finalizeState && (st.stagesCompleted ?? 0) > (crashInfo.stagesCompletedBefore ?? 0);
  };

  try {
    let restartDone = false;
    let lastTickMs = ticks[0];
    for (let i = 0; i < ticks.length; i++) {
      lastTickMs = ticks[i];
      if (i < faultStart) enterPhase('normal');
      else if (i < faultStart + options.faultTicks) enterPhase('fault_auth');
      else if (i < faultStart + 2 * options.faultTicks) enterPhase('fault_db');
      else if (!restartDone) {
        if (phase !== 'restart_recovery') {
          enterPhase('restart_recovery');
          faults.armCrash();
        }
      } else enterPhase('normal');

      const stagesBefore = new Map([...lastStates].map(([id, st]) => [id, st.stagesCompleted ?? 0]));
      await runOneTick(ticks[i], i);

      if (phase !== 'restart_recovery') continue;
      const c = faults.crash();
      if (c?.state === 'tripped' && !crashInfo) {
        // "Processen dør" her: afviklingen er afbrudt, og alt i den efterfølgende
        // genstart starter forfra i processen (ny klient, ny dedup). DB-tilstanden
        // (claim, trin-markering) er den der faktisk blev efterladt.
        crashInfo = { ...c, alias: aliasOf.get(c.race), stagesCompletedBefore: stagesBefore.get(c.race) ?? 0 };
        faults.disarmCrash();
        crashTrippedAtWall = deps.now();
        await live.restart();
      }
      if (crashInfo && await crashedRecovered()) {
        recovery.recovered = true;
        recovery.wallMs = deps.now() - crashTrippedAtWall;
        restartDone = true;
      } else if (crashInfo && deps.now() - crashTrippedAtWall > RECOVERY_WALL_TIMEOUT_MS) {
        restartDone = true;
      }
    }
    // Er dagen slut før det afbrudte løb er genoptaget, tikkes der videre i væg-tid
    // (claim-leasen er væg-tid), indtil det lykkes eller fristen er udløbet.
    let extra = ticks.length;
    while (crashInfo && !recovery.recovered && deps.now() - crashTrippedAtWall <= RECOVERY_WALL_TIMEOUT_MS) {
      enterPhase('restart_recovery');
      await deps.sleep(RECOVERY_SLEEP_MS);
      lastTickMs = nextClockAlignedTickMs(lastTickMs);
      await runOneTick(lastTickMs, extra++);
      if (await crashedRecovered()) {
        recovery.recovered = true;
        recovery.wallMs = deps.now() - crashTrippedAtWall;
      }
    }
    if (!crashInfo) crashInfo = faults.crash() ? { ...faults.crash(), alias: null } : null;
    closePhase();
    phase = 'oracle';
    setPhase('oracle');
  } finally {
    clearInterval(rssTimer);
    await readers.stop();
    faults.setMode(null);
    faults.disarmCrash();
  }

  const oracleRaw = await als.run({ kind: 'sim' }, () => live.collectOracle({ plan }));
  const resultCounts = {};
  for (const [key, first] of Object.entries(resultFirst)) resultCounts[key] = { first, final: oracleRaw.finalResultCounts?.[key] ?? null };
  const oracleData = { ...oracleRaw, resultCounts };
  const rankingsNeverReady = [...pendingRankings.keys()].map(id => aliasOf.get(id));

  const phases = Object.fromEntries(Object.entries(recorder.phases).filter(([p]) => p !== 'preflight'));
  const run = {
    phases, stageChecks, rankingLags, rankingsNeverReady, rankingStateUnavailable,
    crash: crashInfo ? { state: crashInfo.state, point: crashInfo.point, alias: crashInfo.alias } : null,
    recovery, oracleData,
  };
  const verdict = evaluateRun(run);
  return {
    status: verdict.loadTestPassed ? 'PASSED' : 'FAILED',
    verdict, phases, boardCallsByRace: recorder.boardCallsByRace, rankingLags, stageChecks,
    crash: run.crash, recovery, oracleData,
  };
}

// ─── Live-adapter (kun staging, kun via wrapperen) ───────────────────────────

function freePort() {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', rej);
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => res(port)); });
  });
}

const liveError = (code) => Object.assign(new Error(code), { code });

async function pageAll(build) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw liveError('LIVE_QUERY_FAILED');
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

function chunks(list, size = CHUNK) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export async function createLiveRuntime({ env, recorder, faults, als, getPhase, token }) {
  const backendDir = join(REPO_ROOT, 'backend');
  // server.js/instrument.mjs (backend/.env) og cron.js (repo-rodens .env) kører dotenv:
  // en lokal env-fil kunne genindføre de nøgler wrapperen har fjernet. Ingen må findes.
  if (existsSync(join(backendDir, '.env')) || existsSync(join(REPO_ROOT, '.env'))) throw liveError('DOTENV_FILE_PRESENT');

  // Global fetch udskiftes FØR backend-moduler importeres, så alle Supabase-klienter
  // (også dem server.js og cron.js opretter ved import) går gennem målingen.
  const baseFetch = globalThis.fetch;
  globalThis.fetch = createInstrumentedFetch({ baseFetch, als, getPhase, recorder, faults });

  const mod = (p) => import(pathToFileURL(join(backendDir, p)).href);
  const { createClient } = createRequire(join(backendDir, 'package.json'))('@supabase/supabase-js');
  const makeClient = () => createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  let supabase = makeClient();

  const [{ runStageScheduler }, { isStageSchedulerEnabled }, { isRaceEngineV2Enabled }, { isAutoPrizeEnabled },
    { runAdminSimulateStage }, { makeEnsureSeasonStandings }, { updateStandings },
    { emitRaceResultNotifications, emitStageResultNotifications }, { runAutoPrizeSweep },
    { refreshRankingMatviewsGated }, { runTrainingDayCloseSweep }] = await Promise.all([
    mod('lib/stageScheduler.js'), mod('lib/stageSchedulerFlag.js'), mod('lib/raceEngineFlag.js'), mod('lib/autoPrizeFlag.js'),
    mod('lib/adminSimulateRace.js'), mod('lib/seasonStandingsBootstrap.js'), mod('lib/economyEngine.js'),
    mod('lib/notificationService.js'), mod('lib/autoPrizeSweep.js'),
    mod('lib/refreshRankingMatviews.js'), mod('lib/trainingDayCloseTrigger.js'),
  ]);

  const port = await freePort();
  process.env.PORT = String(port);
  await als.run({ kind: 'other' }, () => mod('server.js'));
  // Anden sikring: miljøet skal stadig være lige så rent efter backend-importen.
  if (checkEnv(process.env).length) throw liveError('ENV_CHANGED_AFTER_BACKEND_IMPORT');
  const apiBase = `http://127.0.0.1:${port}`;
  for (let i = 0; ; i++) {
    try { if ((await baseFetch(`${apiBase}/health`)).ok) break; } catch { /* serveren lytter ikke endnu */ }
    if (i > 60) throw liveError('HTTP_SERVER_NOT_READY');
    await new Promise(r => setTimeout(r, 500));
  }

  let seenKeys = new Map();
  let ensureSeasonStandings = makeEnsureSeasonStandings(supabase);
  const captured = [];
  const capture = (err) => { captured.push(err?.message ?? 'error'); };
  const aliasById = new Map();

  const runStage = ({ raceId, stageIndex, resume = false }) => runAdminSimulateStage({
    supabase, raceId, dryRun: false, runSource: 'scheduler',
    expectedStageIndex: resume ? null : stageIndex,
    resumeStageIndex: resume ? stageIndex : null,
    ensureSeasonStandings, updateStandings,
    notifyDiscord: null,
    notifyInApp: async ({ race }) => { await emitRaceResultNotifications({ supabase, race }); },
    notifyStageInApp: async ({ race, stageNumber, totalStages }) => { await emitStageResultNotifications({ supabase, race, stageNumber, totalStages }); },
  });

  return {
    async loadPlan({ clockMs, untilMs }) {
      const { data: seasons, error } = await supabase.from('seasons').select('id, number').eq('status', 'active');
      if (error) throw liveError('LIVE_QUERY_FAILED');
      const season = seasons?.length === 1 ? seasons[0] : null;
      const clockIso = new Date(clockMs).toISOString();
      const slotsRaw = season ? await pageAll(() => supabase.from('race_stage_schedule')
        .select('race_id, stage_number, scheduled_at, races!inner(id, squad, season_id)')
        .eq('races.season_id', season.id).gte('scheduled_at', clockIso).lt('scheduled_at', new Date(untilMs).toISOString())
        .order('scheduled_at', { ascending: true })) : [];
      const raceIdsInOrder = [...new Set(slotsRaw.map(s => s.race_id))];
      raceIdsInOrder.forEach((id, i) => aliasById.set(id, `R${String(i + 1).padStart(2, '0')}`));
      const slots = slotsRaw.map(s => ({ raceId: s.race_id, alias: aliasById.get(s.race_id), stageNumber: s.stage_number, squad: s.races?.squad, scheduledAtMs: Date.parse(s.scheduled_at) }));
      const before = season ? await pageAll(() => supabase.from('race_stage_schedule')
        .select('race_id, stage_number, races!inner(stages_completed, status, season_id)')
        .eq('races.season_id', season.id).neq('races.status', 'completed').lt('scheduled_at', clockIso)) : [];
      const backlogBeforeClock = before.filter(s => s.stage_number > (s.races?.stages_completed ?? 0)).length;
      const { count: finalizeStatePresent, error: fErr } = season
        ? await supabase.from('races').select('id', { count: 'exact', head: true }).eq('season_id', season.id).not('finalize_state', 'is', null)
        : { count: 0, error: null };
      if (fErr) throw liveError('LIVE_QUERY_FAILED');
      let existingRunsForSlots = 0;
      for (const ids of chunks(raceIdsInOrder)) {
        const runs = await pageAll(() => supabase.from('race_simulation_runs').select('race_id, stage_number').in('race_id', ids));
        const slotKeys = new Set(slots.map(s => `${s.raceId}#${s.stageNumber}`));
        existingRunsForSlots += runs.filter(r => slotKeys.has(`${r.race_id}#${r.stage_number}`)).length;
      }
      const { count: capBaselineRuns, error: cErr } = await supabase.from('race_simulation_runs')
        .select('id', { count: 'exact', head: true }).eq('source', 'scheduler').gte('created_at', copenhagenMidnightUTC(new Date(clockMs)).toISOString());
      if (cErr) throw liveError('LIVE_QUERY_FAILED');
      return {
        activeSeasonCount: seasons?.length ?? 0, activeSeasonNumber: season?.number ?? null,
        slots, races: raceIdsInOrder.map(id => ({ id, alias: aliasById.get(id) })), raceCount: raceIdsInOrder.length,
        backlogBeforeClock, finalizeStatePresent: finalizeStatePresent ?? 0, existingRunsForSlots, capBaselineRuns: capBaselineRuns ?? 0,
        flags: {
          stage_scheduler_enabled: await isStageSchedulerEnabled(supabase),
          race_engine_v2: await isRaceEngineV2Enabled(supabase, { isBetaTester: true }),
          auto_prize: await isAutoPrizeEnabled(supabase),
        },
      };
    },

    async runTick(now, idx) {
      const counter = { dbCalls: 0 };
      const cronCounter = { dbCalls: 0 };
      const t0 = performance.now();
      let result = null;
      let threw = false;
      await als.run({ kind: 'tick', counter }, async () => {
        try {
          result = await runStageScheduler({
            supabase, now, isStageSchedulerEnabled, isRaceEngineV2Enabled, seenKeys, captureExceptionFn: capture,
            runStageFn: (args) => als.run({ kind: 'tick', counter, race: args.raceId, raceAlias: aliasById.get(args.raceId) }, () => runStage(args)),
          });
        } catch (err) {
          // catch-ok: et kastet tick er et maalepunkt (tickErrors), ikke en fejl i simulatoren.
          threw = true;
          capture(err);
        }
      });
      const ms = performance.now() - t0;
      // Øvrige løbsdags-crons i samme tick (prod: hvert 1.-5. minut): afregning,
      // aftentræning og ranglistens refresh. Målt separat fra scheduler-kaldene.
      await als.run({ kind: 'cron', counter: cronCounter }, async () => {
        for (const job of [
          () => runAutoPrizeSweep({ supabase }),
          () => runTrainingDayCloseSweep({ supabase, now, onAlarm: capture }),
          () => refreshRankingMatviewsGated(supabase, { captureExceptionFn: capture }),
        ]) {
          // catch-ok: fejlen tælles via fetch-instrumenteringen; næste job skal stadig køre.
          try { await job(); } catch (err) { capture(err); }
        }
      });
      return { idx, ms, dbCalls: counter.dbCalls, cronDbCalls: cronCounter.dbCalls, result, threw };
    },

    async raceStates(ids) {
      const out = [];
      for (const part of chunks(ids)) {
        const { data, error } = await supabase.from('races').select('id, status, stages_completed, finalize_state, prize_paid_at').in('id', part);
        if (error) throw liveError('LIVE_QUERY_FAILED');
        for (const r of data ?? []) out.push({ id: r.id, status: r.status, stagesCompleted: r.stages_completed, finalizeState: r.finalize_state, prizePaid: !!r.prize_paid_at });
      }
      return out;
    },

    async stageResultCount(raceId, stageNumber) {
      const { count, error } = await supabase.from('race_results').select('id', { count: 'exact', head: true }).eq('race_id', raceId).eq('stage_number', stageNumber);
      return error ? null : count;
    },

    async rankingsReady() {
      const { data, error } = await supabase.rpc('get_ranking_refresh_work_state');
      if (error || !data || typeof data.pending !== 'boolean') return null;
      return data.pending === false;
    },

    startReaders({ count, paths, getPhase: phaseNow }) {
      let stopped = false;
      const loops = Array.from({ length: count }, async (_, n) => {
        for (let i = n; !stopped; i++) {
          const path = paths[i % paths.length];
          const t0 = performance.now();
          let status = 0;
          let code503 = null;
          const p = phaseNow();
          try {
            const res = await baseFetch(`${apiBase}${path}`, { headers: { Authorization: `Bearer ${token}` } });
            status = res.status;
            const body = await res.text();
            if (status === 503) { try { code503 = JSON.parse(body)?.error ?? null; } catch { code503 = 'non_json'; } }
          } catch {
            status = 0;
          }
          if (p !== 'preflight' && p !== 'oracle') recorder.recordHttp(p, { status, ms: performance.now() - t0, code503 });
          await new Promise(r => setTimeout(r, 250));
        }
      });
      return { stop: async () => { stopped = true; await Promise.all(loops); } };
    },

    sampleDb() {
      const sql = 'select (select count(*) from pg_stat_activity where datname = current_database()),'
        + ' (select count(*) from pg_locks where not granted), blks_read, blks_hit, temp_bytes, deadlocks'
        + ' from pg_stat_database where datname = current_database()';
      const r = spawnSync('psql', ['-X', '-A', '-t', '-F', ',', '-c', sql, env.SUPABASE_DB_URL], {
        encoding: 'utf8', timeout: 15_000, windowsHide: true,
        env: { PATH: env.PATH ?? env.Path ?? '', SystemRoot: env.SystemRoot ?? '', PGCONNECT_TIMEOUT: '10' },
      });
      if (r.status !== 0) return null;
      const nums = String(r.stdout).trim().split(',').map(Number);
      if (nums.length !== 6 || nums.some(n => !Number.isFinite(n))) return null;
      const [connections, waitingLocks, blksRead, blksHit, tempBytes, deadlocks] = nums;
      return { connections, waitingLocks, blksRead, blksHit, tempBytes, deadlocks };
    },

    async restart() {
      // Genstart: ny klient, nye tick-lokale strukturer (dedup, standings-bootstrap).
      supabase = makeClient();
      seenKeys = new Map();
      ensureSeasonStandings = makeEnsureSeasonStandings(supabase);
    },

    async collectOracle({ plan }) {
      const ids = plan.races.map(r => r.id);
      const runsBySlot = Object.fromEntries(plan.slots.map(s => [`${s.alias}#${s.stageNumber}`, 0]));
      const finance = [];
      const board = [];
      for (const part of chunks(ids)) {
        for (const r of await pageAll(() => supabase.from('race_simulation_runs').select('race_id, stage_number').in('race_id', part))) {
          const key = `${aliasById.get(r.race_id)}#${r.stage_number}`;
          if (key in runsBySlot) runsBySlot[key]++;
        }
        finance.push(...await pageAll(() => supabase.from('finance_transactions').select('race_id, team_id, type').in('race_id', part).in('type', ['prize', 'sponsor_race_day'])));
        board.push(...await pageAll(() => supabase.from('board_satisfaction_events').select('race_id, board_id').in('race_id', part)));
      }
      const dupKeys = (rows, keyFn) => {
        const seen = new Map();
        for (const row of rows) seen.set(keyFn(row), (seen.get(keyFn(row)) ?? 0) + 1);
        return [...seen].filter(([, n]) => n > 1).map(([k]) => k);
      };
      const financeDup = dupKeys(finance, r => `${r.race_id}|${r.team_id}|${r.type}`).map(k => { const [race, , type] = k.split('|'); return { alias: aliasById.get(race), type }; });
      const boardDup = boardDuplicateRaceIds(board).map(id => aliasById.get(id));
      const states = await this.raceStates(ids);
      const races = states.map(s => ({ alias: aliasById.get(s.id), status: s.status, finalizeState: !!s.finalizeState, prizePaid: s.prizePaid }));
      const finalResultCounts = {};
      for (const s of plan.slots) finalResultCounts[`${s.alias}#${s.stageNumber}`] = await this.stageResultCount(s.raceId, s.stageNumber);
      return { runsBySlot, financeDup, boardDup, races, finalResultCounts, capturedErrors: captured.length };
    },

    async close() {
      globalThis.fetch = baseFetch;
    },
  };
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

export async function main(argv = process.argv.slice(2), env = process.env) {
  const { errors, options } = parseArgs(argv);
  if (errors.length) {
    process.stdout.write(`${JSON.stringify({ status: 'BLOCKED', loadTestPassed: false, blockers: errors, usage: USAGE })}\n`);
    return 2;
  }
  const result = await runRaceDaySim(options, {
    env,
    now: () => Date.now(),
    assertIsolation: (e) => assertIsolation(e),
    checkPrerequisites: (config) => checkStagingPrerequisites(config),
    readFile: (p) => readFileSync(resolve(p), 'utf8'),
    createLive: (args) => createLiveRuntime(args),
    writeReport: (dir, name, md) => { mkdirSync(dir, { recursive: true }); const p = join(dir, name); writeFileSync(p, md); return p; },
    sleep: (ms) => new Promise(r => setTimeout(r, ms)),
    gitSha: () => {
      const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8', windowsHide: true });
      const sha = String(r.stdout ?? '').trim();
      return r.status === 0 && /^[0-9a-f]{40}$/.test(sha) ? sha : null;
    },
  });
  process.stdout.write(`${JSON.stringify({ status: result.status, loadTestPassed: result.verdict.loadTestPassed, blockers: result.verdict.blockers, report: result.reportPath })}\n`);
  return result.verdict.loadTestPassed ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // process.exit: server.js og backend-modulernes timere ville ellers holde processen i live.
  main().then((code) => process.exit(code), () => process.exit(1));
}
