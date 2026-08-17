#!/usr/bin/env node
// #3645 / #3459 — GENDANNELSE AF UDVIKLINGSLOFTER FRA ET SNAPSHOT.
//
// Dette er rollback-trin 2 for race-day-flippet. Trin 1 (`update app_config set
// value = 'off' where key = 'race_day_engine_enabled'`) stopper motoren, men
// gendanner ingenting: flaget styrer hvilken motor der kører, ikke hvad den
// allerede har skrevet. Dette script skriver `ability_caps` og `ability_progress`
// tilbage fra et snapshot taget af `snapshot3459.mjs`.
//
// Et rollback man ikke har prøvet, er ikke et rollback — derfor er dry-run default,
// og derfor er scriptet tør-kørt mod staging FØR 23/8 (drejebogens gate).
//
// SIKKERHEDS-KÆDEN (i den rækkefølge den udføres):
//   1. Dry-run er default. --apply kræver OGSÅ miljøvariablen CONFIRM_RESTORE=yes.
//      To uafhængige bekræftelser, hvoraf den ene ikke kan komme fra en shell-historik.
//   2. Miljø-port: snapshottets `supabaseProjectRef` skal matche den database
//      scriptet er koblet til. Et prod-snapshot kan ikke skrives ind i staging
//      eller omvendt uden --tillad-andet-miljo.
//   3. Planen bygges mod en FRISK læsning. Rækker der allerede matcher snapshottet
//      kommer ikke i planen — anden kørsel skriver nul rækker (idempotens).
//   4. Ryttere der er kommet til EFTER snapshottet røres ALDRIG. Der findes ingen
//      "før"-tilstand at gendanne dem til.
//   5. FØR-billede: de nuværende værdier for de berørte rækker skrives til
//      `pre-restore-<tidsstempel>.json` i snapshot-mappen, så gendannelsen selv
//      kan rulles tilbage. Ingen skrivning før den fil ligger på disken.
//   6. Batchet skrivning med {data, error}-tjek pr. række.
//   7. Post-verify: læs tilbage og bekræft at hver skrevet række matcher snapshottet.
//
// OM TALLENE. Rapporten måler i RÅ LOFT-ENHEDER (sum over evner, og snittet af de
// 8 højeste), ikke i rating. `ratingFromAbilities` skiftede enhed 14/8 (#3666), så
// et rating-delta i dag ikke kan sammenlignes med de tal drejebogen blev godkendt
// på. Delta = LEVENDE MINUS SNAPSHOT, altså det flippet har flyttet og
// gendannelsen fjerner igen. Negativ = loft tabt siden snapshottet.
//
// KØRSEL
//   dry-run (default, skriver ALDRIG):
//     cd backend && infisical run --env=prod -- node scripts/dev/restoreCaps3459.mjs --snapshot ../docs/snapshots/3459
//   skrivning (kræver BEGGE dele):
//     CONFIRM_RESTORE=yes infisical run --env=prod -- node scripts/dev/restoreCaps3459.mjs --snapshot ../docs/snapshots/3459 --apply
//
// EJER-GATE. Selve --apply er en population-mutation mod et live spiller-vendt
// system og er ejer-gated på dagen (27/6-reglen). Scriptet håndhæver bekræftelserne;
// det erstatter ikke ejerens go.
//
// Refs #3645 #3459 #3591.

import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

import { VISIBLE_ABILITIES } from "../../lib/abilityDerivation.js";
import { buildCapsRestorePlan, fmtInt, fmtSigned, jsonEqual } from "../lib/cutover3645.js";

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
};

