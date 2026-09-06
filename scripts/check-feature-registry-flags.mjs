#!/usr/bin/env node
// scripts/check-feature-registry-flags.mjs
// ============================================================
// Flag-gate for docs/FEATURE_REGISTRY.yml (#4921).
//
// FEJLKLASSEN: registret kan sige "live" mens prod-flaget staar off - praecis
// den drift der gjorde den gamle FEATURE_STATUS.md misvisende (facilities stod
// som gated `false` mens prod sagde `on`). Genereringen alene fanger det ikke:
// den tjekker kun at markdown matcher YAML'en, ikke at YAML'en matcher
// virkeligheden. Denne gate laeser prod `app_config` og doemmer hver post med
// et `flag` mod den faktiske vaerdi.
//
// REGLER:
//   state: live  + flag  -> vaerdien skal vaere on/true
//   state: beta  + flag  -> vaerdien skal vaere beta
//   andre states + flag  -> vaerdien maa IKKE vaere on/true
//   flag-noegle findes ikke i app_config -> FAIL
//   verified aeldre end 60 dage -> WARN (exit 0, men printet)
//
// Dormante flag (raekken findes bevidst ikke, fx race_engine_v4 hvor fravaer =
// off pr. fail-safe) hoerer derfor IKKE i `flag`-feltet - de hoerer i `note`.
// Registrets header siger det samme.
//
// DB-adgang: samme moenster som backend/scripts/audit-feature-liveness.js
// (SUPABASE_URL + SUPABASE_SERVICE_KEY, dotenv fra backend/.env). Uden env
// springer flag-sammenligningen over og exit'er 0, saa en lokal preflight uden
// prod-adgang ikke blokeres - CI har secrets og er den rigtige gate.
//
// Brug:
//   node scripts/check-feature-registry-flags.mjs
//
// Refs #4921.

// @supabase/supabase-js og dotenv importeres DOVENT inde i main(). Reglerne
// (evaluateFlags/findStale/normalizeFlagValue) er rene og skal kunne testes i
// et job der ikke har koert `npm ci` - foerste CI-koersel fejlede praecis der:
// ERR_MODULE_NOT_FOUND i freshness-jobbet, som med vilje ikke installerer
// dependencies fordi det kun laver fil-sammenligning.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseRegistry, validate } from "./generate-feature-status.mjs";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const REGISTRY_PATH = join(ROOT, "docs", "FEATURE_REGISTRY.yml");
const STALE_DAYS = 60;

const ON_VALUES = new Set(["on", "true"]);

/**
 * app_config.value er jsonb: samme "taendt" kan komme tilbage som strengen
 * "on" eller som boolean true. Normaliser til en lowercase-streng, saa
 * reglerne kan skrives ét sted.
 *
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeFlagValue(raw) {
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "boolean") return raw ? "true" : "false";
  return String(raw).trim().toLowerCase();
}

/**
 * Ren funktion, saa reglerne kan testes uden DB.
 *
 * @param {Array<Record<string, string>>} entries
 * @param {Map<string, string>} flagValues normaliserede app_config-vaerdier
 * @returns {Array<{id: string, flag: string, state: string, value: string, level: "FAIL"|"OK", reason: string}>}
 */
export function evaluateFlags(entries, flagValues) {
  const rows = [];
  for (const e of entries) {
    if (!e.flag) continue;
    if (!flagValues.has(e.flag)) {
      rows.push({
        id: e.id,
        flag: e.flag,
        state: e.state,
        value: "(findes ikke)",
        level: "FAIL",
        reason: "noeglen findes ikke i prod app_config",
      });
      continue;
    }
    const value = flagValues.get(e.flag);
    let level = "OK";
    let reason = "";
    if (e.state === "live" && !ON_VALUES.has(value)) {
      level = "FAIL";
      reason = "state live kraever flag on/true";
    } else if (e.state === "beta" && value !== "beta") {
      level = "FAIL";
      reason = "state beta kraever flag beta";
    } else if (e.state !== "live" && e.state !== "beta" && ON_VALUES.has(value)) {
      level = "FAIL";
      reason = `state ${e.state} men flaget er taendt`;
    }
    rows.push({ id: e.id, flag: e.flag, state: e.state, value, level, reason });
  }
  return rows;
}

/**
 * @param {Array<Record<string, string>>} entries
 * @param {Date} now
 * @returns {Array<{id: string, verified: string, days: number}>}
 */
