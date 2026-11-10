// A provisional rider_condition is an output, never another date opening.
import { enteringFatigueV2 } from "./conditionModelV2.js";
import { loadTrainNowInstantRiderIds } from "./trainNowLock.js";
import { settleTrainingDateCondition, canonicalRaceLoads } from "./trainingDateCondition.js";
import { isConditionModelV2Enabled, isRaceDateTrainingDayEnabled } from "./conditionModelV2Flag.js";
import { isRaceDayEngineEnabled } from "./raceDayEngineFlag.js";
import { RACE_DAY_ENGINE_RECOVERY_CONFIG } from "./riderCondition.js";
import { loadMedicalBonusByTeam } from "./medicalEffects.js";
import { fetchAllRows, SUPABASE_IN_CHUNK_SIZE } from "./supabasePagination.js";

export class InstantConditionEvidenceError extends Error {}

// Review 10/11: med kontakten slukket maa en kort fejl i selve stempel-opslaget ikke vaelte
// visninger og udtagelse (/training/me, prognosen, assistentens autofyld); foer #7737 laeste
// de slet ikke stempler. KUN de kaldere slaar failOpenWhenOff til. Etapen (applyStageStartFatigue)
// skriver resultater og forbliver fail-closed: et stempel overlever, at kontakten slukkes
// samme dato, saa "slukket" beviser ikke, at der ingen stempler er (Codex-review 10/11).
async function stampedIds({ supabase, tickDate, riderIds, failOpenWhenOff }) {
  try {
    return [...await loadTrainNowInstantRiderIds({ supabase, tickDate, riderIds })];
  } catch (lookupError) {
    if (!failOpenWhenOff) throw lookupError;
    const { data, error } = await supabase.from("app_config")
      .select("value").eq("key", "training_train_now_instant").maybeSingle();
    if (!error && data?.value !== "on") return [];
    throw lookupError;
  }
}

async function rows(query, source) {
  const { data, error } = await query;
  if (error || !Array.isArray(data)) throw new Error(`${source}: ${error?.message ?? "missing rows"}`);
  return data;
}

