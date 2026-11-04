#!/usr/bin/env node
/**
 * Sandhedsvagt efter hver etape (#7643, ejer-go valg A 4/11).
 *
 * Læser (kun SELECT via PostgREST) de etaper der er kørt siden sidst, og kører
 * de syv regler i scripts/lib/race-truth-rules.mjs: resultat, løbsfilm,
 * referat-input og etapeplanens skift skal fortælle samme historie.
 *
 * Ved fund:
 *   - én kommentar pr. kørsel på et fast tracking-issue (RACE_TRUTH_TRACKING_ISSUE),
 *     kun race-id, etape og regel. Repoet og Actions-loggen er offentlige, så
 *     ingen navne, rytter-id'er, tider eller huller.
 *   - én besked til #ops (DISCORD_OPS_WEBHOOK_URL) med antal pr. regel og de
 *     første fund (event-indeks, km, gruppe), stadig uden navne.
 *
 * Fail-soft: vagten kører i GitHub Actions, adskilt fra motoren, og returnerer
 * altid 0. En fejl i vagten bliver en advarsel og et "guard_error"-fund, aldrig
 * et stop af noget løb.
 *
 * Tilstand (hvilke etaper der er tjekket) ligger i Actions-cache, aldrig i prod.
 *
 * Miljø:
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY   læseadgang (findes som GitHub-secrets)
 *   DISCORD_OPS_WEBHOOK_URL              valgfri: #ops-beskeden
 *   RACE_TRUTH_TRACKING_ISSUE            valgfri: issue-nummer til kommentaren
 *   GITHUB_TOKEN, GITHUB_REPOSITORY      til kommentaren (sættes af Actions)
 *   RACE_TRUTH_LOOKBACK_HOURS            valgfri: hvor langt tilbage (default 36)
 *   RACE_TRUTH_STATE                     valgfri: tilstandsfil
 *   RACE_TRUTH_DRY_RUN=1                 skriv intet ud (ingen kommentar/besked)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { RULES, checkStage, publicFinding, summarize } from "./lib/race-truth-rules.mjs";

export const DEFAULT_LOOKBACK_HOURS = 36;
export const MAX_STAGES_PER_RUN = 80;
export const HTTP_TIMEOUT_MS = 15_000;
export const PAGE_SIZE = 1000;
export const DISCORD_DETAIL_LINES = 12;
export const STATE_KEEP_DAYS = 7;
// `gc` er et endagsløbs resultat (etape 1 uden etape-rækker) og slut-GC'en i et
// etapeløb; `points`/`mountain` er slut-etapens trøjer (raceRunner.js).
export const RESULT_TYPES = ["stage", "gc", "leader", "points_day", "mountain_day", "points", "mountain"];

function isMain() {
  try {
    return path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1] ?? "");
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Tilstand
// ---------------------------------------------------------------------------

export function stageKey(row) {
  return `${row.race_id}:${row.stage_number}:${row.created_at}`;
}

export function readState(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed.checked === "object" && parsed.checked ? { checked: { ...parsed.checked } } : { checked: {} };
  } catch {
    return { checked: {} };
  }
}

export function pruneState(state, nowIso, keepDays = STATE_KEEP_DAYS) {
  const cutoff = Date.parse(nowIso) - keepDays * 86_400_000;
  const checked = {};
  for (const [key, at] of Object.entries(state.checked ?? {})) if (Date.parse(at) >= cutoff) checked[key] = at;
  return { checked };
}

export function writeState(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
}

// ---------------------------------------------------------------------------
// Læsning (PostgREST, kun GET)
// ---------------------------------------------------------------------------

export function createReader(fetchFn, supabaseUrl, serviceKey) {
  const base = `${String(supabaseUrl).replace(/\/+$/, "")}/rest/v1/`;
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Accept: "application/json" };
  return async function select(pathAndQuery) {
    const all = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const res = await fetchFn(base + pathAndQuery, {
        method: "GET",
        headers: { ...headers, Range: `${from}-${from + PAGE_SIZE - 1}` },
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`PostgREST ${res.status} on ${pathAndQuery.split("?")[0]}`);
      const rows = await res.json();
      if (!Array.isArray(rows)) throw new Error(`PostgREST returned no rows for ${pathAndQuery.split("?")[0]}`);
      all.push(...rows);
      if (rows.length < PAGE_SIZE) return all;
    }
  };
}

/** Etaper med en tidslinje skrevet siden `sinceIso` (uden events). */
export async function listRecentStages(select, sinceIso) {
  return select(
    `race_stage_timelines?select=race_id,stage_number,timeline_version,created_at`
    + `&created_at=gte.${encodeURIComponent(sinceIso)}&order=created_at.asc,race_id.asc,stage_number.asc`,
  );
}

