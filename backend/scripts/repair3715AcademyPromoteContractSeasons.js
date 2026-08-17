// Reparation #3715 — de ryttere hvis kontrakt blev forkortet af #3620-regressionen,
// FØR kode-fixet (PR #3698, merget 2026-08-14T06:18:02Z).
//
// ROD-ÅRSAG (verificeret i git-historik + kode, se PR-beskrivelsen for fuld udredning):
//
//   PROMOTE (academyTransfer.js promote()): PR #2929 (a13bf3d4, 2026-07-25T12:00:13Z)
//   rettede #2881 ved at lade promote() bruge contractOnAcquirePatch. 3 sekunder
//   senere udvidede PR #2933 (209607ed, 2026-07-25T12:00:16Z) selve guarden fra
//   `salary != null` til `salary != null && contract_end_season != null` — men
//   promote()'s SELECT hentede aldrig contract_end_season, så guarden blev
//   PERMANENT falsk på netop den sti (`undefined != null` === false). Enhver
//   promote() i vinduet regenererede derfor kontrakten ubetinget: længde 3 → 2,
//   udløb → aktiv sæson + 1. Fixet af PR #3698 (602197f3, 2026-08-14T06:18:02Z).
//
//   DEMOTE (samme fil, demote()): skrev UBETINGET en frisk 3-sæsoners akademi-
//   kontrakt forankret i den AKTUELLE sæson, siden funktionen blev født (commit
//   3bad21e9, 2026-06-25T20:45:27Z — #932/#1883). Ingen kode-ændring rørte dette
//   før SAMME #3698-fix. Vinduet er derfor hele beta'en frem til 14/8, ikke kun
//   siden 25/7.
//
// AFGRÆNSNING (se PR-beskrivelsen for fuld metode + tal):
//
//   PROMOTE-siden er DETERMINISTISK reparerbar for en afgrænset delmængde: en
//   rytter der (a) viser bug-signaturen (contract_length=2, contract_end_season=3),
//   (b) ALDRIG blev demoted før denne promotion (så akademi-kontrakten kun blev
//   sat ÉN gang, ved intake-signering — aldrig rørt af den OGSÅ-buggede demote()),
//   og (c) har en 'signed' academy_intake-række vi kan finde sæson-nummeret for.
//   Academy-intake-stien (finalize_academy_acquisition) var ALDRIG en del af
//   #3620-bugget, så intake-sæsonen giver et 100% deterministisk facit:
//   contract_end_season = intake_sæson + 2 (ACADEMY.CONTRACT_LENGTH=3).
//
//   Alt andet er USIKKERT og røres IKKE af denne migration:
//   - Ryttere med en tidligere academy_demoted-notifikation (deres akademi-
//     kontrakt kan selv være korrumperet af den samme demote-bug — vi kan ikke
//     bevise et facit for dem).
//   - Ryttere uden noget entry-path-signal overhovedet.
//   - HELE demote-siden: der findes INGEN kontrakt-historik-tabel og INGEN log
//     over #1720-kontraktforlængelser, så en rytters kontrakt-udløb LIGE FØR en
//     demotion kan ikke rekonstrueres. Se PR-beskrivelsen for kandidat-pool-tal.
//
// KØR ALDRIG mod prod uden ejer-godkendelse:
//   node scripts/repair3715AcademyPromoteContractSeasons.js
//       → dry-run: viser kandidater + før/efter + skriver CSV/JSON-dump. Intet skrives.
//   node scripts/repair3715AcademyPromoteContractSeasons.js --apply --confirm "REPAIR 3715 CONTRACT SEASONS"
//       → RIGTIG kørsel. Kræver DESUDEN REPAIR_3715_OWNER_ACK=true i miljøet.
//         JSON-backup (før-værdier) skrives FØR UPDATE. Idempotent: WHERE-
//         prædikatet matcher 0 rækker efter første succesfulde kørsel.

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { writeFileSync, mkdirSync } from "fs";
import { ACADEMY } from "../lib/academyFlag.js";
import { CONTRACT } from "../lib/contractSeed.js";

