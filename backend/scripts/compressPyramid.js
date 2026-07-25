#!/usr/bin/env node
// #2851 · Pyramide-komprimering S1→S2 (ejer-låst model 23/7, byg-beslutning 25/7).
//
// Global rangering af alle managerhold på den afsluttede sæsons
// season_standings.total_points → rank 1-48 fylder D2 (2 puljer, snake),
// 49-144 fylder D3 (4 puljer, snake), 145+ samles i D4 pulje A/B. D1 røres
// ikke. Kører EFTER "Afslut sæson" (med season_end_skip_division_movement=on,
// så motoren ikke selv har flyttet) og FØR transitionen — se drejebogens
// skridt 3b i docs/SEASON_TRANSITION_CHECKLIST.md.
//
// Default = DRY-RUN (read-only): printer den navngivne 48/96/rest-liste
// (ejer-godkendelses-listen), økonomi-simuleringen (upkeep + sponsor-delta)
// og pulje-fyldet. --execute muterer: snapshot → teams-UPDATEs → NETTO-
// notifikationer → reconcileAiTeamsForPool pr. pulje → verifikation.
//
// Idempotent re-run: fordelingen er deterministisk (rankTeamsGlobally-tiebreak),
// så et re-run beregner samme destinationer → 0 nye UPDATEs; notifikationer
// dedup'es af notifyUser (24t-vindue på type+titel+besked+related_id).
// Rollback: snapshot-JSON + genereret restore-SQL (skrives FØR første UPDATE).
//
//   node scripts/compressPyramid.js                       # dry-run
//   node scripts/compressPyramid.js --execute             # rigtig kørsel
//   node scripts/compressPyramid.js --from=<season-uuid>  # anden kilde-sæson
//   railway run --service CyclingZone -- node scripts/compressPyramid.js

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";

import { fetchAllRows } from "../lib/supabasePagination.js";
import {
  rankTeamsGlobally,
  distributeCompression,
  summarizeMovements,
} from "../lib/pyramidCompression.js";
import { SEASON_END_SKIP_MOVEMENT_FLAG_KEY } from "../lib/seasonEndMovementFlag.js";
import { UPKEEP_BY_DIVISION } from "../lib/economyConstants.js";
import { buildSponsorStandingsContext, computeSponsorForSeason } from "../lib/sponsorEngine.js";
import { reconcileAiTeamsForPool } from "../lib/aiTeamGenerator.js";
import { notifyTeamOwner } from "../lib/notificationService.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env"), quiet: true });

const arg = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  if (hit) return hit.split("=").slice(1).join("=");
  if (process.argv.includes(`--${n}`)) return true;
  return d;
};

const FROM = arg("from", "00000000-0000-0000-0000-000000000001");
const EXECUTE = !!arg("execute", false);

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ SUPABASE_URL / SUPABASE_SERVICE_KEY mangler (kør via `railway run` eller backend/.env).");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const kr = (n) => `${(n / 1_000_000).toFixed(2)}M`;
const pad = (s, w) => String(s ?? "").padEnd(w);

console.log(`\n${"═".repeat(78)}`);
console.log(`PYRAMIDE-KOMPRIMERING (#2851) ${EXECUTE ? "🔴 EXECUTE (skriver til prod)" : "🟢 DRY-RUN (read-only)"}`);
console.log("═".repeat(78));

// ─── 1 · Load ────────────────────────────────────────────────────────────────

const { data: fromSeason, error: seasonErr } = await supabase
  .from("seasons").select("id, number, status").eq("id", FROM).maybeSingle();
if (seasonErr || !fromSeason) {
  console.error(`❌ Kunne ikke læse sæson ${FROM}: ${seasonErr?.message || "ikke fundet"}`);
  process.exit(1);
}
console.log(`Kilde-sæson: #${fromSeason.number} (status='${fromSeason.status}')`);

