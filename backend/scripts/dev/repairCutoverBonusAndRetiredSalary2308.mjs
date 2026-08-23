// Cutover-natten 23/8 · Reparation af to spiller-rapporterede fund (#3901/#1155):
//
// A) MANGLENDE DIVISIONSBONUSSER: payDivisionBonuses' dedup filtrerede kun på
//    type='bonus', så hold med en accepteret bestyrelses-/sponsorbonus i S2 blev
//    fejlagtigt sprunget over (12 hold / 825.000 CZ$, bl.a. begge D2-puljevindere).
//    Dedup-fixet ligger i economyEngine.js; dette script GENKØRER payDivisionBonuses
//    for S2 — samme kodesti, samme beløb, samme audit — og betaler kun de manglende.
//
// B) LØN FOR PENSIONEREDE: season_payroll (fase 6) trak S3-løn for ryttere som
//    rider_progression (fase 13) derefter pensionerede — de kører aldrig et S3-løb.
//    Refunderes pr. hold som admin_adjustment med navne i beskrivelsen (samme
//    skrivesti som POST /admin/adjust-balance: incrementBalanceWithAudit + admin_log).
//
// Kør fra backend/ (dry-run default, read-only):
//   infisical run --env=prod --silent -- node scripts/dev/repairCutoverBonusAndRetiredSalary2308.mjs
//   CONFIRM_REPAIR=yes ... node scripts/dev/repairCutoverBonusAndRetiredSalary2308.mjs --apply
//
// Idempotens: A er dedup'et af reason_code-filteret (genkørsel betaler 0);
// B er dedup'et af et deterministisk idempotency-key pr. hold (repair-2308-retired-<team>).

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { fetchAllRows } from "../../lib/supabasePagination.js";
import { payDivisionBonuses } from "../../lib/economyEngine.js";
import { incrementBalanceWithAudit } from "../../lib/balanceRpc.js";
import { FINANCE_REASON, FINANCE_ACTOR_TYPE, FINANCE_RELATED_ENTITY, SALARY_RATE_PRODUCTION, DIVISION_BONUSES } from "../../lib/economyConstants.js";

const S2 = "00000000-0000-0000-0000-000000000002";
const APPLY = process.argv.includes("--apply");
const CONFIRMED = process.env.CONFIRM_REPAIR === "yes";
const BACKUP_TABLE = "cutover_3645_backup_20260823";

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { console.error("❌ env mangler"); process.exit(1); }
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const fmt = (n) => Math.round(n).toLocaleString("da-DK");

async function planBonuses() {
  const standings = await fetchAllRows(() => sb.from("season_standings")
    .select("*, team:team_id(id, name, is_ai, is_test_account, is_bank)")
    .eq("season_id", S2).order("id"));
  const paidRows = await fetchAllRows(() => sb.from("finance_transactions")
    .select("team_id, reason_code").eq("season_id", S2).eq("type", "bonus").order("id"));
  const paid = new Set(paidRows.filter((r) => r.reason_code == null || r.reason_code === FINANCE_REASON.SEASON_END_DIVISION_BONUS).map((r) => r.team_id));
  const owed = [];
  for (const s of standings) {
    if (!s.team_id || s.team?.is_ai || s.team?.is_test_account || s.team?.is_bank) continue;
    if (paid.has(s.team_id)) continue;
    const bonuses = DIVISION_BONUSES[s.division];
    const rank = s.rank_in_division;
    if (!bonuses || !rank || rank > bonuses.length) continue;
    const amount = bonuses[rank - 1];
    if (amount) owed.push({ name: s.team?.name, division: s.division, rank, amount });
  }
  return { standings, owed };
}

