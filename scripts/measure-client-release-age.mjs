#!/usr/bin/env node
// Retention efter MÅLT klient-alder (#5162, spor K3).
//
// Hvilke gamle releases skal næste build bære videre? Ikke et fast antal dage
// (ejer 24/9: "ikke fast antal dage"), men de releases som aktive klienter
// faktisk stadig kører. Scriptet:
//
//   1. spørger PostHog (READ-ONLY, HogQL) hvor mange events hver frontend-
//      release (`cz_frontend`-property, = <meta name="cz-frontend">) har haft
//      pr. time de sidste 7 døgn,
//   2. læser hvornår hver release blev lagt i lageret (manifesternes
//      oprettelsestid) og dermed hvornår den blev AFLØST af den næste,
//   3. beregner p99 af "hvor længe efter afløsningen kører en klient stadig
//      den gamle release" over alle events fra afløste releases,
//   4. vinduet er max(72 t, p99 + 24 t): alle releases set inden for vinduet
//      beholdes, plus ALTID de 3 nyeste (gulvet, så en telemetri-pause ikke
//      tømmer listen). Loft 30 releases: overskrides det, beholdes de 30
//      nyeste OG der rejses en alarm (aldrig stille beskæring),
//   5. skriver `retention.json` til bucketen. Det er scriptets ENESTE skrivning.
//
// Kørsel: deploy-verify.yml efter hvert deploy til main. Uden PostHog-nøgle
// eller lager: springer over med en tydelig linje (exit 0). Carry-forward
// bruger da gulvet eller den seneste retention.json, som altid er en
// over-mængde af det nu nødvendige: siden målingen kan kun den nyeste release
// være kommet til, og den er i gulvet.
//
//   node scripts/measure-client-release-age.mjs [--dry-run] [--json]
//
// Miljø:
//   POSTHOG_PERSONAL_API_KEY  personlig nøgle med query:read (aldrig projekt-nøglen)
//   POSTHOG_PROJECT_ID        PostHog-projektets numeriske id
//   POSTHOG_HOST              default https://eu.posthog.com
//   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SERVICE_KEY  lageret
//   CZ_RELEASE_ASSETS_LOCAL_DIR  lokalt lager (tests)
//
// Exit 0 = målt og skrevet (også med alarm, som står i retention.json, i
// GitHub-annotationen og i step-summary). Exit 1 = målingen kunne ikke
// gennemføres med nøgler til stede.

import fs from "node:fs";
import { pathToFileURL } from "node:url";

import {
  FLOOR_RELEASES,
  MANIFEST_PREFIX,
  MARGIN_HOURS,
  MAX_RELEASES,
  MEASURE_LOOKBACK_DAYS,
  MIN_WINDOW_HOURS,
  RETENTION_OBJECT_PATH,
  RETENTION_SCHEMA,
  createStore,
  describeStore,
  isValidReleaseId,
  resolveStoreConfig,
} from "./lib/releaseAssetsStore.mjs";

const LOG_PREFIX = "[release-assets:retention]";
const HOUR_MS = 60 * 60 * 1000;
export const FRONTEND_PROPERTY = "cz_frontend";

export const RETENTION_QUERY = `
SELECT properties.${FRONTEND_PROPERTY} AS fe, toStartOfHour(timestamp) AS h, count() AS c
FROM events
WHERE timestamp > now() - INTERVAL ${MEASURE_LOOKBACK_DAYS} DAY
  AND notEmpty(toString(properties.${FRONTEND_PROPERTY}))
GROUP BY fe, h
ORDER BY h
LIMIT 100000
`.trim();

/** Vægtet percentil (nearest-rank) over [{ value, weight }]. 0 ved tom liste. */
export function weightedPercentile(samples, p) {
  const rows = samples.filter((s) => s.weight > 0).sort((a, b) => a.value - b.value);
  const total = rows.reduce((sum, s) => sum + s.weight, 0);
  if (total === 0) return 0;
  const rank = Math.ceil((p / 100) * total);
  let seen = 0;
  for (const row of rows) {
    seen += row.weight;
    if (seen >= rank) return row.value;
  }
  return rows[rows.length - 1].value;
}

/**
 * Ren beregning.
 *
 * @param {object} input
 * @param {Array<{frontend: string, hour: number, count: number}>} input.observations
 *        events pr. release pr. time (hour = ms-epoch for timens start)
 * @param {Array<{frontend: string, createdAt: number}>} input.releases
 *        alle releases i lageret (ms-epoch)
 * @param {number} input.now ms-epoch
 */