// Guard: komprimeringen hører til EFTER "Afslut sæson" (status='completed').
// Dry-run må gerne køre når som helst (det er sådan den foreløbige ejer-liste
// genereres lørdag); --execute kræver completed medmindre --force.
if (EXECUTE && fromSeason.status !== "completed" && !arg("force", false)) {
  console.error(`❌ --execute kræver at sæson ${fromSeason.number} er 'completed' ("Afslut sæson" først — drejebogens skridt 3). Brug --force hvis du ved hvad du gør.`);
  process.exit(1);
}

// Advarsel: hvis motor-gaten IKKE var på under season-end, har motoren allerede
// flyttet hold + sendt notifikationer. Komprimeringen overskriver fordelingen
// deterministisk alligevel, men spillere kan have set dobbelte beskeder.
const { data: flagRow } = await supabase
  .from("app_config").select("value").eq("key", SEASON_END_SKIP_MOVEMENT_FLAG_KEY).maybeSingle();
const flagOn = flagRow?.value === true || flagRow?.value === "on";
if (!flagOn) {
  console.warn(`⚠️  ${SEASON_END_SKIP_MOVEMENT_FLAG_KEY} er IKKE 'on' i app_config — hvis "Afslut sæson" allerede er kørt, har motoren selv flyttet hold først. Komprimeringen overskriver, men tjek notifikations-støj.`);
}

const allTeams = await fetchAllRows(() =>
  supabase.from("teams")
    .select("id, name, division, league_division_id, sponsor_income, is_ai, is_frozen, is_test_account, is_bank")
    .order("id"));

// Fuld menneske-manager-diskriminator (samme som motoren, #2832-review fund 4).
const managerTeams = allTeams.filter(
  (t) => !t.is_ai && !t.is_frozen && !t.is_test_account && !t.is_bank,
);

const standings = await fetchAllRows(() =>
  supabase.from("season_standings")
    .select("team_id, division, league_division_id, rank_in_division, total_points, stage_wins, gc_wins")
    .eq("season_id", FROM)
    .order("team_id"));

const { data: pools, error: poolErr } = await supabase
  .from("league_divisions").select("id, tier, pool_index, label").order("tier").order("pool_index");
if (poolErr) { console.error(`❌ league_divisions: ${poolErr.message}`); process.exit(1); }
const poolLabel = new Map(pools.map((p) => [p.id, p.label ?? `T${p.tier}#${p.pool_index}`]));

console.log(`Managerhold: ${managerTeams.length} af ${allTeams.length} hold · standings-rækker: ${standings.length} · puljer: ${pools.length}`);

// ─── 2 · Rangér + fordel ─────────────────────────────────────────────────────

const ranked = rankTeamsGlobally({ teams: managerTeams, standings });
const { assignments, byPool } = distributeCompression(ranked, pools);
const { promoted, relegated, poolMoves, unchanged } = summarizeMovements(assignments);

const missing = ranked.filter((r) => r.missingStanding);
if (missing.length) {
  console.warn(`⚠️  ${missing.length} managerhold uden standings-række (rangeret som 0 point): ${missing.map((m) => m.name).join(", ")}`);
}

console.log(`\n── NAVNGIVEN LISTE (ejer-godkendelse — rank · hold · point · fra → til) ──`);
for (const a of assignments) {
  const tag = { promoted: "⬆ OP ", relegated: "⬇ NED", "pool-move": "↔ pul", unchanged: "  =  " }[a.movement];
  console.log(`  ${String(a.rank).padStart(3)}  ${pad(a.name, 28)} ${String(a.totalPoints).padStart(6)} p  D${a.fromTier ?? "?"}/${pad(poolLabel.get(a.fromPoolId) ?? "—", 10)} → D${a.toTier}/${pad(poolLabel.get(a.toPoolId), 10)} ${tag}`);
}
console.log(`\n  Netto: ${promoted.length} op · ${relegated.length} ned · ${poolMoves.length} pulje-skift (samme division) · ${unchanged.length} uændret`);

