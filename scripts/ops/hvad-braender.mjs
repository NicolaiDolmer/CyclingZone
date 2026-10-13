#!/usr/bin/env node
/**
 * Cycling Zone - "Hvad brænder"-vagten (#6548, design-go ejer 12/10)
 * ===================================================================
 * Daglig rapport kl. 08:00 dansk tid. Deterministisk (ingen AI-tokens): samler tal
 * fra Sentry, GitHub Actions, prod-databasen og aftentræningen, klassificerer dem
 * rød/gul/grøn efter de godkendte grænser og opdaterer ÉT fastgjort issue. Kun når
 * noget er rødt, skrives også en kommentar (giver ejeren en notifikation).
 *
 * Rapporten indeholder kun tal og issue-/PR-numre: repoet er offentligt synligt.
 * Ingen secret-værdier, hosts, spillernavne eller mails printes. psql-stderr printes aldrig.
 *
 * Tilstand (DB-størrelse pr. dag til 7-dages-væksten) ligger som skjult JSON i
 * issuets egen tekst, så den overlever uden cache og kan læses af mennesker.
 *
 * Env:
 *   GITHUB_TOKEN, GITHUB_REPOSITORY      (Actions)
 *   SUPABASE_DB_URL                      psql-forbindelse (read-only forespørgsler)
 *   SENTRY_AUTH_TOKEN                    event:read
 *   SENTRY_ORG (default cycling-zone), SENTRY_PROJECT_ID (default 4511389114105936)
 *   HVAD_BRAENDER_ISSUE                  rapport-issue (default 6549, fastgjort; design i #6548)
 * Flag: --dry-run  (print rapporten, skriv intet)
 * Exit: 0 = rapport lavet (uanset farve) · 1 = config-fejl.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);
const RED = "RØD", AMBER = "GUL", GREEN = "GRØN", NODATA = "INGEN DATA";
const STATE_RE = /<!-- hvad-braender-state: (\{.*?\}) -->/s;
const TOKEN_MARKER = "<!-- wave-tokens:";

// ── Rene klassifikationer (testes) ───────────────────────────────────────────

/** Sentry: rød = nyt issue (først set inden for 24 t) med ≥1 ramt spiller eller ≥10 hændelser i 24 t. */
export function classifySentry(issues, nowMs) {
  const day = 24 * 3600 * 1000;
  const lines = [];
  let level = GREEN;
  for (const i of issues) {
    const events24 = Array.isArray(i?.stats?.["24h"]) ? i.stats["24h"].reduce((s, [, n]) => s + (Number(n) || 0), 0) : Number(i.count) || 0;
    const users = Number(i.userCount) || 0;
    const isNew = nowMs - Date.parse(i.firstSeen) <= day;
    const regressed = i.substatus === "regressed" || i.substatus === "escalating";
    if (isNew && (users >= 1 || events24 >= 10)) {
      level = RED;
      lines.push(`${i.shortId}: nyt, ${events24} hændelser, ${users} spiller(e)`);
    } else if (regressed && events24 > 0) {
      if (level !== RED) level = AMBER;
      lines.push(`${i.shortId}: ${i.substatus === "regressed" ? "regressed" : "stigende"}, ${events24} hændelser, ${users} spiller(e)`);
    }
  }
  return { level, summary: lines.length ? lines.join(" · ") : `${issues.length} uløste med aktivitet, ingen nye med spillere`, lines };
}

/** CI på main: rød = samme workflow fejlet på 2 forskellige dage og seneste kørsel er rød; gul = seneste kørsel rød. */
export function classifyCi(runs, { tz = "Europe/Copenhagen" } = {}) {
  const byWf = new Map();
  for (const r of runs) {
    if (r.head_branch !== "main" || r.status !== "completed") continue;
    if (!byWf.has(r.name)) byWf.set(r.name, []);
    byWf.get(r.name).push(r);
  }
  const red = [], amber = [];
  const day = (iso) => new Intl.DateTimeFormat("sv-SE", { timeZone: tz }).format(new Date(iso));
  for (const [name, list] of byWf) {
    list.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    const latest = list[0];
    if (latest.conclusion !== "failure") continue;
    const failDays = new Set(list.filter((r) => r.conclusion === "failure").map((r) => day(r.created_at)));
    (failDays.size >= 2 ? red : amber).push(`${name} (${failDays.size} dag${failDays.size === 1 ? "" : "e"})`);
  }
  if (red.length) return { level: RED, summary: `rødt 2+ dage i træk: ${red.join(", ")}${amber.length ? ` · rødt i dag: ${amber.join(", ")}` : ""}` };
  if (amber.length) return { level: AMBER, summary: `seneste kørsel rød: ${amber.join(", ")}` };
  return { level: GREEN, summary: "ingen workflow med rød seneste kørsel på main" };
}

