// #5443 · Dagens smalle oplåsning af `riders.valuation_type` — KUN OPAD.
//
// Hvad den gør: for en fast, ejer-godkendt liste af ryttere på menneskehold
// sættes `valuation_type = primary_type`, og værdien genberegnes med den LIVE
// formel — præcis samme sti som søndagskørslen (`recomputeRiderValue` fra
// riderValueRefresh.js). Ingen kodeændring i værdi-stien, ingen ny model.
//
// Hvorfor kun opad: frysningen fra 4/8 gør en gruppe ryttere for BILLIGE, fordi
// de værdisættes som en type de ikke er. Det er en fejl der kan rettes i dag
// uden at nogen taber noget. Faldene hører til den samlede permanente model.
//
// Udvælgelsen er gen-valideret mod prod PÅ KØRSELSTIDSPUNKTET (ren logik +
// tests i backend/lib/unfreezeSelection5443.js): stadig aktiv, stadig på
// menneskehold, stadig et mismatch, værdien stiger stadig, og den nye værdi
// overskyder ikke mål-modellen med mere end 10 %. Ryttere der ikke længere
// opfylder kravene springes over og listes med årsag — nogle har trænet siden
// morgenens søndagskørsel, så tallene kan have flyttet sig.
//
// Den rører KUN rytterne på listen. Resten af bestanden venter til næste søndag.
//
// TØRKØRSEL ER DEFAULT og 100 % read-only:
//   infisical run --env=prod --silent -- node scripts/dev/unfreezeValuationTypeToday5443.mjs
//
// APPLY kræver BÅDE flag OG env-var (samme to-bekræftelses-mønster som
// valueRefreshOnce4000.mjs):
//   CONFIRM_UNFREEZE_5443=yes infisical run --env=prod --silent -- \
//     node scripts/dev/unfreezeValuationTypeToday5443.mjs --apply
//
// ROLLBACK lægger backup-tallene tilbage (kræver samme to bekræftelser):
//   CONFIRM_UNFREEZE_5443=yes infisical run --env=prod --silent -- \
//     node scripts/dev/unfreezeValuationTypeToday5443.mjs --rollback
//
// Idempotent: en ny apply-kørsel finder 0 tilbage at rette.

import "dotenv/config";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

import { fetchAllRows } from "../../lib/supabasePagination.js";
import { selectInChunks } from "../../lib/dbChunk.js";
import { ABILITY_KEYS } from "../../lib/riderTypes.js";
import { ABILITY_KEYS as RACE_ABILITY_KEYS } from "../../lib/raceSimulator.js";
import { ageForSeason } from "../../lib/riderSeasonAge.js";
import { applyTypeDampening, TYPE_DAMPENING_ENABLED } from "../../lib/riderValuationTypeDampening.js";
import { recomputeRiderValue } from "../../lib/riderValueRefresh.js";
import { selectCandidates, summarizeSelection, SELECTION_DEFAULTS } from "../../lib/unfreezeSelection5443.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LIB = join(__dirname, "../../lib");
const BACKEND = join(__dirname, "../..");

const arg = (n, d) => { const h = process.argv.find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(`--${n}=`.length) : d; };
const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const CONFIRMED = process.env.CONFIRM_UNFREEZE_5443 === "yes";
const IDS_PATH = resolve(arg("ids", "C:/Dev/CyclingZone/balance-internals/2026-09-20-5443-v4-refit/idag-ids.json"));
const TARGET_MODEL_PATH = resolve(join(BACKEND, String(arg("target-model", "lib/riderValuationModelV4.candidate-5443-V5a.json"))));
const OUT_DIR = resolve(arg("out", "C:/Dev/CyclingZone/balance-internals/2026-09-20-5443-v4-refit/idag"));
const BACKUP_TABLE = String(arg("backup-table", "backup_5443_valuation_type_20260920"));

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ SUPABASE_URL / SUPABASE_SERVICE_KEY mangler. Kør via infisical run --env=prod --silent -- ...");
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const projectRef = (SUPABASE_URL.match(/https:\/\/([a-z0-9]+)\.supabase\./) || [])[1] || "ukendt";

