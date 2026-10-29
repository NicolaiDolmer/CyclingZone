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
//   state: live    + flag  -> vaerdien skal vaere on/true
//   state: beta    + flag  -> vaerdien skal vaere beta
//   state: dormant + flag  -> vaerdien maa IKKE vaere on/true (identisk med
//                             building - bygget faerdigt, men bevidst
//                             slukket, #4928). Kraever `note` i registret,
//                             haandhaevet af generate-feature-status.mjs'
//                             validate(), ikke her.
//   andre states   + flag  -> vaerdien maa IKKE vaere on/true
//   flag-noegle findes ikke i app_config -> FAIL
//     UNDTAGEN i pull_request-kontekst (--base-ref): indsaetter PR'ens diff en
//     database/*.sql netop den noegle i app_config med en vaerdi der IKKE er
//     on/true, er status PENDING (exit 0, printet) - raekken oprettes foerst af
//     auto-migrate efter merge (#2642). Paa main/push/cron gaelder FAIL uaendret,
//     saa en migration der aldrig blev koert stadig fanges (#7344).
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
import { execFileSync } from "node:child_process";
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
 * Finder app_config-noegler som SQL-tekster indsaetter med en vaerdi der IKKE er
 * on/true (fx '"off"'::jsonb, 'false'::jsonb, '"beta"'::jsonb). Ren funktion.
 * Konservativ: en vaerdi der ikke kan parses som literal taeller ikke som pending.
 *
 * @param {string[]} sqlTexts
 * @returns {Map<string, string>} noegle -> normaliseret seed-vaerdi
 */
export function findPendingFlagKeys(sqlTexts) {
  const pending = new Map();
  // En noegle der et sted i PR'en saettes on/true (eller ikke kan laeses), mister
  // undtagelsen for godt: en senere eller tidligere off-seed maa ikke redde den.
  const blocked = new Set();
  const note = (key, value) => {
    if (value === null || ON_VALUES.has(value)) {
      blocked.add(key);
      pending.delete(key);
    } else if (!blocked.has(key)) {
      pending.set(key, value);
    }
  };
  for (const sql of sqlTexts) {
    // Kommentarer og dollar-quoted tekst koerer ikke som SQL her: fjern dem foerst.
    const stripped = sql
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(\$[A-Za-z_]*\$)[\s\S]*?\1/g, "")
      .replace(/--[^\n]*/g, "");
    for (const stmt of splitStatements(stripped)) {
      const ins = /^\s*insert\s+into\s+(?:public\.)?app_config\s*\(([^)]*)\)\s*values\s*([\s\S]*)$/i.exec(stmt);
      if (ins) {
        const cols = ins[1].split(",").map((c) => c.trim().replace(/"/g, "").toLowerCase());
        const ki = cols.indexOf("key");
        const vi = cols.indexOf("value");
        // Ingen key/value-kolonne vi kan placere: konservativt, ingen undtagelse.
        if (ki < 0 || vi < 0) continue;
        for (const tuple of parseTuples(ins[2])) {
          const key = parseKeyLiteral(tuple[ki]);
          if (!key) continue;
          note(key, parseFlagLiteral(tuple[vi]));
        }
        continue;
      }
      const upd = /^\s*update\s+(?:public\.)?app_config\s+set\s+([\s\S]*?)\s+where\s+([\s\S]*)$/i.exec(stmt);
      if (upd) {
        const key = parseKeyLiteral((/\bkey\s*=\s*('(?:[^']|'')*')/i.exec(upd[2]) || [])[1]);
        const val = /\bvalue\s*=\s*('(?:[^']|'')*'(?:\s*::\s*jsonb)?|true|false)/i.exec(upd[1]);
        // En UPDATE opretter ingen raekke; kun en der taender (eller ikke kan laeses) blokerer.
        if (key) {
          const v = val ? parseFlagLiteral(val[1]) : null;
          if (v === null || ON_VALUES.has(v)) note(key, v);
        }
      }
    }
  }
  return pending;
}

/** Splitter SQL i saetninger paa ';' uden for '...'-literaler. */
function splitStatements(sql) {
  const out = [];
  let cur = "";
  let inStr = false;
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    if (ch === "'") {
      if (inStr && sql[i + 1] === "'") { cur += "''"; i += 1; continue; }
      inStr = !inStr;
    }
    if (ch === ";" && !inStr) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** VALUES-delen -> liste af tupler med raa elementer. Stopper ved ON CONFLICT/RETURNING. */
function parseTuples(valuesPart) {
  const tuples = [];
  let depth = 0;
  let inStr = false;
  let cur = "";
  let tuple = null;
  for (let i = 0; i < valuesPart.length; i += 1) {
    const ch = valuesPart[i];
    if (inStr) {
      cur += ch;
      if (ch === "'") {
        if (valuesPart[i + 1] === "'") { cur += "'"; i += 1; } else inStr = false;
      }
      continue;
    }
    if (ch === "'") { inStr = true; cur += ch; continue; }
    if (ch === "(") {
      depth += 1;
      if (depth === 1) { tuple = []; cur = ""; continue; }
    } else if (ch === ")") {
      depth -= 1;
      if (depth === 0) { tuple.push(cur.trim()); tuples.push(tuple); tuple = null; cur = ""; continue; }
    } else if (ch === "," && depth === 1) {
      tuple.push(cur.trim()); cur = ""; continue;
    } else if (depth === 0 && /[a-z]/i.test(ch)) {
      break; // ON CONFLICT ..., RETURNING ...
    }
    if (depth >= 1) cur += ch;
  }
  return tuples;
}

/** 'flag_key' -> flag_key, ellers null. */
function parseKeyLiteral(raw) {
  const m = /^'([A-Za-z0-9_.-]+)'$/.exec(String(raw ?? "").trim());
  return m ? m[1] : null;
}

/** Literal for value -> normaliseret streng, eller null hvis den ikke kan laeses. */
function parseFlagLiteral(raw) {
  const s = String(raw ?? "").trim().replace(/::\s*jsonb$/i, "").trim();
  if (/^(true|false)$/i.test(s)) return normalizeFlagValue(s.toLowerCase() === "true");
  if (!/^'(?:[^']|'')*'$/.test(s)) return null;
  try {
    return normalizeFlagValue(JSON.parse(s.slice(1, -1).replace(/''/g, "'")));
  } catch {
    return null;
  }
}

