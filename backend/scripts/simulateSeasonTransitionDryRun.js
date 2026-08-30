#!/usr/bin/env node
// Sæson-transitions dry-run (#1155) — verificér S1→S2 mod ægte prod-data UDEN writes.
//
// Kører transitionToNextSeason({ dryRun: true }) mod den aktive sæson og rapporterer
// de tre transition-invarianter eksplicit:
//   1. Nedrykning gated (seasonNumber < FIRST_PROMOTION_RELEGATION_SEASON=3 → springes over)
//   2. Auto-loop guard (closed_at IS NOT NULL skelner lukket deadline-window fra nyfødt
//      racing-window — nyt window fødes med closed_at=null så cron ikke re-fyrer)
//   3. Transfer-vindue lukker (closePrevTransferWindow sætter status='closed', closed_at sat)
//
// dryRun=true returnerer EFTER buildTransitionPlan (kun .select()) → garanteret write-fri.
//
// Kør med prod-credentials injiceret af Railway (dumper ingen secrets):
//   railway run --service CyclingZone -- node scripts/simulateSeasonTransitionDryRun.js
//
// Lokalt mod prod kræver SUPABASE_URL + SUPABASE_SERVICE_KEY i env.

import { createClient } from "@supabase/supabase-js";
import { transitionToNextSeason } from "../lib/seasonTransition.js";
import { FIRST_PROMOTION_RELEGATION_SEASON } from "../lib/economyConstants.js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) {
  console.error("❌ SUPABASE_URL / SUPABASE_SERVICE_KEY mangler i env. Kør via `railway run`.");
  process.exit(1);
}
const supabase = createClient(url, key);

const money = (n) => (n == null ? "—" : `${(Math.round(n / 1000) / 1000).toFixed(2).replace(/\.?0+$/, "")}M`);

// ── 1. Find den aktive sæson (fromSeason) ────────────────────────────────────
const { data: active, error: activeErr } = await supabase
  .from("seasons")
  .select("id, number, status, start_date")
  .eq("status", "active")
  .order("number", { ascending: false })
  .limit(1)
  .maybeSingle();
if (activeErr) throw new Error(`Kunne ikke læse aktiv sæson: ${activeErr.message}`);
if (!active) throw new Error("Ingen aktiv sæson fundet (status='active').");

console.log(`\n${"═".repeat(78)}`);
console.log(`SÆSON-TRANSITIONS DRY-RUN — read-only, rører ikke prod`);
console.log(`${"═".repeat(78)}`);
console.log(`\nAktiv sæson: #${active.number}  (id ${active.id}, status='${active.status}')`);

// ── 2. Kør dry-run ───────────────────────────────────────────────────────────
const { plan, carryOverPreview } = await transitionToNextSeason({ supabase, fromSeasonId: active.id, dryRun: true });

console.log(`\n── PLAN ──────────────────────────────────────────────────────────────────`);
console.log(`  Fra sæson:          #${plan.from_season.number}  (${plan.from_season.id})`);
console.log(`  Til sæson:          #${plan.to_season.number}  (${plan.to_season.id})`);
console.log(`  Nyt transfer-window: ${plan.to_season.transfer_window_id}`);
console.log(`  Allerede transitioneret? ${plan.already_transitioned ? "JA ⚠️ (toSeason eksisterer)" : "nej"}`);
console.log(`  Hold påvirket:       ${plan.teams_affected}`);

// #2926 · Sponsor-tallene modellerer den FAKTISKE kontraktbestand: fase 5b
// (expireAndRenewContracts) kører FØR sponsor-payouten, så processSeasonStart
// udbetaler kontrakternes guaranteed_base — ikke den kontraktfri division-base.
const src = plan.sponsor_contract_sources || { locked: 0, pending: 0, default: 0 };
console.log(`  Sponsor GARANTERET base (før modifier):              ${money(plan.sponsor_base_total)} pts`);
console.log(`     kontrakt-kilder: ${src.locked} låst · ${src.pending} managervalg aktiveres · ${src.default} auto-default ('safe')`);
// #2753 · payout-tallet er det der FAKTISK krediteres: base x board-modifier x
// pullout, cappet af kontraktloftet. Basen ovenfor er kun reference.
console.log(`  Sponsor FAKTISK payout (udbetales ved sæsonstart):   ${money(plan.sponsor_payout_total)} pts${plan.sponsor_board_test_mode ? "  (board test-mode: modifier neutraliseret)" : ""}`);
console.log(`  Signing-bonusser (engangs, ved aktivering):           ${money(plan.sponsor_signing_bonus_total)} pts`);
console.log(`  → Samlet pengeinjektion ved SELVE skiftet:            ${money(plan.sponsor_payout_total + plan.sponsor_signing_bonus_total)} pts`);
console.log(`  Variabel pulje (pr. etape HEN OVER sæsonen, ikke nu): ${money(plan.sponsor_race_day_pool_total)} pts`);

// ── 3. Invariant-rapport ─────────────────────────────────────────────────────
const toNum = plan.to_season.number;
console.log(`\n── INVARIANTER ───────────────────────────────────────────────────────────`);

// (1) Nedrykning gated
const relegationSkipped = toNum < FIRST_PROMOTION_RELEGATION_SEASON;
console.log(
  `  1. Nedrykning:  sæson ${toNum} ${relegationSkipped ? "<" : ">="} gate ${FIRST_PROMOTION_RELEGATION_SEASON}` +
  ` → ${relegationSkipped ? "✓ INGEN op/nedrykning (sprunget over)" : "⚠️ OP/NEDRYKNING VIL SKE"}`
);