export function computeRetention({ observations, releases, now }) {
  const ordered = [...releases]
    .filter((r) => isValidReleaseId(r.frontend) && Number.isFinite(r.createdAt))
    .sort((a, b) => b.createdAt - a.createdAt);
  const known = new Map(ordered.map((r) => [r.frontend, r]));

  // Afløst-tidspunkt = næste nyere releases oprettelse.
  const supersededAt = new Map();
  for (let i = 1; i < ordered.length; i += 1) supersededAt.set(ordered[i].frontend, ordered[i - 1].createdAt);

  const lastSeen = new Map();
  const staleSamples = [];
  const unknown = new Set();
  let totalEvents = 0;
  for (const obs of observations) {
    if (!obs || !Number.isFinite(obs.hour) || !(obs.count > 0)) continue;
    totalEvents += obs.count;
    if (!known.has(obs.frontend)) {
      if (obs.frontend) unknown.add(obs.frontend);
      continue;
    }
    // Timens SLUTNING er det seneste tidspunkt releasen kan være set.
    const seenUntil = Math.min(obs.hour + HOUR_MS, now);
    lastSeen.set(obs.frontend, Math.max(lastSeen.get(obs.frontend) ?? 0, seenUntil));
    const superseded = supersededAt.get(obs.frontend);
    if (superseded !== undefined && seenUntil > superseded) {
      staleSamples.push({ value: (seenUntil - superseded) / HOUR_MS, weight: obs.count });
    }
  }

  const p99StaleHours = Math.round(weightedPercentile(staleSamples, 99) * 10) / 10;
  const windowHours = Math.max(MIN_WINDOW_HOURS, p99StaleHours + MARGIN_HOURS);
  const cutoff = now - windowHours * HOUR_MS;

  const floor = ordered.slice(0, FLOOR_RELEASES).map((r) => r.frontend);
  const seenInWindow = ordered.filter((r) => (lastSeen.get(r.frontend) ?? 0) >= cutoff).map((r) => r.frontend);
  const wanted = ordered.map((r) => r.frontend).filter((id) => floor.includes(id) || seenInWindow.includes(id));

  const alarms = [];
  let kept = wanted;
  let dropped = [];
  if (wanted.length > MAX_RELEASES) {
    kept = wanted.slice(0, MAX_RELEASES);
    dropped = wanted.slice(MAX_RELEASES);
    alarms.push({
      kind: "cap_exceeded",
      message: `${wanted.length} releases er aktive inden for ${windowHours} t; loftet er ${MAX_RELEASES}. De ${dropped.length} ældste bæres IKKE videre.`,
    });
  }
  if (totalEvents === 0) {
    alarms.push({
      kind: "empty_telemetry",
      message: `Ingen events med ${FRONTEND_PROPERTY} de sidste ${MEASURE_LOOKBACK_DAYS} døgn — kun gulvet (${floor.length} nyeste) beholdes.`,
    });
  }

  return {
    schema: RETENTION_SCHEMA,
    generated_at: new Date(now).toISOString(),
    source: "posthog",
    lookback_days: MEASURE_LOOKBACK_DAYS,
    p99_stale_hours: p99StaleHours,
    window_hours: windowHours,
    floor,
    cap: MAX_RELEASES,
    releases: kept,
    dropped,
    unknown_releases_seen: [...unknown].sort(),
    stale_events: staleSamples.reduce((sum, s) => sum + s.weight, 0),
    total_events: totalEvents,
    alarms,
  };
}

/** HogQL-resultat → observationer. Ukendte rækker ignoreres. */
export function parsePosthogRows(payload) {
  const rows = Array.isArray(payload?.results) ? payload.results : [];
  const out = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 3) continue;
    const [fe, h, c] = row;
    const hour = Date.parse(typeof h === "string" && !/[zZ]|[+-]\d\d:?\d\d$/.test(h) ? `${h.replace(" ", "T")}Z` : h);
    const count = Number(c);
    if (typeof fe !== "string" || !Number.isFinite(hour) || !Number.isFinite(count)) continue;
    out.push({ frontend: fe.trim(), hour, count });
  }
  return out;
}