const fmt = (n) => (n == null || !Number.isFinite(Number(n)) ? "—" : Math.round(Number(n)).toLocaleString("da-DK"));
const pct = (x) => (x == null || !Number.isFinite(x) ? "—" : `${x >= 0 ? "+" : ""}${x.toFixed(1)} %`);
const csvCell = (v) => {
  const s = String(v ?? "");
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

async function load() {
  const ids = JSON.parse(readFileSync(IDS_PATH, "utf8"));
  if (!Array.isArray(ids) || !ids.length) throw new Error(`${IDS_PATH}: forventede et ikke-tomt array af rytter-id'er`);

  const baseline = JSON.parse(readFileSync(join(LIB, "riderTypesBaseline.json"), "utf8"));
  const youthBaseline = JSON.parse(readFileSync(join(LIB, "riderTypesBaselineYouth.json"), "utf8"));
  // Den LIVE model — dagens rettelse bruger præcis den formel der kører nu.
  const liveModel = applyTypeDampening(JSON.parse(readFileSync(join(LIB, "riderValuationModelV4.json"), "utf8")));
  // Mål-modellen bruges KUN som loft i udvælgelsen; den skriver ingenting.
  let targetModel = null;
  try {
    targetModel = applyTypeDampening(JSON.parse(readFileSync(TARGET_MODEL_PATH, "utf8")));
  } catch {
    console.warn(`⚠ Mål-modellen ${TARGET_MODEL_PATH} kunne ikke læses — loft-testen springes over.`);
  }

  const { data: season, error: sErr } = await sb.from("seasons").select("number").eq("status", "active").maybeSingle();
  if (sErr) throw new Error(`seasons: ${sErr.message}`);
  let seasonNumber = season?.number ?? null;
  if (!seasonNumber) {
    const { data: last } = await sb.from("seasons").select("number").eq("status", "completed")
      .order("number", { ascending: false }).limit(1).maybeSingle();
    seasonNumber = last?.number ?? 1;
  }

  const { data: ridersRaw, error: rErr } = await selectInChunks({
    supabase: sb, table: "riders",
    columns: "id, firstname, lastname, team_id, is_retired, is_academy, primary_type, secondary_type, valuation_type, base_value, current_production_value, birthdate, potentiale, archetype_draw",
    inColumn: "id", ids,
  });
  if (rErr) throw new Error(`riders: ${rErr.message}`);
  const riderById = new Map((ridersRaw || []).map((r) => [r.id, r]));
  for (const r of riderById.values()) r.age = ageForSeason(r.birthdate, seasonNumber);

  const teams = await fetchAllRows(() => sb.from("teams").select("id, name, is_ai, is_bank, is_test_account, is_frozen").order("id"));
  const teamById = new Map(teams.map((t) => [t.id, t]));

  const { data: abRaw, error: aErr } = await selectInChunks({
    supabase: sb, table: "rider_derived_abilities",
    // Race-motorens 15 noegler, ikke kun vaerdimodellens 13: MAAL-modellen
    // (V5a) bruger visnings-opskriften, som ogsaa taeller `positioning` og
    // `tactics`. Uden dem i raekken ville de vaegte tavst falde ud, maal-vaerdien
    // blive for lav, og ryttere blive afvist for "overskydning" de ikke laver.
    columns: `rider_id, ability_caps, ${[...new Set([...ABILITY_KEYS, ...RACE_ABILITY_KEYS])].join(", ")}`, inColumn: "rider_id", ids,
  });
  if (aErr) throw new Error(`rider_derived_abilities: ${aErr.message}`);
  const abById = new Map((abRaw || []).map((a) => [a.rider_id, a]));

  return { ids, baseline, youthBaseline, liveModel, targetModel, riderById, teamById, abById, seasonNumber };
}

function buildCandidates(ctx) {
  const isHuman = (id) => {
    const t = id ? ctx.teamById.get(id) : null;
    return Boolean(t && t.is_ai === false && t.is_bank !== true && t.is_test_account !== true && t.is_frozen !== true);
  };
  const out = [];
  for (const id of ctx.ids) {
    const r = ctx.riderById.get(id);
    if (!r) { out.push({ id, found: false }); continue; }
    const ab = ctx.abById.get(id);
    const team = r.team_id ? ctx.teamById.get(r.team_id) : null;
    const base = {
      id,
      name: `${r.firstname} ${r.lastname}`.trim(),
      teamId: r.team_id,
      team: team?.name ?? (r.team_id ? `ukendt hold` : "fri rytter"),
      found: true,
      active: r.is_retired !== true,
      humanTeam: isHuman(r.team_id),
      hasAbilities: Boolean(ab),
      valuationType: r.valuation_type,
      primaryType: r.primary_type,
      age: r.age,
      storedValue: r.base_value == null ? null : Number(r.base_value),
      storedCpv: r.current_production_value == null ? null : Number(r.current_production_value),
    };
    if (!ab) { out.push(base); continue; }
    const opts = { typeAbilities: ab.ability_caps, youthBaseline: ctx.youthBaseline };
    const frozen = recomputeRiderValue(r, ab, ctx.baseline, ctx.liveModel, opts);
    const unfrozen = recomputeRiderValue({ ...r, valuation_type: r.primary_type }, ab, ctx.baseline, ctx.liveModel, opts);
    const target = ctx.targetModel
      ? recomputeRiderValue({ ...r, valuation_type: r.primary_type }, ab, ctx.baseline, ctx.targetModel, opts)
      : null;
    out.push({
      ...base,
      frozenValue: frozen?.base_value ?? null,
      unfrozenValue: unfrozen?.base_value ?? null,
      unfrozenCpv: unfrozen?.current_production_value ?? null,
      newPrimaryType: unfrozen?.primary_type ?? r.primary_type,
      newSecondaryType: unfrozen?.secondary_type ?? r.secondary_type,
      targetValue: target?.base_value ?? null,
    });
  }
  return out;
}

// ── Bivirkninger: hvad læser market_value for netop disse ryttere? ───────────
async function sideEffects(ids) {
  const out = {};
  const { data: auctions } = await selectInChunks({
    supabase: sb, table: "auctions",
    columns: "id, rider_id, status, starting_price, current_price, seller_team_id",
    inColumn: "rider_id", ids,
  });
  const open = (auctions || []).filter((a) => !["completed", "cancelled"].includes(String(a.status)));
  out.aabne_auktioner = open.length;
  out.auktions_detaljer = open.slice(0, 20);

  const { data: offers } = await selectInChunks({
    supabase: sb, table: "transfer_offers",
    columns: "id, rider_id, status, offer_amount, seller_team_id, buyer_team_id",
    inColumn: "rider_id", ids,
  });
  out.aabne_tilbud = (offers || []).filter((o) => !["accepted", "rejected", "withdrawn", "expired"].includes(String(o.status))).length;

  return out;
}

// ── Apply ────────────────────────────────────────────────────────────────────
async function ensureBackupTable() {
  // Backup-tabellen oprettes via SQL. Scriptet kan ikke køre DDL gennem
  // PostgREST, så vi VERIFICERER at den findes og fejler højlydt hvis ikke —
  // DDL'en er ejer-/orkestrator-kørt, jf. migrations-reglen.
  const { error } = await sb.from(BACKUP_TABLE).select("rider_id", { head: true, count: "exact" }).limit(1);
  if (error) {
    throw new Error(
      `Backup-tabellen '${BACKUP_TABLE}' findes ikke (eller kan ikke læses): ${error.message}\n` +
      `Kør FØRST denne SQL (ejer/orkestrator):\n\n${backupDdl()}\n`
    );
  }
}

function backupDdl() {
  return `create table if not exists public.${BACKUP_TABLE} (
  rider_id uuid primary key,
  valuation_type text,
  base_value integer,
  current_production_value integer,
  market_value integer,
  taget_at timestamptz not null default now()
);
alter table public.${BACKUP_TABLE} enable row level security;
-- Ingen policies: kun service_role kan læse/skrive (samme mønster som de
-- øvrige backup_*-tabeller).`;
}

async function applyChanges(selected) {
  await ensureBackupTable();

  // (1) Backup FØRST — kun de ryttere der faktisk røres, og kun hvis de ikke
  // allerede ligger der (idempotens: en gentagen kørsel må ikke overskrive
  // backup'en med de NYE tal).
  const { data: existing } = await selectInChunks({
    supabase: sb, table: BACKUP_TABLE, columns: "rider_id", inColumn: "rider_id",
    ids: selected.map((x) => x.id),
  });
  const already = new Set((existing || []).map((x) => x.rider_id));
  const toBackup = selected.filter((x) => !already.has(x.id)).map((x) => ({
    rider_id: x.id,
    valuation_type: x.valuationType,
    base_value: x.storedValue,
    current_production_value: x.storedCpv,
    market_value: x.storedValue,
  }));
  for (let i = 0; i < toBackup.length; i += 100) {
    const { error } = await sb.from(BACKUP_TABLE).insert(toBackup.slice(i, i + 100));
    if (error) throw new Error(`backup insert: ${error.message}`);
  }
  console.log(`  backup: ${toBackup.length} nye rækker (${already.size} lå der i forvejen)`);

  // (2)+(3) valuation_type OG de genberegnede værdier i ÉN update pr. rytter,
  // så en afbrudt kørsel aldrig efterlader en rytter med ny type og gammel værdi.
  let written = 0;
  for (let i = 0; i < selected.length; i += 25) {
    const batch = selected.slice(i, i + 25);
    await Promise.all(batch.map((x) => sb.from("riders").update({
      valuation_type: x.primaryType,
      base_value: x.unfrozenValue,
      current_production_value: x.unfrozenCpv,
    }).eq("id", x.id).then(({ error }) => {
      if (error) throw new Error(`riders update ${x.id}: ${error.message}`);
    })));
    written += batch.length;
  }
  console.log(`  skrevet: ${written} ryttere`);
  return written;
}

async function rollback() {
  const rows = await fetchAllRows(() => sb.from(BACKUP_TABLE)
    .select("rider_id, valuation_type, base_value, current_production_value").order("rider_id"));
  if (!rows.length) { console.log("Backup-tabellen er tom — intet at rulle tilbage."); return 0; }
  let n = 0;
  for (let i = 0; i < rows.length; i += 25) {
    const batch = rows.slice(i, i + 25);
    await Promise.all(batch.map((b) => sb.from("riders").update({
      valuation_type: b.valuation_type,
      base_value: b.base_value,
      current_production_value: b.current_production_value,
    }).eq("id", b.rider_id).then(({ error }) => {
      if (error) throw new Error(`rollback ${b.rider_id}: ${error.message}`);
    })));
    n += batch.length;
  }
  console.log(`✅ Rullet ${n} ryttere tilbage fra ${BACKUP_TABLE}.`);
  return n;
}

async function main() {
  console.log("=== #5443 · dagens oplåsning af valuation_type (KUN OPAD) ===");
  console.log(`Database: ${projectRef} · tilstand: ${ROLLBACK ? "ROLLBACK" : APPLY ? "APPLY" : "TØRKØRSEL (read-only)"}`);
  if ((APPLY || ROLLBACK) && !CONFIRMED) {
    console.error("❌ --apply/--rollback kræver OGSÅ env CONFIRM_UNFREEZE_5443=yes. Intet er skrevet.");
    process.exit(2);
  }
  if (ROLLBACK) { await rollback(); return; }

  const ctx = await load();
  console.log(`Liste: ${ctx.ids.length} id'er · sæson-anker ${ctx.seasonNumber} · TYPE_DAMPENING_ENABLED=${TYPE_DAMPENING_ENABLED}`);
  console.log(`Mål-model (kun loft): ${ctx.targetModel ? TARGET_MODEL_PATH : "ingen"}`);

  const candidates = buildCandidates(ctx);
  const { selected, skipped, byReason } = selectCandidates(candidates, SELECTION_DEFAULTS);
  const sum = summarizeSelection(selected);
  selected.sort((a, b) => (b.unfrozenValue - b.storedValue) - (a.unfrozenValue - a.storedValue));

  console.log(`\nUDVALGT: ${sum.riders} ryttere på ${sum.teams} hold`);
  console.log(`Σ ${fmt(sum.sum_before)} → ${fmt(sum.sum_after)} CZ$ (${fmt(sum.sum_diff)}, ${pct(sum.sum_pct)})`);
  console.log(`Sprunget over: ${skipped.length}${skipped.length ? ` — ${Object.entries(byReason).map(([k, v]) => `${k}: ${v}`).join(" · ")}` : ""}`);
  const ttFrozen = selected.filter((x) => x.valuationType === "tt").length;
  console.log(`Heraf frosset som tt: ${ttFrozen}`);
  console.log("\n10 største stigninger:");
  for (const x of selected.slice(0, 10)) {
    console.log(`  ${x.name} (${x.team}) ${x.valuationType} → ${x.primaryType}: ${fmt(x.storedValue)} → ${fmt(x.unfrozenValue)} (${pct(x.gainPct)})`);
  }

  console.log("\n→ bivirknings-tjek…");
  const fx = await sideEffects(selected.map((x) => x.id));
  console.log(`  åbne auktioner på de udvalgte: ${fx.aabne_auktioner} · åbne transfer-tilbud: ${fx.aabne_tilbud}`);

  mkdirSync(OUT_DIR, { recursive: true });
  const meta = {
    ran_at: new Date().toLocaleString("da-DK", { timeZone: "Europe/Copenhagen" }),
    project_ref: projectRef, mode: ROLLBACK ? "rollback" : APPLY ? "apply" : "dry-run",
    ids_path: IDS_PATH, target_model: ctx.targetModel ? TARGET_MODEL_PATH : null,
    backup_table: BACKUP_TABLE, thresholds: SELECTION_DEFAULTS, season: ctx.seasonNumber,
  };
  writeFileSync(join(OUT_DIR, "idag-toerkoersel.json"),
    JSON.stringify({ meta, summary: sum, tt_frozen: ttFrozen, by_reason: byReason, side_effects: fx, selected, skipped }, null, 2), "utf8");

  const header = ["navn", "hold", "alder", "type_foer", "type_efter", "vaerdi_foer", "vaerdi_efter", "aendring_pct", "maal_V5a", "overskydning_pct"];
  const csv = [header.join(";"), ...selected.map((x) => [
    x.name, x.team, x.age ?? "", x.valuationType ?? "", x.primaryType ?? "",
    Math.round(x.storedValue), Math.round(x.unfrozenValue), x.gainPct?.toFixed(1) ?? "",
    x.targetValue == null ? "" : Math.round(x.targetValue), x.overshootPct?.toFixed(1) ?? "",
  ].map(csvCell).join(";"))].join("\n");
  writeFileSync(join(OUT_DIR, "idag-liste.csv"), `\uFEFF${csv}\n`, "utf8");
  console.log(`\n✅ Skrevet: ${join(OUT_DIR, "idag-toerkoersel.json")}`);
  console.log(`✅ Skrevet: ${join(OUT_DIR, "idag-liste.csv")}`);

  if (!APPLY) {
    console.log("\nTØRKØRSEL — INTET er skrevet til databasen.");
    console.log("Apply kræver:\n  CONFIRM_UNFREEZE_5443=yes infisical run --env=prod --silent -- node scripts/dev/unfreezeValuationTypeToday5443.mjs --apply");
    return;
  }

  console.log("\n=== APPLY ===");
  await applyChanges(selected);

  // (4) Post-verify: en ny tørkørsel over SAMME liste skal give 0 tilbage.
  console.log("\n→ post-verify…");
  const ctx2 = await load();
  const again = selectCandidates(buildCandidates(ctx2), SELECTION_DEFAULTS);
  const sum2 = summarizeSelection(again.selected);
  const stored2 = ctx2.ids.map((id) => ctx2.riderById.get(id)).filter(Boolean)
    .filter((r) => selected.some((s) => s.id === r.id))
    .reduce((s, r) => s + (Number(r.base_value) || 0), 0);
  console.log(`  tilbage at rette: ${sum2.riders} (skal være 0)`);
  console.log(`  Σ gemt for de rørte ryttere nu: ${fmt(stored2)} (forventet ${fmt(sum.sum_after)})`);
  const okVerify = sum2.riders === 0 && Math.abs(stored2 - sum.sum_after) <= Math.max(10, sum.sum_after * 0.001);
  console.log(okVerify ? "✅ POST-VERIFY OK" : "❌ POST-VERIFY AFVIGER — undersøg før du gør mere");
  writeFileSync(join(OUT_DIR, "idag-postverify.json"),
    JSON.stringify({ ran_at: new Date().toISOString(), remaining: sum2.riders, sum_expected: sum.sum_after, sum_actual: stored2, ok: okVerify }, null, 2), "utf8");
  if (!okVerify) process.exit(1);
}

main().catch((e) => { console.error("❌", e.message); console.error(e.stack); process.exit(1); });
