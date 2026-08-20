#!/usr/bin/env node
/**
 * Cycling Zone — Ugentlig Supabase advisor-sweep (#3978)
 * ========================================================
 * `scripts/db-health.sql` (db-health.yml, mandage) daekker SQL-maalbare
 * advisor-klasser (RLS initplan, dobbelte permissive policies, invalide
 * indexes, statistik-drift). Supabases egne advisors har OGSAA fund der
 * ikke kan ses fra SQL — auth-konfiguration (OTP-udloeb, leaked-password-
 * protection) og nye advisor-typer Supabase tilfoejer loebende. Dette
 * script kalder Management-API'ets `/advisors/security`-endpoint direkte
 * og diff'er mod den dokumenterede accept-liste, saa kun NYE fund larmer.
 *
 * Accept-listen er scripts/ops/supabase-advisor-allowlist.json, afledt af
 * docs/audits/2026-08-04-supabase-hardening.md. Match er praecist: enten
 * finding.name (hele klassen, kun for pervasive INFO-stoej) eller et
 * cache_key-prefix (specifikt fund — funktionsnavn+signatur er en del af
 * cache_key, saa en NY funktion med samme advisor-type IKKE matcher).
 *
 * READ-ONLY — kalder kun GET .../advisors/security. Ingen mutationer.
 *
 * Env:
 *   SUPABASE_ACCESS_TOKEN   (paakraevet) — se scripts/ops/supabase-log-watch.mjs.
 *   SUPABASE_PROJECT_REF    (valgfri) — default 'ghwvkxzhsbbltzfnuhhz'.
 *
 * Usage:
 *   node scripts/ops/supabase-advisor-sweep.mjs           # menneskelig
 *   node scripts/ops/supabase-advisor-sweep.mjs --json     # maskinlaesbart
 *
 * Exit: 0 = koerte OK (uanset fund/ej-fund) · 1 = config/API-fejl.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ALLOWLIST_PATH = path.join(__dirname, "supabase-advisor-allowlist.json");

function isMain() {
  if (!import.meta || !import.meta.url) return false;
  try { return path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1] ?? ""); }
  catch { return false; }
}

export function loadAllowlist(allowlistPath = ALLOWLIST_PATH) {
  const raw = JSON.parse(readFileSync(allowlistPath, "utf8"));
  return {
    names: new Set((raw.acceptedNames || []).map((e) => e.name)),
    cacheKeyPrefixes: (raw.acceptedCacheKeys || []).map((e) => e.cacheKeyPrefix),
  };
}

export function isAllowed(finding, allowlist) {
  if (allowlist.names.has(finding.name)) return true;
  return allowlist.cacheKeyPrefixes.some((prefix) => (finding.cache_key || "").startsWith(prefix));
}

/** @returns {object[]} findings der IKKE er daekket af accept-listen. */
export function diffFindings(findings, allowlist) {
  return findings.filter((f) => !isAllowed(f, allowlist));
}

async function fetchSecurityAdvisors(token, ref) {
  const url = `https://api.supabase.com/v1/projects/${ref}/advisors/security`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Management-API ${res.status}: ${text.slice(0, 300)}`);
  }
  const body = await res.json();
  return body.lints || body.result?.lints || [];
}

async function main() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = process.env.SUPABASE_PROJECT_REF || "ghwvkxzhsbbltzfnuhhz";
  const asJson = process.argv.includes("--json");

  if (!token) {
    console.error("[supabase-advisor-sweep] FAIL: SUPABASE_ACCESS_TOKEN mangler i env.");
    console.error("  Opret et personal access token: Supabase Dashboard -> Account -> Access Tokens.");
    console.error("  Saet det som GitHub-secret: gh secret set SUPABASE_ACCESS_TOKEN (aldrig i kode/logs).");
    process.exit(1);
  }

  const allowlist = loadAllowlist();

  let findings;
  try {
    findings = await fetchSecurityAdvisors(token, ref);
  } catch (err) {
    console.error(`[supabase-advisor-sweep] FAIL: ${err.message}`);
    process.exit(1);
  }

  const newFindings = diffFindings(findings, allowlist);
  const hasFindings = newFindings.length > 0;

  if (asJson) {
    console.log(JSON.stringify({ hasFindings, total: findings.length, newFindings }, null, 2));
  } else {
    console.log(`[supabase-advisor-sweep] ${findings.length} advisor-fund i alt, ${newFindings.length} uden for accept-listen.`);
    if (!hasFindings) {
      console.log("[supabase-advisor-sweep] OK - alle fund er dokumenterede/accepterede.");
    } else {
      console.log("\n== Nye/ikke-accepterede fund ==");
      for (const f of newFindings) {
        console.log(`  [${f.level}] ${f.name} — ${f.detail}`);
        console.log(`    ${f.remediation}`);
      }
    }
  }

  if (process.env.GITHUB_OUTPUT) {
    const fs = await import("node:fs");
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `has_findings=${hasFindings}\n`);
    if (hasFindings) {
      const body = newFindings.map((f) => `- **${f.level}** \`${f.name}\`: ${f.detail}\n  Remediation: ${f.remediation}`);
      fs.appendFileSync(process.env.GITHUB_OUTPUT, `findings<<ADVISORSWEEP_EOF\n${body.join("\n")}\nADVISORSWEEP_EOF\n`);
    }
  }

  process.exit(0);
}

if (isMain()) {
  main();
}