// #3620 bug-vindue for promote() (se filens header for kilder).
export const PROMOTE_BUG_START = "2026-07-25T12:00:16Z"; // PR #2933 merge — guarden blev permanent falsk
export const PROMOTE_BUG_END = "2026-08-14T06:18:02Z";   // PR #3698 merge — rettet

const BUGGY_LENGTH = CONTRACT.DEFAULT_ACQUIRE_LENGTH; // 2
const CORRECT_LENGTH = ACADEMY.CONTRACT_LENGTH;        // 3

async function fetchAll(supabase, table, apply) {
  const out = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const q = apply(supabase.from(table).select("*")).range(from, from + PAGE - 1);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

/**
 * Finder + (valgfrit) reparerer de deterministisk-reparerbare promote-bug-ofre.
 * @returns {Promise<{repairable: object[], uncertain: object[], applied: boolean, backupPath?: string}>}
 */
export async function repair3715AcademyPromoteContractSeasons({
  supabase, dryRun = true, now = new Date(), log = console.log,
}) {
  // 1) Alle academy_promoted-notifikationer i bug-vinduet, seneste pr. rytter.
  const promoNotifs = await fetchAll(supabase, "notifications", (q) =>
    q.eq("type", "academy_promoted").gte("created_at", PROMOTE_BUG_START).lt("created_at", PROMOTE_BUG_END));
  const latestByRider = new Map();
  for (const n of promoNotifs) {
    const prev = latestByRider.get(n.related_id);
    if (!prev || n.created_at > prev.created_at) latestByRider.set(n.related_id, n);
  }
  const riderIds = [...latestByRider.keys()];
  log(`Promote-notifikationer i bug-vinduet (${PROMOTE_BUG_START} → ${PROMOTE_BUG_END}): ${promoNotifs.length} rækker, ${riderIds.length} distinkte ryttere`);
  if (!riderIds.length) { log("intet at reparere"); return { repairable: [], uncertain: [], applied: false }; }

  // 2) Nuværende rytter-tilstand + team-flags (ekskludér AI/bank/frosne/test).
  const riders = await fetchAll(supabase, "riders", (q) => q.in("id", riderIds));
  const ridersById = new Map(riders.map((r) => [r.id, r]));
  const teamIds = [...new Set(riders.map((r) => r.team_id).filter(Boolean))];
  const teams = await fetchAll(supabase, "teams", (q) => q.in("id", teamIds));
  const teamsById = new Map(teams.map((t) => [t.id, t]));

  // 3) Bug-signatur-kandidater: contract_length=2 AND contract_end_season=3.
  const candidates = riderIds
    .map((id) => ({ riderId: id, promotedAt: latestByRider.get(id).created_at, rider: ridersById.get(id) }))
    .filter((c) => c.rider && c.rider.contract_length === BUGGY_LENGTH && c.rider.contract_end_season === 3)
    .filter((c) => {
      const t = c.rider.team_id ? teamsById.get(c.rider.team_id) : null;
      return t && !t.is_ai && !t.is_bank && !t.is_frozen && !t.is_test_account;
    });
  log(`Bug-signatur (length=${BUGGY_LENGTH}, end=3), ægte spillerhold: ${candidates.length}`);

  // 4) Entry-path-signaler: prior academy_demoted (usikker) + signed academy_intake (deterministisk anker).
  const demoteNotifs = await fetchAll(supabase, "notifications", (q) =>
    q.eq("type", "academy_demoted").in("related_id", candidates.map((c) => c.riderId)));
  const priorDemoteByRider = new Map();
  for (const n of demoteNotifs) {
    if (!priorDemoteByRider.has(n.related_id)) priorDemoteByRider.set(n.related_id, []);
    priorDemoteByRider.get(n.related_id).push(n.created_at);
  }

  const intakeRows = await fetchAll(supabase, "academy_intake", (q) =>
    q.eq("status", "signed").in("rider_id", candidates.map((c) => c.riderId)));
  const seasonIds = [...new Set(intakeRows.map((r) => r.season_id).filter(Boolean))];
  const seasons = await fetchAll(supabase, "seasons", (q) => q.in("id", seasonIds));
  const seasonNumberById = new Map(seasons.map((s) => [s.id, s.number]));
  const intakeByRider = new Map();
  for (const row of intakeRows) {
    if (!intakeByRider.has(row.rider_id)) intakeByRider.set(row.rider_id, []);
    intakeByRider.get(row.rider_id).push(row);
  }

  const repairable = [];
  const uncertain = [];
  for (const c of candidates) {
    const priorDemotes = (priorDemoteByRider.get(c.riderId) || []).filter((t) => t < c.promotedAt);
    const hadPriorDemote = priorDemotes.length > 0;
    const intakes = (intakeByRider.get(c.riderId) || [])
      .filter((r) => r.created_at < c.promotedAt)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1)); // seneste først
    const latestIntake = intakes[0];
    const intakeSeasonNumber = latestIntake ? seasonNumberById.get(latestIntake.season_id) : null;

    if (!hadPriorDemote && intakeSeasonNumber != null) {
      const correctEndSeason = intakeSeasonNumber + (CORRECT_LENGTH - 1);
      repairable.push({
        riderId: c.riderId,
        teamId: c.rider.team_id,
        promotedAt: c.promotedAt,
        intakeSeasonNumber,
        before: { contract_length: c.rider.contract_length, contract_end_season: c.rider.contract_end_season, salary: c.rider.salary },
        after: { contract_length: CORRECT_LENGTH, contract_end_season: correctEndSeason },
        seasonRestored: correctEndSeason - c.rider.contract_end_season,
      });
    } else {
      uncertain.push({
        riderId: c.riderId,
        teamId: c.rider.team_id,
        promotedAt: c.promotedAt,
        reason: hadPriorDemote
          ? "prior_academy_demoted — akademi-kontrakten kan selv være korrumperet af demote-bugget, intet sikkert facit"
          : "no_entry_path_signal — hverken signed academy_intake eller prior academy_demoted fundet",
        current: { contract_length: c.rider.contract_length, contract_end_season: c.rider.contract_end_season, salary: c.rider.salary },
      });
    }
  }

  const seasonsRestored = repairable.filter((r) => r.seasonRestored > 0).length;
  const lengthOnlyFixes = repairable.filter((r) => r.seasonRestored === 0).length;

  log(`\n── Reparerbar (deterministisk, via signed academy_intake) ── ${repairable.length}`);
  for (const r of repairable) {
    log(`  ${r.riderId}  intake-sæson ${r.intakeSeasonNumber}  længde ${r.before.contract_length}→${r.after.contract_length}  udløb ${r.before.contract_end_season}→${r.after.contract_end_season}${r.seasonRestored > 0 ? `  (+${r.seasonRestored} sæson)` : "  (kun længde, udløb uændret)"}`);
  }
  log(`\n── Usikker (IKKE rørt) ── ${uncertain.length}`);
  for (const u of uncertain) {
    log(`  ${u.riderId}  ${u.reason}`);
  }
  log(`\nSammendrag: ${repairable.length} reparerbare (${seasonsRestored} med reel sæson-korrektion, ${lengthOnlyFixes} kun længde-korrektion) · ${uncertain.length} usikre, ikke rørt`);

  // Dump til fil, altid (dry-run og apply).
  const outDir = join(dirname(fileURLToPath(import.meta.url)), "backups");
  mkdirSync(outDir, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const jsonPath = join(outDir, `repair-3715-academy-contract-seasons-${stamp}.json`);
  writeFileSync(jsonPath, JSON.stringify({ generatedAt: now.toISOString(), repairable, uncertain }, null, 2));
  const csvLines = ["rider_id,team_id,promoted_at,intake_season,before_length,before_end,after_length,after_end,season_restored"];
  for (const r of repairable) {
    csvLines.push([r.riderId, r.teamId, r.promotedAt, r.intakeSeasonNumber, r.before.contract_length, r.before.contract_end_season, r.after.contract_length, r.after.contract_end_season, r.seasonRestored].join(","));
  }
  const csvPath = join(outDir, `repair-3715-academy-contract-seasons-${stamp}.csv`);
  writeFileSync(csvPath, csvLines.join("\n"));
  log(`\ndump skrevet: ${jsonPath}`);
  log(`dump skrevet: ${csvPath}`);

  if (dryRun || !repairable.length) {
    log(dryRun ? "\nDRY-RUN — ingen writes. Kør med --apply (+ --confirm) EFTER ejer-godkendelse." : "\nIntet reparerbart at skrive.");
    return { repairable, uncertain, applied: false, jsonPath, csvPath };
  }

  // ── APPLY ──────────────────────────────────────────────────────────────────
  // Backup FØR UPDATE (før-værdier, samme fil som dry-run-dumpet — allerede skrevet ovenfor).
  let updated = 0;
  for (const r of repairable) {
    // Idempotent: WHERE matcher kun rækker der STADIG viser bug-signaturen.
    const { data, error } = await supabase
      .from("riders")
      .update({ contract_length: r.after.contract_length, contract_end_season: r.after.contract_end_season })
      .eq("id", r.riderId)
      .eq("contract_length", BUGGY_LENGTH)
      .eq("contract_end_season", 3)
      .select("id");
    if (error) throw new Error(`update ${r.riderId}: ${error.message}`);
    if (data && data.length) updated++;
  }
  log(`\nOpdateret: ${updated}/${repairable.length} rækker (resten matchede ikke længere prædikatet — allerede rettet eller ændret siden dry-run).`);

  // Post-verify: 0 tilbage med bug-signaturen blandt de reparerede rider-id'er.
  const postCheck = await fetchAll(supabase, "riders", (q) =>
    q.in("id", repairable.map((r) => r.riderId)).eq("contract_length", BUGGY_LENGTH).eq("contract_end_season", 3));
  log(`Post-verify: ${postCheck.length} af de ${repairable.length} reparerede rider-id'er viser STADIG bug-signaturen (forventet: 0).`);

  return { repairable, uncertain, applied: true, updated, jsonPath, csvPath, postCheckRemaining: postCheck.length };
}

