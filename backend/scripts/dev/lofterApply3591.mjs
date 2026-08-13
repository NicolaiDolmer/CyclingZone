#!/usr/bin/env node
//
// ⚠ FROSSET 2026-08-14 (#3666). KØR IKKE UDEN AT LÆSE DETTE FØRST.
//
// Scriptet importerer `ratingFromAbilities`, og den funktion betyder ikke længere
// det samme. Før var rating et anker-normaliseret tal på 1-99; nu er den det
// vægtede snit af rollens evner. Alle rating-deltaer scriptet PRINTER er derfor i
// en anden enhed end da tallene blev læst og godkendt — medianen faldt fra 15
// til 13, og de bedste ryttere fra 99 til 85, så et delta der dengang var lille kan
// i dag se stort ud og omvendt.
//
// Selve mutationen (hvis scriptet har en) rører lofter/evner, ikke rating, og er
// dermed uændret. Det er RAPPORTEN der ikke længere kan sammenlignes med den der
// blev godkendt. Skal arbejdet gøres om, så re-kalibrer tærskler og forventede
// tal mod den nye skala FØRST.
//
// Slicen er lukket; scriptet er bevaret som historik, ikke som værktøj.
// backend/scripts/dev/lofterApply3591.mjs
// ============================================================================
// #3591 pkt. 2 — KONTROLLERET GENBEREGNING AF DE GEMTE UDVIKLINGSLOFTER.
//
// HVAD DEN GØR. Skriver `rider_derived_abilities.ability_caps` for de ryttere hvis
// gemte loft ikke matcher det loftet SKAL være, givet rytterens forankrede anlæg.
// Rører ÉN kolonne. Aldrig evner, aldrig typer, aldrig værdier, aldrig løn.
//
// HVORFOR DEN GENBEREGNER I STEDET FOR AT SKRIVE EN FORUDBEREGNET LISTE.
// Populationen driver mens vi arbejder — mellem to snapshots 11/8 og 13/8 kom 48 nye
// ryttere til med samme mangel, og 9 af de oprindeligt berørte var allerede rettet af
// den daglige træningsmotor. En forudberegnet liste ville skrive lofter regnet mod
// forældede evner, og et loft under rytterens NUVÆRENDE evne bryder gulv-garantien.
// Værktøjet tager derfor sit eget friske øjebliksbillede og bygger planen forfra.
//
// FORUDSÆTNING (verificeres, ikke antages): rytterens anlæg SKAL bære både primær og
// sekundær, og de skal matche de synlige typer. Det er hvad #3593-migrationen sikrede.
// Er den ikke kørt, stopper værktøjet — ellers ville det skrive lofter formet af et
// halvt anlæg og cementere præcis den fejl #3593 lukkede.
//
// SIKKERHEDS-KÆDEN (i den rækkefølge den udføres):
//   1. Ejer-gate i koden: dry-run er default; --apply kræver --jeg-har-set-dry-runnet.
//   2. Forudsætnings-port: hver rytter skal have et fuldt, konsistent anlæg.
//   3. Frisk læsning fra prod (kun SELECT) → plan bygges forfra.
//   4. Gulv-port: intet nyt loft må ligge under rytterens nuværende evne. Ét brud
//      stopper HELE kørslen — ingen delvis skrivning.
//   5. Backup FØR skrivning: hver berørt rytters gamle ability_caps sikres og tælles.
//   6. Batchet skrivning med {data, error}-tjek på hver batch.
//   7. Post-verify: læs tilbage fra DB og bekræft at hver skrevet række matcher planen.
//
// KØRSEL
//   dry-run (default, skriver ALDRIG):
//     infisical run --env=prod -- node scripts/dev/lofterApply3591.mjs
//   skrivning (kræver BEGGE flag):
//     infisical run --env=prod -- node scripts/dev/lofterApply3591.mjs --apply --jeg-har-set-dry-runnet
//
// Refs #3591 #3593 #3564 #3570.

import { createClient } from "@supabase/supabase-js";

import { VISIBLE_ABILITIES } from "../../lib/abilityDerivation.js";
import { buildCapsForRider } from "../../lib/riderProgression.js";
import { ratingFromAbilities } from "../../lib/scoutingReport.js";

