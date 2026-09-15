#!/usr/bin/env node
// #4619 · Backfill af riders.squad (trup-datamodel slice 1).
//
// HVORFOR ET NODE-SCRIPT OG IKKE SQL
// Reglen hviler på SÆSONALDER, og sæsonalderen beregnes ALDRIG i SQL.
// backend/lib/riderSeasonAge.js er SSOT (#3071/#3081: fire kopier af formlen,
// to prod-bugs — 121 ryttere fik ét peak i stedet for to, og frontend/backend
// var uenige om alderen fra sæson 2). Dette script IMPORTERER SSOT'en gennem
// backend/lib/squads.js; der findes ikke en kopi af formlen her.
//
// REGLEN (spec 2026-09-15 §3.2, YOUTH_RULES §2.1)
//   is_academy = true  OG sæsonalder ≤ 18  → junior
//   is_academy = true  OG sæsonalder 19-22 → u23
//   is_academy = true  OG sæsonalder ≥ 23  → u23 + pending academy_graduation
//                                             (from_squad u23, to_squad senior)
//   alt andet                              → senior
// Eksisterende academy_graduation-rækker uden trup-felter backfilles u23 → senior.
//
// Den ≥ 23-årige lander i u23 og IKKE i senior med vilje: han er ikke senior
// endnu, han er en U23-rytter der er vokset ud og skal igennem Graduation Day
// (samme valg som §2.2's default-kæde: op hvis plads og råd, ellers sælg,
// ellers slip). Ville vi sætte ham direkte til senior, sprang vi managerens
// override-vindue over og lagde løn på holdet uden at spørge.
//
// IDEMPOTENT: mål-truppen udledes fra fødselsdato + sæson, ikke fra den
// nuværende værdi. Anden kørsel finder 0 ryttere at ændre og 0 rækker at
// oprette (graduerings-rækkerne er beskyttet af UNIQUE(rider_id, season_id) OG
// af et eksplicit opslag). Testet i backfill-4619-riders-squad.test.js.
//
// Usage:
//   node backend/scripts/backfill-4619-riders-squad.js --dry-run           # default, READ-ONLY
//   node backend/scripts/backfill-4619-riders-squad.js --dry-run --json
//   node backend/scripts/backfill-4619-riders-squad.js --apply --owner-go  # KRÆVER EJER-GO
//
// --apply skriver mod prod og er gated bag BEGGE flag. Kør ALDRIG --apply uden
// et eksplicit go på netop de tal dry-run'en har vist ejeren
// (feedback_explicit_go_per_prod_step). Migrationen
// database/2026-09-15-4619-riders-squad.sql SKAL være applied først — den
// opretter både kolonnen og snapshot-tabellen dette script skriver i.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY (service-role). Læses fra backend/.env.
// Exit: 0 = ok, 1 = dry-run fandt ryttere der skal ændres (så en CI-kørsel kan
//       se forskel), 2 = kald-/konfigurationsfejl.

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ageForSeason } from "../lib/riderSeasonAge.js";
import { academySquadForSeasonAge, SQUAD_CAPS, isYouthSquad, DEFAULT_SQUAD } from "../lib/squads.js";
import { fetchAllRows } from "../lib/supabasePagination.js";
import { graduationDeadlineFrom } from "../lib/academyGraduation.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
dotenv.config({ path: join(REPO_ROOT, "backend", ".env"), quiet: true });

export const SNAPSHOT_TABLE = "riders_4619_squad_backup_20260915";
const UPDATE_CHUNK = 200;

/**
 * Mål-truppen for ÉN rytter. Ren funktion — hele reglen bor her, så dry-run og
 * apply umuligt kan vælge forskellige ryttere (den værste fejlklasse i et
 * reparations-script, læring 3/9).
 *
 * @param {{is_academy?:boolean, birthdate?:string|null}} rider
 * @param {number} seasonNumber
 * @returns {{squad:string, seasonAge:number|null, needsGraduation:boolean}}
 */
export function targetSquadFor(rider, seasonNumber) {
  const seasonAge = ageForSeason(rider?.birthdate, seasonNumber);
  if (rider?.is_academy !== true) return { squad: DEFAULT_SQUAD, seasonAge, needsGraduation: false };

  // En akademirytter UDEN brugbar fødselsdato kan ikke placeres på alder. Han
  // bliver i akademiets nederste trin (junior) i stedet for at blive gættet op
  // eller tavst sendt til senior — begge dele ville flytte ham ud af akademiet
  // på et gæt. Antallet rapporteres separat i dry-run'en.
  const squad = academySquadForSeasonAge(seasonAge) ?? "junior";
  return {
    squad,
    seasonAge,
    needsGraduation: Number.isFinite(seasonAge) && seasonAge >= 23,
  };
}

