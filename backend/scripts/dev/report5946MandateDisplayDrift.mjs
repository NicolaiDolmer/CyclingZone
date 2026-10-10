// #5946 · READ-ONLY drift-rapport: hvor mange hold ser i Boardroom andre mål
// end deres underskrevne mandat (board_mandates.goals)?
//
// Rodårsag (se boardMandate.js::isMandateGoalsAuthoritative): GET /board/room
// lod en AFSLUTTET gammel 1yr-række (board_profiles.current_goals) overskrive
// mandatets target/label (#5751-reconcile). Under mandat-modellen 'on' er den
// række kun en afledt kopi, og den kan være forældet (en anden sæsons plan)
// eller genskrevet efter underskriften (sæsonslut → 'pending' → den gamle
// auto-accept skrev standardmål). Spillerrapport: genforhandlet til top 7,
// Boardroom viste top 5.
//
// Rapporten tæller, for hvert AKTIVT mandat:
//   • driftBefore — visningen FØR #5946 (altid reconcile) afviger fra mandatet
//   • driftAfter  — visningen EFTER #5946 (resolveMandateDisplayGoals med det
//                   aktuelle flag-stadie) afviger fra mandatet
//   • årsag       — legacy-rækken hører til en ANDEN sæson end mandatet, eller
//                   samme sæson men genskrevet
// samt onboarding-fluebenet (board_plan_set): hold hvis manager selv har
// underskrevet et mandat ('mandate.signed'-kvittering), men som ingen
// board_profiles-række med negotiated_at har (= fluebenet manglede før #5946).
//
// Skriver INTET til databasen. Output er KUN aggregerede tal (repoet er
// offentligt: ingen hold-id'er, navne eller mål-tal pr. hold).
//
// Brug (fra backend/):
//   infisical run --env=prod --silent -- node scripts/dev/report5946MandateDisplayDrift.mjs
//   ... --out=../docs/snapshots/5946/drift-<dato>.md   (skriv markdown-rapporten)
//
// Resynk af den lagrede board_profiles-række er IKKE nødvendig for visningen
// efter #5946 (mandatet er autoritativt under 'on'); en evt. datareparation
// følger scripts/resyncMandateGoalsFromLegacy5751.js-mønstret og kræver ejer-go.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LEGACY_NEGOTIATED_GOAL_FIELDS,
  reconcileMandateGoalsWithLegacyBoard,
  resolveMandateDisplayGoals,
} from "../../lib/boardMandate.js";
import { BOARD_MANDATE_MODEL_FLAG_KEY } from "../../lib/boardMandateFlag.js";
import { parseBoardGoals } from "../../lib/boardGoals.js";
import { readFlagStage } from "../../lib/featureStage.js";
import { fetchAllRows } from "../../lib/supabasePagination.js";

function rawGoals(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      // best-effort: en ulæselig målliste tælles som tom (rapporten er read-only).
      return [];
    }
  }
  return [];
}

/**
 * Afviger de viste mål fra mandatets egne på et af de felter en legacy-række
 * kan overføre (LEGACY_NEGOTIATED_GOAL_FIELDS)? reconcile bevarer rækkefølge og
 * længde, så en sammenligning pr. indeks er præcis.
 */
export function goalsDifferFromMandate(displayGoals, mandateGoals) {
  const shown = Array.isArray(displayGoals) ? displayGoals : [];
  const own = Array.isArray(mandateGoals) ? mandateGoals : [];
  if (shown.length !== own.length) return true;
  return own.some((goal, index) =>
    LEGACY_NEGOTIATED_GOAL_FIELDS.some((field) => (shown[index]?.[field] ?? null) !== (goal?.[field] ?? null)));
}

/**
 * Kernen for ÉT mandat. Ren funktion (ingen DB, ingen console).
 *
 * @returns {{ driftBefore: boolean, driftAfter: boolean, reason: "none"|"legacy_other_season"|"legacy_same_season" }}
 */
export function classifyMandateDisplayDrift({ mandate, legacyBoard = null, mandateModelStage = null }) {
  const mandateGoals = rawGoals(mandate?.goals);
  const legacyArgs = {
    legacyGoals: legacyBoard ? parseBoardGoals(legacyBoard.current_goals) : null,
    legacyNegotiationStatus: legacyBoard?.negotiation_status ?? null,
    legacyNegotiatedAt: legacyBoard?.negotiated_at ?? null,
  };
  const before = reconcileMandateGoalsWithLegacyBoard({ mandateGoals, ...legacyArgs });
  const after = resolveMandateDisplayGoals({
    mandateGoals,
    mandateSignedAt: mandate?.signed_at ?? null,
    mandateModelStage,
    ...legacyArgs,
  });
  const driftBefore = goalsDifferFromMandate(before, mandateGoals);
  const driftAfter = goalsDifferFromMandate(after, mandateGoals);
  let reason = "none";
  if (driftBefore) {
    reason = legacyBoard?.plan_start_season_number != null
      && legacyBoard.plan_start_season_number !== mandate?.season_number
      ? "legacy_other_season"
      : "legacy_same_season";
  }
  return { driftBefore, driftAfter, reason };
}

