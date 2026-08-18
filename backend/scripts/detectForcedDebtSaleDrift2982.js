// #2982 · Read-only drift-detektor for tvangssalg (forced_debt_sale).
//
// Baggrund: FØR denne fix var kreditering (creditTeam) og rytter-disposition
// (riders.team_id-flyt) i economyEngine.js's gældsloft-tvangssalg to separate
// Supabase-kald. En crash/fejl mellem de to (netværks-hikke, en throw i
// clearFutureRaceEntriesSafe/closeTransferListingsForRiders) kunne efterlade
// et hold med:
//   - en forced_debt_sale-postering i finance_transactions (pengene bogført)
//   - rytteren STADIG på det krediterede hold (dispositionen nåede aldrig igennem)
// Se issue #2982 for det fulde hændelsesforløb.
//
// Dette script finder den drift-klasse READ-ONLY: for hver forced_debt_sale-
// postering udleder det rytter-id'et fra idempotency_key (mønster
// `forced_debt_sale:<team>:<season>:<rider>`, sat i economyEngine.js) og
// slår rytterens AKTUELLE team_id op. Hvis rytteren stadig ejes af det
// krediterede hold, er salget kun halvt gennemført.
//
// KØR ALDRIG med --apply mod prod uden ejer-godkendelse. Scriptet muterer
// intet i sig selv — det er en observation, ikke en reparation. Fixet i
// #2982 gør drift-klassen selvhelende fremadrettet (næste sæson-payroll for
// det pågældende hold fuldfører den uafsluttede disposition automatisk, se
// economyEngine.js's `stillOwnedByTeam`-gren), så en separat repair-mutation
// er kun nødvendig hvis man vil rette OP FØR næste sæsonskifte.
//
//   node scripts/detectForcedDebtSaleDrift2982.js
//
// Prod-status ved skrivetidspunktet (18/8, read-only SELECT): 0 rows — ingen
// eksisterende drift at reparere. Kør scriptet igen før enhver fremtidig
// sæsonskifte-cutover for at bekræfte det stadig gælder.

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { fetchAllRows } from "../lib/supabasePagination.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", ".env") });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function main() {
  // #3331 pagination-guard: finance_transactions er deny-listed (PostgREST's
  // 1000-row-loft) — paginer via fetchAllRows i stedet for et rå select.
  const rows = await fetchAllRows(() => (
    supabase
      .from("finance_transactions")
      .select("id, team_id, amount, created_at, season_id, idempotency_key")
      .eq("type", "forced_debt_sale")
      .order("created_at", { ascending: true })
  ));

  console.log(`forced_debt_sale-posteringer fundet: ${rows.length}`);
  if (rows.length === 0) {
    console.log("Ingen tvangssalg bogført endnu — ingen drift muligt.");
    return;
  }

  const drifted = [];
  for (const row of rows) {
    // idempotency_key: forced_debt_sale:<teamId>:<seasonId>:<riderId>
    const parts = (row.idempotency_key || "").split(":");
    const riderId = parts.length === 4 ? parts[3] : null;
    if (!riderId) {
      console.warn(`  ⚠️  ${row.id}: uventet idempotency_key-format ("${row.idempotency_key}") — kan ikke udlede rytter-id, spring over`);
      continue;
    }

    const { data: rider, error: riderError } = await supabase
      .from("riders")
      .select("id, team_id, firstname, lastname")
      .eq("id", riderId)
      .maybeSingle();
    if (riderError) {
      console.warn(`  ⚠️  ${row.id}: kunne ikke slå rytter ${riderId} op: ${riderError.message}`);
      continue;
    }
    if (!rider) {
      console.warn(`  ⚠️  ${row.id}: rytter ${riderId} findes ikke længere (slettet/anonymiseret?) — kan ikke afgøre drift`);
      continue;
    }

    if (rider.team_id === row.team_id) {
      drifted.push({ transactionId: row.id, teamId: row.team_id, seasonId: row.season_id, riderId: rider.id, riderName: `${rider.firstname} ${rider.lastname}`, amount: row.amount, creditedAt: row.created_at });
    }
  }

  if (drifted.length === 0) {
    console.log("✅ Ingen drift: alle krediterede tvangssalg har også fuldført rytter-dispositionen.");
    return;
  }

  console.log(`\n🔴 ${drifted.length} tvangssalg med UAFSLUTTET disposition (holdet har pengene, rytteren står stadig på holdet):`);
  for (const d of drifted) {
    console.log(`  - finance_transactions.id=${d.transactionId} team=${d.teamId} season=${d.seasonId} rider=${d.riderName} (${d.riderId}) amount=${d.amount} credited_at=${d.creditedAt}`);
  }
  console.log("\nDisse hold fuldfører automatisk (efter #2982-fixet) ved deres NÆSTE sæson-payroll-kørsel.");
  console.log("Ønskes det rettet FØR næste sæsonskifte, kræver det en separat, ejer-godkendt reparationskørsel.");
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
