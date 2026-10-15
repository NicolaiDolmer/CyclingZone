#!/usr/bin/env node
// scripts/roadmap-sync-registry.mjs
// ============================================================
// Opretter manglende roadmap-punkter ud fra docs/FEATURE_REGISTRY.yml (#6693).
//
// En registerpost med flag + roadmap_en + roadmap_da faar et roadmap_items-
// punkt (approved, status planned, flag_key = flaget). Idempotent paa
// flag_key: findes der allerede et punkt med samme flag_key - uanset status,
// ogsaa archived - roeres intet. Teksten paa et eksisterende punkt opdateres
// heller ikke; det er adminens felt efter oprettelsen.
//
// Den eksisterende BEFORE INSERT-trigger roadmap_items_sync_flag (database/
// 2026-10-05-5387-roadmap-hub.sql) laeser flagets stadie ved oprettelsen:
// er flaget allerede beta, bliver punktet in_progress med beta_since; on ->
// shipped. Derefter flytter triggeren paa app_config punktet ved hvert flip.
//
// Dry-run er default og skriver intet. --apply indsaetter.
// Koeres automatisk efter merge til main af .github/workflows/roadmap-sync.yml.
//
// Brug:  infisical run -- node scripts/roadmap-sync-registry.mjs [--apply]
// Env:   SUPABASE_URL + SUPABASE_SERVICE_KEY (print aldrig vaerdierne).
// ============================================================

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { REGISTRY_PATH, parseRegistry, validate } from "./generate-feature-status.mjs";

/**
 * Registrets area -> roadmap_items.engine (CHECK: races, training, youth,
 * market, club). Alt der ikke er en af de fire motorer, staar under "Klub & verden".
 */
export const AREA_ENGINE = {
  "race-engine": "races",
  "race-day": "races",
  stats: "races",
  training: "training",
  academy: "youth",
  market: "market",
  squad: "club",
  season: "club",
  economy: "club",
  club: "club",
  board: "club",
  social: "club",
  onboarding: "club",
  comms: "club",
  billing: "club",
  ops: "club",
};

/** Raekken der indsaettes for en registerpost med roadmap-tekst. */
export function itemFromEntry(e) {
  const engine = AREA_ENGINE[e.area];
  if (!engine) throw new Error(`${e.id}: intet engine for area "${e.area}"`);
  return {
    engine,
    sort_order: 0,
    title_en: e.roadmap_en,
    title_da: e.roadmap_da,
    approved: true,
    status: "planned",
    horizon: e.roadmap_horizon || "next",
    issue_ref: e.epic ? Number(e.epic) : null,
    flag_key: e.flag,
  };
}

/**
 * Ren planlaegger: ingen I/O.
 * @param {{ entries: Array<Record<string,string>>, existingFlagKeys: Iterable<string> }} args
 * @returns {{ inserts: object[], skipped: Array<{ id: string, reason: string }> }}
 */
export function planSync({ entries, existingFlagKeys }) {
  const taken = new Set(existingFlagKeys);
  const inserts = [];
  const skipped = [];
  for (const e of entries) {
    if (!e.roadmap_en || !e.roadmap_da) continue;
    if (!e.flag) {
      skipped.push({ id: e.id, reason: "roadmap-tekst uden flag (sync er noeglet paa flag_key)" });
      continue;
    }
    if (e.state === "retired") {
      skipped.push({ id: e.id, reason: "state retired" });
      continue;
    }
    if (taken.has(e.flag)) continue;
    taken.add(e.flag);
    inserts.push({ id: e.id, row: itemFromEntry(e) });
  }
  return { inserts, skipped };
}

export function formatPlan({ inserts, skipped }, { apply }) {
  const lines = [];
  const verb = apply ? "Opretter" : "Ville oprette (dry-run)";
  lines.push(`${verb} ${inserts.length} roadmap-punkt(er):`);
  lines.push(
    ...(inserts.length
      ? inserts.map((p) => `  ${p.row.flag_key}  [${p.row.engine}/${p.row.horizon}]  ${p.row.title_en}  (${p.id})`)
      : ["  ingen"]),
  );
  if (skipped.length) {
    lines.push(`Sprunget over (${skipped.length}):`);
    lines.push(...skipped.map((s) => `  ${s.id}: ${s.reason}`));
  }
  if (!apply && inserts.length) lines.push("Koer med --apply for at oprette dem.");
  return lines.join("\n");
}

export function parseArgs(argv) {
  const out = { apply: false };
  for (const a of argv) {
    if (a === "--apply") out.apply = true;
    else throw new Error(`Ukendt argument: ${a}`);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const entries = parseRegistry(readFileSync(REGISTRY_PATH, "utf8"));
  const errors = validate(entries);
  if (errors.length) {
    throw new Error(`FEATURE_REGISTRY.yml er ugyldig:\n${errors.map((e) => `  - ${e}`).join("\n")}`);
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL/SUPABASE_SERVICE_KEY er ikke sat i miljøet (kør via infisical run).");
  }
  const { createClient } = await import("@supabase/supabase-js");
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const existing = await db.from("roadmap_items").select("flag_key").not("flag_key", "is", null);
  if (existing.error) throw new Error(`roadmap_items: ${existing.error.message}`);
  const plan = planSync({ entries, existingFlagKeys: existing.data.map((r) => r.flag_key) });
  console.log(formatPlan(plan, args));

  if (!args.apply || plan.inserts.length === 0) return;
  const { data, error } = await db
    .from("roadmap_items")
    .insert(plan.inserts.map((p) => p.row))
    .select("flag_key, status");
  if (error) throw new Error(`insert roadmap_items: ${error.message}`);
  for (const r of data) console.log(`  oprettet: ${r.flag_key} -> ${r.status}`);
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main().catch((err) => {
    console.error(`roadmap-sync-registry fejlede: ${err.message}`);
    process.exit(1);
  });
}
