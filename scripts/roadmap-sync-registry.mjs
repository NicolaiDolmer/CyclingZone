#!/usr/bin/env node
// scripts/roadmap-sync-registry.mjs
// ============================================================
// Opretter manglende roadmap-punkter ud fra docs/FEATURE_REGISTRY.yml (#6693).
//
// En registerpost med flag + roadmap_en + roadmap_da faar et roadmap_items-
// punkt (status planned, flag_key = flaget), sidst i planens raekkefoelge.
// Idempotent paa flag_key: findes der allerede et punkt med samme flag_key -
// uanset status, ogsaa archived - roeres intet. Teksten paa et eksisterende
// punkt opdateres heller ikke; det er adminens felt efter oprettelsen.
//
// EJER-GATE: punktet oprettes SKJULT (approved = false, publish_on_beta = true).
// Triggeren roadmap_items_sync_publish (database/2026-10-15-6693-roadmap-sync-
// owner-gate.sql) goer det synligt, naar kontakten staar paa beta eller on -
// ved oprettelsen eller ved flippet. Flag-flips er ejer-only, saa ejeren ser
// teksten ved flip-go. Scriptet saetter aldrig selv approved = true.
//
// Den eksisterende BEFORE INSERT-trigger roadmap_items_sync_flag (database/
// 2026-10-05-5387-roadmap-hub.sql) laeser flagets stadie ved oprettelsen:
// er flaget allerede beta, bliver punktet in_progress med beta_since; on ->
// shipped. Derefter flytter triggeren paa app_config punktet ved hvert flip.
//
// Poster med state live eller retired springes over: kun foer-live-stadier faar et nyt punkt.
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
import { isPlayerFacingFlag } from "./feature-registry-roadmap-check.mjs";

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

/** Afstand mellem punkter i planen; samme som admin-fanens nextSortOrder (frontend/src/lib/roadmapAdminModel.ts). */
export const SORT_STEP = 10;

/** Raekken der indsaettes for en registerpost med roadmap-tekst. Altid skjult: se EJER-GATE i toppen. */
export function itemFromEntry(e, sortOrder = SORT_STEP) {
  const engine = AREA_ENGINE[e.area];
  if (!engine) throw new Error(`${e.id}: intet engine for area "${e.area}"`);
  return {
    engine,
    sort_order: sortOrder,
    title_en: e.roadmap_en,
    title_da: e.roadmap_da,
    approved: false,
    publish_on_beta: true,
    status: "planned",
    horizon: e.roadmap_horizon || "next",
    issue_ref: e.epic ? Number(e.epic) : null,
    flag_key: e.flag,
  };
}

/**
 * Ren planlaegger: ingen I/O. Nye punkter laegges sidst i planen (efter den
 * hoejeste eksisterende sort_order), i registrets raekkefoelge.
 * @param {{ entries: Array<Record<string,string>>, existingFlagKeys: Iterable<string>, maxSortOrder?: number }} args
 * @returns {{ inserts: object[], skipped: Array<{ id: string, reason: string }> }}
 */
export function planSync({ entries, existingFlagKeys, maxSortOrder = 0 }) {
  const taken = new Set(existingFlagKeys);
  const inserts = [];
  const skipped = [];
  let nextSort = (Number.isFinite(maxSortOrder) ? maxSortOrder : 0) + SORT_STEP;
  for (const e of entries) {
    if (!e.roadmap_en || !e.roadmap_da) continue;
    if (!e.flag) {
      skipped.push({ id: e.id, reason: "roadmap-tekst uden flag (sync er noeglet paa flag_key)" });
      continue;
    }
    // Samme positive regel som CI-gaten (Codex #6694): kun spillervendte flag
    // paa vej ud (building/dormant/beta, ikke area ops). spec/idea/live/retired
    // og intern drift oprettes aldrig, saa de ikke kan publiceres ved et flip.
    if (!isPlayerFacingFlag(e)) {
      skipped.push({ id: e.id, reason: `ikke spillervendt pre-live (state ${e.state}, area ${e.area})` });
      continue;
    }
    if (taken.has(e.flag)) continue;
    taken.add(e.flag);
    inserts.push({ id: e.id, row: itemFromEntry(e, nextSort) });
    nextSort += SORT_STEP;
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

  // Lille tabel (et par hundrede raekker): alt hentes, saa planen kender baade
  // optagne flag_key og den hoejeste sort_order.
  const existing = await db.from("roadmap_items").select("flag_key, sort_order");
  if (existing.error) throw new Error(`roadmap_items: ${existing.error.message}`);
  const plan = planSync({
    entries,
    existingFlagKeys: existing.data.map((r) => r.flag_key).filter(Boolean),
    maxSortOrder: existing.data.reduce((m, r) => Math.max(m, Number(r.sort_order) || 0), 0),
  });
  console.log(formatPlan(plan, args));

  if (!args.apply || plan.inserts.length === 0) return;
  const { data, error } = await db
    .from("roadmap_items")
    .insert(plan.inserts.map((p) => p.row))
    .select("flag_key, status, approved");
  if (error) {
    const hint = /publish_on_beta/.test(error.message)
      ? " (migrationen database/2026-10-15-6693-roadmap-sync-owner-gate.sql er ikke applied endnu; koer workflowet igen efter auto-migrate)"
      : "";
    throw new Error(`insert roadmap_items: ${error.message}${hint}`);
  }
  for (const r of data) {
    console.log(`  oprettet: ${r.flag_key} -> ${r.status}, ${r.approved ? "synlig (flaget er beta/on)" : "skjult til flaget gaar i beta"}`);
  }
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main().catch((err) => {
    console.error(`roadmap-sync-registry fejlede: ${err.message}`);
    process.exit(1);
  });
}
