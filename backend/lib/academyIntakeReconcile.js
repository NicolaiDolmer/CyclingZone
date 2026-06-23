// #1756 — reconcile-sweep for stale academy_intake 'offered'-rækker mod
// rytter-ejerskab.
//
// PROBLEM: prod havde 5 academy_intake-rækker i status 'offered' på ryttere der
// allerede er ejet (riders.team_id sat) — stale rækker der aldrig blev flippet da
// rytteren blev anskaffet. Fundet 2026-06-22 under #1748/#1743-arbejdet (se
// migration 2026-06-22-hide-intake-riders-from-db.sql: "73 'offered'-rækker,
// hvoraf 5 allerede var ejede"). PR #1754's RLS-fix skjuler dem korrekt fra UI'et,
// så der er INGEN spiller-synlig fejl; dette er ren data-hygiejne.
//
// KORREKT MÅL-STATUS pr. stale række, afgjort af HVEM der ejer rytteren nu:
//   • riders.team_id === academy_intake.team_id  → holdet underskrev kandidaten
//     via akademiet (finalize_academy_acquisition satte team_id + is_academy=true),
//     men 'signed'-flippet i signAcademyCandidate (trin 4) fuldførte aldrig.
//     KORREKT: 'signed'.
//   • riders.team_id !== academy_intake.team_id  → det tilbudte hold afviste
//     kandidaten (eller hentede ham ikke), og et ANDET hold vandt ham på den
//     efterfølgende ungdomsauktion (auctionFinalization → samme RPC, andet team).
//     Set fra det tilbudte holds intake-række er udfaldet en afvisning.
//     KORREKT: 'rejected'. (Issue #1756: "rejected hvis ikke hentet via akademi".)
//
// En 'offered'-række med team_id = NULL (rytter stadig fri) er IKKE stale — det er
// et legitimt åbent tilbud — og røres aldrig.
//
// IDEMPOTENT: kun rækker der stadig er 'offered' OG hvor rytteren er ejet flippes.
// Et re-run finder ingen rækker (de er nu signed/rejected) → no-op.
//
// resolved_at sættes så de flippede rækker matcher den normale sign/reject-sti
// (signAcademyCandidate/rejectAcademyCandidate sætter begge resolved_at).
//
// AFGRÆNSNING: scriptet ændrer KUN academy_intake.status/resolved_at. Det rører
// ALDRIG rider-ejerskab, balance, finance eller auktioner — ejerskabet er allerede
// korrekt (rytteren ER hos sit rette hold); kun intake-sporet er bagud.

import { fetchAllRows } from "./supabasePagination.js";

/**
 * Find stale 'offered' intake-rækker (rytter ejet) og afgør deres korrekte status.
 *
 * Returnerer en plan-liste uden at skrive noget. Hver post:
 *   { intakeId, riderId, offeredTeamId, ownerTeamId, targetStatus }
 *
 * @param {object} supabase
 * @returns {Promise<Array<{intakeId:string, riderId:string, offeredTeamId:string, ownerTeamId:string, targetStatus:'signed'|'rejected'}>>}
 */
export async function findStaleOfferedIntake(supabase) {
  if (!supabase?.from) throw new Error("Supabase client required");

  // Alle stadig-'offered' intake-rækker. Paginer (kan overstige 1000 i en stor
  // population). Stabil .order("id") kræves af fetchAllRows.
  const offered = await fetchAllRows(() =>
    supabase
      .from("academy_intake")
      .select("id, team_id, rider_id")
      .eq("status", "offered")
      .order("id"));

  if (offered.length === 0) return [];

  // Slå rytter-ejerskab op for de tilbudte rytter-id'er. .in() kan også ramme
  // 1000-loftet hvis der nogensinde bliver mange stale rækker; paginer derfor
  // rytter-opslaget i chunks for at være på den sikre side.
  const riderIds = offered.map((r) => r.rider_id);
  const ownerById = new Map();
  const CHUNK = 1000;
  for (let i = 0; i < riderIds.length; i += CHUNK) {
    const chunk = riderIds.slice(i, i + CHUNK);
    const riders = await fetchAllRows(() =>
      supabase
        .from("riders")
        .select("id, team_id")
        .in("id", chunk)
        .order("id"));
    for (const r of riders) ownerById.set(r.id, r.team_id ?? null);
  }

  const plan = [];
  for (const row of offered) {
    const ownerTeamId = ownerById.get(row.rider_id) ?? null;
    // Fri rytter (team_id NULL) = legitimt åbent tilbud, ikke stale. Spring over.
    if (!ownerTeamId) continue;
    // Ejet rytter med stadig-'offered' række = stale. Mål-status afgøres af ejer.
    const targetStatus = ownerTeamId === row.team_id ? "signed" : "rejected";
    plan.push({
      intakeId: row.id,
      riderId: row.rider_id,
      offeredTeamId: row.team_id,
      ownerTeamId,
      targetStatus,
    });
  }
  return plan;
}

/**
 * REN orkestrering (DB injiceres) — testbar uden createClient.
 *
 * @param {object}   opts
 * @param {object}   opts.supabase
 * @param {boolean}  [opts.dryRun=true]   default dry-run; ingen writes uden eksplicit live
 * @param {Function} [opts.now]           DI-hook; default () => new Date()
 * @param {Function} [opts.log]           DI-hook; default console.log
 * @returns {Promise<{dryRun:boolean, stale:number, signed:number, rejected:number, updated:number, plan:Array}>}
 */
export async function runAcademyIntakeReconcile({
  supabase,
  dryRun = true,
  now = () => new Date(),
  log = console.log,
} = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");

  const plan = await findStaleOfferedIntake(supabase);
  const signed = plan.filter((p) => p.targetStatus === "signed").length;
  const rejected = plan.filter((p) => p.targetStatus === "rejected").length;

  log(`Stale 'offered'-rækker (rytter ejet): ${plan.length} (→ signed: ${signed}, → rejected: ${rejected})`);

  if (plan.length === 0) {
    log("Intet at gøre — ingen stale intake-rækker. Idempotent no-op.");
    return { dryRun, stale: 0, signed: 0, rejected: 0, updated: 0, plan: [] };
  }

  for (const p of plan) {
    log(`  intake ${p.intakeId} · rytter ${p.riderId} · tilbudt ${p.offeredTeamId} · ejet af ${p.ownerTeamId} → ${p.targetStatus}`);
  }

  if (dryRun) {
    log("DRY-RUN — ingen writes. Kør med --live for at anvende.");
    return { dryRun: true, stale: plan.length, signed, rejected, updated: 0, plan };
  }

  // LIVE: flip hver række. Idempotent re-guard i WHERE (status stadig 'offered'),
  // så et samtidigt normalt sign/reject-kald ikke overskrives af denne sweep.
  const resolvedAt = now().toISOString();
  let updated = 0;
  for (const p of plan) {
    const { data, error } = await supabase
      .from("academy_intake")
      .update({ status: p.targetStatus, resolved_at: resolvedAt })
      .eq("id", p.intakeId)
      .eq("status", "offered")
      .select("id");
    if (error) throw new Error(`reconcile flip ${p.intakeId}: ${error.message}`);
    if (Array.isArray(data) && data.length > 0) updated += 1;
  }

  log(`LIVE — flippet ${updated}/${plan.length} intake-rækker.`);
  return { dryRun: false, stale: plan.length, signed, rejected, updated, plan };
}
