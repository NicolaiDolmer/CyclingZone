// #2699 — NEDJUSTÉR akademi-outliers til ungdomsbåndet.
//
// Ejer-direktiv 19/7: "Disse talenter skal altså gøres dårligere, sådan de kommer
// ned på det niveau, vi rent faktisk ønsker at unge ryttere skal have." De ryttere
// det gælder blev født under en kalibrering der er rettet siden (#3561 sænkede
// startLuckSd 1,2→0,6, signatureBoostPerWeight 15→0,8 og statCeilBoosted 99→54),
// men de eksisterende kandidater bærer stadig de gamle tal.
//
// DRY-RUN ER DEFAULT. Uden --apply røres databasen ikke.
//
//   Dry-run:  infisical run --env=prod -- node scripts/dev/repairYouthOutliers2699.mjs
//   Apply:    infisical run --env=prod -- node scripts/dev/repairYouthOutliers2699.mjs --apply
//
// HVAD DER BEVARES: navn, nationalitet, fødselsdato, potentiale, krop, hvilket hold
// tilbuddet ligger hos, og rytterens PRIMÆRE type. Spilleren ser altså den samme
// rytter med den samme etiket — kun stats falder ned i båndet. Det er bevidst:
// disse 14 ligger i 10 spilleres akademier lige nu, og en sletning ville være
// 9/8-hændelsen om igen.
//
// HVAD DER ÆNDRES: stat_*-felterne regenereres med den NUVÆRENDE kalibrering via
// produktionens egen generateYouthStats, hvorefter deriveForRiderIds bygger
// physiology → evner → caps → type → base_value forfra. Rytteren får samtidig et
// persisteret archetype_draw (fast identitet, #3570/#3588), som ryttere fra før
// fase 2 mangler — så han ikke reklassificeres af en senere kørsel.
//
// UDVÆLGELSEN er ren: kun 'offered' intake-rækker hvis rytter er team-løs OG uden
// parkeret skifte (samme ejerskabs-lag som academyIntakeExpirySweep lærte 18/7).
// En rytter der er blevet ejet siden måling røres ALDRIG.
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

import { generateYouthStats } from "../../lib/academyGenerator.js";
import { makeRng } from "../../lib/fictionalRiderGenerator.js";
import { hashStringToSeed, fetchActiveSeason } from "../../lib/academyIntake.js";
import { seedPhysiologyFromLegacy } from "../../lib/physiologySeeding.js";
import { deriveAbilities } from "../../lib/abilityDerivation.js";
import { buildCapsForRider } from "../../lib/riderProgression.js";
import { resolveRiderTypes } from "../../lib/riderTypes.js";
import { selectTypesBaseline } from "../../lib/riderTypesBaselineSelect.js";
import { predictBaseValue } from "../../lib/riderValuation.js";
import { ageForSeason } from "../../lib/riderSeasonAge.js";
import { ACADEMY } from "../../lib/academyFlag.js";
import { deriveForRiderIds } from "../../lib/backfillCores.js";

const LIB = path.join(import.meta.dirname, "../../lib");
const typesBaseline = JSON.parse(fs.readFileSync(path.join(LIB, "riderTypesBaseline.json"), "utf8"));
const youthTypesBaseline = JSON.parse(fs.readFileSync(path.join(LIB, "riderTypesBaselineYouth.json"), "utf8"));
const valuationModel = JSON.parse(fs.readFileSync(path.join(LIB, "riderValuationModelV4.json"), "utf8"));

// Ungdomsbåndets G6-liste — identisk med archetypeGenerationGates.test.js.
const PHYSICAL_ABILITIES = Object.freeze([
  "climbing", "time_trial", "flat", "tempo", "sprint",
  "acceleration", "punch", "endurance", "recovery", "durability",
]);

const REPAIR_SEED_BASE = 2699;

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, "").split("=");
  return [k, v ?? true];
}));
const APPLY = args.apply === true;
const THRESHOLD = Number(args.threshold ?? 15); // bedste fysiske evne over dette = outlier

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Mangler SUPABASE secrets (kør via: infisical run --env=prod -- node ...)");
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const kr = (n) => (n == null ? "—" : Math.round(n).toLocaleString("da-DK"));
const bestOf = (ab) => Math.max(...PHYSICAL_ABILITIES.map((a) => Number(ab[a]) || 0));

