#!/usr/bin/env node
// #2917 · Backfill af sæson-achievements
//
// 13 achievements var defineret i `achievements` og synlige for spilleren, men
// ingen kode kunne tildele dem (0 tildelinger i prod 25/7). achievementEngine er
// nu wiret (fremadrettet), og dette script tildeler dem RETROSPEKTIVT for en
// afsluttet sæson, så sæson 1 ikke går tabt.
//
//   season_top10 · season_top5 · season_top3 · season_winner · season_div1_winner
//   season_div3_winner · season_3_top3 · season_2_seasons · season_5_seasons
//   team_promotion · team_relegation · team_survived · season_grand_tour_rider
//
// Default = DRY-RUN (read-only): printer præcis hvem der får hvad. --execute
// indsætter i manager_achievements.
//
// Idempotent: kriterierne er rene funktioner af season_standings + sæson-status +
// holdets nuværende division, og eksisterende (user_id, achievement_id)-par
// springes over. Tabellen har desuden en UNIQUE(user_id, achievement_id), så et
// dobbeltkørsel kan ikke dublere. Re-run er sikkert.
//
// VIGTIGT om rækkefølge: op/nedrykning (team_promotion / team_relegation /
// team_survived) udledes af FAKTISK divisionsskifte. Kører du scriptet FØR
// sæsonskiftet har flyttet holdene, er de tre nul — kør igen bagefter.
//
//   node scripts/backfillSeasonAchievements.js                        # dry-run
//   node scripts/backfillSeasonAchievements.js --execute              # skriver
//   node scripts/backfillSeasonAchievements.js --season=<uuid>        # anden sæson
//   node scripts/backfillSeasonAchievements.js --assume-final         # forhåndsvis
//   node scripts/backfillSeasonAchievements.js --list                 # hele navnelisten
//   node scripts/backfillSeasonAchievements.js --skip=team_survived   # udelad enkelte
//
// --skip findes til S1→S2-skiftet specifikt: dér flyttes holdene af pyramide-
// komprimeringen (#2851, global rangering) i stedet for den normale per-pulje
// op/nedrykning, så "farezonen" (team_survived) er en tilnærmelse netop den ene
// gang. Fra S2→S3 er kriteriet eksakt igen.
//   railway run --service CyclingZone -- node scripts/backfillSeasonAchievements.js

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAllRows } from "../lib/supabasePagination.js";
import { getAchievementUnlocks } from "../lib/achievementEngine.js";
import {
  GRAND_TOUR_MIN_STAGES,
  buildSeasonRowsForTeam,
  computeSeasonAchievementStats,
} from "../lib/seasonAchievements.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env"), quiet: true });

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.split("=").slice(1).join("=");
  if (process.argv.includes(`--${name}`)) return true;
  return fallback;
};

const SEASON_ID = arg("season", "00000000-0000-0000-0000-000000000001");
const EXECUTE = !!arg("execute", false);
const ASSUME_FINAL = !!arg("assume-final", false);
const LIST_ALL = !!arg("list", false);
const SKIPPED = new Set(
  String(arg("skip", "") === true ? "" : arg("skip", ""))
    .split(",").map((id) => id.trim()).filter(Boolean)
);

// De 13 achievements dette script ejer. Alt andet i `achievements` tildeles af
// den løbende motor (POST /api/achievements/check) og røres ikke her.
const ALL_SEASON_ACHIEVEMENT_IDS = [
  "season_top10", "season_top5", "season_top3", "season_winner",
  "season_div1_winner", "season_div3_winner", "season_3_top3",
  "season_2_seasons", "season_5_seasons",
  "team_promotion", "team_relegation", "team_survived",
  "season_grand_tour_rider",
];
const unknownSkips = [...SKIPPED].filter((id) => !ALL_SEASON_ACHIEVEMENT_IDS.includes(id));
if (unknownSkips.length) {
  console.error(`❌ --skip kender ikke: ${unknownSkips.join(", ")}`);
  process.exit(1);
}
const SEASON_ACHIEVEMENT_IDS = ALL_SEASON_ACHIEVEMENT_IDS.filter((id) => !SKIPPED.has(id));

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ SUPABASE_URL / SUPABASE_SERVICE_KEY mangler (kør via `railway run` eller backend/.env).");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const pad = (value, width) => String(value ?? "").padEnd(width);

console.log(`\n${"═".repeat(78)}`);
console.log(`SÆSON-ACHIEVEMENTS BACKFILL (#2917) ${EXECUTE ? "🔴 EXECUTE (skriver til prod)" : "🟢 DRY-RUN (read-only)"}`);
console.log("═".repeat(78));

// ─── 1 · Sæson + gate ────────────────────────────────────────────────────────

