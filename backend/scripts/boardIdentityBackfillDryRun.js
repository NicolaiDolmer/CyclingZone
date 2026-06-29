#!/usr/bin/env node
// Backfill: beregn season_1_identity_basis + DNA-forslag for ægte hold der
// mangler basis (de hold der sidder fast uden DNA-valg). Genbruger den ægte
// engine-logik 1:1 (computeSeasonOneIdentity + computeDnaSuggestions), så
// outputtet matcher hvad startSequentialNegotiation/dannelse ville producere.
// #1680/#1721-opfølgning.
//
//   node scripts/boardIdentityBackfillDryRun.js            # DRY-RUN (default, INTET skrives)
//   node scripts/boardIdentityBackfillDryRun.js --apply    # skriv season_1_identity_basis
//
// --apply skriver kun til hold hvor feltet STADIG er NULL (idempotent —
// startSequentialNegotiation springer samme hold over ved næste sæson-overgang).
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY (service-role).

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

import { computeSeasonOneIdentity } from "../lib/boardIdentity.js";
import { computeDnaSuggestions } from "../lib/boardClubDna.js";
import { BOARD_IDENTITY_RIDER_SELECT } from "../lib/boardConstants.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env"), quiet: true });

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

const APPLY = process.argv.slice(2).includes("--apply");

function pad(value, width) {
  const s = String(value ?? "");
  return s.length >= width ? s.slice(0, width) : s + " ".repeat(width - s.length);
}

async function main() {
  // Ægte hold uden identitets-grundlag (samme diskriminator som UI/kapacitet).
  const { data: teams, error: teamErr } = await supabase
    .from("teams")
    .select("id, name, division, season_1_identity_basis, team_dna_key")
    .eq("is_ai", false)
    .eq("is_bank", false)
    .eq("is_frozen", false)
    .eq("is_test_account", false)
    .not("user_id", "is", null)
    .is("season_1_identity_basis", null);
  if (teamErr) throw teamErr;

  if (!teams?.length) {
    console.log("Ingen ægte hold mangler season_1_identity_basis. Intet at backfille.");
    return;
  }

  const { data: riders, error: riderErr } = await supabase
    .from("riders")
    .select(`team_id, ${BOARD_IDENTITY_RIDER_SELECT}`)
    .in("team_id", teams.map((t) => t.id));
  if (riderErr) throw riderErr;

  const ridersByTeam = new Map();
  for (const r of riders || []) {
    if (!r.team_id) continue;
    if (!ridersByTeam.has(r.team_id)) ridersByTeam.set(r.team_id, []);
    ridersByTeam.get(r.team_id).push(r);
  }

  console.log(`\nDRY-RUN — ${teams.length} ægte hold uden season_1_identity_basis (READ-ONLY)\n`);
  console.log(
    pad("Hold", 22), pad("Div", 4), pad("#R", 4),
    pad("Spec", 10), pad("Nat", 6), pad("Star", 7), pad("Youth", 7),
    "DNA-forslag (national / spec / wildcard)"
  );
  console.log("-".repeat(120));

  const slotCount = {};
  let zeroRiderTeams = 0;
  let written = 0;

  for (const team of teams.sort((a, b) => (a.division ?? 9) - (b.division ?? 9))) {
    const teamRiders = ridersByTeam.get(team.id) || [];
    if (teamRiders.length === 0) zeroRiderTeams += 1;

    const basis = computeSeasonOneIdentity({ team, riders: teamRiders, seasonNumber: 1 });
    const suggestions = computeDnaSuggestions(basis);
    const natCode = basis.national_core?.code || "—";
    const natEst = basis.national_core?.established ? "" : "?";
    const starLvl = basis.star_profile?.level || "—";

    for (const s of suggestions) slotCount[s.key] = (slotCount[s.key] || 0) + 1;
    const sugStr = suggestions.map((s) => s.key).join(" / ");

    console.log(
      pad(team.name, 22), pad(team.division, 4), pad(teamRiders.length, 4),
      pad(basis.primary_specialization, 10), pad(natCode + natEst, 6),
      pad(starLvl, 7), pad(basis.youth_level, 7), sugStr
    );

    if (APPLY) {
      // Idempotent: skriv kun hvis feltet stadig er NULL (undgå at overskrive
      // hvis en sæson-overgang nåede holdet imellem read og write).
      const { error: updErr } = await supabase
        .from("teams")
        .update({ season_1_identity_basis: basis })
        .eq("id", team.id)
        .is("season_1_identity_basis", null);
      if (updErr) throw new Error(`UPDATE fejlede for ${team.name}: ${updErr.message}`);
      written += 1;
    }
  }

  console.log("\n── Forslags-fordeling (hvor ofte hvert DNA optræder i de 3 forslag) ──");
  for (const [key, n] of Object.entries(slotCount).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${pad(key, 26)} ${n}`);
  }
  if (zeroRiderTeams > 0) {
    console.log(`\n⚠ ${zeroRiderTeams} hold har 0 ryttere i pool — basis bliver default/svag.`);
  }
  if (APPLY) {
    console.log(`\n✅ APPLY: season_1_identity_basis skrevet for ${written} hold.\n`);
  } else {
    console.log("\nDRY-RUN — INTET skrevet. Kør med --apply for at skrive.\n");
  }
}

main().catch((err) => {
  console.error("Dry-run fejlede:", err.message);
  process.exit(1);
});
