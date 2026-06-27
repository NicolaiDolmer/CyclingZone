// backend/scripts/dev/reset-division-3.mjs
// Division 3-nulstilling "fra bunden af" (ejer-godkendt 2026-06-27, spec
// superpowers/specs/2026-06-27-race-calendar-model-design.md).
//
// NULSTILLER (kun Division 3 = tier 3 = league_division_id 4,5,6,7):
//   - reverserer KUN de 40 ægte D3-holds egen præmie (contained scope, ejer-valg),
//   - sletter resultater/standings/træthed/bestyrelses-effekter af de slettede løb,
//   - sletter de gamle D3-løb (FK CASCADE rydder results/entries/schedule/profiler/
//     sim-runs/withdrawals; board_satisfaction_events SET NULL),
//   - materialiserer den NYE delte D3-kalender (28-dages form, game_day-binding),
//   - giver 0%-reset-lån til de hold der ellers gik i minus (skadesløs dækning).
// BEHOLDER: rytterne + alle indkøb/transfers (transfer_in/out, academy_signing).
//
// FK-sikkerhed: kun finance_transactions.race_id (NO ACTION) blokerer sletning af løb →
// vi reverserer+sletter D3-holds præmie-txns og NULLER race_id på udefra-holds beholdne
// præmie-txns, FØR løbene slettes.
//
// KRÆVER migration FØRST (ejer-applied): race_stage_schedule.game_day + races.game_day_start
// + loan_config 'reset'-rows (0% rente/fee). Se migrations-SQL i bunden af denne fil.
//
// Brug:  node backend/scripts/dev/reset-division-3.mjs            (dry-run, intet skrives)
//        node backend/scripts/dev/reset-division-3.mjs --apply    (udfører — KUN efter ejer-go)

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { materializeTierCalendars } from "../../lib/tierCalendarMaterializer.js";
import { createLoan } from "../../lib/loanEngine.js";
import { incrementBalanceWithAudit } from "../../lib/balanceRpc.js";
import { updateStandings, updateRiderValues } from "../../lib/economyEngine.js";
import { recomputeSeasonRaceDays } from "../../lib/seasonRaceDays.js";

dotenv.config();
const APPLY = process.argv.includes("--apply");
const D3 = [4, 5, 6, 7]; // tier 3-puljer
const fmt = (n) => Math.round(Number(n) || 0).toLocaleString("da-DK");

