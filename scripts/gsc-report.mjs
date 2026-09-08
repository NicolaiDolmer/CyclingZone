#!/usr/bin/env node
// Google Search Console-rapport (#3797) - laesevej til hvad Cycling Zone faktisk
// rankerer paa, uden at ejeren skal aabne GSC-UI'et.
//
// Moenster: samme som scripts/sentry-issues.mjs. Noeglen kommer KUN fra env via
// Infisical, aldrig fra disk, og hverken noeglen eller dens felter printes.
//
// SETUP (engangs - kun ejeren kan oprette service-kontoen):
//   Se docs/runbooks/GSC_SERVICE_ACCOUNT.md (ca. 10 minutter).
//   Kort: Google Cloud-projekt -> aktivér "Google Search Console API" -> opret
//   service-konto -> hent JSON-noeglen -> tilfoej service-kontoens e-mail som
//   bruger paa GSC-ejendommen -> laeg hele JSON'en i Infisical som
//   GSC_SERVICE_ACCOUNT_JSON (dev + prod).
//
// BRUG:
//   infisical run --env=dev -- node scripts/gsc-report.mjs
//   infisical run --env=dev -- node scripts/gsc-report.mjs --days=28
//   infisical run --env=dev -- node scripts/gsc-report.mjs --site=https://cyclingzone.org/
//   infisical run --env=dev -- node scripts/gsc-report.mjs --json
//
// ENV:
//   GSC_SERVICE_ACCOUNT_JSON  (paakraevet) - HELE service-account-JSON'en som én streng
//   GSC_SITE_URL              (valgfri)    - default sc-domain:cyclingzone.org
//
// EXIT-CODES:
//   0 = rapport hentet
//   1 = ugyldige argumenter
//   2 = manglende eller ugyldig GSC_SERVICE_ACCOUNT_JSON (peger paa runbooken)
//   3 = API-fejl (auth, netvaerk, rate-limit, ukendt property)
//
// Ingen npm-dependency: JWT'en signeres med node:crypto, og baade token- og
// GSC-kaldet er rene fetch()-kald. googleapis ville traekke ~50 MB ind for tre
// HTTP-kald.

import process from "node:process";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RUNBOOK = "docs/runbooks/GSC_SERVICE_ACCOUNT.md";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const API_BASE = "https://searchconsole.googleapis.com/webmasters/v3/sites";
const DEFAULT_SITE = process.env.GSC_SITE_URL || "sc-domain:cyclingzone.org";

// GSC's data er typisk 2-3 dage forsinket. Rapporten slutter derfor 3 dage
// tilbage i tiden, ellers ser den seneste periode kunstigt tom ud og
// sammenligningen mod forrige periode bliver misvisende.
const LAG_DAYS = 3;

