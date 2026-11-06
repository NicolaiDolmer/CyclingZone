#!/usr/bin/env node
// scripts/known-issues-sync.mjs
// ============================================================
// Known issues foelger patch noten automatisk (#7790).
//
// Naar en patch note med rollout "live" refererer et issue-nummer, saettes det
// aabne kendte fejl med samme issue_ref til fixed. Moenster fra
// roadmap-sync-registry.mjs: ren planlaegger, dry-run som default, --apply
// skriver, idempotent. Koeres efter merge til main af
// .github/workflows/known-issues-sync.yml (push paa patchNotes.js).
//
// Regler:
//   - Kun patch-noter med rollout "live" taeller. beta, beta_to_live,
//     switched_on og event goer ingen fejl fixed.
//   - En note er kun bevis for en fejl, der var aaben da noten kom: raekken
//     lukkes kun af en note dateret STRENGT efter raekkens sidste aendring
//     (updated_at). En note samme dag eller aeldre lukker den ikke.
//   - Kun aabne raekker (checking, confirmed, fixing) roeres. fixed og
//     dismissed efterlades, som de er (idempotent, ingen gen-aabning).
//   - Status-triggeren i databasen stempler closed_at; scriptet saetter kun
//     status og updated_at. Ingen migration.
//   - Flere refs paa samme note, og samme ref paa flere noter, er fint:
//     hver raekke planlaegges hoejst een gang.
//
// Brug:  infisical run -- node scripts/known-issues-sync.mjs [--apply]
// Env:   SUPABASE_URL + SUPABASE_SERVICE_KEY (print aldrig vaerdierne).
// ============================================================

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const PATCH_NOTES_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../frontend/src/data/patchNotes.js",
);

/** Status for en kendt fejl der stadig er aaben. */
export const OPEN_STATUSES = ["checking", "confirmed", "fixing"];

/** Laeser PATCHES ud af patchNotes.js uden at afhaenge af package-type. */
export async function loadPatches(path = PATCH_NOTES_PATH) {
  const source = readFileSync(path, "utf8");
  const url = `data:text/javascript;base64,${Buffer.from(source, "utf8").toString("base64")}`;
  const mod = await import(url);
  if (!Array.isArray(mod.PATCHES)) throw new Error("patchNotes.js eksporterer ikke PATCHES");
  return mod.PATCHES;
}

/** Udrulninger hvor aendringen er naaet spillerne (ikke kun beta-gruppen). */
export const RELEASED_ROLLOUTS = ["live"];

/** Ren: issue-nummer -> seneste dato (YYYY-MM-DD) en udgivet note refererer det. */
export function releasedRefs(patches) {
  const refs = new Map();
  for (const patch of patches) {
    for (const change of patch.changes ?? []) {
      if (!RELEASED_ROLLOUTS.includes(change.rollout)) continue;
      for (const ref of change.refs ?? []) {
        if (!Number.isSafeInteger(ref) || ref < 1) continue;
        const date = String(patch.date ?? "");
        if (!refs.has(ref) || date > refs.get(ref)) refs.set(ref, date);
      }
    }
  }
  return refs;
}

/** Ren: sorteret liste af udgivne issue-numre. */
export function liveRefs(patches) {
  return [...releasedRefs(patches).keys()].sort((a, b) => a - b);
}

/** Ren planlaegger: ingen I/O. Returnerer en liste af patches til known_issues. */
export function planSync({ released, issues, now }) {
  const seen = new Set();
  const plan = [];
  for (const k of issues) {
    if (k.issue_ref == null || !released.has(k.issue_ref)) continue;
    if (!OPEN_STATUSES.includes(k.status)) continue;
    // Noten skal vaere strengt nyere end raekkens sidste aendring.
    if (k.updated_at && released.get(k.issue_ref) <= String(k.updated_at).slice(0, 10)) continue;
    if (seen.has(k.id)) continue;
    seen.add(k.id);
    plan.push({
      table: "known_issues",
      id: k.id,
      issue_ref: k.issue_ref,
      title: k.title_en,
      from: k.status,
      patch: { status: "fixed", updated_at: now },
    });
  }
  return plan;
}

export function parseArgs(argv) {
  const out = { apply: false };
  for (const a of argv) {
    if (a === "--apply") out.apply = true;
    else throw new Error(`Ukendt argument: ${a}`);
  }
  return out;
}

export function formatPlan(plan) {
  if (plan.length === 0) return "Ingen aabne kendte fejl at saette til fixed.";
  return plan
    .map((p) => `known_issues ${String(p.id).slice(0, 8)}  #${p.issue_ref}  ${p.from} -> fixed  ${p.title}`)
    .join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL/SUPABASE_SERVICE_KEY er ikke sat i miljøet (kør via infisical run).");
  }

  const released = releasedRefs(await loadPatches());
  console.log(`${released.size} issue-numre i udgivne patch-noter`);

  const { createClient } = await import("@supabase/supabase-js");
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data, error } = await db
    .from("known_issues")
    .select("id, issue_ref, status, title_en, updated_at")
    .in("status", OPEN_STATUSES)
    .not("issue_ref", "is", null);
  if (error) throw new Error(`known_issues: ${error.message}`);

  const plan = planSync({ released, issues: data, now: new Date().toISOString() });
  console.log(formatPlan(plan));

  if (!args.apply) {
    console.log("\ndry-run, intet skrevet");
    return;
  }

  for (const p of plan) {
    // Optimistisk laas: kun hvis status stadig er den vi planlagde ud fra.
    const { data: changed, error: uErr } = await db
      .from(p.table)
      .update(p.patch)
      .eq("id", p.id)
      .eq("status", p.from)
      .select("id");
    if (uErr) throw new Error(`${p.table} ${p.id}: ${uErr.message}`);
    if (!changed || changed.length === 0) {
      // Ændret af andre siden planen: ikke en fejl, naeste koersel ser det rigtige billede.
      console.log(`sprunget over ${p.table} ${p.id}: status ændret siden planen blev lavet`);
      continue;
    }
    const { data: row, error: vErr } = await db.from(p.table).select("id, status").eq("id", p.id).single();
    if (vErr) throw new Error(`verify ${p.table} ${p.id}: ${vErr.message}`);
    if (row.status !== "fixed") {
      throw new Error(`verify ${p.table} ${p.id}: forventede fixed, fandt ${row.status}`);
    }
    console.log(`fixed ${p.table} ${p.id} (verificeret)`);
  }
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main().catch((err) => {
    console.error(`known-issues-sync fejlede: ${err.message}`);
    process.exit(1);
  });
}
