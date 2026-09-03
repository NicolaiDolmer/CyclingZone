// Reparation #4576 — 105 forladte 'offered' academy_intake-raekker fra S3-akademi-
// optaget 29/8. Ownership-invariant-vagten (#2647, Sentry CYCLINGZONE-4R) alarmerer
// paa academy_intake.status='offered' hvor rytteren allerede er ejet (riders.team_id
// sat). Malt mod prod 1/9: alle 105 er oprettet 2026-08-29 — en stabil engangs-pulje,
// ikke voksende. Vagten selv er korrekt og skal IKKE aendres.
//
// GENBRUGER `findStaleOfferedIntake`/`runAcademyIntakeReconcile` fra
// `backend/lib/academyIntakeReconcile.js` (#1756) — den funktion der allerede
// afgoer maal-status. KORT REKAP (fuld begrundelse i den fils header):
//   riders.team_id === academy_intake.team_id  → holdet fik rytteren via akademiet
//     men sign-flippet fuldfoerte aldrig  → 'signed'.
//   riders.team_id !== academy_intake.team_id  → et ANDET hold vandt rytteren
//     (typisk via den efterfoelgende ungdomsauktion) → 'rejected'.
//   riders.team_id === null (fri rytter)        → legitimt aabent tilbud, IKKE stale.
// Se docs/YOUTH_RULES.md §4 (intake-status-livscyklus) for SSOT-citatet.
//
// #2642-RAMMER (backup-tabel + idempotent + post-verify):
//   1) Backup: HELE foer-billedet af hver stale raekke skrives til
//      `backup_4576_academy_intake_<dato>` (DDL i
//      `database/2026-09-03-4576-academy-intake-backup-table.sql`, aeret separat —
//      dette script SKRIVER til tabellen, det OPRETTER den ikke; samme
//      arbejdsdeling som #3645/#3591).
//   2) Flip: status saettes til maal-vaerdien via runAcademyIntakeReconcile.
//   3) Post-verify: issuets SQL (count academy_intake JOIN riders WHERE
//      status='offered' AND riders.team_id IS NOT NULL) skal give 0 for de
//      rader vi lige reparerede.
//
// IDEMPOTENT: WHERE-praedikatet i reconcile-flippet kraever status STADIG
// 'offered' — en gentagen koersel finder 0 raekker at flippe (allerede signed/
// rejected) og backup-upsert paa row_id er en no-op-opdatering.
//
// KOER ALDRIG mod prod uden ejer-godkendelse:
//   node scripts/repairOrphanedAcademyOffers4576.js
//       → dry-run (default): taeller + lister stale raekker, read-only. Intet skrives.
//   node scripts/repairOrphanedAcademyOffers4576.js --apply --confirm "REPAIR 4576 ACADEMY INTAKE"
//       → RIGTIG koersel. Kraever DESUDEN REPAIR_4576_OWNER_ACK=true i miljoeet.
//         Backup skrives FOER flip. Post-verify koeres til sidst.

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

import { findStaleOfferedIntake, runAcademyIntakeReconcile } from "../lib/academyIntakeReconcile.js";
import { fetchAllRowsChunkedIn } from "../lib/supabasePagination.js";

export const BACKUP_TABLE = "backup_4576_academy_intake_20260903";

/**
 * REN orkestrering (DB injiceres) — testbar uden createClient.
 *
 * @param {object}   opts
 * @param {object}   opts.supabase
 * @param {boolean}  [opts.dryRun=true]
 * @param {Function} [opts.now]
 * @param {Function} [opts.log]
 * @returns {Promise<{dryRun:boolean, stale:number, signed:number, rejected:number,
 *   backedUp:number, updated:number, postVerifyRemaining:number, plan:Array}>}
 */