async function main() {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

  const { data: season, error: sErr } = await supabase.from("seasons").select("id, number, start_date").eq("status", "active").maybeSingle();
  if (sErr || !season) throw new Error(`aktiv sæson ikke fundet: ${sErr?.message}`);

  const { data: d3Races } = await supabase.from("races").select("id, prize_paid_at").eq("season_id", season.id).in("league_division_id", D3);
  const d3RaceIds = (d3Races || []).map((r) => r.id);

  const { data: d3Teams } = await supabase.from("teams")
    .select("id, name, balance, league_division_id").in("league_division_id", D3).eq("is_ai", false).eq("is_test_account", false);
  const d3TeamIds = new Set((d3Teams || []).map((t) => t.id));

  // Præmie-txns på D3-løb (paginér for at undgå 1000-rk-trunkering).
  const prizeTx = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase.from("finance_transactions").select("id, team_id, amount, race_id")
      .eq("type", "prize").in("race_id", d3RaceIds).range(from, from + 999);
    prizeTx.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  const prizeByTeam = new Map();
  const crossDivTxIds = [];
  for (const tx of prizeTx) {
    if (d3TeamIds.has(tx.team_id)) prizeByTeam.set(tx.team_id, (prizeByTeam.get(tx.team_id) || 0) + Number(tx.amount));
    else crossDivTxIds.push(tx.id);
  }

  const teamRows = (d3Teams || []).map((t) => {
    const prize = prizeByTeam.get(t.id) || 0;
    const projected = Number(t.balance) - prize;
    return { id: t.id, name: t.name, balance: Number(t.balance), prize, projected, loan: Math.max(0, -projected) };
  });
  const negatives = teamRows.filter((t) => t.loan > 0).sort((a, b) => b.loan - a.loan);
  const totalReverse = [...prizeByTeam.values()].reduce((a, b) => a + b, 0);
  const totalLoans = negatives.reduce((a, b) => a + b.loan, 0);

  const cal = await materializeTierCalendars({
    supabase, seasonId: season.id, seasonStartDate: season.start_date,
    from: new Date(season.start_date), tiers: [3], dryRun: true,
  });

  console.log(`\n=== Division 3-nulstilling — sæson ${season.number} (${APPLY ? "APPLY" : "DRY-RUN"}) ===`);
  console.log(`D3-løb (gamle): ${d3RaceIds.length}  ·  ægte D3-hold: ${teamRows.length}`);
  console.log(`Præmie at reversere (kun D3-hold): ${fmt(totalReverse)}  ·  udefra-præmie-txns at af-linke: ${crossDivTxIds.length}`);
  console.log(`Hold i minus efter reversering: ${negatives.length}  ·  0%-lån i alt: ${fmt(totalLoans)}`);
  for (const t of negatives) console.log(`   ${t.name}: saldo ${fmt(t.balance)} − præmie ${fmt(t.prize)} = ${fmt(t.projected)} → lån ${fmt(t.loan)}`);
  const newPlan = cal.tiers.find((x) => x.tier === 3);
  if (newPlan) console.log(`Ny D3-kalender: ${newPlan.pools.length} puljer, ${newPlan.pools[0]?.selected ?? 0} løb/pulje, tomme dage: ${newPlan.emptyDays}, beskåret: ${newPlan.truncatedStages}/${newPlan.truncatedSingles}`);

  if (!APPLY) {
    console.log(`\nDRY-RUN — intet skrevet. Kør med --apply efter ejer-go (+ migration applied).`);
    return;
  }

  console.log(`\n--- APPLY ---`);
  // 1. Reversér D3-holds præmie (idempotent pr. hold).
  for (const t of teamRows.filter((x) => x.prize > 0)) {
    await incrementBalanceWithAudit(supabase, {
      teamId: t.id, delta: -t.prize,
      payload: {
        type: "admin_adjustment", amount: -t.prize, description: "Division 3-nulstilling: præmie-reversering",
        season_id: season.id, actor_type: "SYSTEM", actor_id: null, source_path: "reset-division-3",
        reason_code: "D3_RESET_PRIZE_CLAWBACK", idempotency_key: `d3_reset_clawback:${t.id}`,
        metadata: { code: "tx.d3ResetClawback" },
      },
    });
  }
  // 2. Slet D3-holds præmie-txns.
  await supabase.from("finance_transactions").delete().eq("type", "prize").in("race_id", d3RaceIds).in("team_id", [...d3TeamIds]);
  // 3. Af-link udefra-holds beholdne præmie-txns (så løb kan slettes; pengene beholdes).
  for (let i = 0; i < crossDivTxIds.length; i += 500) {
    await supabase.from("finance_transactions").update({ race_id: null }).in("id", crossDivTxIds.slice(i, i + 500));
  }
  // 4. Slet gamle D3-løb (CASCADE rydder results/entries/schedule/profiler/sim-runs/withdrawals).
  await supabase.from("races").delete().eq("season_id", season.id).in("league_division_id", D3);
  // 5. Re-ankr D3-bestyrelse (satisfaction → sæson-start-anker, budget_modifier → 1.0).
  for (const t of teamRows) {
    const { data: bp } = await supabase.from("board_profiles").select("id, season_start_satisfaction").eq("team_id", t.id).eq("season_id", season.id);
    for (const row of bp || []) {
      await supabase.from("board_profiles").update({ satisfaction: row.season_start_satisfaction ?? 50, budget_modifier: 1.0 }).eq("id", row.id);
    }
  }
  // 6. Nulstil træthed for D3-ryttere.
  const { data: d3Riders } = await supabase.from("riders").select("id").in("team_id", [...d3TeamIds]);
  const d3RiderIds = (d3Riders || []).map((r) => r.id);
  for (let i = 0; i < d3RiderIds.length; i += 500) {
    await supabase.from("rider_condition").update({ fatigue: 0 }).in("rider_id", d3RiderIds.slice(i, i + 500));
  }
  // 7. Genberegn standings + rytter-værdier + race-days (globalt, idempotent).
  await updateStandings(season.id);
  await updateRiderValues(supabase);
  await recomputeSeasonRaceDays({ supabase, seasonId: season.id });
  // 8. 0%-reset-lån til de hold der gik i minus (skadesløs dækning, tilbagebetales af fremtidig præmie).
  for (const t of negatives) {
    await createLoan(t.id, "reset", t.loan, supabase, { actorType: "SYSTEM", actorId: null });
  }
  // 9. Materialisér den nye D3-kalender.
  const applied = await materializeTierCalendars({
    supabase, seasonId: season.id, seasonStartDate: season.start_date,
    from: new Date(season.start_date), tiers: [3], dryRun: false, log: (m) => console.log(m),
  });
  console.log(`\nFÆRDIG: nye løb ${applied.racesInserted}, etape-tider ${applied.stageSchedules}, profiler ${applied.stageProfiles}, lån ${negatives.length}.`);
}

main().catch((e) => { console.error(e); process.exit(1); });

/*
MIGRATION (ejer-applied via Supabase apply_migration FØR --apply):

ALTER TABLE race_stage_schedule ADD COLUMN IF NOT EXISTS game_day integer;
ALTER TABLE races ADD COLUMN IF NOT EXISTS game_day_start integer;
COMMENT ON COLUMN race_stage_schedule.game_day IS 'In-game løbsdag (binding-nøgle), adskilt fra scheduled_at (IRL sim-tidspunkt). Kalender-rebuild 2026-06-27.';

INSERT INTO loan_config (division, loan_type, interest_rate_pct, origination_fee_pct, seasons, debt_ceiling)
SELECT d, 'reset', 0, 0, 5, 2000000
FROM generate_series(1, 4) AS d
WHERE NOT EXISTS (SELECT 1 FROM loan_config lc WHERE lc.division = d AND lc.loan_type = 'reset');
*/
