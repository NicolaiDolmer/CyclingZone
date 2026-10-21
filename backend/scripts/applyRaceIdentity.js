#!/usr/bin/env node
// #6857: validate the entire seed and catalog before writing. Default = dry-run.
// node backend/scripts/applyRaceIdentity.js [--file path.json] [--apply]
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { fetchAllRows } from "../lib/supabasePagination.js";
import { RACE_IDENTITY_TYPES, validateSignature, validateAuthoredRoute } from "../lib/raceIdentityTypes.js";

const DEFAULT_FILE = fileURLToPath(new URL("../../database/seed/race_identity.json", import.meta.url));
const FIELDS = ["race_identity_type", "signature", "authored_route"];
function object(value, path, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${path}: expected an object`);
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new TypeError(`${path}.${key}: unknown field`);
}

export function parseArgs(args) {
  const result = { apply: false, file: DEFAULT_FILE };
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (seen.has(arg)) throw new Error(`Duplicate option: ${arg}`);
    seen.add(arg);
    if (arg === "--apply") result.apply = true;
    else if (arg === "--file" && args[i + 1] && !args[i + 1].startsWith("--")) result.file = args[++i];
    else throw new Error(`Unknown or incomplete option: ${arg}`);
  }
  return result;
}

function validateEntries(entries, path) {
  if (!Array.isArray(entries)) throw new TypeError(`${path}: expected an array`);
  const ids = new Set();
  entries.forEach((row, i) => {
    const at = `${path}[${i}]`;
    object(row, at, ["external_id", ...FIELDS]);
    if (typeof row.external_id !== "string" || !row.external_id.trim() || row.external_id !== row.external_id.trim()) throw new TypeError(`${at}.external_id: expected a non-empty trimmed string`);
    if (ids.has(row.external_id)) throw new Error(`${at}.external_id: duplicate ${row.external_id}`);
    ids.add(row.external_id);
    for (const field of FIELDS) if (!Object.hasOwn(row, field)) throw new TypeError(`${at}.${field}: required (use null for legacy behavior)`);
    if (row.race_identity_type !== null && !RACE_IDENTITY_TYPES.includes(row.race_identity_type)) throw new TypeError(`${at}.race_identity_type: unknown type`);
    try {
      validateSignature(row.signature);
      validateAuthoredRoute(row.authored_route);
    } catch (error) {
      throw new TypeError(`${at} (${row.external_id}): ${error.message}`, { cause: error });
    }
  });
  return entries;
}

export function validateSeed(document) {
  object(document, "seed", ["version", "schema", "examples", "entries"]);
  if (document.version !== 1) throw new Error("seed.version: expected 1");
  if (document.schema !== undefined && typeof document.schema !== "string") throw new TypeError("seed.schema: expected a descriptive string");
  if (document.examples !== undefined) validateEntries(document.examples, "seed.examples");
  return validateEntries(document.entries, "seed.entries");
}

export async function applyRaceIdentity(document, { supabase, apply = false } = {}) {
  if (typeof apply !== "boolean") throw new TypeError("apply: expected an explicit boolean");
  const entries = validateSeed(document);
  const report = { mode: apply ? "apply" : "dry-run", entries: entries.length, changes: 0, written: 0 };
  if (!entries.length) return report;
  if (!supabase) throw new Error("A Supabase client is required for non-empty entries");
  const catalog = await fetchAllRows(() => supabase.from("race_pool")
    .select("id, external_id, race_type, race_class, race_identity_type, signature, authored_route").order("id"));
  const byExternalId = new Map();
  for (const row of catalog) {
    if (byExternalId.has(row.external_id)) throw new Error(`catalog.external_id: duplicate ${row.external_id}`);
    byExternalId.set(row.external_id, row);
  }
  // Build the complete plan before the first mutation, including target eligibility.
  const changes = [];
  for (const row of entries) {
    const current = byExternalId.get(row.external_id);
    if (!current?.id) throw new Error(`Unknown external_id: ${row.external_id}`);
    if (row.race_identity_type !== null && current.race_type !== "stage_race") throw new Error(`${row.external_id}: race_identity_type requires stage_race`);
    if (row.signature !== null && current.race_type !== "stage_race") throw new Error(`${row.external_id}: signature requires stage_race`);
    if (row.authored_route !== null && (current.race_type !== "single" || current.race_class !== "Monuments")) throw new Error(`${row.external_id}: authored_route requires a single-day Monuments race`);
    const patch = Object.fromEntries(FIELDS.map(field => [field, row[field]]));
    if (FIELDS.some(field => !isDeepStrictEqual(current[field], patch[field]))) changes.push({ id: current.id, external_id: row.external_id, patch });
  }
  report.changes = changes.length;
  if (apply) {
    for (const change of changes) {
      const { data, error } = await supabase.from("race_pool").update(change.patch).eq("id", change.id).select("id");
      if (error) throw new Error(`update ${change.external_id}: ${error.message}; ${report.written} earlier updates completed`);
      if (data?.length !== 1 || data[0].id !== change.id) throw new Error(`update ${change.external_id}: expected exactly one matching row; ${report.written} earlier updates completed`);
      report.written++;
    }
  }
  return report;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const document = JSON.parse(readFileSync(resolve(args.file), "utf8"));
  const entries = validateSeed(document);
  let supabase;
  if (entries.length) {
    const { default: dotenv } = await import("dotenv");
    dotenv.config({ path: fileURLToPath(new URL("../.env", import.meta.url)), quiet: true });
    const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error("Missing SUPABASE_URL/SUPABASE_SERVICE_KEY");
    const { createClient } = await import("@supabase/supabase-js");
    supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  }
  console.log(JSON.stringify(await applyRaceIdentity(document, { supabase, apply: args.apply })));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