const { data: season, error: seasonErr } = await supabase
  .from("seasons").select("id, number, status, end_date").eq("id", SEASON_ID).maybeSingle();
if (seasonErr || !season) {
  console.error(`❌ Kunne ikke læse sæson ${SEASON_ID}: ${seasonErr?.message || "ikke fundet"}`);
  process.exit(1);
}
console.log(`Kilde-sæson: #${season.number} (status='${season.status}')`);
if (SKIPPED.size) console.log(`Udeladt via --skip: ${[...SKIPPED].join(", ")}`);

if (season.status !== "completed") {
  if (EXECUTE) {
    console.error(
      `❌ --execute kræver at sæson ${season.number} er 'completed'. `
      + "Placeringer tælles først når sæsonen ER slut — kør efter sæsonskiftet."
    );
    process.exit(1);
  }
  if (!ASSUME_FINAL) {
    console.log(
      `\n⚠️  Sæson ${season.number} kører stadig. Dry-run viser 0 tildelinger fordi ingen`
      + "\n   placering er endelig endnu. Brug --assume-final for at forhåndsvise resultatet"
      + "\n   med de nuværende stillinger som slutstilling.\n"
    );
  } else {
    console.log(
      `\n⚠️  --assume-final: sæson ${season.number} behandles som afsluttet (FORHÅNDSVISNING).`
      + "\n   Op/nedrykning + overlevelse afgøres af faktisk divisionsskifte og forbliver"
      + "\n   nul indtil sæsonskiftet har flyttet holdene.\n"
    );
  }
}

// ─── 2 · Load ────────────────────────────────────────────────────────────────

const [allSeasons, teams, standings, grandTours, existing, achievementDefs] = await Promise.all([
  fetchAllRows(() => supabase.from("seasons").select("id, number, status").order("number")),
  fetchAllRows(() => supabase.from("teams")
    .select("id, name, user_id, division, is_ai, is_bank, is_frozen, is_test_account")
    .order("id")),
  fetchAllRows(() => supabase.from("season_standings")
    .select("season_id, team_id, division, league_division_id, rank_in_division")
    .order("id")),
  fetchAllRows(() => supabase.from("races")
    .select("id").gte("stages", GRAND_TOUR_MIN_STAGES).order("id")),
  fetchAllRows(() => supabase.from("manager_achievements")
    .select("user_id, achievement_id").order("id")),
  fetchAllRows(() => supabase.from("achievements").select("id, title").order("id")),
]);

const seasonsById = new Map(
  allSeasons.map((row) => [
    row.id,
    // --assume-final gør KUN kilde-sæsonen "afsluttet"; øvrige sæsoner beholder
    // deres rigtige status, så en igangværende sæson 2 ikke pludselig tæller med.
    ASSUME_FINAL && row.id === SEASON_ID ? { ...row, status: "completed" } : row,
  ])
);

const grandTourRaceIds = new Set(grandTours.map((race) => race.id));
const gtTeamIds = new Set();
if (grandTourRaceIds.size) {
  // race_entries har PK (race_id, rider_id) og ingen id-kolonne — pagineringen
  // skal derfor sortere på netop de to (stabil orden er et krav i fetchAllRows).
  const gtEntries = await fetchAllRows(() => supabase.from("race_entries")
    .select("team_id, race_id")
    .in("race_id", [...grandTourRaceIds])
    .order("race_id").order("rider_id"));
  for (const entry of gtEntries) if (entry.team_id) gtTeamIds.add(entry.team_id);
}

const humanTeams = teams.filter((team) =>
  team.user_id && !team.is_ai && !team.is_bank && !team.is_frozen && !team.is_test_account);

const definitionById = new Map(achievementDefs.map((row) => [row.id, row]));
const missingDefs = SEASON_ACHIEVEMENT_IDS.filter((id) => !definitionById.has(id));
if (missingDefs.length) {
  console.error(`❌ Manglende achievement-definitioner i DB: ${missingDefs.join(", ")}`);
  process.exit(1);
}
// getAchievementUnlocks slår op i denne liste; kun de 13 er med, så scriptet
// aldrig kan tildele fx auction_first_bid ved et uheld.
const seasonDefs = SEASON_ACHIEVEMENT_IDS.map((id) => definitionById.get(id));

const alreadyUnlocked = new Map();
for (const row of existing) {
  if (!alreadyUnlocked.has(row.user_id)) alreadyUnlocked.set(row.user_id, new Set());
  alreadyUnlocked.get(row.user_id).add(row.achievement_id);
}

console.log(
  `Indlæst: ${humanTeams.length} menneske-hold · ${standings.length} standings-rækker · `
  + `${grandTourRaceIds.size} Grand Tours (≥${GRAND_TOUR_MIN_STAGES} etaper) · `
  + `${existing.length} eksisterende tildelinger`
);