/** Database: rød = vækst >10 % på 7 dage eller WAL >2 GB; gul = vækst >5 %. history = {dato: bytes}. */
export function classifyDb({ dbBytes, walBytes }, history, today) {
  const gb = (b) => (b / 1024 ** 3).toFixed(2).replace(".", ",");
  const dates = Object.keys(history || {}).filter((d) => d < today).sort();
  const weekAgo = new Date(Date.parse(`${today}T00:00:00Z`) - 7 * 86400000).toISOString().slice(0, 10);
  const base = dates.filter((d) => d <= weekAgo).pop() ?? dates[0];
  const growth = base ? (dbBytes - history[base]) / history[base] : null;
  const pct = growth == null ? "ingen historik endnu" : `${growth >= 0 ? "+" : ""}${(growth * 100).toFixed(1).replace(".", ",")} % siden ${base}`;
  const summary = `${gb(dbBytes)} GB (${pct}), WAL ${gb(walBytes)} GB`;
  if (walBytes > 2 * 1024 ** 3 || (growth != null && growth > 0.10)) return { level: RED, summary };
  if (growth != null && growth > 0.05) return { level: AMBER, summary };
  return { level: GREEN, summary };
}

/**
 * Aftentræning: rød = afregning >2 min eller >3 hold uafsluttet; gul = 1-3 uafsluttet.
 * Varighed = sidste afsluttede hold minus afregningens start, hvor start = det seneste af
 * dagens sidste etape og kl. 20:00 dansk tid (sweep-reglen, TRAINING_RULES §13.3).
 */
export function classifyTraining({ tickDate, total, complete, durationSeconds }) {
  if (!total) return { level: NODATA, summary: `ingen afregning registreret for ${tickDate}` };
  const open = total - complete;
  const dur = durationSeconds == null ? "?" : `${Math.round(durationSeconds)} s`;
  const summary = `${tickDate}: ${complete}/${total} hold afsluttet, varighed ${dur}${open ? `, ${open} uafsluttet (karantæne/afstemning)` : ""}`;
  if ((durationSeconds != null && durationSeconds > 120) || open > 3) return { level: RED, summary };
  if (open > 0) return { level: AMBER, summary };
  return { level: GREEN, summary };
}

/**
 * Deploy verify: rød = seneste afsluttede kørsel på main fejlet, og ingen nyere kørsel findes.
 * Merge-køen merger op til 3 PR'er i træk og verificerer én gang (#4919): et overhalet
 * deploy fejler "inactive", mens det nyere kører. Findes en nyere kørsel, er status gul
 * (afventer) indtil den er færdig; bliver den grøn, er den overhalede fejl ufarlig.
 */
export function classifyDeploy(runs) {
  const main = runs.filter((r) => r.head_branch === "main").sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const done = main.filter((r) => r.status === "completed");
  if (!done.length) return { level: NODATA, summary: "ingen kørsler" };
  const latest = done[0];
  const newerPending = main.some((r) => r.status !== "completed" && Date.parse(r.created_at) >= Date.parse(latest.created_at));
  if (latest.conclusion === "failure" && newerPending) return { level: AMBER, summary: `deploy verify rød (${latest.head_sha.slice(0, 9)}), nyere kørsel afventer` };
  if (latest.conclusion === "failure") return { level: RED, summary: `seneste deploy verify rød (${latest.head_sha.slice(0, 9)})` };
  return { level: GREEN, summary: `seneste deploy verify ${latest.conclusion} (${latest.head_sha.slice(0, 9)})` };
}

/** Bølge-tokens: rød = deltrin >100k tokens eller prompt-start >50 KB; gul = bølge >2× estimat. reports fra wave-tokens-kommentarer. */
export function classifyWaveTokens(reports) {
  if (!reports.length) return { level: NODATA, summary: "ingen bølge-token-rapport de seneste 24 t" };
  const red = [], amber = [];
  for (const r of reports) {
    for (const a of r.agents || []) {
      if ((a.tokens ?? 0) > 100000 || (a.promptKb ?? 0) > 50) red.push(`${r.wave}/${a.label}: ${a.tokens} tokens, start ${a.promptKb} KB`);
    }
    if (r.estimate && r.total > 2 * r.estimate) amber.push(`${r.wave}: ${r.total} mod estimat ${r.estimate}`);
  }
  if (red.length) return { level: RED, summary: red.join(" · ") };
  if (amber.length) return { level: AMBER, summary: amber.join(" · ") };
  return { level: GREEN, summary: `${reports.length} bølge(r) inden for grænserne` };
}