const SNAPSHOT_DIR = value("--snapshot") || path.join(import.meta.dirname, "../../../docs/snapshots/3459");
const APPLY = flag("--apply");
const ALLOW_OTHER_ENV = flag("--tillad-andet-miljo");
const CONFIRMED = process.env.CONFIRM_RESTORE === "yes";
const WRITE_BATCH = 100;

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Mangler SUPABASE-secrets (kør via: infisical run --env=prod -- ...)");
  process.exit(1);
}
if (APPLY && !CONFIRMED) {
  console.error("STOP — --apply kræver også miljøvariablen CONFIRM_RESTORE=yes.");
  console.error("Kør dry-runnet først, vis tallene til ejeren, og sæt derefter:");
  console.error("  CONFIRM_RESTORE=yes ... node scripts/dev/restoreCaps3459.mjs --snapshot <mappe> --apply");
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const projectRef = (SUPABASE_URL.match(/https:\/\/([a-z0-9]+)\.supabase\./) || [])[1] || "ukendt";

function readJson(file) {
  const p = path.join(SNAPSHOT_DIR, file);
  if (!fs.existsSync(p)) throw new Error(`Snapshot-filen mangler: ${p}`);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

console.log("=== #3459 gendannelse af udviklingslofter fra snapshot ===");
console.log(APPLY ? "TILSTAND: APPLY (skriver til databasen)" : "TILSTAND: DRY-RUN (skriver intet)");
console.log(`Snapshot : ${path.resolve(SNAPSHOT_DIR)}`);
console.log(`Database : ${projectRef}`);

// ── Læs snapshottet + miljø-porten ──────────────────────────────────────────
const meta = readJson("meta.json");
const snapshotRows = readJson("rider_derived_abilities.json");
console.log(`Taget    : ${meta.takenAt} (projekt ${meta.supabaseProjectRef}, sæson ${meta.activeSeasonNumber}, flag '${meta.raceDayEngineEnabled}')`);

if (meta.supabaseProjectRef !== projectRef) {
  const linje = `Snapshottet er taget i '${meta.supabaseProjectRef}', men scriptet er koblet til '${projectRef}'.`;
  if (!ALLOW_OTHER_ENV) {
    console.error(`\nSTOP — ${linje}`);
    console.error("Et snapshot må ikke skrives ind i et andet miljø ved et uheld.");
    console.error("Er det med vilje (fx tør-kørsel mod staging med en staging-snapshot), så tag snapshottet i DET miljø.");
    console.error("Kun hvis krydset er bevidst: tilføj --tillad-andet-miljo.");
    process.exit(1);
  }
  console.log(`ADVARSEL: ${linje} Fortsætter fordi --tillad-andet-miljo er sat.`);
}

if (!Array.isArray(snapshotRows) || snapshotRows.length === 0) {
  console.error("STOP — snapshottet indeholder ingen rækker.");
  process.exit(1);
}
if (meta.rowCounts?.rider_derived_abilities != null && meta.rowCounts.rider_derived_abilities !== snapshotRows.length) {
  console.error(`STOP — meta.json lover ${meta.rowCounts.rider_derived_abilities} rækker, filen har ${snapshotRows.length}. Snapshottet er ufuldstændigt.`);
  process.exit(1);
}
console.log(`Snapshot verificeret læsbart: ${fmtInt(snapshotRows.length)} rækker.`);

// ── Frisk læsning ───────────────────────────────────────────────────────────
async function selectAll(table, cols, orderCol) {
  const out = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from(table).select(cols).order(orderCol, { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

const liveRows = await selectAll("rider_derived_abilities", "rider_id, ability_caps, ability_progress", "rider_id");
console.log(`Levende rækker nu           : ${fmtInt(liveRows.length)}`);

const res = buildCapsRestorePlan({ snapshotRows, liveRows, abilityKeys: VISIBLE_ABILITIES });

console.log(`\n── Plan ──`);
console.log(`Rækker der skal skrives tilbage : ${fmtInt(res.plan.length)}`);
console.log(`   heraf lofter ændret          : ${fmtInt(res.capsChanged)}`);
console.log(`   heraf progress ændret        : ${fmtInt(res.progressChanged)}`);
console.log(`Rækker der allerede matcher     : ${fmtInt(res.unchanged)}`);
console.log(`I snapshot, væk fra databasen   : ${fmtInt(res.missingInLive.length)}`);
console.log(`Kommet til EFTER snapshottet    : ${fmtInt(res.extraInLive.length)} (røres aldrig)`);

const pct = (s, navn, enhed) => {
  if (!s.n) {
    console.log(`${navn}: ingen rækker med ændret loft.`);
    return;
  }
  console.log(`${navn} (${enhed}, levende minus snapshot — negativ = tabt siden snapshottet):`);
  console.log(`   n ${fmtInt(s.n)} · min ${fmtSigned(s.min)} · p10 ${fmtSigned(s.p10)} · p50 ${fmtSigned(s.p50)} · p90 ${fmtSigned(s.p90)} · max ${fmtSigned(s.max)} · snit ${fmtSigned(s.mean)}`);
};
console.log("");
pct(res.deltaCapSum, "Loft-sum-delta", `sum over ${VISIBLE_ABILITIES.length} evner`);
pct(res.deltaTop8, "Bedste-af-8-delta", "snit af de 8 højeste lofter");
console.log("\nEnheden er RÅ LOFT, ikke rating. ratingFromAbilities skiftede enhed 14/8 (#3666)");
console.log("og kan ikke sammenlignes med tallene drejebogen blev godkendt på.");

if (res.missingInLive.length) {
  console.log(`\nFørste 10 rytter-id'er der er væk fra databasen: ${res.missingInLive.slice(0, 10).join(", ")}`);
}

if (!APPLY) {
  console.log(`\nDRY-RUN slut — intet skrevet.`);
  console.log(`Skrivning kræver BEGGE dele: CONFIRM_RESTORE=yes i miljøet OG --apply på kommandolinjen.`);
  process.exit(0);
}
if (!res.plan.length) {
  console.log("\nIntet at skrive — databasen matcher allerede snapshottet. (Idempotent no-op.)");
  process.exit(0);
}

// ── FØR-billede, så gendannelsen selv kan rulles tilbage ────────────────────
const stamp = new Date().toISOString().replaceAll(":", "").replace(/\..*/, "Z");
const preFile = path.join(SNAPSHOT_DIR, `pre-restore-${stamp}.json`);
const liveById = new Map(liveRows.map((r) => [r.rider_id, r]));
const preImage = res.plan.map((p) => {
  const l = liveById.get(p.rider_id);
  return { rider_id: p.rider_id, ability_caps: l?.ability_caps ?? null, ability_progress: l?.ability_progress ?? null };
});
fs.writeFileSync(preFile, JSON.stringify(preImage));
if (!fs.existsSync(preFile) || JSON.parse(fs.readFileSync(preFile, "utf8")).length !== res.plan.length) {
  console.error("STOP — før-billedet blev ikke skrevet fuldstændigt. Ingen skrivning uden det.");
  process.exit(1);
}
console.log(`\nFør-billede sikret: ${fmtInt(preImage.length)} rækker → ${preFile}`);
console.log(`Gendan gendannelsen med: node scripts/dev/restoreCaps3459.mjs --snapshot <mappe med denne fil omdøbt> …`);

// ── Skrivning ───────────────────────────────────────────────────────────────
let skrevet = 0;
for (let i = 0; i < res.plan.length; i += WRITE_BATCH) {
  for (const p of res.plan.slice(i, i + WRITE_BATCH)) {
    const { error } = await sb
      .from("rider_derived_abilities")
      .update({ ability_caps: p.ability_caps, ability_progress: p.ability_progress })
      .eq("rider_id", p.rider_id);
    if (error) throw new Error(`skrivning ${p.rider_id}: ${error.message}`);
    skrevet++;
  }
  console.log(`   ${fmtInt(skrevet)}/${fmtInt(res.plan.length)}`);
}

// ── Post-verify ─────────────────────────────────────────────────────────────
console.log("\nPost-verify: læser tilbage fra databasen …");
const efter = await selectAll("rider_derived_abilities", "rider_id, ability_caps, ability_progress", "rider_id");
const efterById = new Map(efter.map((e) => [e.rider_id, e]));
const afvig = res.plan.filter((p) => {
  const e = efterById.get(p.rider_id);
  return !e || !jsonEqual(e.ability_caps ?? null, p.ability_caps) || !jsonEqual(e.ability_progress ?? null, p.ability_progress);
});
if (afvig.length) {
  console.error(`POST-VERIFY FEJLEDE: ${fmtInt(afvig.length)} rækker matcher ikke snapshottet.`);
  console.error(`Før-billedet ligger i ${preFile}.`);
  process.exit(1);
}
console.log(`Post-verify OK: alle ${fmtInt(res.plan.length)} skrevne rækker matcher snapshottet.`);
console.log("Kør scriptet igen uden --apply — planen skal nu være tom (idempotens).");