// ─── 3 · Evaluér ─────────────────────────────────────────────────────────────

const awards = [];                       // { team, achievementId }
const perAchievement = new Map(SEASON_ACHIEVEMENT_IDS.map((id) => [id, []]));
let teamsWithStanding = 0;

for (const team of humanTeams) {
  const seasonRows = buildSeasonRowsForTeam({
    teamId: team.id,
    standings,
    seasonsById,
    currentDivision: team.division ?? null,
  });
  if (!seasonRows.length) continue;
  teamsWithStanding += 1;

  const stats = computeSeasonAchievementStats({
    seasonRows,
    hasGrandTourRider: gtTeamIds.has(team.id),
  });

  const unlocked = getAchievementUnlocks({
    achievements: seasonDefs,
    unlockedAchievementIds: [...(alreadyUnlocked.get(team.user_id) || [])],
    stats,
  });

  for (const achievement of unlocked) {
    awards.push({ team, achievementId: achievement.id });
    perAchievement.get(achievement.id).push(team);
  }
}

// ─── 4 · Rapport ─────────────────────────────────────────────────────────────

console.log(`\n── HVEM FÅR HVAD (${teamsWithStanding} hold med sæson-historik) ──`);
for (const id of SEASON_ACHIEVEMENT_IDS) {
  const recipients = perAchievement.get(id);
  const alreadyCount = [...alreadyUnlocked.values()].filter((set) => set.has(id)).length;
  console.log(
    `  ${pad(id, 26)} ${String(recipients.length).padStart(3)} nye`
    + `${alreadyCount ? ` (${alreadyCount} havde den i forvejen)` : ""}`
  );
  const shown = LIST_ALL ? recipients : recipients.slice(0, 8);
  for (const team of shown) console.log(`      · ${team.name}`);
  if (!LIST_ALL && recipients.length > shown.length) {
    console.log(`      … +${recipients.length - shown.length} mere (--list for hele listen)`);
  }
}
console.log(`\n  I ALT: ${awards.length} nye tildelinger til ${new Set(awards.map((a) => a.team.id)).size} hold.`);

if (!awards.length) {
  console.log("\n✅ Intet at gøre (alt er allerede tildelt, eller ingen kvalificerer sig endnu).");
  process.exit(0);
}

if (!EXECUTE) {
  console.log("\n🟢 DRY-RUN — intet skrevet. Kør igen med --execute for at tildele.");
  process.exit(0);
}

// ─── 5 · Skriv ───────────────────────────────────────────────────────────────

// unlocked_at = sæsonens slutdato, ikke kørselstidspunktet: badget hører til den
// sæson det blev fortjent i, og "Senest låst op" på managerprofilen bliver dermed
// ikke oversvømmet af 13 identiske tidsstempler fra selve backfill-kørslen.
const unlockedAt = season.end_date
  ? new Date(season.end_date).toISOString()
  : new Date().toISOString();

let inserted = 0;
let skipped = 0;
let failed = 0;
for (const award of awards) {
  const { error } = await supabase.from("manager_achievements").insert({
    user_id: award.team.user_id,
    achievement_id: award.achievementId,
    unlocked_at: unlockedAt,
  });
  if (!error) {
    inserted += 1;
  } else if (/duplicate key|23505/i.test(error.message || "")) {
    // UNIQUE(user_id, achievement_id) — allerede tildelt (parallel kørsel/re-run).
    skipped += 1;
  } else {
    failed += 1;
    console.error(`  ⚠️ ${award.team.name} / ${award.achievementId}: ${error.message}`);
  }
}

console.log(`\n── SKREVET ──`);
console.log(`  ✅ ${inserted} indsat · ${skipped} allerede tildelt · ${failed} fejlede`);

// ─── 6 · Post-verifikation ───────────────────────────────────────────────────

const after = await fetchAllRows(() => supabase.from("manager_achievements")
  .select("user_id, achievement_id")
  .in("achievement_id", SEASON_ACHIEVEMENT_IDS)
  .order("id"));
const afterCounts = new Map(SEASON_ACHIEVEMENT_IDS.map((id) => [id, 0]));
for (const row of after) afterCounts.set(row.achievement_id, (afterCounts.get(row.achievement_id) || 0) + 1);

console.log(`\n── VERIFIKATION (tildelinger i DB nu) ──`);
for (const id of SEASON_ACHIEVEMENT_IDS) {
  console.log(`  ${pad(id, 26)} ${String(afterCounts.get(id)).padStart(3)}`);
}
if (failed > 0) {
  console.error(`\n❌ ${failed} indsættelser fejlede — scriptet er idempotent, kør igen.`);
  process.exit(1);
}
console.log("\n✅ Backfill færdig.");