async function planRefunds() {
  const logs = await fetchAllRows(() => sb.from("rider_development_log")
    .select("rider_id, retired_this_season").eq("season_number", 3).eq("retired_this_season", true).order("rider_id"));
  const riderIds = logs.map((l) => l.rider_id);
  const riders = await fetchAllRows(() => sb.from("riders")
    .select("id, firstname, lastname, current_production_value, is_retired").in("id", riderIds).order("id"));
  const backup = await fetchAllRows(() => sb.from(BACKUP_TABLE)
    .select("row_id, row_before").eq("table_name", "riders").in("row_id", riderIds).order("row_id"));
  const teamBefore = new Map(backup.map((b) => [b.row_id, b.row_before?.team_id ?? null]));
  const teams = await fetchAllRows(() => sb.from("teams").select("id, name, is_ai").order("id"));
  const teamById = new Map(teams.map((t) => [t.id, t]));

  const byTeam = new Map();
  for (const r of riders) {
    if (!r.is_retired) continue;
    const teamId = teamBefore.get(r.id);
    const team = teamId ? teamById.get(teamId) : null;
    if (!team || team.is_ai) continue;
    // Lønnen payroll trak = computeFrozenSalary(cpv) fra genberegningen 20:04.
    // CPV er uændret af pensionen; salary-kolonnen blev nullet af releasen.
    const cpv = Number(r.current_production_value) > 0 ? Number(r.current_production_value) : 1000;
    const charged = Math.max(1, Math.round(cpv * SALARY_RATE_PRODUCTION));
    if (!byTeam.has(teamId)) byTeam.set(teamId, { name: team.name, riders: [], total: 0 });
    const e = byTeam.get(teamId);
    e.riders.push(`${r.firstname} ${r.lastname}`.trim() + ` (${fmt(charged)})`);
    e.total += charged;
  }
  return byTeam;
}

async function main() {
  console.log("=== Reparation 23/8: divisionsbonusser + pensions-løn ===");
  console.log(`MODE: ${APPLY ? "APPLY" : "dry-run (skriver INTET)"}`);
  if (APPLY && !CONFIRMED) { console.error("❌ --apply kræver CONFIRM_REPAIR=yes"); process.exit(1); }

  const { standings, owed } = await planBonuses();
  console.log(`\nA) Divisionsbonusser der mangler: ${owed.length} hold · ${fmt(owed.reduce((a, o) => a + o.amount, 0))} CZ$`);
  for (const o of owed) console.log(`   D${o.division} nr. ${o.rank}  ${String(o.name).padEnd(30)} ${fmt(o.amount).padStart(9)}`);

  const refunds = await planRefunds();
  const refundTotal = [...refunds.values()].reduce((a, e) => a + e.total, 0);
  console.log(`\nB) Pensions-løn-refusioner: ${refunds.size} hold · ${fmt(refundTotal)} CZ$`);
  for (const [, e] of refunds) console.log(`   ${e.name.padEnd(30)} ${fmt(e.total).padStart(8)}  ${e.riders.join(", ")}`);

  if (!APPLY) { console.log("\nDRY-RUN slut — intet skrevet."); return; }

  console.log("\n→ A) payDivisionBonuses (fixet dedup, samme kodesti som motoren)…");
  await payDivisionBonuses(standings, S2, sb);
  const paidAfter = await fetchAllRows(() => sb.from("finance_transactions")
    .select("team_id").eq("season_id", S2).eq("type", "bonus").eq("reason_code", FINANCE_REASON.SEASON_END_DIVISION_BONUS).order("id"));
  console.log(`   Divisionsbonus-rækker i alt nu: ${paidAfter.length}`);

  console.log("→ B) refusioner…");
  const { data: s3 } = await sb.from("seasons").select("id").eq("status", "active").maybeSingle();
  for (const [teamId, e] of refunds) {
    await incrementBalanceWithAudit(sb, {
      teamId,
      delta: e.total,
      payload: {
        type: "admin_adjustment",
        amount: e.total,
        description: `Refund: season 3 salary charged for retired rider(s) ${e.riders.join(", ")}`,
        season_id: s3?.id ?? null,
        actor_type: FINANCE_ACTOR_TYPE.ADMIN,
        actor_id: null,
        source_path: "scripts/dev/repairCutoverBonusAndRetiredSalary2308",
        reason_code: FINANCE_REASON.ADMIN_BALANCE_ADJUSTMENT,
        related_entity_type: FINANCE_RELATED_ENTITY.MANUAL,
        related_entity_id: null,
        idempotency_key: `repair-2308-retired-${teamId}`,
      },
    });
    console.log(`   ✅ ${e.name}: +${fmt(e.total)}`);
  }

  const again = await planBonuses();
  console.log(`\nPost-verify: manglende bonusser efter apply = ${again.owed.length} (skal være 0)`);
  if (again.owed.length) process.exit(2);
}

main().catch((e) => { console.error("❌", e.message); process.exit(1); });