/** Alt reglerne skal bruge for én etape (kolonner: database/schema-snapshot.json). */
export async function loadStage(select, stage, raceRowsCache = new Map()) {
  const race = encodeURIComponent(stage.race_id);
  const n = Number(stage.stage_number);
  const [timeline] = await select(`race_stage_timelines?select=events,timeline_version&race_id=eq.${race}&stage_number=eq.${n}&limit=1`);
  const cacheKey = `${stage.race_id}:${n}`;
  let raceRows = raceRowsCache.get(cacheKey);
  if (!raceRows) {
    raceRows = await select(
      `race_results?select=stage_number,result_type,rank,rider_id,finish_time,sprint_points,kom_points,bonus_seconds,in_breakaway,breakaway_caught,breakaway_dropped`
      + `&race_id=eq.${race}&stage_number=lte.${n}&result_type=in.(${RESULT_TYPES.join(",")})&order=stage_number.asc,result_type.asc,rank.asc,rider_id.asc`,
    );
    raceRowsCache.set(cacheKey, raceRows);
  }
  const passages = await select(
    `race_stage_passages?select=stage_number,waypoint_kind,waypoint_index,rider_id,passage_rank,points,bonus_seconds`
    + `&race_id=eq.${race}&stage_number=eq.${n}&order=waypoint_kind.asc,waypoint_index.asc,passage_rank.asc`,
  );
  const moments = await select(`race_stage_moments?select=moment_key,params,rider_ids&race_id=eq.${race}&stage_number=eq.${n}`);
  const incidents = await select(`race_incidents?select=rider_id,kind,outcome&race_id=eq.${race}&stage_number=eq.${n}`);
  return {
    raceId: stage.race_id,
    stageNumber: n,
    timelineVersion: timeline?.timeline_version ?? stage.timeline_version ?? null,
    events: Array.isArray(timeline?.events) ? timeline.events : [],
    raceRows,
    passages,
    moments,
    incidents,
  };
}

// ---------------------------------------------------------------------------
// Rapportering
// ---------------------------------------------------------------------------

const shortId = (id) => String(id ?? "").slice(0, 8);

/** Pr. etape: hvilke regler slog ud (offentligt: ingen tal, ingen id'er på ryttere). */
export function groupByStage(findings) {
  const stages = new Map();
  for (const f of findings) {
    const key = `${f.race_id}:${f.stage_number}`;
    const entry = stages.get(key) ?? { race_id: f.race_id, stage_number: f.stage_number, findings: [] };
    entry.findings.push(f);
    stages.set(key, entry);
  }
  return [...stages.values()];
}

/** Kommentaren på tracking-issuet: race-id, etape, regel og kode. */
export function buildIssueComment(findings, { runUrl = "", checkedStages = 0 } = {}) {
  const lines = ["**Sandhedsvagt (#7643): fund efter seneste etaper**", ""];
  for (const stage of groupByStage(findings.map(publicFinding))) {
    const rules = [...new Set(stage.findings.map((f) => f.rule))].sort();
    lines.push(`- Race \`${shortId(stage.race_id)}\` etape ${stage.stage_number}: ${rules.join(", ")}`);
    const byRule = new Map();
    for (const f of stage.findings) byRule.set(f.rule, new Set([...(byRule.get(f.rule) ?? []), f.code]));
    for (const rule of rules) lines.push(`  - ${rule}: ${[...byRule.get(rule)].sort().map((c) => `\`${c}\``).join(", ")}`);
  }
  lines.push("", "Regler:");
  const used = [...new Set(findings.map((f) => f.rule))].sort();
  for (const rule of used) lines.push(`- ${rule}: ${RULES[rule] ?? "vagtens egen fejl"}`);
  lines.push("", `Tjekkede etaper i kørslen: ${checkedStages}. Detaljer (km, grupper) står i #ops.`);
  if (runUrl) lines.push(`Kørsel: ${runUrl}`);
  return lines.join("\n");
}