// Cutline-kontekst (auditen 25/7: grænsen ved 48/144 afgøres af få point).
for (const line of [48, 144]) {
  const inSide = assignments.find((a) => a.rank === line);
  const outSide = assignments.find((a) => a.rank === line + 1);
  if (inSide && outSide) {
    console.log(`  Cutline ${line}: ${inSide.name} (${inSide.totalPoints} p) vs ${outSide.name} (${outSide.totalPoints} p) — margin ${inSide.totalPoints - outSide.totalPoints} p`);
  }
}

// ─── 3 · Økonomi-simulering (ejer-gate 1) ────────────────────────────────────
// Base-model uden kontrakt-låste valg: de ~73 hold der selv HAR valgt sponsor
// har låst guaranteed_base (påvirkes ikke af flytningen); de øvrige følger
// division-basen her. Upkeep rammer ALLE managerhold uanset kontrakt.

const sponsorCtx = buildSponsorStandingsContext(standings);
let upkeepBefore = 0, upkeepAfter = 0, sponsorBefore = 0, sponsorAfter = 0;
const deltas = [];
for (const a of assignments) {
  const team = managerTeams.find((t) => t.id === a.teamId);
  upkeepBefore += UPKEEP_BY_DIVISION[a.fromTier] ?? 0;
  upkeepAfter += UPKEEP_BY_DIVISION[a.toTier] ?? 0;
  const lastSeasonStanding = sponsorCtx.standingByTeamId.get(a.teamId) || null;
  const divisionStandings = lastSeasonStanding
    ? sponsorCtx.divisionStandingsByDivision.get(lastSeasonStanding.division) || []
    : [];
  const before = computeSponsorForSeason({
    seasonNumber: fromSeason.number + 1,
    team: { ...team, division: a.fromTier },
    lastSeasonStanding,
    divisionStandings,
  });
  const after = computeSponsorForSeason({
    seasonNumber: fromSeason.number + 1,
    team: { ...team, division: a.toTier },
    lastSeasonStanding,
    divisionStandings,
  });
  sponsorBefore += before.gross_sponsor;
  sponsorAfter += after.gross_sponsor;
  if (after.gross_sponsor !== before.gross_sponsor || a.toTier !== a.fromTier) {
    deltas.push({
      name: a.name, rank: a.rank, fromTier: a.fromTier, toTier: a.toTier,
      sponsorDelta: after.gross_sponsor - before.gross_sponsor,
      upkeepDelta: (UPKEEP_BY_DIVISION[a.toTier] ?? 0) - (UPKEEP_BY_DIVISION[a.fromTier] ?? 0),
    });
  }
}

console.log(`\n── ØKONOMI-SIM (S${fromSeason.number + 1}-base, uden kontrakt-låste sponsorvalg) ──`);
const tierCount = (tier, key) => assignments.filter((x) => x[key] === tier).length;
console.log(`  Divisions-fordeling (managerhold): før D1/${tierCount(1, "fromTier")} D2/${tierCount(2, "fromTier")} D3/${tierCount(3, "fromTier")} D4/${tierCount(4, "fromTier")} → efter D1/${tierCount(1, "toTier")} D2/${tierCount(2, "toTier")} D3/${tierCount(3, "toTier")} D4/${tierCount(4, "toTier")}`);
console.log(`  Divisions-upkeep i alt: ${kr(upkeepBefore)} → ${kr(upkeepAfter)}  (Δ ${kr(upkeepAfter - upkeepBefore)})`);
console.log(`  Sponsor-base i alt:     ${kr(sponsorBefore)} → ${kr(sponsorAfter)}  (Δ ${kr(sponsorAfter - sponsorBefore)})`);
console.log(`  Netto liga-økonomi Δ (sponsor-Δ minus upkeep-Δ): ${kr((sponsorAfter - sponsorBefore) - (upkeepAfter - upkeepBefore))}`);
deltas.sort((a, b) => (b.sponsorDelta - b.upkeepDelta) - (a.sponsorDelta - a.upkeepDelta));
// NB: netto-Δ her er KUN base-sponsor minus upkeep. Oprykkere står "negativt"
// fordi D2-upkeep (140k) vokser mere end base-sponsoren (+60k) — den variable
// sponsor-del, renown og de større D2-præmier er IKKE med. Det er en bevidst
// konservativ visning: ejeren skal se gulvet, ikke det optimistiske skøn.
console.log(`  Bedste netto-base-Δ (sponsor-Δ − upkeep-Δ; variabel del + præmier IKKE medregnet):`);
for (const d of deltas.slice(0, 5)) console.log(`     ${pad(d.name, 28)} D${d.fromTier}→D${d.toTier}  sponsor ${kr(d.sponsorDelta)} · upkeep ${kr(d.upkeepDelta)}`);
console.log(`  Dårligste netto-base-Δ (oprykkere: mere upkeep end base-løft — præmier/variabel del opvejer):`);
for (const d of deltas.slice(-5).reverse()) console.log(`     ${pad(d.name, 28)} D${d.fromTier}→D${d.toTier}  sponsor ${kr(d.sponsorDelta)} · upkeep ${kr(d.upkeepDelta)}`);

