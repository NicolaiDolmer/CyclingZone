#!/usr/bin/env node
// Engangs-backfill (#1478 data-hale) — akademiryttere signet FØR PR #1493.
//
// De blev oprettet før academyGenerator satte height/weight og før akademi-intake
// kørte derive-kæden, så de mangler height/weight + rider_derived_abilities +
// ryttertype + base_value. Uden afledte evner springes de over i træning-engine
// og viser rå legacy-stats (jeppek-feedback 2026-06-19).
//
// Sætter realistisk height/weight (SAMME fordeling som academyGenerator, så
// physiology-seeding ikke defaulter alle til 180/70) FØR derive. Seed er
// deterministisk pr. rytter-id → reproducerbar. Kun FIKTIVE akademiryttere
// (pcm_id IS NULL); rører IKKE ægte PCM-navne (åben ejer-beslutning).
//
//   infisical run --env=dev -- node backend/scripts/dev/backfillAcademyDeriveTail.js            # dry-run
//   infisical run --env=dev -- node backend/scripts/dev/backfillAcademyDeriveTail.js --apply

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { makeRng, gaussian } from "../../lib/fictionalRiderGenerator.js";
import { deriveForRiderIds } from "../../lib/backfillCores.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../../.env"), quiet: true });

const APPLY = process.argv.includes("--apply");
const DRY_RUN = !APPLY;

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// FNV-1a hash → 32-bit numerisk seed fra uuid-streng (makeRng forventer tal).
function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

// Samme krops-fordeling som academyGenerator.js (linje 95-97).
function bodyFor(id) {
  const rng = makeRng(hashSeed(id));
  const height = Math.round(clamp(gaussian(rng, 180, 5), 165, 196));
  const bmi = clamp(gaussian(rng, 21.5, 1.0), 18.5, 24.5);
  const weight = Math.round(bmi * (height / 100) ** 2);
  return { height, weight };
}

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function main() {
  console.log(`=== Akademi derive-hale backfill ${DRY_RUN ? "(DRY-RUN)" : "(APPLY)"} ===`);

  // 1) Fiktive akademiryttere + eksisterende afledte evner (to queries → robust).
  const { data: academy, error: aerr } = await supabase
    .from("riders")
    .select("id, firstname, lastname, height, weight")
    .eq("is_academy", true)
    .is("pcm_id", null);
  if (aerr) throw new Error(`riders: ${aerr.message}`);

  // Scope til akademi-id'erne (≤ få rækker) — undgå PostgREST's 1000-række-cap
  // på et globalt rider_derived_abilities-select, der ellers falsk-flagger ryttere.
  const academyIds = (academy || []).map((r) => r.id);
  const { data: derived, error: derr } = await supabase
    .from("rider_derived_abilities")
    .select("rider_id")
    .in("rider_id", academyIds);
  if (derr) throw new Error(`derived: ${derr.message}`);
  const haveDerived = new Set((derived || []).map((d) => d.rider_id));

  const targets = (academy || []).filter((r) => !haveDerived.has(r.id));
  console.log(`Fiktive akademiryttere: ${academy.length} · uden afledte evner: ${targets.length}`);
  if (targets.length === 0) {
    console.log("Intet at gøre.");
    return;
  }

  // 2) height/weight til dem der mangler.
  const hwUpdates = targets
    .filter((r) => r.height == null || r.weight == null)
    .map((r) => ({ id: r.id, name: `${r.firstname} ${r.lastname}`, ...bodyFor(r.id) }));
  console.log(`Mangler height/weight: ${hwUpdates.length}`);
  for (const u of hwUpdates) {
    console.log(`  ${u.name.padEnd(26)} → ${u.height}cm / ${u.weight}kg`);
  }

  if (!DRY_RUN && hwUpdates.length) {
    for (const u of hwUpdates) {
      const { error } = await supabase
        .from("riders")
        .update({ height: u.height, weight: u.weight })
        .eq("id", u.id);
      if (error) throw new Error(`h/w update ${u.id}: ${error.message}`);
    }
    console.log(`  ✅ height/weight skrevet for ${hwUpdates.length} ryttere`);
  }

  // 3) Derive-kæde (physiology → abilities → type → base_value).
  const res = await deriveForRiderIds(
    supabase,
    targets.map((r) => r.id),
    { dryRun: DRY_RUN, log: console.log }
  );
  console.log(`derive: ${JSON.stringify(res)}`);
  console.log(DRY_RUN ? "\n(DRY-RUN — intet skrevet. Kør med --apply for at anvende.)" : "\n✅ APPLY færdig.");
}

main().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
