#!/usr/bin/env node
// Engangs-data-reparation (#1122 / #669): bring de eksisterende fiktive ryttere
// (pcm_id IS NULL) ind i den ægte PCM-stat-skala [50,85].
//
// Baggrund: den gamle generator clampede stats til [40,88] (uden for PCM-skalaen),
// så de fiktive fik outlier-stats der ville clampe deres evner til 1/99 ved kilden
// (abilityDerivation.js: PCM 50→spil-1, 85→spil-99). Generatoren er nu rettet til
// [50,85]; dette script reparerer de RÆKKER der allerede er skrevet med den gamle
// skala. Kun outliers flyttes (<50→50, >85→85); stats i [50,85] er urørt.
//
// Sikkerhed:
//   • Default DRY-RUN — ingen skrivning uden --apply.
//   • Rører KUN pcm_id IS NULL (egne ryttere). service_role bypasser RLS, så
//     diskriminatoren håndhæves eksplicit — både i fetch OG i hver update (.is).
//     (Samme fælde som uci_scraper 2026-06-02: bulk-job skal gentage RLS-filteret.)
//   • Kun stat_*-kolonner ændres; ingen generated/identitets-felter røres.
//   • Idempotent: en anden kørsel efter clamp ændrer intet.
//   • Backup af før-værdier skrives FØR skrivning (kirurgisk reversibilitet).

import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAllRows } from "../lib/supabasePagination.js";
import { STAT_KEYS } from "../lib/fictionalRiderGenerator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env"), quiet: true });

const FLOOR = 50;
const CEIL = 85;
const APPLY = process.argv.includes("--apply");

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const clamp = (n) => Math.max(FLOOR, Math.min(CEIL, n));

async function fetchFictional() {
  return fetchAllRows(() => supabase
    .from("riders")
    .select(["id", "firstname", "lastname", "pcm_id", ...STAT_KEYS].join(", "))
    .is("pcm_id", null)
    .order("id", { ascending: true }));
}

function globalRange(rows) {
  let min = Infinity;
  let max = -Infinity;
  for (const r of rows) {
    for (const k of STAT_KEYS) {
      const v = Number(r[k]);
      if (!Number.isFinite(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  return { min, max };
}

async function main() {
  console.log(`=== Clamp fiktive stats → [${FLOOR},${CEIL}] ${APPLY ? "[APPLY]" : "[DRY-RUN]"} ===\n`);

  const riders = await fetchFictional();
  console.log(`🔎 ${riders.length} fiktive ryttere (pcm_id IS NULL)`);
  const before = globalRange(riders);
  console.log(`   Før: global min=${before.min} max=${before.max}\n`);

  // Beregn ændringer (kun rækker med mindst én outlier).
  const changes = [];
  for (const r of riders) {
    const patch = {};
    const diff = [];
    for (const k of STAT_KEYS) {
      const old = Number(r[k]);
      const next = clamp(old);
      if (next !== old) { patch[k] = next; diff.push(`${k} ${old}→${next}`); }
    }
    if (diff.length) changes.push({ id: r.id, name: `${r.firstname} ${r.lastname}`, patch, diff, before: r });
  }

  if (!changes.length) {
    console.log("✅ Ingen outliers — alle fiktive er allerede i [50,85]. Intet at gøre.");
    return;
  }

  console.log(`📝 ${changes.length} ryttere har outliers (${changes.reduce((s, c) => s + c.diff.length, 0)} stat-værdier):`);
  for (const c of changes) console.log(`   ${c.name.padEnd(26)} ${c.diff.join("  ")}`);

  // Backup af FØR-tilstanden for de berørte rækker (reversibilitet).
  const backupPath = join(__dirname, `clampFictionalRiderStats.backup.json`);
  const backup = changes.map((c) => ({
    id: c.id, name: c.name,
    before: Object.fromEntries(STAT_KEYS.map((k) => [k, c.before[k]])),
    patch: c.patch,
  }));
  writeFileSync(backupPath, JSON.stringify(backup, null, 2));
  console.log(`\n💾 Backup (før-værdier) skrevet: ${backupPath}`);

  if (!APPLY) {
    console.log("\n🔍 DRY-RUN — intet skrevet. Kør med --apply for at udføre clamp.");
    return;
  }

  console.log(`\n⬆️  Opdaterer ${changes.length} rækker (kun stat_*-kolonner, kun pcm_id IS NULL)...`);
  for (const c of changes) {
    const { error } = await supabase
      .from("riders")
      .update(c.patch)
      .eq("id", c.id)
      .is("pcm_id", null); // defense-in-depth: ram aldrig en PCM-rytter
    if (error) throw new Error(`UPDATE fejlede for ${c.name} (${c.id}): ${error.message}`);
    console.log(`   ✅ ${c.name}`);
  }

  // Verifikation: hent igen og bekræft [50,85].
  const after = globalRange(await fetchFictional());
  console.log(`\n✅ Færdig. Efter: global min=${after.min} max=${after.max}`);
  const ok = after.min >= FLOOR && after.max <= CEIL;
  console.log(ok
    ? `✅ VERIFICERET: alle fiktive stats i [${FLOOR},${CEIL}].`
    : `❌ STADIG UDEN FOR [${FLOOR},${CEIL}] — undersøg.`);
  if (!ok) process.exit(1);
}

main().catch((err) => { console.error("❌", err.message); process.exit(1); });