/**
 * Byg HELE planen ud af en population. Ren funktion uden I/O, så idempotensen
 * kan testes uden en database: kør plan → anvend patcherne på fixturen → kør
 * plan igen → 0 ændringer.
 *
 * @param {{riders:Array, teams:Array, graduations:Array, seasonNumber:number, now?:Date}} args
 */
export function planSquadBackfill({ riders = [], teams = [], graduations = [], seasonNumber, now = new Date() } = {}) {
  if (!Number.isFinite(seasonNumber)) throw new Error("planSquadBackfill: seasonNumber required");

  const teamName = new Map(teams.map((t) => [t.id, t.name ?? t.id]));
  // En rytter har HØJST én pending-række; opslaget er (rider_id, season_id) og
  // vi arbejder kun i den aktive sæson.
  const pendingRiderIds = new Set(
    graduations.filter((g) => g.status === "pending").map((g) => g.rider_id),
  );

  const riderUpdates = [];
  const snapshotRows = [];
  const newGraduations = [];
  const perTeam = new Map();
  const totals = { senior: 0, u23: 0, junior: 0 };
  let missingBirthdate = 0;
  let outgrownU23 = 0;

  for (const r of riders) {
    const { squad, seasonAge, needsGraduation } = targetSquadFor(r, seasonNumber);
    totals[squad] = (totals[squad] ?? 0) + 1;
    if (r.is_academy === true && !Number.isFinite(seasonAge)) missingBirthdate++;

    if (isYouthSquad(squad) && r.team_id) {
      if (!perTeam.has(r.team_id)) perTeam.set(r.team_id, { teamId: r.team_id, name: teamName.get(r.team_id) ?? r.team_id, u23: 0, junior: 0 });
      perTeam.get(r.team_id)[squad]++;
    }

    const derivedIsAcademy = isYouthSquad(squad);
    if (r.squad !== squad || r.is_academy !== derivedIsAcademy) {
      riderUpdates.push({ id: r.id, squad, is_academy: derivedIsAcademy });
      snapshotRows.push({ rider_id: r.id, squad_before: r.squad ?? null, is_academy_before: r.is_academy ?? null });
    }

    if (needsGraduation) {
      outgrownU23++;
      // academy_graduation.team_id er NOT NULL — en strandet akademi-fri-agent
      // (invariant D, #2257) kan ikke få en række og hører ikke til her.
      if (r.team_id && !pendingRiderIds.has(r.id)) {
        newGraduations.push({
          team_id: r.team_id, rider_id: r.id, status: "pending",
          deadline: graduationDeadlineFrom(now),
          from_squad: "u23", to_squad: "senior",
        });
      }
    }
  }

  // Eksisterende rækker uden trup-felter: den ENE overgang der fandtes før
  // #4619 var akademi → senior, og den hedder nu u23 → senior.
  const graduationBackfills = graduations
    .filter((g) => g.from_squad == null || g.to_squad == null)
    .map((g) => ({ id: g.id, from_squad: "u23", to_squad: "senior" }));

  const overCap = [...perTeam.values()]
    .flatMap((t) => [
      t.u23 > SQUAD_CAPS.u23 ? { team: t.name, teamId: t.teamId, squad: "u23", count: t.u23, cap: SQUAD_CAPS.u23 } : null,
      t.junior > SQUAD_CAPS.junior ? { team: t.name, teamId: t.teamId, squad: "junior", count: t.junior, cap: SQUAD_CAPS.junior } : null,
    ])
    .filter(Boolean)
    .sort((a, b) => b.count - a.count || a.team.localeCompare(b.team));

  return {
    seasonNumber,
    totals,
    perTeam: [...perTeam.values()].sort((a, b) => a.name.localeCompare(b.name)),
    overCap,
    riderUpdates,
    snapshotRows,
    newGraduations,
    graduationBackfills,
    stats: {
      ridersScanned: riders.length,
      ridersChanging: riderUpdates.length,
      outgrownU23,
      pendingGraduationsToCreate: newGraduations.length,
      graduationRowsToBackfill: graduationBackfills.length,
      academyRidersWithoutBirthdate: missingBirthdate,
    },
  };
}

// ── I/O ──────────────────────────────────────────────────────────────────────