// (2) Auto-loop guard: inspicér transfer_windows for fromSeason
const { data: fromWindows } = await supabase
  .from("transfer_windows")
  .select("id, status, closed_at, final_whistle_sent_at, squad_enforcement_completed_at, created_at")
  .eq("season_id", plan.from_season.id)
  .order("created_at", { ascending: false });
const latestFrom = (fromWindows || [])[0] || null;
console.log(`\n  2. Auto-loop guard (cron matcher kun status='closed' + closed_at + final_whistle + squad_enforcement):`);
if (!latestFrom) {
  console.log(`     fromSeason har intet transfer_window endnu.`);
} else {
  const wrapped =
    latestFrom.status === "closed" &&
    latestFrom.closed_at != null &&
    latestFrom.final_whistle_sent_at != null &&
    latestFrom.squad_enforcement_completed_at != null;
  console.log(`     fromSeason-window: status='${latestFrom.status}'` +
    ` · closed_at=${latestFrom.closed_at ? "sat" : "null"}` +
    ` · final_whistle=${latestFrom.final_whistle_sent_at ? "sat" : "null"}` +
    ` · squad_enf=${latestFrom.squad_enforcement_completed_at ? "sat" : "null"}`);
  console.log(`     → cron vil ${wrapped ? "FYRE transition (window fuldt wrapped)" : "IKKE fyre endnu (mangler wrap-trin)"}`);
  console.log(`     Nyt S${toNum}-window fødes med closed_at=null → cron kan ALDRIG re-fyre på det. ✓`);
}

// (3) Vindue lukker — vis nuværende status (lukkes når transition kører rigtigt)
console.log(`\n  3. Vindue lukker: closePrevTransferWindow sætter status='closed' + closed_at ved rigtig kørsel.`);
console.log(`     (dry-run skriver ikke; ovenstående status er FØR-tilstand.)`);

// ── 4. Sponsor-niveau sanity (#1157 · kontrakt-bevidst siden #2926) ──────────
console.log(`\n── SPONSOR-PREVIEW (top 8 efter garanteret base) ─────────────────────────`);
const rows = [...plan.sponsor_breakdown].sort((a, b) => b.sponsor_base - a.sponsor_base).slice(0, 8);
for (const r of rows) {
  console.log(
    `     ${String(r.team_name).padEnd(24)} div ${r.division}  base ${money(r.sponsor_base).padStart(7)}` +
    `  ${String(r.sponsor_contract_source).padEnd(7)} ${String(r.sponsor_contract_variant ?? "—").padEnd(11)} ${r.sponsor_name ?? ""}`
  );
}
const contractFree = plan.sponsor_breakdown.filter((r) => r.sponsor_mode !== "contract");
if (contractFree.length) {
  console.log(`\n  ⚠️  ${contractFree.length} hold uden kontrakt-modelleret base — undersøg (previewet skal være kontrakt-bevidst).`);
}

// ── 5. Manager-opsætnings-carry-over (#2916) ─────────────────────────────────
console.log(`\n── OPSÆTNINGS-CARRY-OVER (#2916) ─────────────────────────────────────────`);
if (!carryOverPreview) {
  console.log(`  (intet carryOverPreview i svaret)`);
} else if (carryOverPreview.error) {
  console.log(`  ⚠️  Carry-over-probe fejlede: ${carryOverPreview.error}`);
} else {
  const s = carryOverPreview.surfaces || {};
  console.log(`  Menneskehold: ${carryOverPreview.human_teams}`);
  if (carryOverPreview.handler_drift?.length) {
    console.log(`  ⚠️  Handler-drift: ${carryOverPreview.handler_drift.join("; ")}`);
  }
  console.log(`\n  COPY — training_plans:`);
  console.log(`     eligible=${s.training_plans?.eligible ?? "—"}  ville_kopiere=${s.training_plans?.carried ?? "—"}` +
    ` (${s.training_plans?.teams ?? "—"} hold)  allerede_i_ny_sæson=${s.training_plans?.skipped_already_present ?? "—"}`);
  console.log(`\n  REVALIDATE — rider_peak_plans (peaks på løb i forkert pulje / uden mål):`);
  console.log(`     checket=${s.rider_peak_plans?.checked ?? "—"}  wrong_pool=${s.rider_peak_plans?.wrong_pool ?? "—"}` +
    `  missing_target=${s.rider_peak_plans?.missing_target ?? "—"}  hold_ramt=${s.rider_peak_plans?.teams_affected ?? "—"}`);
  console.log(`\n  REVALIDATE — race_entries (manuelle udtagelser i forkert pulje):`);
  console.log(`     checket=${s.race_entries?.checked ?? "—"}  wrong_pool=${s.race_entries?.wrong_pool ?? "—"}` +
    `  hold_ramt=${s.race_entries?.teams_affected ?? "—"}`);
  console.log(`\n  REVALIDATE — team_race_strategy.target_race_ids (holdstrategiens prioriterede løb):`);
  console.log(`     checket_hold=${s.team_race_strategy?.checked_teams ?? "—"}  checket_refs=${s.team_race_strategy?.checked_refs ?? "—"}` +
    `  stale=${s.team_race_strategy?.stale_refs ?? "—"}  wrong_pool=${s.team_race_strategy?.wrong_pool_refs ?? "—"}` +
    `  hold_ramt=${s.team_race_strategy?.teams_affected ?? "—"}`);
}

console.log(`\n${"═".repeat(78)}`);
console.log(`Færdig. Read-only — intet skrevet til prod.\n`);
