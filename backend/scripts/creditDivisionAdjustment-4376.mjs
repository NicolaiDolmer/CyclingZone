// #4376 · Efterbetaling af divisions-tillægget for en sæson der allerede er startet.
//
// HVORFOR SCRIPTET FINDES: tillægget krediteres normalt af economyEngine.processSeasonStart,
// men sæson 3's sæsonstart kørte 23/8 — fem dage før reglen blev besluttet (29/8). De hold
// der rykkede op ved den transition har derfor betalt den nye divisions upkeep fra dag ét
// mod en sponsor prissat til den gamle, hele sæsonen. Scriptet betaler den korrektion
// bagud ÉN gang.
//
// SAMME REGEL, SAMME NØGLE: scriptet importerer nøjagtig de samme funktioner som motoren
// (resolveDivisionAdjustment, divisionAdjustmentIdempotencyKey) og bruger samme
// idempotency-nøgle. De to stier kan derfor ikke dobbeltbetale, og de kan ikke drive fra
// hinanden — det var lektien fra #2926, hvor preview og udførelse regnede hver sit tal.
//
// EJER-VALG 5 (29/8): i sæson 3 anvendes KUN den opadgående halvdel. Ingen mister penge
// midt i en sæson (grandfathering-princippet fra #1234). Fradraget nedad starter først
// fra sæson 4 og håndteres af motoren, ikke af dette script. Reglen er indbygget i
// computeDivisionAdjustment via FIRST_SEASON_WITH_DOWNWARD_ADJUSTMENT, så scriptet
// behøver ingen egen filtrering — men det verificeres eksplicit nedenfor, fordi et
// tavst fortegns-skift her ville trække penge ud af 17 holds kasser.
//
// Brug:
//   railway run --service CyclingZone -- node scripts/creditDivisionAdjustment-4376.mjs
//   railway run --service CyclingZone -- node scripts/creditDivisionAdjustment-4376.mjs --execute
//
// Kør ALTID dry-run først og vis tallene til ejeren. Ingen prod-mutation uden et GO på
// netop dét skridt (hard regel 23/8).

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAllRows } from "../lib/supabasePagination.js";
import { incrementBalanceWithAudit } from "../lib/balanceRpc.js";
import {
  resolveDivisionAdjustment,
  divisionAdjustmentIdempotencyKey,
} from "../lib/divisionAdjustment.js";
import {
  FINANCE_ACTOR_TYPE,
  FINANCE_REASON,
  FINANCE_RELATED_ENTITY,
} from "../lib/economyConstants.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env"), quiet: true });

const arg = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  if (hit) return hit.split("=").slice(1).join("=");
  if (process.argv.includes(`--${n}`)) return true;
  return d;
};

const EXECUTE = !!arg("execute", false);
const SEASON_NUMBER = Number(arg("season", 3));

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ SUPABASE_URL / SUPABASE_SERVICE_KEY mangler. Kør via `railway run`.");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const fmt = (n) => (n == null ? "—" : Math.round(n).toLocaleString("da-DK"));