async function loadPopulation(supabase) {
  const { data: season, error: seasonErr } = await supabase
    .from("seasons").select("id, number").eq("status", "active").maybeSingle();
  if (seasonErr) throw new Error(`aktiv saeson: ${seasonErr.message}`);
  if (!season) throw new Error("ingen aktiv saeson (seasons.status='active') - kan ikke regne saesonalder");

  // Dry-run'en skal kunne køres FØR migrationen er applied — ejeren ser tallene
  // før merge, og auto-migrate.yml kører først ved merge (#2642). Mangler
  // kolonnerne endnu, læser vi uden dem og lader dem stå på den værdi
  // migrationens DEFAULT vil give ('senior' / NULL), så planen bliver præcis
  // den samme som efter migrationen. `preMigration` rapporteres, så ingen tror
  // at tallene er målt mod det nye skema.
  let preMigration = false;
  let riders;
  try {
    riders = await fetchAllRows(() =>
      supabase.from("riders")
        .select("id, team_id, firstname, lastname, birthdate, is_academy, squad, is_retired")
        .order("id"));
  } catch (err) {
    if (!isUndefinedColumn(err)) throw err;
    preMigration = true;
    const raw = await fetchAllRows(() =>
      supabase.from("riders")
        .select("id, team_id, firstname, lastname, birthdate, is_academy, is_retired")
        .order("id"));
    riders = raw.map((r) => ({ ...r, squad: DEFAULT_SQUAD }));
  }

  const teams = await fetchAllRows(() => supabase.from("teams").select("id, name").order("id"));

  let graduations;
  try {
    graduations = await fetchAllRows(() =>
      supabase.from("academy_graduation")
        .select("id, rider_id, team_id, season_id, status, from_squad, to_squad")
        .eq("season_id", season.id)
        .order("id"));
  } catch (err) {
    if (!isUndefinedColumn(err)) throw err;
    preMigration = true;
    const raw = await fetchAllRows(() =>
      supabase.from("academy_graduation")
        .select("id, rider_id, team_id, season_id, status")
        .eq("season_id", season.id)
        .order("id"));
    graduations = raw.map((g) => ({ ...g, from_squad: null, to_squad: null }));
  }

  return { season, riders, teams, graduations, preMigration };
}

// PostgREST svarer 42703 "column ... does not exist" når migrationen endnu ikke
// er applied. fetchAllRows kaster en Error uden `code`, så beskeden er det vi har.
function isUndefinedColumn(err) {
  return err?.code === "42703" || /column .* does not exist/i.test(err?.message || "");
}

function printReport(plan, { json = false } = {}) {
  if (json) {
    console.log(JSON.stringify({
      seasonNumber: plan.seasonNumber,
      totals: plan.totals,
      stats: plan.stats,
      overCap: plan.overCap,
      perTeam: plan.perTeam,
    }, null, 2));
    return;
  }

  const s = plan.stats;
  console.log("");
  console.log(`#4619 backfill riders.squad - saeson ${plan.seasonNumber}`);
  console.log("=".repeat(64));
  if (plan.preMigration) {
    console.log("  (migrationen er IKKE applied endnu - squad laest som DEFAULT 'senior')");
  }
  console.log(`  Ryttere scannet ............... ${s.ridersScanned}`);
  console.log("");
  console.log("  MAAL-TRUP (alle ryttere)");
  console.log(`    senior ...................... ${plan.totals.senior ?? 0}`);
  console.log(`    u23 ......................... ${plan.totals.u23 ?? 0}`);
  console.log(`    junior ...................... ${plan.totals.junior ?? 0}`);
  console.log("");
  console.log(`  Raekker der aendres ........... ${s.ridersChanging}`);
  console.log(`  >= 23-aarige i akademiet ...... ${s.outgrownU23}  (faar pending graduation: ${s.pendingGraduationsToCreate})`);
  console.log(`  Grad-raekker der backfilles ... ${s.graduationRowsToBackfill}  (u23 -> senior)`);
  if (s.academyRidersWithoutBirthdate > 0) {
    console.log(`  ⚠ akademiryttere uden fodselsdato: ${s.academyRidersWithoutBirthdate} (placeres i junior, ikke gaettet op)`);
  }
  console.log("");
  console.log(`  HOLD OVER LOFT (u23 ${SQUAD_CAPS.u23} / junior ${SQUAD_CAPS.junior})`);
  if (plan.overCap.length === 0) {
    console.log("    ingen");
  } else {
    for (const o of plan.overCap) {
      console.log(`    ${o.team.padEnd(28)} ${o.squad.padEnd(7)} ${o.count} / ${o.cap}  (+${o.count - o.cap})`);
    }
  }
  console.log("");
  const withYouth = plan.perTeam.filter((t) => t.u23 + t.junior > 0);
  console.log(`  HOLD MED UNGDOMSRYTTERE (${withYouth.length})`);
  for (const t of withYouth) {
    console.log(`    ${t.name.padEnd(28)} u23 ${String(t.u23).padStart(2)}   junior ${String(t.junior).padStart(2)}`);
  }
  console.log("");
}

