// #7982 trin 4a: what one train-now press remembers between its day fields.
//
// A press settles the date's five day fields one after the other. Before trin 4a every day field
// read everything again, also the numbers the press itself had just saved. Now the first day field
// that trains reads as before ("hent") and this memory keeps a copy; every later day field is
// counted from it ("regn", computeTrainingDayTick in dailyTrainingEngine.js) and saved with the
// same database function as before ("gem", commit_training_date_tick). After each save the memory
// is told what the database now holds, the way the database function stores it:
//
//   abilities        only the columns of the rider's patch change; jsonb columns come back as
//                    stored jsonb (a JSON round trip, keys in the database's order)
//   receipts         one per rider per day field, holding the rider's report as stored jsonb
//   date work        the status the save answered with
//   condition, race  never remembered after a save: a rider whose condition or race load was
//   loads            saved is read again if a later day field needs him (in practice none does)
//
// Anything the memory is not sure about makes it step aside: the database did not apply exactly
// the riders the press sent (already run, a rider quarantined), or a later day field needs a rider
// the first one did not read. That day field then reads everything as before.
//
// One memory per press, created by settleWholeDayPress and gone with it: nothing at module level,
// nothing shared between two presses or two teams.

/** PostgreSQL's jsonb key order: shorter keys first, then by character. */
const jsonbKeyOrder = (a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);

/**
 * PURE: a value as it comes back from a jsonb column: what JSON can carry (the client sends JSON),
 * with object keys in jsonb order.
 * @param {unknown} value
 */
export function asStoredJsonb(value) {
  if (value === undefined) return undefined;
  const sorted = (item) => {
    if (Array.isArray(item)) return item.map(sorted);
    if (!item || typeof item !== "object") return item;
    return Object.fromEntries(Object.keys(item).sort(jsonbKeyOrder).map((key) => [key, sorted(item[key])]));
  };
  return sorted(JSON.parse(JSON.stringify(value)));
}

const sameIds = (a, b) => {
  if (a.length !== b.length) return false;
  const left = new Set(a);
  return left.size === a.length && b.every((id) => left.has(id));
};

// The input fields that hold rows from the database. Every day field gets its own copy, as a
// read gives it, so nothing one day field does to its input reaches the next.
const ROW_FIELDS = ["planRows", "weekPlanRow", "sameDateRunReports", "illnessHistoryByRider", "trainingStaff", "dateWork"];

export function createTrainNowPressMemory() {
  /** @type {any} */
  let input = null;
  /** @type {any} */
  let selection = null;
  let abilityRows = [];
  let conditionRows = [];
  let raceLoadRows = [];
  let receipts = [];
  const memory = {
    /** True while the memory holds a day field's fetch that later day fields may count from. */
    ready: false,
    /** True after the press's first save: from then on nothing is fetched ahead. */
    committed: false,
    /** Race lookups fetched ahead, by race day: { key: rider ids joined, facts }. */
    raceFacts: new Map(),
    /** Riders whose condition or race load was saved by this press after it was read. */
    dirtyRiderIds: new Set(),
    get selection() {
      return selection && { ...selection, rosterRows: structuredClone(selection.rosterRows), dateWork: structuredClone(selection.dateWork), dateReceipts: structuredClone(receipts) };
    },
    /**
     * Keep what a day field fetched (called before it is counted). Rows are copied, so the
     * memory holds what the database answered, not what the count later does with it.
     */
    capture({ input: fetched, selection: picked, raceFacts }) {
      input = { ...fetched };
      for (const field of ROW_FIELDS) input[field] = structuredClone(fetched[field]);
      abilityRows = structuredClone(fetched.abilityRows ?? []);
      conditionRows = structuredClone(fetched.conditionRows ?? []);
      raceLoadRows = structuredClone(fetched.raceLoadRows ?? []);
      receipts = structuredClone(picked.dateReceipts ?? []);
      selection = {
        rosterRows: structuredClone(picked.rosterRows ?? []),
        dateWork: structuredClone(picked.dateWork),
        eligibleIds: [...picked.eligibleIds], waitingIds: [...picked.waitingIds], riderIds: [...picked.riderIds],
        instantRiderIds: new Set(picked.instantRiderIds), trainNowBonusRiderIds: new Set(picked.trainNowBonusRiderIds),
      };
      for (const [day, facts] of raceFacts ?? []) memory.raceFacts.set(day, facts);
      memory.dirtyRiderIds = new Set();
      memory.ready = true;
    },
    /** A fresh copy of the remembered fetch for one day field, with the abilities as saved since. */
    dayInput() {
      if (!memory.ready || !input) return null;
      const out = { ...input };
      for (const field of ROW_FIELDS) out[field] = structuredClone(input[field]);
      out.abilityRows = structuredClone(abilityRows);
      out.conditionRows = structuredClone(conditionRows);
      out.raceLoadRows = structuredClone(raceLoadRows);
      return out;
    },
    /**
     * After a save: the database now holds what was sent, for the riders it applied. Mirrors
     * commit_training_date_tick for the tables a later day field reads.
     */
    afterCommit({ args, data }) {
      memory.committed = true;
      if (!memory.ready) return;
      const sent = (args?.p_report?.riders ?? []).map((row) => row.rider_id);
      const applied = data?.applied_rider_ids;
      if (data?.already_ran === true || !Array.isArray(applied) || !sameIds(applied, sent)) {
        memory.ready = false;
        return;
      }
      for (const { riderId, patch } of args.p_abilities ?? []) {
        const row = abilityRows.find((item) => item.rider_id === riderId);
        if (!row) { memory.ready = false; return; }
        for (const [key, value] of Object.entries(patch ?? {})) {
          if (key === "rider_id") continue;
          row[key] = value !== null && typeof value === "object" ? asStoredJsonb(value) : value;
        }
      }
      for (const report of args.p_report.riders) {
        receipts.push({
          rider_id: report.rider_id, season_id: args.p_season_id, game_day: args.p_game_day, tick_date: args.p_tick_date,
          team_id: args.p_team_id, report: asStoredJsonb(report), created_at: args.p_now,
        });
      }
      for (const row of args.p_conditions ?? []) memory.dirtyRiderIds.add(row.rider_id);
      for (const row of args.p_race_loads ?? []) memory.dirtyRiderIds.add(row.rider_id);
      if (typeof data?.work_status === "string" && selection?.dateWork) selection.dateWork.status = data.work_status;
      if (typeof data?.work_status === "string" && input?.dateWork) input.dateWork.status = data.work_status;
    },
  };
  return memory;
}