/** Spor uden leverance: rød = draft-PR >4 t gammel med push de seneste 24 t; gul = draft uden push >24 t. */
export function classifyTracks(prs, nowMs) {
  const h = 3600 * 1000;
  const red = [], amber = [];
  for (const p of prs) {
    if (!p.draft) continue;
    const age = nowMs - Date.parse(p.created_at);
    const sincePush = nowMs - Date.parse(p.pushed_at ?? p.updated_at);
    if (age > 4 * h && sincePush <= 24 * h) red.push(`#${p.number} (${Math.round(age / h)} t uden merge)`);
    else if (sincePush > 24 * h) amber.push(`#${p.number} (${Math.round(sincePush / h)} t uden push)`);
  }
  if (red.length) return { level: RED, summary: `aktive drafts uden leverance: ${red.join(", ")}` };
  if (amber.length) return { level: AMBER, summary: `stille drafts: ${amber.join(", ")}` };
  return { level: GREEN, summary: "ingen aktive drafts over 4 t" };
}

export function parseState(body) {
  const m = STATE_RE.exec(body || "");
  try { return m ? JSON.parse(m[1]) : {}; } catch { return {}; }
}

export function parseWaveTokenComments(comments, nowMs) {
  const out = [];
  for (const c of comments) {
    if (nowMs - Date.parse(c.created_at) > 24 * 3600 * 1000) continue;
    const i = (c.body || "").indexOf(TOKEN_MARKER);
    if (i < 0) continue;
    const end = c.body.indexOf("-->", i);
    try { out.push(JSON.parse(c.body.slice(i + TOKEN_MARKER.length, end).trim())); } catch { /* malformed marker ignoreres */ }
  }
  return out;
}

const ORDER = [RED, AMBER, NODATA, GREEN];
export function renderReport(sections, { stamp, state }) {
  const sorted = [...sections].sort((a, b) => ORDER.indexOf(a.level) - ORDER.indexOf(b.level));
  const reds = sorted.filter((s) => s.level === RED);
  const head = reds.length ? `**${reds.length} rød(e)**: ${reds.map((s) => s.name).join(", ")}` : "**Intet rødt.**";
  const rows = sorted.map((s) => `| ${s.level} | ${s.name} | ${s.summary.replace(/\|/g, "/")} |`);
  return [
    `## Hvad brænder · ${stamp}`,
    "",
    head,
    "",
    "| Status | Kilde | Fund |",
    "|---|---|---|",
    ...rows,
    "",
    "_Grænser og design: #6548. Opdateres dagligt kl. 08:00; kommentar kun ved rødt._",
    "",
    `<!-- hvad-braender-state: ${JSON.stringify(state)} -->`,
  ].join("\n");
}

// ── I/O ──────────────────────────────────────────────────────────────────────

async function gh(path, { method = "GET", body } = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`GitHub ${method} ${path.split("?")[0]}: ${res.status}`);
  return res.json();
}

async function psqlScalarRow(sql) {
  try {
    const { stdout } = await execFileAsync("psql", [process.env.SUPABASE_DB_URL, "-X", "-tA", "-F", "|", "-v", "ON_ERROR_STOP=1", "-c", sql], { timeout: 60000 });
    return stdout.trim().split("\n")[0].split("|");
  } catch (err) {
    // stderr kan indeholde host: kun en grov klasse.
    throw new Error(err?.code === "ENOENT" ? "psql ikke fundet" : err?.killed ? "psql-timeout" : "psql-fejl");
  }
}

const cphDate = (ms) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Copenhagen" }).format(new Date(ms));

async function safe(name, fn) {
  try { return { name, ...(await fn()) }; } catch (e) { return { name, level: NODATA, summary: `kunne ikke måles (${e.message})` }; }
}

// GitHub kan forsinke planlagte kørsler i timevis (13/10: 06:00Z kom 13:48Z). Gaten i
// workflowet er derfor "kl. 08 eller senere"; her sikrer state, at der kun rapporteres én gang pr. dag.
export function alreadyReported(state, today, scheduled) {
  return Boolean(scheduled) && state?.reportedOn === today;
}

