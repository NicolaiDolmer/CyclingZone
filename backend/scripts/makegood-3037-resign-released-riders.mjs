#!/usr/bin/env node
// #3037 make-good (ejer-go 26/7 ~23:05, option A): gen-indskriv de 11 ryttere som
// contract_expiry_release tog fra Easy Riders (9) og Lip Air France Team (2) ved
// S1→S2-skiftet — starter-kontrakterne var forankret i sæsonnumre, så et 1-dags-hold
// fik kontrakter der udløb næste dag. Friske kontrakter via contractSeed-formlerne,
// men med MIN. længde 2 (end >= sæson 3), så det aldrig kan ske for dem igen.
//
// Guards: opdaterer kun ryttere der STADIG er frie agenter (.is('team_id', null)) og
// ikke pensionerede. Kør generateSeasonEntries bagefter for at genskabe S2-entries.
//   railway run --service CyclingZone -- node scripts/makegood-3037-resign-released-riders.mjs --execute

import { createClient } from "@supabase/supabase-js";
import { computeFrozenSalary, pickContractLength, computeContractEndSeason } from "../lib/contractSeed.js";
import { makeRng } from "../lib/fictionalRiderGenerator.js";
import { notifyTeamOwner } from "../lib/notificationService.js";

const EXECUTE = process.argv.includes("--execute");
const START_SEASON = 2;
const rng = makeRng(3037);

// (teamId, navn, rytter-ids — målt 26/7 22:55, alle frie agenter, 0 i auktion)
const PLAN = [
  {
    teamId: "22874e50-d3d9-45c8-bf87-5b0a7ad3b410", name: "Easy Riders",
    riderIds: [
      "f677ba24-8000-4e78-80b1-e478654d47bb", // Merhawi Goitom
      "eff77a5b-840f-4081-8759-4313639e2ecd", // Cheng Wang
      "1a1a41bc-e6d4-4a1e-8a11-a7ea141033e3", // Yang M. Tang
      "8a2dadb8-5137-4e53-9f1d-05e527b204bb", // Hiroto S. Yamamoto
      "8b75715b-e345-48e0-9030-d09229adcd99", // Iván A. Lozano
      "8c802ba8-9b01-482b-8696-43e2f5111ec1", // Oliver Haugen
      "966e3bfd-4471-4df1-9c66-7dd7552082b4", // Ayoub Toumi
      "a3c400ed-a069-43ae-b88c-56637ffc7d68", // Mario A. Reyes
      "cb140691-78aa-44ca-8fce-d1eba71b8209", // Kenta Y. Kobayashi
    ],
  },
  {
    teamId: "12612579-2b21-461f-8206-7d952eb0062c", name: "Lip Air France Team",
    riderIds: [
      "7a03b386-5044-451c-a54d-daf8f7417329", // Óscar A. Castro
      "def0fe5d-35b6-4d77-824b-4e49fe1622a3", // Tarek Bennani
    ],
  },
];

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

for (const team of PLAN) {
  const { data: t, error: tErr } = await supabase
    .from("teams").select("id, name, division").eq("id", team.teamId).single();
  if (tErr) throw new Error(`team-opslag (${team.name}): ${tErr.message}`, { cause: tErr });
  if (t.name !== team.name) throw new Error(`team-id/navn-mismatch: ${t.name} != ${team.name}`);

  let resigned = 0;
  for (const riderId of team.riderIds) {
    const { data: r, error: rErr } = await supabase
      .from("riders")
      .select("id, firstname, lastname, team_id, is_retired, current_production_value")
      .eq("id", riderId).single();
    if (rErr) throw new Error(`rytter-opslag (${riderId}): ${rErr.message}`, { cause: rErr });
    if (r.team_id != null || r.is_retired) {
      console.log(`  ⏭️  ${r.firstname} ${r.lastname}: ikke længere fri agent — springes over`);
      continue;
    }
    const length = Math.max(pickContractLength(rng), 2); // min end = sæson 3
    const patch = {
      team_id: team.teamId,
      salary: computeFrozenSalary({ current_production_value: r.current_production_value, division: t.division }),
      contract_length: length,
      contract_end_season: computeContractEndSeason(START_SEASON, length),
    };
    if (!EXECUTE) {
      console.log(`  (dry) ${r.firstname} ${r.lastname} → ${team.name}  salary=${patch.salary}  end=${patch.contract_end_season}`);
      resigned++;
      continue;
    }
    const { data: upd, error: uErr } = await supabase
      .from("riders").update(patch).eq("id", riderId).is("team_id", null).select("id");
    if (uErr) throw new Error(`re-sign ${riderId}: ${uErr.message}`, { cause: uErr });
    if (upd && upd.length > 0) {
      resigned++;
      console.log(`  ✅ ${r.firstname} ${r.lastname} → ${team.name}  salary=${patch.salary}  end=${patch.contract_end_season}`);
    } else {
      console.log(`  ⏭️  ${r.firstname} ${r.lastname}: taget af anden proces mellem select og update`);
    }
  }

  if (EXECUTE && resigned > 0) {
    await notifyTeamOwner({
      supabase,
      teamId: team.teamId,
      type: "admin_notice",
      title: "Your riders are back — contract error fixed",
      message:
        `A contract system error released ${resigned} of your riders at the season change. ` +
        `They have been re-signed on proper multi-season contracts at no cost to you — no action needed. ` +
        `Sorry for the scare, and good luck in season 2!`,
      relatedId: null,
      metadata: { source: "makegood_3037", resigned },
    });
    console.log(`  📨 ${team.name}: manager notificeret (${resigned} gen-indskrevet)`);
  }
}
console.log(EXECUTE ? "Færdig." : "DRY-RUN færdig — ingen writes.");