export function findStale(entries, now = new Date()) {
  const stale = [];
  for (const e of entries) {
    const verified = new Date(`${e.verified}T00:00:00Z`);
    if (Number.isNaN(verified.getTime())) continue;
    const days = Math.floor((now.getTime() - verified.getTime()) / 86400000);
    if (days > STALE_DAYS) stale.push({ id: e.id, verified: e.verified, days });
  }
  return stale.sort((a, b) => b.days - a.days);
}

function printTable(rows) {
  const widths = {
    id: Math.max(2, ...rows.map((r) => r.id.length)),
    flag: Math.max(4, ...rows.map((r) => r.flag.length)),
    state: Math.max(5, ...rows.map((r) => r.state.length)),
    value: Math.max(5, ...rows.map((r) => r.value.length)),
  };
  const pad = (s, n) => s.padEnd(n);
  console.log(
    `${pad("STATUS", 6)}  ${pad("id", widths.id)}  ${pad("flag", widths.flag)}  ${pad("state", widths.state)}  ${pad("value", widths.value)}  begrundelse`,
  );
  console.log("-".repeat(6 + widths.id + widths.flag + widths.state + widths.value + 22));
  for (const r of rows) {
    console.log(
      `${pad(r.level, 6)}  ${pad(r.id, widths.id)}  ${pad(r.flag, widths.flag)}  ${pad(r.state, widths.state)}  ${pad(r.value, widths.value)}  ${r.reason}`,
    );
  }
}

async function main() {
  const { default: dotenv } = await import("dotenv");
  dotenv.config({ path: join(ROOT, "backend", ".env"), quiet: true });

  const entries = parseRegistry(readFileSync(REGISTRY_PATH, "utf8"));
  const errors = validate(entries);
  if (errors.length > 0) {
    console.error("FEATURE_REGISTRY.yml er ugyldig:");
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  const stale = findStale(entries);
  if (stale.length > 0) {
    console.log(`ADVARSEL: ${stale.length} post(er) er ikke verificeret i over ${STALE_DAYS} dage:`);
    for (const s of stale) console.log(`  - ${s.id} (verified ${s.verified}, ${s.days} dage siden)`);
    console.log("");
  }

  // Trim i scriptet, ikke i workflow-YAML'en: feature-liveness-audit.yml maa
  // koere secrets gennem `tr -d '[:space:]'` i bash, fordi en efterhaengende
  // newline i en repo-secret ellers giver et ubrugeligt SUPABASE_URL. Samme
  // haerdning her, men ét sted der ogsaa daekker lokal koersel fra .env.
  const SUPABASE_URL = (process.env.SUPABASE_URL || "").trim();
  const SUPABASE_SERVICE_KEY = (process.env.SUPABASE_SERVICE_KEY || "").trim();
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.log("SUPABASE_URL/SUPABASE_SERVICE_KEY mangler - springer flag-sammenligningen over.");
    console.log("Registret selv er validt. CI koerer den rigtige gate med secrets.");
    process.exit(0);
  }

  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });
  const { data, error } = await supabase.from("app_config").select("key, value");
  if (error) {
    console.error(`Kunne ikke laese app_config: ${error.message}`);
    // process.exitCode, ikke process.exit(): et haardt exit mens supabase-js'
    // fetch-handles stadig lukker ned crasher libuv paa Windows med
    // "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)" og giver exit 127
    // i stedet for 1 - altsaa en gate der fejler paa den forkerte maade.
    process.exitCode = 1;
    return;
  }

  const flagValues = new Map((data || []).map((row) => [row.key, normalizeFlagValue(row.value)]));
  const rows = evaluateFlags(entries, flagValues);
  printTable(rows);

  const failures = rows.filter((r) => r.level === "FAIL");
  console.log("");
  console.log(`${rows.length} post(er) med flag - ${failures.length} fejl, ${stale.length} advarsel/advarsler.`);
  if (failures.length > 0) {
    console.error("FEATURE-REGISTER-GATE ROED: registrets tilstand matcher ikke prod app_config.");
    console.error("Fix: ret `state` i docs/FEATURE_REGISTRY.yml, eller flip flaget i prod - alt efter hvad der er sandt.");
    process.exitCode = 1;
    return;
  }
  console.log("FEATURE-REGISTER-GATE GROEN.");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