function detailLine(f) {
  const parts = [`${f.rule} ${f.code}`];
  if (f.index != null) parts.push(`idx ${f.index}`);
  if (f.km != null) parts.push(`km ${f.km}`);
  if (f.group_id) parts.push(f.group_id);
  if (f.formed_km != null) parts.push(`dannet km ${f.formed_km}`);
  if (f.split_km != null) parts.push(`split km ${f.split_km}`);
  return parts.join(" · ");
}

/** #ops-beskeden: antal pr. regel og de første fund pr. etape (ingen navne). */
export function buildDiscordPayload(findings, { runUrl = "", issueUrl = "" } = {}) {
  const blocks = [];
  for (const stage of groupByStage(findings)) {
    const counts = summarize(stage.findings);
    const head = Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)).map(([rule, c]) => `${rule}×${c.total}`).join(" ");
    const details = stage.findings.slice(0, DISCORD_DETAIL_LINES).map(detailLine);
    const more = stage.findings.length > DISCORD_DETAIL_LINES ? `\n… +${stage.findings.length - DISCORD_DETAIL_LINES}` : "";
    blocks.push(`**Race ${shortId(stage.race_id)} etape ${stage.stage_number}**: ${head}\n\`\`\`\n${details.join("\n")}${more}\n\`\`\``);
  }
  let description = blocks.join("\n");
  const links = [issueUrl ? `[Tracking-issue](${issueUrl})` : "", runUrl ? `[Kørsel](${runUrl})` : ""].filter(Boolean).join(" · ");
  if (description.length > 3800) description = `${description.slice(0, 3800)}\n…`;
  return {
    embeds: [{
      title: "Sandhedsvagt: resultat, film og referat er uenige",
      description: `${description}${links ? `\n${links}` : ""}`,
      color: 0xd4a017,
    }],
  };
}