async function main() {
  console.log(`\n═══ #2699 nedjustering af akademi-outliers — ${APPLY ? "APPLY" : "DRY-RUN"} ═══`);
  console.log(`Tærskel: bedste fysiske evne > ${THRESHOLD} (ungdomsbåndets G6-grænse)\n`);

  const season = await fetchActiveSeason(sb);
  if (!season) throw new Error("ingen aktiv sæson");

  // Alle ventende tilbud med ejerskabs-verificeret team-løs rytter.
  const { data: rows, error } = await sb
    .from("academy_intake")
    .select("id, team_id, rider_id, status, riders!inner(id, firstname, lastname, birthdate, potentiale, height, weight, nationality_code, primary_type, secondary_type, archetype_draw, market_value, team_id, pending_team_id, valuation_type), teams(name)")
    .eq("status", "offered");
  if (error) throw new Error(`intake lookup: ${error.message}`);

  const free = (rows || []).filter((r) => r.riders?.team_id === null && r.riders?.pending_team_id === null);
  const riderIds = free.map((r) => r.rider_id);

  const { data: abRows, error: abErr } = await sb
    .from("rider_derived_abilities").select("*").in("rider_id", riderIds);
  if (abErr) throw new Error(`abilities lookup: ${abErr.message}`);
  const abById = new Map((abRows || []).map((a) => [a.rider_id, a]));

  const outliers = free.filter((r) => {
    const ab = abById.get(r.rider_id);
    return ab && bestOf(ab) > THRESHOLD;
  });

  console.log(`Ventende tilbud (team-løse): ${free.length}`);
  console.log(`Heraf over ungdomsbåndet: ${outliers.length}\n`);
  if (!outliers.length) { console.log("Intet at gøre.\n"); return; }

  const plans = [];
  for (const row of outliers) {
    const r = row.riders;
    const seasonAge = ageForSeason(r.birthdate, season.number);
    // Stat-formlen bruger generatorens eget aldersinterval. En kandidat på 22 i
    // sæson-alder (arven fra #3611) ville ellers få ageLift over statCeil og
    // dermed en profil generatoren aldrig ville producere for en ungdomsrytter.
    const statAge = Math.min(Math.max(seasonAge, ACADEMY.MIN_AGE), ACADEMY.MAX_AGE);

    // Anlægget = rytterens NUVÆRENDE primære type, som rent anlæg. Spilleren ser
    // dermed ikke etiketten skifte — kun niveauet falder. (Rene anlæg er også det
    // ~85 % af nye kandidater trækker; hybrider er undtagelsen.)
    const draw = { primary: r.primary_type, secondary: null, isHybrid: false };

    const rng = makeRng(((REPAIR_SEED_BASE ^ hashStringToSeed(r.id)) >>> 0));
    const { stats } = generateYouthStats({
      rng, age: statAge, potentiale: r.potentiale, archetypeType: draw.primary,
    });

    // Spejl deriveForRiderIds på den NYE stat-profil.
    const nyRider = { ...r, ...stats, archetype_draw: draw };
    const nyAb = deriveAbilities(seedPhysiologyFromLegacy(nyRider), nyRider);
    const baseline = {};
    for (const k of PHYSICAL_ABILITIES) if (nyAb[k] != null) baseline[k] = Number(nyAb[k]);
    const nyCaps = buildCapsForRider(baseline, { potentiale: r.potentiale, age: seasonAge }, draw.primary, null);
    const rowModel = selectTypesBaseline(seasonAge, typesBaseline, youthTypesBaseline);
    const { primary, secondary } = resolveRiderTypes(draw, nyCaps, rowModel);
    const nyBaseValue = predictBaseValue({ ...nyRider, primary_type: primary.key, age: seasonAge }, nyAb, valuationModel);
    // riders.market_value er en GENERATED column (COALESCE(base_value, 1000)), så den
    // følger base_value af sig selv når deriveForRiderIds skriver. calculateRiderMarketValue
    // må IKKE bruges her: den returnerer et eksplicit market_value hvis feltet findes på
    // objektet, og rytterens GAMLE værdi ligger i spread'en — dry-runnet ville så vise
    // "uændret værdi" for hver eneste rytter, hvilket er præcis hvad det gjorde først.
    const nyMarket = nyBaseValue ?? 1000;

    const gammelAb = abById.get(r.id);
    plans.push({
      riderId: r.id,
      navn: `${r.firstname} ${r.lastname}`,
      hold: row.teams?.name ?? "?",
      alder: seasonAge,
      potentiale: r.potentiale,
      type: `${r.primary_type}${r.secondary_type ? "/" + r.secondary_type : ""}`,
      nyType: `${primary.key}${secondary?.key ? "/" + secondary.key : ""}`,
      foerEvne: bestOf(gammelAb),
      efterEvne: bestOf(nyAb),
      foerVaerdi: r.market_value,
      efterVaerdi: nyMarket,
      foerFee: Math.round((r.market_value ?? 0) * ACADEMY.SIGNING_FEE_RATE),
      efterFee: Math.round((nyMarket ?? 0) * ACADEMY.SIGNING_FEE_RATE),
      stats, draw,
    });
  }

  plans.sort((a, b) => b.foerEvne - a.foerEvne);

  console.log("FØR → EFTER (bedste fysiske evne / markedsværdi / signing fee)\n");
  console.log("Rytter                  Hold                    Alder Pot   Evne        Værdi                    Fee");
  console.log("─".repeat(108));
  for (const p of plans) {
    console.log(
      p.navn.padEnd(23).slice(0, 23),
      p.hold.padEnd(23).slice(0, 23),
      String(p.alder).padStart(4),
      String(p.potentiale).padStart(4),
      ` ${String(p.foerEvne).padStart(2)}→${String(p.efterEvne).padEnd(3)}`,
      `${kr(p.foerVaerdi).padStart(9)}→${kr(p.efterVaerdi).padEnd(8)}`,
      `${kr(p.foerFee).padStart(7)}→${kr(p.efterFee)}`
    );
  }

  const typeSkift = plans.filter((p) => p.type.split("/")[0] !== p.nyType.split("/")[0]);
  const stadigOver = plans.filter((p) => p.efterEvne > THRESHOLD);
  console.log("\n" + "─".repeat(108));
  console.log(`Ryttere berørt:            ${plans.length}`);
  console.log(`Hold berørt:               ${new Set(plans.map((p) => p.hold)).size}`);
  console.log(`Primær type ændret:        ${typeSkift.length} ${typeSkift.length === 0 ? "✅ (spilleren ser samme etiket)" : "⚠"}`);
  console.log(`Stadig over båndet efter:  ${stadigOver.length} ${stadigOver.length === 0 ? "✅" : "❌"}`);
  console.log(`Samlet værdi før:          ${kr(plans.reduce((s, p) => s + (p.foerVaerdi ?? 0), 0))}`);
  console.log(`Samlet værdi efter:        ${kr(plans.reduce((s, p) => s + (p.efterVaerdi ?? 0), 0))}`);
  console.log(`Ingen manager har betalt for dem — alle er stadig 'offered', ingen bud, intet ejerskab.`);

  if (!APPLY) {
    console.log("\nDRY-RUN — ingen writes. Kør igen med --apply.\n");
    return;
  }

  console.log("\nSkriver...");
  let n = 0;
  for (const p of plans) {
    // Re-verificér ejerskab lige før write (rytteren kan være signeret siden målingen).
    const { data: fresh, error: fErr } = await sb
      .from("riders").select("team_id, pending_team_id").eq("id", p.riderId).maybeSingle();
    if (fErr) throw new Error(`re-verify ${p.riderId}: ${fErr.message}`);
    if (!fresh || fresh.team_id !== null || fresh.pending_team_id !== null) {
      console.log(`  ⏭  ${p.navn}: ejet siden måling — springes over`);
      continue;
    }
    const { error: uErr } = await sb
      .from("riders")
      .update({ ...p.stats, archetype_draw: p.draw })
      .eq("id", p.riderId)
      .is("team_id", null)
      .is("pending_team_id", null);
    if (uErr) throw new Error(`update ${p.riderId}: ${uErr.message}`);
    n += 1;
  }

  console.log(`\nAfleder ${n} ryttere (physiology → evner → caps → type → base_value)...`);
  await deriveForRiderIds(sb, plans.map((p) => p.riderId), { dryRun: false });
  console.log(`\n✅ ${n} ryttere nedjusteret til ungdomsbåndet.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