export async function main(argv = process.argv.slice(2)) {
  const dryRun = argv.includes("--dry-run");
  const repo = process.env.GITHUB_REPOSITORY || "NicolaiDolmer/CyclingZone";
  const issueNo = Number(process.env.HVAD_BRAENDER_ISSUE || 6549);
  if (!process.env.GITHUB_TOKEN) { console.error("GITHUB_TOKEN mangler"); return 1; }
  const now = Date.now();
  const today = cphDate(now);
  const yesterday = cphDate(now - 86400000);

  const issue = await gh(`/repos/${repo}/issues/${issueNo}`);
  const state = parseState(issue.body);
  state.db = state.db || {};
  if (alreadyReported(state, today, process.env.HVAD_BRAENDER_SCHEDULED === "1")) {
    console.log(`[hvad-braender] allerede rapporteret ${today}, springer over`);
    return 0;
  }

  const sections = await Promise.all([
    safe("Sentry 24 t", async () => {
      if (!process.env.SENTRY_AUTH_TOKEN) throw new Error("SENTRY_AUTH_TOKEN mangler");
      const org = process.env.SENTRY_ORG || "cycling-zone", project = process.env.SENTRY_PROJECT_ID || "4511389114105936";
      const res = await fetch(`https://sentry.io/api/0/organizations/${org}/issues/?project=${project}&query=is:unresolved&statsPeriod=24h&limit=50`, { headers: { Authorization: `Bearer ${process.env.SENTRY_AUTH_TOKEN}` } });
      if (!res.ok) throw new Error(`Sentry ${res.status}`);
      const issues = (await res.json()).filter((i) => Date.parse(i.lastSeen) >= now - 86400000);
      return classifySentry(issues, now);
    }),
    safe("CI på main", async () => {
      const since = new Date(now - 3 * 86400000).toISOString().slice(0, 10);
      const data = await gh(`/repos/${repo}/actions/runs?branch=main&per_page=100&created=>=${since}`);
      return classifyCi(data.workflow_runs.filter((r) => r.name !== "Deploy verify"));
    }),
    safe("Database", async () => {
      if (!process.env.SUPABASE_DB_URL) throw new Error("SUPABASE_DB_URL mangler");
      const [db, wal] = await psqlScalarRow("select pg_database_size(current_database()), (select coalesce(sum(size),0) from pg_ls_waldir())");
      const result = classifyDb({ dbBytes: Number(db), walBytes: Number(wal) }, state.db, today);
      state.db[today] = Number(db);
      for (const d of Object.keys(state.db).sort().slice(0, -14)) delete state.db[d];
      return result;
    }),
    safe("Aftentræning", async () => {
      if (!process.env.SUPABASE_DB_URL) throw new Error("SUPABASE_DB_URL mangler");
      const [total, complete, secs] = await psqlScalarRow(
        `with s as (select greatest(coalesce(max(scheduled_at), '-infinity'), ('${yesterday} 20:00'::timestamp at time zone 'Europe/Copenhagen')) start_at
           from race_stage_schedule where (scheduled_at at time zone 'Europe/Copenhagen')::date = '${yesterday}')
         select count(*), count(*) filter (where status='complete'),
           extract(epoch from max(w.updated_at) filter (where w.status='complete') - (select start_at from s))
         from training_date_work w where w.tick_date='${yesterday}'`);
      return classifyTraining({ tickDate: yesterday, total: Number(total), complete: Number(complete), durationSeconds: secs === "" ? null : Number(secs) });
    }),
    safe("Deploy verify", async () => {
      const data = await gh(`/repos/${repo}/actions/workflows/deploy-verify.yml/runs?branch=main&per_page=10`);
      return classifyDeploy(data.workflow_runs);
    }),
    safe("Bølge-tokens", async () => {
      const since = new Date(now - 86400000).toISOString();
      const comments = await gh(`/repos/${repo}/issues/comments?since=${since}&per_page=100`);
      return classifyWaveTokens(parseWaveTokenComments(comments, now));
    }),
    safe("Spor uden leverance", async () => {
      const prs = await gh(`/repos/${repo}/pulls?state=open&per_page=100`);
      const withPush = await Promise.all(prs.filter((p) => p.draft).map(async (p) => {
        const commits = await gh(`/repos/${repo}/pulls/${p.number}/commits?per_page=100`);
        const last = commits.at(-1)?.commit?.committer?.date;
        return { ...p, pushed_at: last ?? p.updated_at };
      }));
      return classifyTracks(withPush, now);
    }),
  ]);

  const stamp = `${today} kl. ${new Intl.DateTimeFormat("da-DK", { timeZone: "Europe/Copenhagen", hour: "2-digit", minute: "2-digit" }).format(new Date(now))}`;
  if (!dryRun) state.reportedOn = today;
  const body = renderReport(sections, { stamp, state });
  if (dryRun) { console.log(body); return 0; }
  // Rød-kommentaren sendes FØR body'en (med reportedOn) gemmes: fejler alarmen, prøver næste
  // planlagte kørsel igen i stedet for at tro, at dagen er rapporteret.
  const reds = sections.filter((s) => s.level === RED);
  if (reds.length) {
    await gh(`/repos/${repo}/issues/${issueNo}/comments`, { method: "POST", body: { body: `**Rødt ${stamp}:** ${reds.map((s) => `${s.name}: ${s.summary}`).join(" · ")}` } });
  }
  await gh(`/repos/${repo}/issues/${issueNo}`, { method: "PATCH", body: { body } });
  console.log(`[hvad-braender] ${sections.map((s) => `${s.name}=${s.level}`).join(" · ")}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => { process.exitCode = code; }, (e) => { console.error(`[hvad-braender] fejl: ${e.message}`); process.exitCode = 1; });
}
