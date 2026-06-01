#!/usr/bin/env node
// Sentry issue-reader — læse-vej til prod-fejl uden Sentry MCP (#741 cuttede MCP'en).
//
// Lister uresolvede issues fra Sentry Web-API'en, så Claude/Codex kan triage
// prod-fejl programmatisk under audits. DSN'en kan KUN sende events (write);
// at LÆSE issues kræver en Sentry auth-token (org/user-token med event:read).
//
// SETUP (engangs — kun ejeren kan oprette token):
//   1. Sentry → Settings → Account → Auth Tokens (eller Organization → Auth Tokens
//      for en org-token). Opret token med scopes: event:read, project:read, org:read.
//   2. Læg den i Infisical (så ingen secret rammer disken):
//        infisical secrets set SENTRY_AUTH_TOKEN=<token> --env=dev
//      (valgfrit også --env=prod). Org-slug + project-id er ikke hemmelige og
//      defaulter herunder.
//
// BRUG:
//   infisical run --env=dev -- node scripts/sentry-issues.mjs
//   infisical run --env=dev -- node scripts/sentry-issues.mjs --period=24h --query="is:unresolved" --limit=25
//   infisical run --env=dev -- node scripts/sentry-issues.mjs --json
//
// ENV (alle har defaults undtagen token):
//   SENTRY_AUTH_TOKEN  (påkrævet)  — auth-token med event:read
//   SENTRY_ORG         (default: cycling-zone)
//   SENTRY_PROJECT_ID  (default: 4511389114105936)
//   SENTRY_API_HOST    (default: https://sentry.io  — orgen er US-region; us.sentry.io virker også)
//
// EXIT-CODES:
//   0 = issues hentet (0 eller flere)
//   1 = manglende token / ugyldige args
//   2 = API-fejl (auth, netværk, rate-limit)

import process from "node:process";

const DEFAULTS = {
  org: process.env.SENTRY_ORG || "cycling-zone",
  projectId: process.env.SENTRY_PROJECT_ID || "4511389114105936",
  host: process.env.SENTRY_API_HOST || "https://sentry.io",
  query: "is:unresolved",
  period: "24h",
  limit: "25",
};

function parseArgs(argv) {
  const args = {};
  for (const arg of argv.slice(2)) {
    if (arg.startsWith("--")) {
      const [key, ...rest] = arg.slice(2).split("=");
      args[key] = rest.length ? rest.join("=") : true;
    }
  }
  return args;
}

function fmtAge(iso) {
  if (!iso) return "?";
  const then = new Date(iso).getTime();
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}t`;
  return `${Math.round(hrs / 24)}d`;
}

async function main() {
  const args = parseArgs(process.argv);
  const token = process.env.SENTRY_AUTH_TOKEN;

  if (!token) {
    console.error("❌ SENTRY_AUTH_TOKEN mangler.");
    console.error("   Opret en Sentry auth-token (scopes: event:read, project:read) og læg i Infisical:");
    console.error("     infisical secrets set SENTRY_AUTH_TOKEN=<token> --env=dev");
    console.error("   Kør derefter: infisical run --env=dev -- node scripts/sentry-issues.mjs");
    process.exit(1);
  }

  const org = args.org || DEFAULTS.org;
  const projectId = args.project || DEFAULTS.projectId;
  const host = args.host || DEFAULTS.host;
  const query = args.query || DEFAULTS.query;
  const period = args.period || DEFAULTS.period;
  const limit = args.limit || DEFAULTS.limit;

  const url =
    `${host}/api/0/organizations/${encodeURIComponent(org)}/issues/` +
    `?project=${encodeURIComponent(projectId)}` +
    `&query=${encodeURIComponent(query)}` +
    `&statsPeriod=${encodeURIComponent(period)}` +
    `&limit=${encodeURIComponent(limit)}`;

  let res;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
  } catch (err) {
    console.error(`❌ Netværksfejl mod Sentry API: ${err.message}`);
    process.exit(2);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`❌ Sentry API ${res.status} ${res.statusText}`);
    if (res.status === 401 || res.status === 403) {
      console.error("   Token mangler scope (event:read/project:read) eller er udløbet.");
    }
    if (body) console.error(`   ${body.slice(0, 300)}`);
    process.exit(2);
  }

  const issues = await res.json();

  if (args.json) {
    console.log(JSON.stringify(issues, null, 2));
    return;
  }

  console.log(`Sentry — org=${org} project=${projectId} query="${query}" period=${period}`);
  console.log(`${issues.length} issue(s):\n`);

  if (issues.length === 0) {
    console.log("  (ingen issues i vinduet)");
    return;
  }

  for (const i of issues) {
    const events = i.count ?? "?";
    const users = i.userCount ?? "?";
    console.log(`• [${i.level || "?"}] ${i.title}`);
    console.log(`  ${i.shortId || i.id} · ${events} events · ${users} brugere · sidst set ${fmtAge(i.lastSeen)} siden · først set ${fmtAge(i.firstSeen)} siden`);
    if (i.culprit) console.log(`  culprit: ${i.culprit}`);
    if (i.permalink) console.log(`  ${i.permalink}`);
    console.log("");
  }
}

main().catch((err) => {
  console.error("💥 sentry-issues fejlede:", err);
  process.exit(2);
});