// ─── 4 · Pulje-fyld-prognose ─────────────────────────────────────────────────

console.log(`\n── PULJE-FYLD (managerhold efter komprimering; AI fylder op til 24 bagefter) ──`);
for (const p of pools) {
  const n = byPool.get(p.id) || 0;
  if (p.tier === 1) continue; // D1 røres ikke
  if (n > 0 || p.tier < 4) console.log(`  D${p.tier} ${pad(poolLabel.get(p.id), 12)} ${String(n).padStart(2)} ægte${n > 24 ? "  ⚠️ OVER 24" : ""}`);
}
const over = [...byPool.entries()].filter(([, n]) => n > 24);
if (over.length) {
  console.error(`❌ ${over.length} pulje(r) over 24 — fordelings-fejl, afbryder.`);
  process.exit(1);
}

if (!EXECUTE) {
  console.log(`\n🟢 Dry-run færdig — ingen writes. Kør med --execute efter ejer-godkendelse af listen.`);
  process.exit(0);
}

// ─── 5 · EXECUTE: snapshot → updates → notifikationer → reconcile → verify ──

const changes = assignments.filter((a) => a.toTier !== a.fromTier || a.toPoolId !== a.fromPoolId);
console.log(`\n🔴 EXECUTE: ${changes.length} hold skal flyttes (${assignments.length - changes.length} står rigtigt).`);

// 5a · Snapshot (FØR første write) — JSON + restore-SQL. Auditen 25/7: standings-
// genberegning læser division fra teams, så rollback SKAL være snapshot-baseret,
// ikke "kør motoren igen".
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const snapDir = join(__dirname, "snapshots");
mkdirSync(snapDir, { recursive: true });
const snapshot = allTeams.map((t) => ({ id: t.id, name: t.name, division: t.division, league_division_id: t.league_division_id }));
const snapPath = join(snapDir, `compress-pyramid-s${fromSeason.number}-${stamp}.json`);
writeFileSync(snapPath, JSON.stringify({ from_season: FROM, taken_at: stamp, teams: snapshot }, null, 2));
const restoreSql = snapshot.map((t) =>
  `update teams set division=${t.division ?? "null"}, league_division_id=${t.league_division_id ? `'${t.league_division_id}'` : "null"} where id='${t.id}';`,
).join("\n");
const restorePath = join(snapDir, `compress-pyramid-s${fromSeason.number}-${stamp}-restore.sql`);
writeFileSync(restorePath, `-- #2851 rollback: genskriv divisions-tilstand som FØR komprimeringen (${stamp})\nbegin;\n${restoreSql}\ncommit;\n`);
console.log(`  📸 Snapshot: ${snapPath}\n  📸 Restore-SQL: ${restorePath}`);

// 5b · Flyt holdene.
let updated = 0;
for (const a of changes) {
  const { error } = await supabase.from("teams")
    .update({ division: a.toTier, league_division_id: a.toPoolId })
    .eq("id", a.teamId);
  if (error) {
    console.error(`❌ UPDATE fejlede for ${a.name} (${a.teamId}): ${error.message} — STOP. Rollback: ${restorePath}`);
    process.exit(1);
  }
  updated += 1;
}
console.log(`  ✅ ${updated} hold flyttet.`);