async function postJson(fetchFn, url, body, headers = {}) {
  try {
    const res = await fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function postIssueComment(fetchFn, { token, repository, issueNumber, body, apiUrl = "https://api.github.com" }) {
  return postJson(fetchFn, `${apiUrl}/repos/${repository}/issues/${issueNumber}/comments`, { body }, {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function run({
  env = process.env,
  fetchFn = fetch,
  now = () => new Date(),
  log = console.log,
  warn = (msg) => console.log(`::warning::${msg}`),
} = {}) {
  const supabaseUrl = String(env.SUPABASE_URL ?? "").trim();
  const serviceKey = String(env.SUPABASE_SERVICE_KEY ?? "").trim();
  if (!supabaseUrl || !serviceKey) {
    warn("Sandhedsvagten mangler SUPABASE_URL/SUPABASE_SERVICE_KEY; intet tjekket.");
    return { checked: 0, findings: [], reported: false };
  }
  const dryRun = env.RACE_TRUTH_DRY_RUN === "1";
  const stateFile = env.RACE_TRUTH_STATE || ".race-truth-guard-state/state.json";
  const nowIso = now().toISOString();
  const lookbackHours = Number(env.RACE_TRUTH_LOOKBACK_HOURS) > 0 ? Number(env.RACE_TRUTH_LOOKBACK_HOURS) : DEFAULT_LOOKBACK_HOURS;
  const sinceIso = new Date(Date.parse(nowIso) - lookbackHours * 3_600_000).toISOString();
  const select = createReader(fetchFn, supabaseUrl, serviceKey);

  let state = pruneState(readState(stateFile), nowIso);
  const recent = await listRecentStages(select, sinceIso);
  const pending = recent.filter((row) => !state.checked[stageKey(row)]).slice(0, MAX_STAGES_PER_RUN);
  log(`Etaper siden ${sinceIso}: ${recent.length}, nye at tjekke: ${pending.length}`);

  const findings = [];
  const raceRowsCache = new Map();
  const withFindings = [];
  let checked = 0;
  for (const row of pending) {
    try {
      const stage = await loadStage(select, row, raceRowsCache);
      const stageFindings = checkStage(stage);
      findings.push(...stageFindings);
      state.checked[stageKey(row)] = nowIso;
      if (stageFindings.length) withFindings.push(stageKey(row));
      checked += 1;
    } catch (err) {
      // Ikke markeret som tjekket: næste kørsel prøver igen (inden for lookback).
      findings.push({ race_id: row.race_id, stage_number: row.stage_number, rule: "GUARD", code: "load_error" });
      warn(`Sandhedsvagten kunne ikke læse race ${shortId(row.race_id)} etape ${row.stage_number} (${err?.name ?? "Error"}).`);
    }
  }

  const publicLines = groupByStage(findings.map(publicFinding)).map((s) => `race ${shortId(s.race_id)} etape ${s.stage_number}: ${[...new Set(s.findings.map((f) => f.rule))].sort().join(", ")}`);
  for (const line of publicLines) log(line);
  log(`Tjekket: ${checked}, etaper med fund: ${publicLines.length}`);

  let reported = false;
  if (findings.length && !dryRun) {
    const runUrl = env.GITHUB_RUN_ID && env.GITHUB_REPOSITORY
      ? `${env.GITHUB_SERVER_URL || "https://github.com"}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`
      : "";
    const issueNumber = Number(env.RACE_TRUTH_TRACKING_ISSUE);
    const issueUrl = issueNumber > 0 && env.GITHUB_REPOSITORY ? `${env.GITHUB_SERVER_URL || "https://github.com"}/${env.GITHUB_REPOSITORY}/issues/${issueNumber}` : "";
    if (issueNumber > 0 && env.GITHUB_TOKEN && env.GITHUB_REPOSITORY) {
      const ok = await postIssueComment(fetchFn, {
        token: env.GITHUB_TOKEN, repository: env.GITHUB_REPOSITORY, issueNumber,
        body: buildIssueComment(findings, { runUrl, checkedStages: checked }), apiUrl: env.GITHUB_API_URL || undefined,
      });
      log(ok ? `Kommentar skrevet på #${issueNumber}` : `Kommentar på #${issueNumber} FEJLEDE`);
      if (!ok) warn("Sandhedsvagten kunne ikke kommentere på tracking-issuet.");
      reported = reported || ok;
    } else {
      warn("RACE_TRUTH_TRACKING_ISSUE er ikke sat; ingen issue-kommentar.");
    }
    const webhook = String(env.DISCORD_OPS_WEBHOOK_URL ?? "").trim();
    if (webhook) {
      const ok = await postJson(fetchFn, webhook, buildDiscordPayload(findings, { runUrl, issueUrl }));
      log(ok ? "Besked sendt til #ops" : "Besked til #ops FEJLEDE");
      if (!ok) warn("Sandhedsvagten kunne ikke sende til #ops.");
      reported = reported || ok;
    }
    // Nåede ingen af modtagerne frem, er alarmen ikke afleveret: etaperne med
    // fund kvitteres ikke, så næste kørsel tjekker og melder dem igen.
    const configured = (issueNumber > 0 && env.GITHUB_TOKEN && env.GITHUB_REPOSITORY) || webhook;
    if (configured && !reported) for (const key of withFindings) delete state.checked[key];
  }

  if (!dryRun) writeState(stateFile, state);
  return { checked, findings, reported };
}

/** Indgangen: kaster aldrig og returnerer altid exit-kode 0 (fail-soft). */
export async function main(options = {}) {
  const warn = options.warn ?? ((msg) => console.log(`::warning::${msg}`));
  try {
    await run({ ...options, warn });
  } catch (err) {
    warn(`Sandhedsvagten fejlede (${err?.name ?? "Error"}); ingen etape er stoppet.`);
  }
  return 0;
}

if (isMain()) {
  main().then((code) => process.exit(code), () => process.exit(0));
}