if (process.argv[1] && process.argv[1].endsWith("repair3715AcademyPromoteContractSeasons.js")) {
  const __envdir = dirname(fileURLToPath(import.meta.url));
  dotenv.config({ path: join(__envdir, "../.env"), quiet: true });
  dotenv.config({ path: join(__envdir, "../../.env"), quiet: true });

  const argValue = (name) => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : null;
  };
  const APPLY = process.argv.includes("--apply");
  const CONFIRM = argValue("--confirm");
  const REQUIRED_CONFIRM = "REPAIR 3715 CONTRACT SEASONS";
  const OWNER_ACK = process.env.REPAIR_3715_OWNER_ACK === "true";

  if (APPLY && (CONFIRM !== REQUIRED_CONFIRM || !OWNER_ACK)) {
    console.error(`❌ --apply kræver BÅDE --confirm "${REQUIRED_CONFIRM}" OG REPAIR_3715_OWNER_ACK=true i miljøet. Ingen writes udført.`);
    process.exit(1);
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
    process.exit(1);
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const dryRun = !APPLY;
  console.log(`=== #3715 akademi-kontrakt-reparation — ${dryRun ? "DRY-RUN" : "APPLY"} ===`);
  repair3715AcademyPromoteContractSeasons({ supabase, dryRun })
    .then((res) => {
      console.log(`\nfærdig: reparerbare=${res.repairable.length} usikre=${res.uncertain.length} applied=${res.applied}${res.applied ? ` updated=${res.updated}` : ""}`);
    })
    .catch((err) => { console.error("FEJL:", err.message); process.exit(1); });
}
