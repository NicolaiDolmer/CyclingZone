#!/usr/bin/env node
// #3645 / #3514 — GENBEREGNING AF BESTYRELSENS TILLIDSTAL. DRY-RUN ER DEFAULT.
//
// HVAD. Mandat-reworket erstatter de tre parallelle `board_profiles.satisfaction`
// (1yr/3yr/5yr) med ÉT tillidstal pr. hold. Startværdien er ejer-låst 7/8:
// det vægtede snit 1yr 50 % / 3yr 30 % / 5yr 20 %
// (`docs/superpowers/specs/2026-08-07-board-mandate-rework-design.md`, punkt 7 i
// beslutningstabellen). Dette script regner det tal for hele populationen og viser
// hvad det betyder — FØR nogen skriver noget.
//
// HVORFOR DET IKKE BARE ER ET GENNEMSNIT. Målt mod prod 17/8 har 208 hold en
// 1yr-plan, 175 en 3yr og 183 en 5yr. Ikke alle hold har alle tre. Vægtene
// renormaliseres derfor over de planer der faktisk findes; ellers ville et hold
// uden 5-årsmål få trukket 20 point ud af ingenting og lande i et konsekvens-lag
// det ikke hører hjemme i. Logikken (med tests) står i
// `backend/scripts/lib/cutover3645.js`.
//
// KONSEKVENS-LAGENE ER UÆNDREDE. Spec §33: "Konsekvens-lag 1-6: uændrede tærskler,
// nu mod det ENE confidence-tal." Scriptet importerer tærsklerne fra
// `boardConsequences.js` — det har ingen egen kopi — og rapporterer hvor mange hold
// der SKIFTER lag som følge af sammenlægningen. Det er dét tal ejeren skal se: et
// hold der går fra "ingen konsekvens" til lønloft mærker cutoveren med det samme.
//
// APPLY ER SPÆRRET INDTIL MIGRATIONEN FINDES.
// Mål-kolonnen (fx `board_profiles.confidence`) er ikke bygget pr. 17/8. Scriptet
// tjekker om den findes; gør den ikke, er --apply en fejl, ikke en gætte-øvelse.
// Når migrationen er bygget, virker --apply med samme porte som de øvrige
// cutover-scripts: CONFIRM_MANDATE_RECOMPUTE=yes + --apply + en kørt backup.
//
// KØRSEL
//   dry-run (default, skriver ALDRIG):
//     cd backend && infisical run --env=prod -- node scripts/dev/mandateRecompute3645.mjs
//   skrivning (først muligt efter #3514-migrationen):
//     CONFIRM_MANDATE_RECOMPUTE=yes infisical run --env=prod -- node scripts/dev/mandateRecompute3645.mjs --apply
//
// Refs #3645 #3514 #3095.

import { createClient } from "@supabase/supabase-js";

import { CONSEQUENCE_CONSTANTS } from "../../lib/boardConsequences.js";
import {
  MANDATE_CONFIDENCE_WEIGHTS,
  backupTableName,
  consequenceTier,
  countBy,
  fmtInt,
  fmtSigned,
  mandateConfidenceFromSatisfactions,
  percentileSummary,
} from "../lib/cutover3645.js";

