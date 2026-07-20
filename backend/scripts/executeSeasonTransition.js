#!/usr/bin/env node
// Eksplicit sæson-transition (#1155) — kører transitionToNextSeason med en
// EKSPLICIT fromSeasonId, så resume-stien kan bruges når season-end allerede har
// sat sæsonen til 'completed' (UI/endpoint leder kun efter status='active' og
// kan derfor ikke finde den længere).
//
// Default = dry-run (ingen writes). Tilføj --execute for rigtig kørsel.
//   railway run --service CyclingZone -- node backend/scripts/executeSeasonTransition.js [--from=<uuid>] [--execute]
//
// Default --from = sæson 1 (00000000-0000-0000-0000-000000000001).

import { createClient } from "@supabase/supabase-js";
import { transitionToNextSeason } from "../lib/seasonTransition.js";
import { FIRST_PROMOTION_RELEGATION_SEASON } from "../lib/economyConstants.js";

const arg = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  if (hit) return hit.split("=").slice(1).join("=");
  if (process.argv.includes(`--${n}`)) return true;
  return d;
};

const FROM = arg("from", "00000000-0000-0000-0000-000000000001");
const EXECUTE = !!arg("execute", false);

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) {
  console.error("❌ SUPABASE_URL / SUPABASE_SERVICE_KEY mangler. Kør via `railway run`.");
  process.exit(1);
}
const supabase = createClient(url, key);
const money = (n) => (n == null ? "—" : `${(Math.round(n / 1000) / 1000).toFixed(2).replace(/\.?0+$/, "")}M`);

const { data: from } = await supabase
  .from("seasons").select("id, number, status").eq("id", FROM).maybeSingle();

console.log(`\n${"═".repeat(72)}`);
console.log(`SÆSON-TRANSITION ${EXECUTE ? "🔴 EXECUTE (skriver til prod)" : "🟢 DRY-RUN (read-only)"}`);
console.log(`${"═".repeat(72)}`);
console.log(`Fra sæson: #${from?.number} (id ${FROM}, status='${from?.status}')`);

// #2361: dette script er BEVIDST ugatet (omgår seasonTransitionReadiness.js) —
// se resume-formålet i filens topkommentar. Uden season-end (processSeasonEnd,
// "Afslut sæson") springes board-eval + payDivisionBonuses + processDivisionEnd
// (op/nedrykning) irreversibelt over, fordi season-end bagefter afviser en
// allerede completed sæson. Gør konsekvensen synlig for operatøren FØR --execute.
const seasonEndRequired = (from?.number ?? 0) >= FIRST_PROMOTION_RELEGATION_SEASON;
const seasonEndVerified = !seasonEndRequired || from?.status === "completed";
console.warn(
  `⚠️  Season-end verificeret: ${seasonEndVerified ? "JA" : "NEJ"}` +
    (seasonEndVerified
      ? ""
      : ` — sæson ${from?.number} har status='${from?.status}', ikke 'completed'. ` +
        `Kør 'Afslut sæson' (POST /admin/seasons/:id/end) FØRST, ellers springes ` +
        `op/nedrykning + divisionsbonusser IRREVERSIBELT over. Dette script omgår ` +
        `readiness-gaten og stopper ikke automatisk.`),
);
if (EXECUTE && !seasonEndVerified) {
  console.warn(`⚠️  --execute kører ALLIGEVEL (scriptet er ugatet) — Ctrl+C nu hvis dette er en fejl.`);
}

const result = await transitionToNextSeason({
  supabase,
  fromSeasonId: FROM,
  dryRun: !EXECUTE,
  adminUserId: null,
});

const plan = result.plan;
console.log(`\n── PLAN ──────────────────────────────────────────────────────────`);
console.log(`  ${plan.from_season.number} → ${plan.to_season.number}   ·   hold påvirket: ${plan.teams_affected}`);
console.log(`  Allerede transitioneret? ${plan.already_transitioned ? "ja (resume — idempotent)" : "nej"}`);
console.log(`  Sponsor base total: ${money(plan.sponsor_base_total)} pts`);
const rows = [...plan.sponsor_breakdown].sort((a, b) => b.sponsor_base - a.sponsor_base).slice(0, 5);
for (const r of rows) console.log(`     ${String(r.team_name).padEnd(26)} div ${r.division}  ${money(r.sponsor_base).padStart(7)}  ${r.sponsor_mode}`);

if (EXECUTE && result.log) {
  console.log(`\n── FASE-LOG (rigtig kørsel) ───────────────────────────────────────`);
  for (const e of result.log) {
    const mark = e.skipped ? "⏭️ " : (e.inserted || e.updated) ? "✅" : "•";
    console.log(`  ${mark} ${e.phase}${e.skipped ? ` — ${e.reason}` : ""}${e.count !== undefined ? ` (${e.count})` : ""}`);
  }
}

console.log(`\n${"═".repeat(72)}`);
console.log(EXECUTE ? "Transition UDFØRT." : "Dry-run færdig — ingen writes. Tilføj --execute for rigtig kørsel.");
console.log("");