export async function queryPosthog({ host, projectId, apiKey, fetchImpl = globalThis.fetch }) {
  const res = await fetchImpl(`${host.replace(/\/+$/, "")}/api/projects/${encodeURIComponent(projectId)}/query/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: { kind: "HogQLQuery", query: RETENTION_QUERY }, name: "cz-release-retention-5162" }),
  });
  if (!res.ok) throw new Error(`PostHog query svarede ${res.status}`);
  return parsePosthogRows(await res.json());
}

export async function listStoredReleases(store) {
  const rows = await store.list(MANIFEST_PREFIX, { sort: "newest", limit: 1000 });
  return rows
    .map((row) => ({ frontend: row.name.replace(/\.json$/, ""), createdAt: Date.parse(row.createdAt ?? "") }))
    .filter((r) => isValidReleaseId(r.frontend) && Number.isFinite(r.createdAt));
}

export function formatSummary(retention) {
  const lines = [
    `Retention (#5162): ${retention.releases.length} releases bæres videre`,
    `  p99 klient-alder efter afløsning: ${retention.p99_stale_hours} t → vindue ${retention.window_hours} t (gulv ${MIN_WINDOW_HOURS} t)`,
    `  events: ${retention.total_events} i alt, ${retention.stale_events} fra afløste releases`,
    `  gulv: ${retention.floor.join(", ") || "(intet)"}`,
  ];
  if (retention.unknown_releases_seen.length > 0) {
    lines.push(`  set i telemetrien uden manifest (fra før carry-forward eller fejlet upload): ${retention.unknown_releases_seen.length}`);
  }
  for (const alarm of retention.alarms) lines.push(`  ALARM [${alarm.kind}]: ${alarm.message}`);
  return lines.join("\n");
}

function appendStepSummary(env, text) {
  if (!env.GITHUB_STEP_SUMMARY) return;
  try {
    fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `\n\`\`\`\n${text}\n\`\`\`\n`);
  } catch { /* summary er best-effort */ }
}

export async function measure({ env = process.env, dryRun = false, store: injectedStore, fetchImpl = globalThis.fetch, now = Date.now(), log = console.log } = {}) {
  const apiKey = env.POSTHOG_PERSONAL_API_KEY || "";
  const projectId = env.POSTHOG_PROJECT_ID || "";
  if (!apiKey || !projectId) {
    const missing = [!apiKey && "POSTHOG_PERSONAL_API_KEY", !projectId && "POSTHOG_PROJECT_ID"].filter(Boolean).join(" + ");
    log(`::notice::${LOG_PREFIX} springer over: ${missing} mangler. Carry-forward bruger gulvet/seneste retention.json.`);
    return { status: "skipped", reason: `${missing} mangler` };
  }
  const config = injectedStore ? { kind: "injected" } : resolveStoreConfig(env);
  if (!injectedStore && config.kind === "none") {
    log(`::notice::${LOG_PREFIX} springer over: ${config.reason}.`);
    return { status: "skipped", reason: config.reason };
  }
  const store = injectedStore ?? createStore(config, { fetchImpl });

  const [observations, releases] = await Promise.all([
    queryPosthog({ host: env.POSTHOG_HOST || "https://eu.posthog.com", projectId, apiKey, fetchImpl }),
    listStoredReleases(store),
  ]);
  const retention = computeRetention({ observations, releases, now });
  const summary = formatSummary(retention);
  log(summary);
  appendStepSummary(env, summary);
  for (const alarm of retention.alarms) log(`::warning::${LOG_PREFIX} ${alarm.message}`);

  if (dryRun) {
    log(`${LOG_PREFIX} --dry-run: retention.json IKKE skrevet.`);
    return { status: "dry-run", retention };
  }
  await store.put(RETENTION_OBJECT_PATH, Buffer.from(`${JSON.stringify(retention, null, 2)}\n`), {
    contentType: "application/json",
    upsert: true,
  });
  log(`${LOG_PREFIX} retention.json skrevet til ${injectedStore ? "injiceret lager" : describeStore(config)}.`);
  return { status: "written", retention };
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const dryRun = argv.includes("--dry-run");
  const asJson = argv.includes("--json");
  const unknownArg = argv.find((a) => a !== "--dry-run" && a !== "--json");
  if (unknownArg) {
    console.error(`${LOG_PREFIX} ukendt argument: ${unknownArg}`);
    return 1;
  }
  try {
    const result = await measure({ env, dryRun });
    if (asJson) console.log(JSON.stringify(result, null, 2));
    return 0;
  } catch (err) {
    console.error(`::error::${LOG_PREFIX} måling fejlede: ${err.message}`);
    return 1;
  }
}

const invokedDirectly = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) {
  process.exitCode = await main();
}
