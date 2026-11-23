import { programForSession } from "./trainingPrograms.js";
import {
  advancesRotation, isValidRotation, nextRotationIndex, rotationPassAt, rotationStamp, ROTATION_OUTCOMES,
} from "./trainingRotation.js";
import { isTrainingRotationEnabledForTeam } from "./trainingRotationFlag.js";

export async function loadRotationPlans({ supabase, teamId, weekRows, riderIds, plans }) {
  const rotations = new Map();
  if (!weekRows.some((row) => row.plan_kind === "rotation")) return rotations;
  if (!(await isTrainingRotationEnabledForTeam(supabase, teamId))) return rotations;
  // pagination-safe: one team roster and its default week row.
  // schema-columns-ok: rotation was added by the merged #8577 rotation migration.
  const { data, error } = await supabase.from("training_week_plans")
    .select("rider_id, rotation").eq("team_id", teamId).eq("plan_kind", "rotation");
  if (error) throw new Error(`training rotation plans: ${error.message}`);
  const stored = new Map((data ?? []).map((row) => [row.rider_id ?? null, row.rotation]));
  const ownRows = new Set(weekRows.map((row) => row.rider_id));
  const ownPlans = new Set(plans.filter((row) => row.focus && row.intensity).map((row) => row.rider_id));
  for (const id of riderIds) {
    const key = ownRows.has(id) || ownPlans.has(id) ? id : null;
    const rotation = stored.get(key);
    if (isValidRotation(rotation)) rotations.set(id, rotation);
  }
  return rotations;
}

export async function loadRotationReceipts({ supabase, teamId, tickDate, rotationByRider, dateReceipts = [] }) {
  const history = new Map();
  if (!rotationByRider.size) return history;
  // Once a rider has a receipt for this revision today, its cursor supersedes history.
  const started = new Set(dateReceipts.flatMap((row) => {
    const rotation = rotationByRider.get(row.rider_id);
    const stamp = row.report?.rotation;
    return rotation && row.team_id === teamId && row.tick_date === tickDate
      && stamp?.rev === rotation.rev && stamp.length === rotation.passes.length ? [row.rider_id] : [];
  }));
  const riderIds = [...rotationByRider.keys()].filter((id) => !started.has(id));
  const batchSize = 5;
  for (let start = 0; start < riderIds.length; start += batchSize) {
    await Promise.all(riderIds.slice(start, start + batchSize).map(async (id) => {
      const rotation = rotationByRider.get(id);
      const fromRev = rotation.anchor?.rev === rotation.rev ? rotation.anchor.fromRev : null;
      const latest = async (carry) => {
        // The same team can continue the rider's cursor across seasons. Limit to the
        // last receipt in settlement order, which can differ from game-day order.
        const base = supabase.from("training_rider_ticks").select("tick_date, rotation:report->rotation")
          .eq("team_id", teamId).eq("rider_id", id).lt("tick_date", tickDate)
          .eq("report->rotation->length", rotation.passes.length);
        const revisions = carry
          ? base.gte("report->rotation->rev", fromRev).lt("report->rotation->rev", rotation.rev)
          : base.eq("report->rotation->rev", rotation.rev);
        const { data, error } = await revisions.order("tick_date", { ascending: false })
          .order("report->rotation->order", { ascending: false }).limit(1).maybeSingle();
        if (error) throw new Error(`training rotation receipts: ${error.message}`);
        return data;
      };
      const receipt = await latest(false) ?? (fromRev != null ? await latest(true) : null);
      if (receipt) history.set(id, [{ tick_date: receipt.tick_date, report: { rotation: receipt.rotation } }]);
    }));
  }
  return history;
}

function orderedStamps(receipts) {
  return [...receipts]
    .filter((row) => row.report?.rotation)
    .sort((a, b) => a.tick_date.localeCompare(b.tick_date) || a.report.rotation.order - b.report.rotation.order)
    .map((row) => row.report.rotation);
}

export function rotationProgress(rotation, receipts = [], dateReceipts = []) {
  const today = orderedStamps(dateReceipts);
  return {
    index: nextRotationIndex({ rotation, stamps: [...orderedStamps(receipts), ...today] }),
    order: (today.at(-1)?.order ?? 0) + 1,
    trained: today.filter((stamp) => stamp.advanced).length,
  };
}

export function rotationProgram({ rotation, receipts, dateReceipts, previousFocus, catalogV3, effortLevels }) {
  if (!rotation) return null;
  const { index, order, trained } = rotationProgress(rotation, receipts, dateReceipts);
  const pass = rotationPassAt(rotation, index);
  if (!pass) return null;
  const program = programForSession(pass.session, previousFocus, { catalogV3, effortLevels, effort: pass.effort });
  return program?.ok ? { index, pass, program, order, trained } : null;
}

export function stampRotation({ rotation, chosen, raced, boundRest, injured, unknown, fatigueRule }) {
  if (!chosen || unknown) return null;
  let outcome = ROTATION_OUTCOMES.TRAINED;
  if (raced) outcome = ROTATION_OUTCOMES.RACED;
  else if (boundRest) outcome = ROTATION_OUTCOMES.BOUND_REST;
  else if (injured) outcome = ROTATION_OUTCOMES.INJURED;
  else if (fatigueRule?.kind === "after_stage") outcome = ROTATION_OUTCOMES.AFTER_STAGE;
  else if (fatigueRule) outcome = ROTATION_OUTCOMES.FATIGUE_RULE;
  const advanced = advancesRotation(outcome, { fatigueFallback: fatigueRule?.fallback });
  return { ...rotationStamp({ rotation, index: chosen.index, advanced }), order: chosen.order, session: chosen.pass.session };
}