export async function repairOrphanedAcademyOffers4576({
  supabase,
  dryRun = true,
  now = () => new Date(),
  log = console.log,
} = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");

  const plan = await findStaleOfferedIntake(supabase);
  const signed = plan.filter((p) => p.targetStatus === "signed").length;
  const rejected = plan.filter((p) => p.targetStatus === "rejected").length;

  log(`Stale 'offered'-raekker (rytter ejet): ${plan.length} (→ signed: ${signed}, → rejected: ${rejected})`);
  for (const p of plan) {
    log(`  intake ${p.intakeId} · rytter ${p.riderId} · tilbudt ${p.offeredTeamId} · ejet af ${p.ownerTeamId} → ${p.targetStatus}`);
  }

  if (plan.length === 0) {
    log("Intet at reparere — ingen stale intake-raekker. Idempotent no-op.");
    return { dryRun, stale: 0, signed: 0, rejected: 0, backedUp: 0, updated: 0, postVerifyRemaining: 0, plan: [] };
  }

  if (dryRun) {
    log("\nDRY-RUN — ingen writes. Koer med --apply (+ --confirm, + REPAIR_4576_OWNER_ACK=true) EFTER ejer-godkendelse.");
    return { dryRun: true, stale: plan.length, signed, rejected, backedUp: 0, updated: 0, postVerifyRemaining: plan.length, plan };
  }

  // ── APPLY ──────────────────────────────────────────────────────────────────
  // 1) Porten: findes backup-tabellen? Uden den maa reparationen ikke starte.
  const { error: probeErr } = await supabase.from(BACKUP_TABLE).select("row_id").limit(1);
  if (probeErr) {
    throw new Error(
      `Backup-tabellen ${BACKUP_TABLE} findes ikke (eller kan ikke laeses): ${probeErr.message}. ` +
        `Koer database/2026-09-03-4576-academy-intake-backup-table.sql FOERST (idempotent, opretter kun en tom tabel).`,
    );
  }

  // 2) Backup: hele foer-billedet af hver stale academy_intake-raekke.
  const intakeIds = plan.map((p) => p.intakeId);
  const fullRows = await fetchAllRowsChunkedIn(intakeIds, (chunk) =>
    supabase.from("academy_intake").select("*").in("id", chunk).order("id"));
  const capturedAt = now().toISOString();
  const backupRows = fullRows.map((row) => ({ row_id: row.id, row_before: row, captured_at: capturedAt }));
  const { error: backupErr } = await supabase
    .from(BACKUP_TABLE)
    .upsert(backupRows, { onConflict: "row_id" });
  if (backupErr) throw new Error(`backup ${BACKUP_TABLE}: ${backupErr.message}`);
  log(`\nBackup skrevet: ${backupRows.length} raekker i ${BACKUP_TABLE}.`);

  // 3) Post-verify backup: alle planlagte id'er er sikret FOER vi roerer noget.
  const backedUpIds = await fetchAllRowsChunkedIn(intakeIds, (chunk) =>
    supabase.from(BACKUP_TABLE).select("row_id").in("row_id", chunk).order("row_id"));
  if (backedUpIds.length < plan.length) {
    throw new Error(
      `Backup-post-verify fejlede: ${backedUpIds.length}/${plan.length} raekker fundet i ${BACKUP_TABLE}. Flip afbrudt — ingen writes til academy_intake.`,
    );
  }

  // 4) Flip: genbruger den allerede idempotente #1756-reconcile.
  const reconcileResult = await runAcademyIntakeReconcile({ supabase, dryRun: false, now, log });

  // 5) Post-verify (issuets SQL): 0 af de reparerede id'er staar stadig 'offered' med ejet rytter.
  const stillStale = await findStaleOfferedIntake(supabase);
  const stillStaleAmongOurs = stillStale.filter((p) => intakeIds.includes(p.intakeId)).length;
  log(`\nPost-verify: ${stillStaleAmongOurs} af de ${plan.length} reparerede raekker staar STADIG 'offered' med ejet rytter (forventet: 0).`);

  return {
    dryRun: false,
    stale: plan.length,
    signed,
    rejected,
    backedUp: backupRows.length,
    updated: reconcileResult.updated,
    postVerifyRemaining: stillStaleAmongOurs,
    plan,
  };
}

if (process.argv[1] && process.argv[1].endsWith("repairOrphanedAcademyOffers4576.js")) {
  const __envdir = dirname(fileURLToPath(import.meta.url));
  dotenv.config({ path: join(__envdir, "../.env"), quiet: true });
  dotenv.config({ path: join(__envdir, "../../.env"), quiet: true });

  const argValue = (name) => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : null;
  };
  const APPLY = process.argv.includes("--apply");
  const CONFIRM = argValue("--confirm");
  const REQUIRED_CONFIRM = "REPAIR 4576 ACADEMY INTAKE";
  const OWNER_ACK = process.env.REPAIR_4576_OWNER_ACK === "true";

  if (APPLY && (CONFIRM !== REQUIRED_CONFIRM || !OWNER_ACK)) {
    console.error(`FEJL: --apply kraever BAADE --confirm "${REQUIRED_CONFIRM}" OG REPAIR_4576_OWNER_ACK=true i miljoeet. Ingen writes udfoert.`);
    process.exit(1);
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("FEJL: Mangler SUPABASE_URL eller SUPABASE_SERVICE_KEY");
    process.exit(1);
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const dryRun = !APPLY;
  console.log(`=== #4576 academy_intake-reparation — ${dryRun ? "DRY-RUN" : "APPLY"} ===`);
  repairOrphanedAcademyOffers4576({ supabase, dryRun })
    .then((res) => {
      console.log(`\nfaerdig: stale=${res.stale} signed=${res.signed} rejected=${res.rejected} backedUp=${res.backedUp} updated=${res.updated} postVerifyRemaining=${res.postVerifyRemaining}`);
      if (!res.dryRun && res.postVerifyRemaining > 0) process.exitCode = 1;
    })
    .catch((err) => { console.error("FEJL:", err.message); process.exit(1); });
}