/**
 * Aggregerer en hel snapshot. Ren funktion.
 */
export function summarizeDrift({ mandates = [], oneYearBoardsByTeamId = new Map(), mandateModelStage = null,
  managerSignedTeamIds = new Set(), negotiatedTeamIds = new Set() }) {
  const summary = {
    mandateModelStage: mandateModelStage ?? null,
    activeMandates: 0,
    signedActiveMandates: 0,
    driftBefore: 0,
    driftAfter: 0,
    byReason: { legacy_other_season: 0, legacy_same_season: 0 },
    onboardingManagerSigned: 0,
    onboardingMissingBefore: 0,
  };
  for (const mandate of mandates) {
    summary.activeMandates += 1;
    if (mandate.signed_at) summary.signedActiveMandates += 1;
    const result = classifyMandateDisplayDrift({
      mandate,
      legacyBoard: oneYearBoardsByTeamId.get(mandate.team_id) ?? null,
      mandateModelStage,
    });
    if (result.driftBefore) {
      summary.driftBefore += 1;
      summary.byReason[result.reason] += 1;
    }
    if (result.driftAfter) summary.driftAfter += 1;
  }
  for (const teamId of managerSignedTeamIds) {
    summary.onboardingManagerSigned += 1;
    if (!negotiatedTeamIds.has(teamId)) summary.onboardingMissingBefore += 1;
  }
  return summary;
}

export function renderMarkdown(summary, { generatedAt = new Date().toISOString() } = {}) {
  return [
    "# #5946 · Boardroom-mål vs. underskrevet mandat (read-only)",
    "",
    `Genereret: ${generatedAt} · mandat-model-stadie: \`${summary.mandateModelStage ?? "null"}\``,
    "",
    "Kun aggregerede tal (offentligt repo). Kilde: `backend/scripts/dev/report5946MandateDisplayDrift.mjs`.",
    "",
    "| Måling | Antal |",
    "| --- | ---: |",
    `| Aktive mandater | ${summary.activeMandates} |`,
    `| heraf underskrevet (signed_at) | ${summary.signedActiveMandates} |`,
    `| Visning afviger fra mandatet FØR #5946 | ${summary.driftBefore} |`,
    `| — legacy-rækken er fra en anden sæson | ${summary.byReason.legacy_other_season} |`,
    `| — legacy-rækken er fra samme sæson (genskrevet) | ${summary.byReason.legacy_same_season} |`,
    `| Visning afviger fra mandatet EFTER #5946 | ${summary.driftAfter} |`,
    `| Hold hvor manageren selv har underskrevet et mandat | ${summary.onboardingManagerSigned} |`,
    `| — uden board_profiles.negotiated_at (flueben manglede før #5946) | ${summary.onboardingMissingBefore} |`,
    "",
  ].join("\n");
}

export async function fetchSnapshot(supabase) {
  const mandates = await fetchAllRows(() => supabase.from("board_mandates")
    .select("id, team_id, season_number, status, signed_at, goals").eq("status", "active").order("id"));
  const boards = await fetchAllRows(() => supabase.from("board_profiles")
    .select("id, team_id, plan_type, negotiation_status, negotiated_at, plan_start_season_number, current_goals")
    .order("id"));
  const receipts = await fetchAllRows(() => supabase.from("board_satisfaction_events")
    .select("id, team_id").eq("reason_category", "mandate.signed").order("id"));
  const oneYearBoardsByTeamId = new Map();
  const negotiatedTeamIds = new Set();
  for (const board of boards) {
    if (board.plan_type === "1yr") oneYearBoardsByTeamId.set(board.team_id, board);
    if (board.negotiation_status === "completed" && board.negotiated_at) negotiatedTeamIds.add(board.team_id);
  }
  return {
    mandates,
    oneYearBoardsByTeamId,
    negotiatedTeamIds,
    managerSignedTeamIds: new Set(receipts.map((r) => r.team_id)),
    mandateModelStage: await readFlagStage(supabase, BOARD_MANDATE_MODEL_FLAG_KEY),
  };
}

function isMain() {
  try {
    return fileURLToPath(import.meta.url) === process.argv[1];
  } catch {
    // best-effort: ukendt argv-form → behandles som import (ingen sideeffekt).
    return false;
  }
}

async function main() {
  const outArg = process.argv.slice(2).find((a) => a.startsWith("--out="));
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error("SUPABASE_URL/SUPABASE_SERVICE_KEY mangler (kør via infisical run).");
    process.exit(1);
  }
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(url, key);
  const summary = summarizeDrift(await fetchSnapshot(supabase));
  const markdown = renderMarkdown(summary);
  console.log(markdown);
  if (outArg) {
    const outPath = outArg.slice("--out=".length);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, markdown);
    console.log(`Skrevet: ${outPath}`);
  }
}

if (isMain()) {
  await main();
}