function parseArgs(argv) {
  const args = {};
  for (const arg of argv.slice(2)) {
    if (!arg.startsWith("--")) return { _error: `ukendt argument: ${arg}` };
    const [key, ...rest] = arg.slice(2).split("=");
    args[key] = rest.length ? rest.join("=") : true;
  }
  return args;
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

// Returnerer {current:{start,end}, previous:{start,end}} som ISO-datoer.
// Eksporteret saa perioderegningen kan testes uden netvaerk.
export function periodRange(days, now = new Date(), lagDays = LAG_DAYS) {
  const end = new Date(now);
  end.setUTCDate(end.getUTCDate() - lagDays);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  const prevEnd = new Date(start);
  prevEnd.setUTCDate(prevEnd.getUTCDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setUTCDate(prevStart.getUTCDate() - (days - 1));
  return {
    current: { start: isoDate(start), end: isoDate(end) },
    previous: { start: isoDate(prevStart), end: isoDate(prevEnd) },
  };
}

function base64url(input) {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Laeser service-konto-JSON'en fra env. Kaster med en besked der peger paa
// runbooken; selve noeglematerialet naevnes aldrig i fejlteksten.
function readServiceAccount() {
  const raw = process.env.GSC_SERVICE_ACCOUNT_JSON;
  if (!raw || !raw.trim()) {
    const err = new Error(
      `GSC_SERVICE_ACCOUNT_JSON mangler.\n` +
      `Koer scriptet gennem Infisical:\n` +
      `  infisical run --env=dev -- node scripts/gsc-report.mjs\n` +
      `Er noeglen ikke oprettet endnu, saa foelg ${RUNBOOK} (ca. 10 min, kun ejeren kan goere det).`
    );
    err.exitCode = 2;
    throw err;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const err = new Error(
      `GSC_SERVICE_ACCOUNT_JSON kunne ikke parses som JSON. Vaerdien skal vaere HELE ` +
      `service-account-filens indhold i én streng (inkl. de \\n-escapede linjeskift i private_key). Se ${RUNBOOK}.`
    );
    err.exitCode = 2;
    throw err;
  }
  if (!parsed.client_email || !parsed.private_key) {
    const err = new Error(
      `GSC_SERVICE_ACCOUNT_JSON mangler client_email og/eller private_key. ` +
      `Det ligner ikke en service-account-noegle. Se ${RUNBOOK}.`
    );
    err.exitCode = 2;
    throw err;
  }
  return parsed;
}

// Signeret JWT -> access token (OAuth2 jwt-bearer). private_key forlader aldrig
// denne funktion.
async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64url(JSON.stringify({
    iss: sa.client_email,
    scope: SCOPE,
    aud: sa.token_uri || TOKEN_URL,
    iat: now,
    exp: now + 3600,
  }));
  const signingInput = `${header}.${claim}`;
  let signature;
  try {
    signature = crypto.createSign("RSA-SHA256").update(signingInput).end()
      .sign(sa.private_key).toString("base64")
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  } catch {
    const err = new Error(`Kunne ikke signere JWT'en med private_key fra GSC_SERVICE_ACCOUNT_JSON. Se ${RUNBOOK}.`);
    err.exitCode = 2;
    throw err;
  }

  const res = await fetch(sa.token_uri || TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${signingInput}.${signature}`,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    const err = new Error(
      `Token-kaldet fejlede (${res.status} ${body.error || ""} ${body.error_description || ""}). ` +
      `Typisk aarsag: "Google Search Console API" er ikke aktiveret i Cloud-projektet, eller noeglen er slettet. Se ${RUNBOOK}.`
    );
    err.exitCode = 3;
    throw err;
  }
  return body.access_token;
}

async function queryGsc(token, site, body) {
  const url = `${API_BASE}/${encodeURIComponent(site)}/searchAnalytics/query`;
  const res = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = json?.error?.message || `HTTP ${res.status}`;
    const hint = res.status === 403
      ? ` Service-kontoen har sandsynligvis ikke adgang til "${site}". Tilfoej dens e-mail som bruger paa ejendommen, jf. ${RUNBOOK}.`
      : res.status === 404
        ? ` Ejendommen "${site}" findes ikke i denne konto. Proev --site=https://cyclingzone.org/ (URL-praefiks) i stedet for sc-domain-formen.`
        : "";
    const err = new Error(`GSC-kaldet fejlede: ${detail}.${hint}`);
    err.exitCode = 3;
    throw err;
  }
  return json.rows || [];
}

// Summerer rows til én total. GSC's egne totaler hentes ikke separat: summen
// over en dimension er den samme for clicks/impressions, og position/CTR
// beregnes vaegtet, saa tallet er sammenligneligt paa tvaers af perioder.
function totals(rows) {
  const clicks = rows.reduce((a, r) => a + (r.clicks || 0), 0);
  const impressions = rows.reduce((a, r) => a + (r.impressions || 0), 0);
  const weightedPos = rows.reduce((a, r) => a + (r.position || 0) * (r.impressions || 0), 0);
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : 0,
    position: impressions > 0 ? weightedPos / impressions : 0,
  };
}

function pct(n) {
  return `${(n * 100).toFixed(1)}%`;
}

function delta(now, before) {
  if (before === 0) return now === 0 ? "0" : "ny";
  const d = ((now - before) / before) * 100;
  const sign = d >= 0 ? "+" : "";
  return `${sign}${d.toFixed(0)}%`;
}

function pad(s, n) {
  const str = String(s);
  return str.length >= n ? str.slice(0, n) : str + " ".repeat(n - str.length);
}

function padLeft(s, n) {
  const str = String(s);
  return str.length >= n ? str : " ".repeat(n - str.length) + str;
}

function printTable(title, rows, keyWidth) {
  console.log(`\n${title}`);
  if (rows.length === 0) {
    console.log("  (ingen data i perioden)");
    return;
  }
  console.log(`  ${pad("", keyWidth)} ${padLeft("klik", 6)} ${padLeft("vis", 8)} ${padLeft("CTR", 7)} ${padLeft("pos", 6)}`);
  for (const r of rows) {
    console.log(
      `  ${pad(r.keys?.[0] ?? "", keyWidth)} ${padLeft(r.clicks || 0, 6)} ${padLeft(r.impressions || 0, 8)} ` +
      `${padLeft(pct(r.ctr || 0), 7)} ${padLeft((r.position || 0).toFixed(1), 6)}`
    );
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (args._error) {
    console.error(`${args._error}\nBrug: infisical run --env=dev -- node scripts/gsc-report.mjs [--days=28] [--site=<url>] [--json]`);
    process.exitCode = 1;
    return;
  }
  const days = args.days === undefined ? 28 : Number.parseInt(String(args.days), 10);
  if (!Number.isFinite(days) || days < 1 || days > 480) {
    console.error("--days skal vaere et helt tal mellem 1 og 480 (GSC gemmer 16 maaneder).");
    process.exitCode = 1;
    return;
  }
  const site = typeof args.site === "string" ? args.site : DEFAULT_SITE;

  const sa = readServiceAccount();
  const token = await getAccessToken(sa);
  const range = periodRange(days);

  const q = (period, dimensions, rowLimit) => queryGsc(token, site, {
    startDate: period.start,
    endDate: period.end,
    dimensions,
    rowLimit,
  });

  const [queriesNow, queriesPrev, pagesNow] = await Promise.all([
    q(range.current, ["query"], 25),
    q(range.previous, ["query"], 25),
    q(range.current, ["page"], 10),
  ]);

  const totalNow = totals(queriesNow);
  const totalPrev = totals(queriesPrev);

  if (args.json) {
    console.log(JSON.stringify({
      site,
      days,
      period: range,
      totals: { current: totalNow, previous: totalPrev },
      queries: queriesNow,
      pages: pagesNow,
    }, null, 2));
    return;
  }

  console.log(`Google Search Console - ${site}`);
  console.log(`Periode: ${range.current.start} til ${range.current.end} (${days} dage, GSC halter ~${LAG_DAYS} dage)`);
  console.log(`Forrige: ${range.previous.start} til ${range.previous.end}`);
  console.log("");
  console.log(`Klik:        ${totalNow.clicks} (${delta(totalNow.clicks, totalPrev.clicks)} mod forrige periode)`);
  console.log(`Visninger:   ${totalNow.impressions} (${delta(totalNow.impressions, totalPrev.impressions)})`);
  console.log(`CTR:         ${pct(totalNow.ctr)} (forrige ${pct(totalPrev.ctr)})`);
  console.log(`Snit-pos:    ${totalNow.position.toFixed(1)} (forrige ${totalPrev.position.toFixed(1)})`);
  console.log("");
  console.log("Totalerne er summen over top-25-queries, ikke hele ejendommen: GSC skjuler");
  console.log("anonymiserede queries, saa summen er systematisk lavere end GSC-UI'ets total.");

  printTable(`Top ${queriesNow.length} queries`, queriesNow, 42);
  printTable(`Top ${pagesNow.length} sider`, pagesNow, 60);
}

// Koer kun naar scriptet kaldes direkte, saa periodRange kan importeres i en test
// uden at ramme netvaerket.
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err.message || String(err));
    process.exit(err.exitCode || 3);
  });
}