// 5c · NETTO-notifikationer (kun tier-ændringer; pulje-skift i samme division
// støjer ikke). Genbruger motorens i18n-koder (notif.divisionPromoted/-Relegated,
// #2164) og dedup'es af notifyUser på (type, titel, besked, related_id) i 24t.
let notified = 0, notifyFailed = 0;
for (const a of [...promoted, ...relegated]) {
  const isUp = a.movement === "promoted";
  try {
    await notifyTeamOwner({
      supabase,
      teamId: a.teamId,
      type: "board_update",
      title: isUp ? "Promoted! 🎉" : "Relegation",
      message: isUp
        ? `Congratulations! Your team moves up to Division ${a.toTier}.`
        : `Your team drops to Division ${a.toTier}.`,
      relatedId: FROM,
      metadata: isUp
        ? { titleCode: "notif.divisionPromoted.title", titleParams: {}, messageCode: "notif.divisionPromoted.message", messageParams: { division: a.toTier } }
        : { titleCode: "notif.divisionRelegated.title", titleParams: {}, messageCode: "notif.divisionRelegated.message", messageParams: { division: a.toTier } },
    });
    notified += 1;
  } catch (err) {
    notifyFailed += 1;
    console.error(`  ⚠️ notifikation fejlede for ${a.name}: ${err?.message || err}`);
  }
}
console.log(`  🔔 ${notified} netto-notifikationer sendt (${notifyFailed} fejlede — fortsætter, notifikationer er additive).`);

// 5d · AI-fyld-reconcile pr. pulje (trim i D2, top-up hvor managere er landet;
// dormant-puljer uden ægte hold røres ikke — samme motor som season-end).
for (const p of pools) {
  await reconcileAiTeamsForPool({ supabase, poolId: p.id });
}
console.log(`  🤖 reconcileAiTeamsForPool kørt for ${pools.length} puljer.`);

// 5e · Verifikation mod DB (post-state).
const after = await fetchAllRows(() =>
  supabase.from("teams")
    .select("id, division, league_division_id, is_ai, is_frozen, is_test_account, is_bank")
    .order("id"));
let wrong = 0;
const afterById = new Map(after.map((t) => [t.id, t]));
for (const a of assignments) {
  const t = afterById.get(a.teamId);
  if (!t || t.division !== a.toTier || t.league_division_id !== a.toPoolId) {
    wrong += 1;
    console.error(`  ❌ ${a.name}: forventet D${a.toTier}/${a.toPoolId}, fandt D${t?.division}/${t?.league_division_id}`);
  }
}
const fillByPool = new Map();
for (const t of after) {
  if (!t.league_division_id) continue;
  fillByPool.set(t.league_division_id, (fillByPool.get(t.league_division_id) || 0) + 1);
}
console.log(`\n── VERIFIKATION ──`);
console.log(`  Placeringer korrekte: ${assignments.length - wrong}/${assignments.length}`);
for (const p of pools) {
  const total = fillByPool.get(p.id) || 0;
  const humans = byPool.get(p.id) || 0;
  const flag = humans > 0 && total !== 24 ? "  ⚠️ ikke 24" : "";
  if (total > 0) console.log(`  D${p.tier} ${pad(poolLabel.get(p.id), 12)} ${String(total).padStart(2)} hold (${humans} ægte)${flag}`);
}
if (wrong > 0) {
  console.error(`\n❌ ${wrong} fejlplaceringer — undersøg FØR transitionen. Rollback: ${restorePath}`);
  process.exit(1);
}
console.log(`\n✅ Komprimering gennemført og verificeret. Husk: sæt ${SEASON_END_SKIP_MOVEMENT_FLAG_KEY}='off' EFTER skiftet (S2→S3 kører motorens regler, #2164).`);