/**
 * Laeser NYE database/2026-*.sql (praecis auto-migrate.yml's glob: kun top-level)
 * som PR'en tilfoejer mod baseRef. Kun tilfoejede filer: en aendret, allerede
 * koert migration koeres aldrig igen. To-dots diff, saa det virker uden merge-base
 * i en shallow CI-checkout. Fejl -> tomt map = FAIL som foer.
 *
 * @param {string} baseRef
 * @returns {Map<string, string>}
 */
export function loadPendingKeysFromDiff(baseRef) {
  try {
    const names = execFileSync(
      "git",
      ["diff", "--name-only", "--diff-filter=A", baseRef, "HEAD", "--", "database"],
      { cwd: ROOT, encoding: "utf8" },
    )
      .split(/\r?\n/)
      .filter((n) => /^database\/2026-[^/]*\.sql$/.test(n));
    return findPendingFlagKeys(names.map((n) => readFileSync(join(ROOT, n), "utf8")));
  } catch (err) {
    console.log(`Kunne ikke laese PR-diff mod ${baseRef} (${String(err.message).split("\n")[0]}) - ingen PENDING-undtagelse.`);
    return new Map();
  }
}

/**
 * Ren funktion, saa reglerne kan testes uden DB.
 *
 * @param {Array<Record<string, string>>} entries
 * @param {Map<string, string>} flagValues normaliserede app_config-vaerdier
 * @param {Map<string, string>} [pendingKeys] noegle -> normaliseret seed-vaerdi (ikke on/true) fra en ny migration i samme PR (kun PR-kontekst)
 * @returns {Array<{id: string, flag: string, state: string, value: string, level: "FAIL"|"OK"|"PENDING", reason: string}>}
 */
export function evaluateFlags(entries, flagValues, pendingKeys = new Map()) {
  const rows = [];
  for (const e of entries) {
    if (!e.flag) continue;
    if (!flagValues.has(e.flag)) {
      if (pendingKeys.has(e.flag)) {
        // Seed-vaerdien skal ogsaa passe til registrets state, ellers fejler
        // gaten garanteret paa main efter auto-migrate.
        const seeded = pendingKeys.get(e.flag);
        const verdict = stateVerdict(e.state, seeded);
        rows.push({
          id: e.id,
          flag: e.flag,
          state: e.state,
          value: verdict.level === "OK" ? `(afventer migration: ${seeded})` : `(seedes ${seeded})`,
          level: verdict.level === "OK" ? "PENDING" : "FAIL",
          reason:
            verdict.level === "OK"
              ? "seedes af ny migration i samme PR - oprettes ved auto-migrate efter merge"
              : `migrationens seed-vaerdi passer ikke til state: ${verdict.reason}`,
        });
        continue;
      }
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
    const { level, reason } = stateVerdict(e.state, value);
    rows.push({ id: e.id, flag: e.flag, state: e.state, value, level, reason });
  }
  return rows;
}

/** state-reglen for en kendt flag-vaerdi (delt af prod-vaerdi og pending seed-vaerdi). */
function stateVerdict(state, value) {
  if (state === "live" && !ON_VALUES.has(value)) return { level: "FAIL", reason: "state live kraever flag on/true" };
  if (state === "beta" && value !== "beta") return { level: "FAIL", reason: "state beta kraever flag beta" };
  if (state !== "live" && state !== "beta" && ON_VALUES.has(value)) {
    return { level: "FAIL", reason: `state ${state} men flaget er taendt` };
  }
  return { level: "OK", reason: "" };
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

export function parseBaseRef(argv, env) {
  const i = argv.indexOf("--base-ref");
  if (i !== -1 && argv[i + 1]) return argv[i + 1];
  if (env.GITHUB_EVENT_NAME === "pull_request") return "origin/main";
  return null;
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
  const baseRef = parseBaseRef(process.argv.slice(2), process.env);
  const pendingKeys = baseRef ? loadPendingKeysFromDiff(baseRef) : new Map();
  const rows = evaluateFlags(entries, flagValues, pendingKeys);
  printTable(rows);

  const failures = rows.filter((r) => r.level === "FAIL");
  console.log("");
  const pendingCount = rows.filter((r) => r.level === "PENDING").length;
  console.log(
    `${rows.length} post(er) med flag - ${failures.length} fejl, ${pendingCount} afventer migration, ${stale.length} advarsel/advarsler.`,
  );
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