async function main() {
  console.log(`\n${"═".repeat(74)}`);
  console.log(
    `#4376 DIVISIONS-TILLÆG · sæson ${SEASON_NUMBER} · ${
      EXECUTE ? "🔴 EXECUTE (skriver til prod)" : "🟢 DRY-RUN (read-only)"
    }`
  );
  console.log("═".repeat(74));

  const { data: season, error: seasonError } = await supabase
    .from("seasons")
    .select("id, number, status")
    .eq("number", SEASON_NUMBER)
    .maybeSingle();
  if (seasonError) throw seasonError;
  if (!season?.id) throw new Error(`Sæson ${SEASON_NUMBER} findes ikke`);
  console.log(`Sæson-id ${season.id} (status: ${season.status})\n`);

  // Samme population-filter som sæson-start-økonomien bruger (humanTeamFilter).
  const teams = await fetchAllRows(() =>
    supabase
      .from("teams")
      .select("id, name, division")
      .eq("is_ai", false)
      .eq("is_bank", false)
      .eq("is_frozen", false)
      .eq("is_test_account", false)
      .order("id", { ascending: true })
  );

  // schema-columns-ok: signed_division tilfoejes af database/2026-08-29-division-adjustment.sql,
  // som per #2642 applies EFTER merge. Snapshot'et er et spejl af prod og kan derfor foerst
  // opdateres naar migrationen er koert — samme flow som 0d857d73a: undtagelse her nu,
  // fjernes sammen med snapshot-refresh i close-out-commit'en.
  const contracts = await fetchAllRows(() =>
    supabase
      .from("sponsor_contracts")
      .select("team_id, sponsor_name, signed_division")
      .eq("status", "active")
      .order("team_id", { ascending: true })
  );
  const contractByTeam = new Map(contracts.map((c) => [c.team_id, c]));

  // Bestyrelsens modifier — SAMME beregning som processSeasonStart: gennemsnittet af alle
  // 'completed' planers budget_modifier. Ejer-valg 4: tillægget behandles som basen.
  const boards = await fetchAllRows(() =>
    supabase
      .from("board_profiles")
      .select("team_id, budget_modifier, negotiation_status")
      .eq("negotiation_status", "completed")
      .order("team_id", { ascending: true })
  );
  const modifierByTeam = new Map();
  for (const b of boards) {
    const bucket = modifierByTeam.get(b.team_id) || { sum: 0, n: 0 };
    bucket.sum += Number(b.budget_modifier ?? 1.0);
    bucket.n += 1;
    modifierByTeam.set(b.team_id, bucket);
  }

  // Aktive sponsor-pullouts (lag 5) stacker multiplikativt, præcis som i motoren.
  const { data: pullouts, error: pulloutError } = await supabase
    .from("board_consequences")
    .select("team_id, severity")
    .eq("layer", 5)
    .eq("status", "active");
  if (pulloutError) throw pulloutError;
  const pulloutByTeam = new Map(
    (pullouts || []).map((p) => [p.team_id, (p.severity || 1000) / 1000])
  );

  const planned = [];
  const missingSignedDivision = [];
  for (const team of teams) {
    const contract = contractByTeam.get(team.id);
    if (!contract) continue;
    if (!Number.isInteger(contract.signed_division)) {
      missingSignedDivision.push(team);
      continue;
    }

    const bucket = modifierByTeam.get(team.id);
    const baseModifier = bucket && bucket.n > 0 ? bucket.sum / bucket.n : 1.0;
    const modifier = baseModifier * (pulloutByTeam.get(team.id) ?? 1.0);

    const result = resolveDivisionAdjustment({
      team,
      contract,
      seasonNumber: SEASON_NUMBER,
      modifier,
    });
    if (!result.applies) continue;
    planned.push({ team, contract, modifier, ...result });
  }

  // FORTEGNS-GUARD: i sæson 3 må intet beløb være negativt. Sker det, er overgangsreglen
  // brudt et sted, og scriptet skal stoppe frem for at trække penge ud af 17 hold.
  const negatives = planned.filter((p) => p.payout < 0);
  if (SEASON_NUMBER < 4 && negatives.length > 0) {
    console.error(
      `❌ STOP: ${negatives.length} hold ville få et NEGATIVT tillæg i sæson ${SEASON_NUMBER}.`
    );
    console.error("   Ejer-valg 5 siger kun opad før sæson 4. Undersøg før du fortsætter.");
    process.exit(1);
  }

  const up = planned.filter((p) => p.payout > 0);
  const down = planned.filter((p) => p.payout < 0);
  const total = planned.reduce((sum, p) => sum + p.payout, 0);

  console.log(`Hold i population:            ${teams.length}`);
  console.log(`Med aktiv kontrakt:           ${contractByTeam.size}`);
  console.log(`Uden signed_division:         ${missingSignedDivision.length} (får intet tillæg — aldrig et gæt)`);
  console.log(`Rammes af tillægget:          ${planned.length}  (${up.length} opad, ${down.length} nedad)`);
  console.log(`Samlet beløb:                 ${fmt(total)} CZ$\n`);

  const byRoute = new Map();
  for (const p of planned) {
    const key = `D${p.signedDivision} → D${p.currentDivision}`;
    const bucket = byRoute.get(key) || { n: 0, total: 0 };
    bucket.n += 1;
    bucket.total += p.payout;
    byRoute.set(key, bucket);
  }
  console.log("Fordeling (aftalens division → holdets division):");
  for (const [route, b] of [...byRoute.entries()].sort()) {
    console.log(`  ${route.padEnd(14)} ${String(b.n).padStart(3)} hold   ${fmt(b.total).padStart(12)} CZ$`);
  }
  console.log("");

  if (!EXECUTE) {
    console.log("🟢 DRY-RUN slut. Intet er skrevet. Kør med --execute efter ejerens GO.\n");
    return;
  }

  let paid = 0;
  let skipped = 0;
  let totalPaid = 0;
  for (const p of planned) {
    const { skipped: wasSkipped } = await incrementBalanceWithAudit(
      supabase,
      {
        teamId: p.team.id,
        delta: p.payout,
        payload: {
          type: "division_adjustment",
          amount: p.payout,
          description: null,
          season_id: season.id,
          metadata: {
            code: "tx.divisionAdjustment",
            params: {
              signedDivision: p.signedDivision,
              currentDivision: p.currentDivision,
            },
          },
          actor_type: FINANCE_ACTOR_TYPE.SYSTEM,
          actor_id: null,
          source_path: "scripts/creditDivisionAdjustment-4376",
          reason_code: FINANCE_REASON.SEASON_START_DIVISION_ADJUSTMENT,
          related_entity_type: FINANCE_RELATED_ENTITY.SEASON,
          related_entity_id: season.id,
          // Identisk med motorens nøgle: kører processSeasonStart senere for samme
          // sæson, springer den over i stedet for at betale igen.
          idempotency_key: divisionAdjustmentIdempotencyKey(p.team.id, season.id),
        },
      },
      { allowDuplicate: true }
    );
    if (wasSkipped) {
      skipped += 1;
      continue;
    }
    paid += 1;
    totalPaid += p.payout;
    console.log(
      `  ✅ ${p.team.name}: ${p.payout > 0 ? "+" : ""}${fmt(p.payout)} CZ$ (D${p.signedDivision} → D${p.currentDivision}, modifier ${p.modifier.toFixed(2)})`
    );
  }

  console.log(`\n🔴 EXECUTE slut: ${paid} betalt (${fmt(totalPaid)} CZ$), ${skipped} sprunget over som allerede betalt.\n`);
  console.log("Post-verify:");
  console.log(`  SELECT count(*), sum(amount) FROM finance_transactions`);
  console.log(`   WHERE type='division_adjustment' AND season_id='${season.id}';\n`);
}

main().catch((error) => {
  console.error("❌ FEJL:", error?.message || error);
  process.exit(1);
});