async function applyPlan(supabase, plan) {
  // 1) SNAPSHOT FØR SKRIVNING. Rollback-kilden; ON CONFLICT DO NOTHING, så en
  //    gentagen kørsel ikke overskriver den oprindelige "før"-værdi med en
  //    allerede-ændret værdi.
  if (plan.snapshotRows.length > 0) {
    for (let i = 0; i < plan.snapshotRows.length; i += UPDATE_CHUNK) {
      const chunk = plan.snapshotRows.slice(i, i + UPDATE_CHUNK);
      const { error } = await supabase.from(SNAPSHOT_TABLE)
        .upsert(chunk, { onConflict: "rider_id", ignoreDuplicates: true });
      if (error) throw new Error(`snapshot: ${error.message}`);
    }
    console.log(`  snapshot: ${plan.snapshotRows.length} raekker gemt i ${SNAPSHOT_TABLE}`);
  }

  // 2) Ryttere. Én update pr. rytter — squad og is_academy skrives SAMMEN
  //    (is_academy er afledt af squad, spec §3.2).
  let updated = 0;
  for (const u of plan.riderUpdates) {
    const { error } = await supabase.from("riders")
      .update({ squad: u.squad, is_academy: u.is_academy })
      .eq("id", u.id);
    if (error) throw new Error(`rider ${u.id}: ${error.message}`);
    updated++;
  }
  console.log(`  ryttere opdateret: ${updated}`);

  // 3) Eksisterende grad-raekker faar trup-felterne.
  for (const g of plan.graduationBackfills) {
    const { error } = await supabase.from("academy_graduation")
      .update({ from_squad: g.from_squad, to_squad: g.to_squad })
      .eq("id", g.id);
    if (error) throw new Error(`graduation ${g.id}: ${error.message}`);
  }
  console.log(`  grad-raekker backfillet: ${plan.graduationBackfills.length}`);

  // 4) Pending-raekker for de >= 23-aarige. UNIQUE(rider_id, season_id) er den
  //    egentlige idempotens-garanti; en tabt race er "en anden naaede det
  //    foerst", ikke en fejl (samme behandling som openGraduationWindow).
  let created = 0, duplicates = 0;
  for (const row of plan.newGraduations) {
    const { error } = await supabase.from("academy_graduation").insert(row);
    if (error) {
      if (error.code === "23505" || /duplicate key value/i.test(error.message || "")) { duplicates++; continue; }
      throw new Error(`graduation insert (${row.rider_id}): ${error.message}`);
    }
    created++;
  }
  console.log(`  pending graduations oprettet: ${created} (dubletter sprunget over: ${duplicates})`);
  console.log("");
  console.log("  ⚠ INGEN notifikationer sendt. Managerne faar deres Graduation Day-besked");
  console.log("    af det naeste academyGraduationSweep-tick (#5133's efter-levering).");
}

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const apply = args.includes("--apply");
  const ownerGo = args.includes("--owner-go");

  if (apply && !ownerGo) {
    console.error("--apply kraever OGSAA --owner-go. Koer dry-run foerst og faa ejerens go paa netop de tal.");
    process.exit(2);
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error("SUPABASE_URL + SUPABASE_SERVICE_KEY mangler (backend/.env).");
    process.exit(2);
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { season, riders, teams, graduations, preMigration } = await loadPopulation(supabase);
  const plan = planSquadBackfill({ riders, teams, graduations, seasonNumber: season.number });
  plan.preMigration = preMigration;

  printReport(plan, { json });

  if (apply && preMigration) {
    console.error("STOP: riders.squad findes ikke endnu. Apply database/2026-09-15-4619-riders-squad.sql foerst.");
    process.exit(2);
  }

  if (!apply) {
    if (!json) console.log("DRY-RUN (read-only). Intet skrevet. Apply: --apply --owner-go\n");
    process.exit(plan.stats.ridersChanging > 0 ? 1 : 0);
  }

  console.log("APPLY (--owner-go givet)");
  await applyPlan(supabase, plan);
  process.exit(0);
}

// Kun når filen køres direkte — testen importerer de rene funktioner.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((err) => {
    console.error(err?.message || err);
    process.exit(2);
  });
}