const BACKUP_TABLE = "rider_caps_3591_backup_20260813";
const APPLY = process.argv.includes("--apply");
const BEKRAEFTET = process.argv.includes("--jeg-har-set-dry-runnet");
const WRITE_BATCH = 100;

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Mangler SUPABASE-secrets (kør via: infisical run --env=prod -- ...)");
  process.exit(1);
}
if (APPLY && !BEKRAEFTET) {
  console.error("--apply kræver også --jeg-har-set-dry-runnet. Kør dry-runnet først.");
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ── Læsning ─────────────────────────────────────────────────────────────────
async function fetchAllRange(table, cols, filterFn) {
  const out = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let q = sb.from(table).select(cols).range(from, from + PAGE - 1).order("id", { ascending: true });
    if (filterFn) q = filterFn(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}
async function readAllIn(table, cols, inCol, ids) {
  const out = [];
  const CH = 200;
  for (let i = 0; i < ids.length; i += CH) {
    const { data, error } = await sb.from(table).select(cols).in(inCol, ids.slice(i, i + CH));
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data || []));
  }
  return out;
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const capsEqual = (a, b) => VISIBLE_ABILITIES.every((k) => num(a?.[k]) === num(b?.[k]));

console.log("=== #3591 pkt. 2 — genberegning af gemte udviklingslofter ===");
console.log(APPLY ? "TILSTAND: APPLY (skriver til prod)" : "TILSTAND: DRY-RUN (skriver intet)");

const seasons = await fetchAllRange("seasons", "number, status");
const activeSeason = seasons.find((s) => s.status === "active");
if (!activeSeason) throw new Error("Ingen aktiv sæson — sæson-alder kan ikke regnes.");
const seasonNumber = activeSeason.number;
console.log(`Aktiv sæson: ${seasonNumber}`);

const riders = await fetchAllRange(
  "riders",
  "id, firstname, lastname, birthdate, potentiale, archetype_draw, primary_type, secondary_type, team_id, is_retired",
  (q) => q.or("is_retired.is.null,is_retired.eq.false"),
);
console.log(`Levende ryttere: ${riders.length}`);

const derived = await readAllIn("rider_derived_abilities", "*", "rider_id", riders.map((r) => r.id));
const derivedById = new Map(derived.map((d) => [d.rider_id, d]));

// ── Forudsætnings-port (#3593 skal være kørt) ───────────────────────────────
const halveAnlaeg = riders.filter((r) => !r.archetype_draw?.primary || !r.archetype_draw?.secondary);
const uenige = riders.filter((r) =>
  r.archetype_draw?.primary !== r.primary_type || r.archetype_draw?.secondary !== r.secondary_type);
if (halveAnlaeg.length || uenige.length) {
  console.error(`STOP — forudsætningen holder ikke: ${halveAnlaeg.length} ryttere med halvt anlæg, ${uenige.length} hvor anlæg og synlig type er uenige.`);
  console.error("Kør #3593-migrationen (database/2026-08-11-3593-anchor-secondary-archetype-draw.sql) først.");
  process.exit(1);
}
console.log(`Forudsætnings-port: OK — alle ${riders.length} har et fuldt anlæg der matcher de synlige typer.`);

// ── Plan ────────────────────────────────────────────────────────────────────
const plan = [];
const gulvBrud = [];
for (const r of riders) {
  const d = derivedById.get(r.id);
  if (!d) continue; // strandet rytter — riderDeriveHealSweep ejer den, ikke os
  const age = r.birthdate ? 2026 + (seasonNumber - 1) - new Date(r.birthdate).getUTCFullYear() : null;
  const abilities = {};
  for (const k of VISIBLE_ABILITIES) if (d[k] != null) abilities[k] = Number(d[k]);

  const nye = buildCapsForRider(abilities, { potentiale: r.potentiale, age }, r.archetype_draw.primary, r.archetype_draw.secondary);
  const gamle = d.ability_caps || {};
  if (capsEqual(gamle, nye)) continue;

  // Gulv-porten: buildCapsForRider returnerer max(tapered, current), så dette KAN
  // ikke ske. Vi tjekker alligevel — en formel-ændring må aldrig kunne konfiskere
  // evne en spiller allerede ejer, og porten skal fange det FØR skrivningen.
  for (const k of VISIBLE_ABILITIES) {
    if (abilities[k] != null && num(nye[k]) < num(abilities[k]) - 1e-9) {
      gulvBrud.push({ id: r.id, navn: `${r.firstname} ${r.lastname}`, evne: k, loft: nye[k], nu: abilities[k] });
    }
  }
  plan.push({
    id: r.id,
    navn: `${r.firstname} ${r.lastname}`,
    ejer: r.team_id ? "hold" : "fri",
    age,
    gamle,
    nye,
    sumDelta: VISIBLE_ABILITIES.reduce((a, k) => a + (num(nye[k]) - num(gamle[k])), 0),
    ratingDelta: ratingFromAbilities(nye, r.primary_type) - ratingFromAbilities(gamle, r.primary_type),
  });
}

if (gulvBrud.length) {
  console.error(`STOP — gulv-porten brød: ${gulvBrud.length} tilfælde hvor et nyt loft ligger under rytterens nuværende evne.`);
  for (const g of gulvBrud.slice(0, 10)) console.error(`   ${g.navn} · ${g.evne}: loft ${g.loft} < nuværende ${g.nu}`);
  process.exit(1);
}

const taber = plan.filter((p) => p.sumDelta < 0);
const vinder = plan.filter((p) => p.sumDelta > 0);
console.log(`\nPLAN: ${plan.length} ryttere får nyt loft (${vinder.length} vinder, ${taber.length} taber)`);
console.log(`   på hold: ${plan.filter((p) => p.ejer === "hold").length} · frie agenter: ${plan.filter((p) => p.ejer === "fri").length}`);
console.log(`   gulv-porten: 0 brud`);
const rd = plan.map((p) => p.ratingDelta).sort((a, b) => a - b);
if (rd.length) console.log(`   rating-delta: min ${rd[0]} · median ${rd[Math.floor(rd.length / 2)]} · max ${rd[rd.length - 1]}`);
for (const p of plan.filter((x) => x.ejer === "hold")) {
  console.log(`   [hold] ${p.navn} (${p.age} år): sum ${p.sumDelta > 0 ? "+" : ""}${p.sumDelta}, rating ${p.ratingDelta > 0 ? "+" : ""}${p.ratingDelta}`);
}

if (!APPLY) {
  console.log(`\nDRY-RUN slut — intet skrevet. Kør med --apply --jeg-har-set-dry-runnet for at skrive.`);
  process.exit(0);
}
if (!plan.length) {
  console.log("\nIntet at skrive.");
  process.exit(0);
}

// ── Backup FØR skrivning ────────────────────────────────────────────────────
console.log(`\nSikrer ${plan.length} rytteres nuværende lofter i ${BACKUP_TABLE} …`);
for (let i = 0; i < plan.length; i += WRITE_BATCH) {
  const batch = plan.slice(i, i + WRITE_BATCH).map((p) => ({ rider_id: p.id, ability_caps_before: p.gamle }));
  const { error } = await sb.from(BACKUP_TABLE).upsert(batch, { onConflict: "rider_id" });
  if (error) throw new Error(`backup ved ${i}: ${error.message}`);
}
const { count: backupCount, error: bcErr } = await sb.from(BACKUP_TABLE).select("rider_id", { count: "exact", head: true });
if (bcErr) throw new Error(`backup-tælling: ${bcErr.message}`);
if (backupCount < plan.length) throw new Error(`STOP — backuppen dækker kun ${backupCount} af ${plan.length} ryttere.`);
console.log(`Backup verificeret: ${backupCount} rækker.`);

// ── Skrivning ───────────────────────────────────────────────────────────────
let skrevet = 0;
for (let i = 0; i < plan.length; i += WRITE_BATCH) {
  const batch = plan.slice(i, i + WRITE_BATCH);
  for (const p of batch) {
    const { error } = await sb.from("rider_derived_abilities").update({ ability_caps: p.nye }).eq("rider_id", p.id);
    if (error) throw new Error(`skrivning ${p.id}: ${error.message}`);
    skrevet++;
  }
  console.log(`   ${skrevet}/${plan.length}`);
}

// ── Post-verify ─────────────────────────────────────────────────────────────
console.log("\nPost-verify: læser tilbage fra DB …");
const efter = await readAllIn("rider_derived_abilities", "rider_id, ability_caps", "rider_id", plan.map((p) => p.id));
const efterById = new Map(efter.map((e) => [e.rider_id, e.ability_caps]));
const afvig = plan.filter((p) => !capsEqual(efterById.get(p.id), p.nye));
if (afvig.length) {
  console.error(`POST-VERIFY FEJLEDE: ${afvig.length} rækker matcher ikke planen.`);
  process.exit(1);
}
console.log(`Post-verify OK: alle ${plan.length} rækker i DB matcher planen.`);
console.log(`Rollback: UPDATE rider_derived_abilities SET ability_caps = b.ability_caps_before FROM ${BACKUP_TABLE} b WHERE rider_id = b.rider_id;`);