/** Read-only reconstruction of PR1's provisional date; the durable stamp survives OFF. */
// `projectedLoad(riderId, gameDay)` (kun tidsgraense-varslet, #7715): en prognose for en
// reserveret loebsplads foer `beforeGameDay`, hvis etapen ikke er koert endnu. Den laegges i
// pladsen i datoens opgoerelse, praecis hvor motoren laegger den rigtige belastning, naar
// etapen er koert. Ledgerens belastning vinder altid; uden funktion er alt som foer.
export async function loadInstantConditions({ supabase, riderIds, tickDate, beforeGameDay = null, failOpenWhenOff = false, projectedLoad = null }) {
  const out = new Map();
  out.openingByRider = new Map();
  out.incompleteRiderIds = new Set();
  out.settledRiderIds = new Set();
  try {
    for (let i = 0; i < riderIds.length; i += SUPABASE_IN_CHUNK_SIZE) {
      const stamped = await stampedIds({ supabase, tickDate, riderIds: riderIds.slice(i, i + SUPABASE_IN_CHUNK_SIZE), failOpenWhenOff });
      if (!stamped.length) continue;
      // pagination-safe: one stamp per rider/date, bounded rider chunk.
      // schema-columns-ok: instant_entry_snapshot is added by stacked PR1 migration database/2026-11-09-7737-train-now-instant.sql.
      const locks = await rows(supabase.from("training_train_now_locks")
        .select("rider_id, team_id, season_id, instant_entry_snapshot").eq("tick_date", tickDate).in("rider_id", stamped), "instant date locks");
      const modelV2 = await isConditionModelV2Enabled(supabase);
      const raceDateTrainingDay = modelV2 && await isRaceDateTrainingDayEnabled(supabase);
      const recoveryConfig = await isRaceDayEngineEnabled(supabase) ? RACE_DAY_ENGINE_RECOVERY_CONFIG : {};
      const medical = modelV2 ? await loadMedicalBonusByTeam(supabase, locks.map(l => l.team_id), { retryOnTransient: true }) : new Map();
      const bundles = new Map();
      for (const id of stamped) {
        const lock = locks.find(l => l.rider_id === id);
        if (!lock?.team_id || !lock.season_id || !Array.isArray(lock.instant_entry_snapshot?.slots)) throw new Error("Missing frozen instant eligibility");
        const dateQuery = table => supabase.from(table).select("*").eq("tick_date", tickDate).eq("season_id", lock.season_id);
        const key = `${lock.team_id}:${lock.season_id}`;
        if (!bundles.has(key)) {
          const ids = locks.filter(l => l.team_id === lock.team_id && l.season_id === lock.season_id).map(l => l.rider_id);
          // pagination-safe: a work key and a bounded rider chunk on one date.
          bundles.set(key, {
            workRows: await rows(dateQuery("training_date_work").eq("team_id", lock.team_id), "instant date opening"),
            receipts: await rows(dateQuery("training_rider_ticks").in("rider_id", ids).order("game_day"), "instant date receipts"),
            ledger: canonicalRaceLoads(await fetchAllRows(() => dateQuery("training_race_loads").in("rider_id", ids)
              .order("rider_id").order("game_day").order("race_id").order("stage_number"))),
            settlements: await rows(dateQuery("training_condition_settlements").in("rider_id", ids), "instant date settlement"),
          });
        }
        const bundle = bundles.get(key);
        const { workRows } = bundle;
        const work = workRows[0];
        const opening = work?.opening_conditions?.[id];
        if (workRows.length !== 1 || !opening || !Array.isArray(work.game_days) || work.game_days.length !== 5
          || !Number.isFinite(opening.fatigue) || !Number.isFinite(opening.form)) throw new Error("Missing frozen instant opening");
        out.openingByRider.set(id, opening);
        const receipts = bundle.receipts.filter(r => r.rider_id === id);
        const ledger = bundle.ledger.filter(r => r.rider_id === id);
        const settlements = bundle.settlements.filter(r => r.rider_id === id);
        if (settlements.length) {
          out.settledRiderIds.add(id);
          bundle.current ??= await rows(supabase.from("rider_condition").select("rider_id, form, fatigue")
            .in("rider_id", bundle.settlements.map(s => s.rider_id)), "settled instant condition");
          const current = bundle.current.filter(c => c.rider_id === id);
          if (current.length !== 1) throw new Error("Missing settled instant condition");
          out.set(id, { form: current[0].form, fatigue: current[0].fatigue });
          continue;
        }
        const days = work.game_days.map(Number).sort((a, b) => a - b);
        if (new Set(days).size !== 5 || days.some(d => !Number.isInteger(d))) throw new Error("Invalid instant date slots");
        const reserved = new Set(lock.instant_entry_snapshot.slots.map(s => Number(s.gameDay)));
        if ([...reserved].some(d => !days.includes(d)) || receipts.some(r => !days.includes(Number(r.game_day)))
          || ledger.some(l => !days.includes(Number(l.game_day)))
          || new Set(receipts.map(r => Number(r.game_day))).size !== receipts.length
          || receipts.length === days.length) throw new Error("Inconsistent instant receipt evidence");
        if (receipts.some(r => r.report?.intensity === "unknown_pending"
          || (r.report?.intensity === "race" && !ledger.some(l => Number(l.game_day) === Number(r.game_day))))) {
          throw new Error("Unresolved instant race receipt evidence");
        }
        const recoveryAbility = receipts.find(r => r.report?.recovery_before_date != null)?.report.recovery_before_date;
        const projectedFor = day => {
          if (!projectedLoad || beforeGameDay == null || day >= beforeGameDay || !reserved.has(day)
            || ledger.some(l => Number(l.game_day) === day)
            || receipts.some(r => Number(r.game_day) === day)) return null;
          const value = projectedLoad(id, day);
          return value == null ? null : Number(value);
        };
        const incomplete = days.some(day => !reserved.has(day) && !receipts.some(r => Number(r.game_day) === day));
        if (incomplete) {
          // PR1 writes the provisional condition only with the final free receipt.
          // Until then the persisted condition is authoritative; do not project
          // uncommitted training or perform recovery writes on a GET.
          const current = await rows(supabase.from("rider_condition").select("rider_id, form, fatigue")
            .eq("rider_id", id), "incomplete instant condition");
          if (current.length !== 1 || !Number.isFinite(current[0].fatigue) || !Number.isFinite(current[0].form)) {
            throw new Error("Missing incomplete instant condition");
          }
          const priorLoads = [...ledger.filter(l => beforeGameDay == null || Number(l.game_day) < beforeGameDay).map(l => ({ day: Number(l.game_day), load: Number(l.load) })),
            ...days.map(day => ({ day, load: projectedFor(day) })).filter(p => p.load != null)]
            .sort((a, b) => a.day - b.day).map(p => p.load);
          if (priorLoads.some(load => !Number.isFinite(load) || load < 0)) throw new Error("Invalid instant race load");
          let recovery = recoveryAbility;
          if (priorLoads.length && !Number.isFinite(recovery)) {
            const abilities = await rows(supabase.from("rider_derived_abilities").select("rider_id, recovery").eq("rider_id", id), "incomplete instant recovery");
            recovery = abilities[0]?.recovery;
            if (!Number.isFinite(recovery)) throw new Error("Missing incomplete instant recovery");
          }
          // The final free commit may advance current after the receipt read.
          // Frozen opening is the persisted pre-provisional condition in that snapshot.
          const fatigue = priorLoads.length ? enteringFatigueV2({ openingFatigue: opening.fatigue,
            priorLoadsToday: priorLoads, recoveryAbility: recovery, medicalBonus: medical.get(lock.team_id) ?? 0 }) : opening.fatigue;
          out.incompleteRiderIds.add(id);
          out.set(id, { fatigue, form: opening.form });
          continue;
        }
        if (!Number.isFinite(recoveryAbility)) throw new Error("Missing frozen instant recovery");
        const intensities = days.map(day => {
          const receipt = receipts.find(r => Number(r.game_day) === day);
          if (ledger.some(l => Number(l.game_day) === day && (beforeGameDay == null || day < beforeGameDay))) return "race";
          if (receipt) return receipt.report?.intensity;
          if (reserved.has(day)) return "race";
          throw new Error("Incomplete instant training receipts");
        });
        const raceLoads = days.map(day => {
          const load = ledger.find(l => Number(l.game_day) === day && (beforeGameDay == null || day < beforeGameDay));
          if (load && (!Number.isFinite(Number(load.load)) || Number(load.load) < 0)) throw new Error("Invalid instant race load");
          const projected = load ? null : projectedFor(day);
          if (projected != null && (!Number.isFinite(projected) || projected < 0)) throw new Error("Invalid projected race load");
          return Number(load?.load ?? projected ?? 0);
        });
        const condition = settleTrainingDateCondition({ riderId: id, dateStr: tickDate, condition: opening,
          intensities, raceLoads, recoveryAbility, recoveryConfig, modelV2,
          medicalBonus: medical.get(lock.team_id) ?? 0, raceDateTrainingDay });
        out.set(id, { fatigue: condition.fatigue, form: condition.form });
      }
    }
    return out;
  } catch (error) {
    throw new InstantConditionEvidenceError(`instant condition evidence: ${error.message}`, { cause: error });
  }
}