const BACKUP_TABLE = backupTableName("cutover", 3645, "2026-08-23");
const TARGET_COLUMN = "confidence";
const WRITE_BATCH = 100;

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const CONFIRMED = process.env.CONFIRM_MANDATE_RECOMPUTE === "yes";

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Mangler SUPABASE-secrets (kør via: infisical run --env=prod -- ...)");
  process.exit(1);
}
if (APPLY && !CONFIRMED) {
  console.error("STOP — --apply kræver også miljøvariablen CONFIRM_MANDATE_RECOMPUTE=yes.");
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const projectRef = (SUPABASE_URL.match(/https:\/\/([a-z0-9]+)\.supabase\./) || [])[1] || "ukendt";
const T = CONSEQUENCE_CONSTANTS.SATISFACTION_THRESHOLDS;

console.log("=== #3514 mandat — ét tillidstal ud af tre tilfredsheder ===");
console.log(APPLY ? `TILSTAND: APPLY (skriver board_profiles.${TARGET_COLUMN})` : "TILSTAND: DRY-RUN (skriver intet)");
console.log(`Database : ${projectRef}`);
console.log(`Vægte    : ${Object.entries(MANDATE_CONFIDENCE_WEIGHTS).map(([k, v]) => `${k} ${Math.round(v * 100)} %`).join(" · ")} (ejer-låst 7/8, renormaliseres ved manglende plan)`);
console.log(`Tærskler : lønloft <${T.SALARY_CAP} · købsspærre <${T.SIGNING_RESTRICTION} · tvangssalg <${T.FORCED_LISTING} · sponsor-exit <${T.SPONSOR_PULLOUT} · bonus >${T.BONUS_OFFER} (uændrede)`);

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

const teams = await selectAll("teams", "id, name, is_ai, is_test_account", "id");
const teamById = new Map(teams.map((t) => [t.id, t]));
const profiles = await selectAll("board_profiles", "id, team_id, plan_type, satisfaction, is_baseline, season_id", "id");

console.log(`\nbestyrelses-profiler: ${fmtInt(profiles.length)} · hold: ${fmtInt(teams.length)}`);
console.log(`pr. plan-type: ${Object.entries(countBy(profiles, (p) => p.plan_type)).map(([k, v]) => `${k} ${fmtInt(v)}`).join(" · ")}`);

// ── Saml pr. hold ───────────────────────────────────────────────────────────
const perTeam = new Map();
for (const p of profiles) {
  if (!p.team_id) continue;
  const t = perTeam.get(p.team_id) || { team_id: p.team_id, sats: {}, profileIds: {} };
  // Er der (mod forventning) flere profiler af samme type pr. hold, vinder den
  // højeste id-sortering ikke tavst — vi tæller det som en konflikt og siger det.
  if (t.sats[p.plan_type] != null) t.konflikt = true;
  t.sats[p.plan_type] = p.satisfaction;
  t.profileIds[p.plan_type] = p.id;
  perTeam.set(p.team_id, t);
}

const konflikter = [...perTeam.values()].filter((t) => t.konflikt);
if (konflikter.length) {
  console.log(`\nADVARSEL: ${fmtInt(konflikter.length)} hold har mere end én profil af samme plan-type. Sammenlægningen er tvetydig for dem.`);
}

const rows = [];
const utenGrundlag = [];
for (const t of perTeam.values()) {
  const team = teamById.get(t.team_id) || null;
  const { confidence, usedPlanTypes, weightCoverage } = mandateConfidenceFromSatisfactions(t.sats);
  if (confidence == null) { utenGrundlag.push(t.team_id); continue; }
  // Sammenligningsgrundlaget: det tal spilleren ser i dag er 1-årsplanen (den
  // aktive kontrakt). Skiftet mærkes derfor mod DEN, ikke mod et snit af de tre.
  const foer = t.sats["1yr"] ?? null;
  rows.push({
    team_id: t.team_id,
    navn: team?.name ?? "(ukendt)",
    erAi: !!team?.is_ai,
    erTest: !!team?.is_test_account,
    sats: t.sats,
    profileIds: t.profileIds,
    foer,
    confidence,
    delta: foer == null ? null : confidence - foer,
    daekning: weightCoverage,
    planer: usedPlanTypes.join("+"),
    tierFoer: consequenceTier(foer, T),
    tierEfter: consequenceTier(confidence, T),
  });
}

console.log(`\nHold med et tillidstal      : ${fmtInt(rows.length)}`);
if (utenGrundlag.length) console.log(`Hold uden nogen tilfredshed : ${fmtInt(utenGrundlag.length)} (springes over — får ikke 0)`);
console.log(`Plan-dækning: ${Object.entries(countBy(rows, (r) => r.planer)).map(([k, v]) => `${k} ${fmtInt(v)}`).join(" · ")}`);

const s = percentileSummary(rows.map((r) => r.confidence));
console.log(`\nTillidstal: min ${fmtInt(s.min)} · p10 ${fmtInt(s.p10)} · p50 ${fmtInt(s.p50)} · p90 ${fmtInt(s.p90)} · max ${fmtInt(s.max)} · snit ${fmtSigned(s.mean)}`);
const d = percentileSummary(rows.filter((r) => r.delta != null).map((r) => r.delta));
console.log(`Delta mod 1-årsplanens tal (det spilleren ser i dag):`);
console.log(`   n ${fmtInt(d.n)} · min ${fmtSigned(d.min)} · p10 ${fmtSigned(d.p10)} · p50 ${fmtSigned(d.p50)} · p90 ${fmtSigned(d.p90)} · max ${fmtSigned(d.max)}`);

// ── Det tal der betyder noget: hvem skifter konsekvens-lag ──────────────────
const skifter = rows.filter((r) => r.tierFoer !== r.tierEfter);
const vaerre = skifter.filter((r) => (r.delta ?? 0) < 0);
const bedre = skifter.filter((r) => (r.delta ?? 0) > 0);
console.log(`\nKonsekvens-lag: ${fmtInt(skifter.length)} hold skifter lag (${fmtInt(vaerre.length)} strammere, ${fmtInt(bedre.length)} lempeligere).`);
console.log(`   fordeling FØR : ${Object.entries(countBy(rows, (r) => r.tierFoer)).map(([k, v]) => `${k} ${fmtInt(v)}`).join(" · ")}`);
console.log(`   fordeling EFTER: ${Object.entries(countBy(rows, (r) => r.tierEfter)).map(([k, v]) => `${k} ${fmtInt(v)}`).join(" · ")}`);

const menneskeSkifter = skifter.filter((r) => !r.erAi && !r.erTest);
console.log(`\nMenneske-ejede hold der skifter lag: ${fmtInt(menneskeSkifter.length)}`);
for (const r of menneskeSkifter.slice(0, 25)) {
  const sats = ["1yr", "3yr", "5yr"].map((k) => `${k} ${r.sats[k] ?? "—"}`).join(" / ");
  console.log(`   ${r.navn.padEnd(26)} ${sats.padEnd(30)} → ${String(r.confidence).padStart(3)}  ${r.tierFoer} → ${r.tierEfter}`);
}

if (!APPLY) {
  console.log(`\nDRY-RUN slut — intet skrevet.`);
  console.log(`Apply kræver at #3514-migrationen har oprettet mål-kolonnen, plus CONFIRM_MANDATE_RECOMPUTE=yes + --apply + en kørt backup.`);
  process.exit(0);
}

// ── Mål-kolonne-porten ──────────────────────────────────────────────────────
// schema-columns-ok: kolonnen SKAL mangle i dag — #3514-migrationen er ikke bygget
// (17/8). Dette select ER porten: fejler den, stopper scriptet. Guarden ville
// ellers forbyde netop den kontrol der forhindrer en blindskrivning.
const { error: colErr } = await sb.from("board_profiles").select(TARGET_COLUMN).limit(1);
if (colErr) {
  console.error(`\nSTOP — kolonnen board_profiles.${TARGET_COLUMN} findes ikke: ${colErr.message}`);
  console.error("#3514-migrationen er ikke kørt. Scriptet gætter ikke på hvor tallet skal hen.");
  process.exit(1);
}

// ── Backup-porten ───────────────────────────────────────────────────────────
const backupRows = await selectAll(BACKUP_TABLE, "row_id", "row_id");
const iBackup = new Set(backupRows.map((b) => b.row_id));
const alleProfileIds = rows.flatMap((r) => Object.values(r.profileIds));
const udenBackup = alleProfileIds.filter((id) => !iBackup.has(id));
if (udenBackup.length) {
  console.error(`\nSTOP — ${fmtInt(udenBackup.length)} bestyrelses-profiler mangler i ${BACKUP_TABLE}.`);
  console.error("Kør cutoverBackup3645.mjs --apply FØRST.");
  process.exit(1);
}
console.log(`\nBackup-porten: OK — alle ${fmtInt(alleProfileIds.length)} profiler har et før-billede.`);

// ── Skrivning ───────────────────────────────────────────────────────────────
// Tillidstallet er ÉT pr. hold, men board_profiles har en række pr. plan-type.
// Indtil migrationen har foldet dem sammen, skrives det samme tal på alle holdets
// rækker — det er den eneste form der er entydig uanset hvilken række der
// overlever sammenlægningen.
let skrevet = 0;
const opgaver = rows.flatMap((r) => Object.values(r.profileIds).map((id) => ({ id, confidence: r.confidence })));
for (let i = 0; i < opgaver.length; i += WRITE_BATCH) {
  for (const o of opgaver.slice(i, i + WRITE_BATCH)) {
    const { error } = await sb.from("board_profiles").update({ [TARGET_COLUMN]: o.confidence }).eq("id", o.id);
    if (error) throw new Error(`skrivning ${o.id}: ${error.message}`);
    skrevet++;
  }
  console.log(`   ${fmtInt(skrevet)}/${fmtInt(opgaver.length)}`);
}

// ── Post-verify ─────────────────────────────────────────────────────────────
const efter = await selectAll("board_profiles", `id, ${TARGET_COLUMN}`, "id");
const efterById = new Map(efter.map((e) => [e.id, e[TARGET_COLUMN]]));
const afvig = opgaver.filter((o) => Number(efterById.get(o.id)) !== o.confidence);
if (afvig.length) {
  console.error(`POST-VERIFY FEJLEDE: ${fmtInt(afvig.length)} rækker matcher ikke planen.`);
  process.exit(1);
}
console.log(`\nPost-verify OK: alle ${fmtInt(opgaver.length)} rækker matcher planen.`);
console.log(`Rollback-SQL: database/2026-08-23-3645-cutover-backup-table.sql (afsnittet "ROLLBACK: MANDAT").`);
