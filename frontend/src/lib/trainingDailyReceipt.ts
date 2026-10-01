export type ReceiptStatus = "complete" | "pending" | "reconciliation" | "recorded";
type Numbers = Record<string, number>;
type Jump = { from: number; to: number };
export interface TrainingActivity {
  rider_id: string;
  name?: string;
  game_day?: number | null;
  focus?: string | null;
  intensity?: string | null;
  gains?: Numbers;
  gains_detail?: Record<string, Jump>;
  progress_before?: Numbers;
  progress_after?: Numbers;
  condition_before_date?: { form?: number; fatigue?: number } | null;
  form?: number | null;
  fatigue?: number | null;
  fatigue_delta?: number;
  injured?: boolean;
  injury_days?: number;
  race_day?: boolean;
  bound_race_day?: boolean;
  status?: string;
  settlement_status?: string;
  missing_evidence?: unknown[];
  score?: number;
  [key: string]: unknown;
}
export interface TrainingRun {
  id?: string;
  tick_date: string;
  created_at?: string;
  season_id?: string | null;
  game_day?: number | null;
  squad?: string;
  executed_by?: string;
  bonus_applied?: boolean;
  report?: {
    riders?: TrainingActivity[];
    condition_per_date?: boolean;
    condition_settled?: boolean;
    date_game_days?: number[];
    game_day?: number | null;
    [key: string]: unknown;
  } | null;
}
export interface DailyRiderReceipt extends TrainingActivity {
  activities: TrainingActivity[];
  receipt_status: ReceiptStatus;
  gains: Numbers;
  gains_detail: Record<string, Jump>;
  gain_percent: Record<string, number | null>;
  fatigue_before: number | null;
  form_before: number | null;
  progress_before: Numbers;
}
export interface DailyTrainingReceipt extends TrainingRun {
  previous_season?: boolean;
  receipt_status: ReceiptStatus;
  game_days: number[];
  expected_game_days: number[] | null;
  report: { riders: DailyRiderReceipt[]; condition_settled: boolean };
}
type Evidence = {
  row: TrainingActivity; day: number | null; normalized: boolean;
  settled: boolean; expected: number[] | null; season: string;
};
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const dayOf = (run: TrainingRun) => run.game_day ?? run.report?.game_day ?? null;
const order = (a: TrainingRun, b: TrainingRun) =>
  (dayOf(a) ?? -1) - (dayOf(b) ?? -1)
  || String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""))
  || String(a.id ?? "").localeCompare(String(b.id ?? ""));

/** Read-only projection of stored reports; no training mathematics or wall-clock reads. */
export function aggregateTrainingRuns(input: TrainingRun[] | null | undefined): DailyTrainingReceipt[] {
  const byDate = new Map<string, TrainingRun[]>();
  for (const run of input ?? []) {
    if (!run || !/^\d{4}-\d{2}-\d{2}$/.test(run.tick_date) || !Array.isArray(run.report?.riders)) continue;
    const scope = `${run.tick_date}:${run.season_id ?? "legacy"}`;
    const group = byDate.get(scope) ?? [];
    group.push(run);
    byDate.set(scope, group);
  }
  return [...byDate.values()].sort((a, b) =>
    b[0].tick_date.localeCompare(a[0].tick_date)
    || String([...b].sort(order).at(-1)!.created_at ?? "").localeCompare(String([...a].sort(order).at(-1)!.created_at ?? ""))
  ).map(unsorted => {
    const date = unsorted[0].tick_date;
    const runs = [...unsorted].sort(order);
    const riders = new Map<string, Map<string, Evidence>>();
    const conflicts = new Set<string>();
    const expected = new Set<number>();
    const gameDays = new Set<number>();
    for (const run of runs) {
      const days = run.report?.date_game_days;
      const explicitDays = Array.isArray(days) && days.length > 0 && days.every(Number.isInteger) ? [...new Set(days)].sort((a,b)=>a-b) : null;
      explicitDays?.forEach(day => expected.add(day));
      const day = dayOf(run);
      if (day != null) gameDays.add(day);
      for (const row of run.report?.riders ?? []) {
        if (!row?.rider_id) continue;
        const slots = riders.get(row.rider_id) ?? new Map<string, Evidence>();
        const key = `${run.season_id ?? ""}:${row.game_day ?? day ?? "calendar"}`;
        const value: Evidence = { row, day: row.game_day ?? day,
          normalized: run.report?.condition_per_date === true,
          settled: run.report?.condition_settled === true,
          expected: explicitDays, season: run.season_id ?? "" };
        const previous = slots.get(key);
        if (previous && JSON.stringify(previous) !== JSON.stringify(value)) conflicts.add(row.rider_id);
        if (!previous) slots.set(key, value);
        riders.set(row.rider_id, slots);
      }
    }
    const rows = [...riders].map(([id, slots]): DailyRiderReceipt => {
      const evidence = [...slots.values()];
      const first = evidence[0];
      const last = evidence.at(-1)!;
      const activities = evidence.map(e => ({ ...e.row, game_day: e.day }));
      const normalized = evidence.some(e => e.normalized);
      const quarantine = conflicts.has(id) || (normalized && evidence.some(e=>!e.normalized)) || evidence.some(e =>
        e.row.settlement_status === "needs_reconciliation" || e.row.status === "unknown_pending"
        || (e.row.missing_evidence?.length ?? 0) > 0);
      const ownExpected = [...new Set(evidence.flatMap(e => e.expected ?? []))];
      const present = new Set(evidence.map(e => e.day));
      const finished = normalized && last.settled
        && (ownExpected.length > 0 ? ownExpected.every(day => present.has(day)) : present.size === 5);
      const state: ReceiptStatus = quarantine ? "reconciliation" : normalized ? (finished ? "complete" : "pending") : "recorded";
      const gains: Numbers = {};
      const details: Record<string, Jump> = {};
      for (const {row} of evidence) {
        for (const [ability, n] of Object.entries(row.gains ?? {})) {
          if (!finite(n) || n <= 0) continue;
          gains[ability] = (gains[ability] ?? 0) + n;
          const jump = row.gains_detail?.[ability];
          if (jump && finite(jump.from) && finite(jump.to)) {
            details[ability] = { from: details[ability]?.from ?? jump.from, to: jump.to };
          }
        }
      }
      for (const [ability, jump] of Object.entries(details)) {
        if (jump.to - jump.from !== gains[ability]) delete details[ability];
      }
      const progressBefore = { ...(first.row.progress_before ?? {}) };
      const gainPercent: Record<string, number | null> = {};
      const keys = new Set([...Object.keys(progressBefore), ...Object.keys(last.row.progress_after ?? {}), ...Object.keys(gains)]);
      for (const ability of keys) {
        const before = progressBefore[ability], after = last.row.progress_after?.[ability];
        gainPercent[ability] = finite(before) && finite(after)
          ? Math.max(0, Math.round(((gains[ability] ?? 0) + after - before) * 100)) : null;
      }
      const knownCondition = state === "complete" || state === "recorded";
      const fatigueBefore = finite(first.row.condition_before_date?.fatigue)
        ? first.row.condition_before_date.fatigue
        : finite(first.row.fatigue) && finite(first.row.fatigue_delta) ? first.row.fatigue - first.row.fatigue_delta : null;
      const formBefore = finite(first.row.condition_before_date?.form) ? first.row.condition_before_date.form : null;
      const active = activities.find(a => a.intensity && a.intensity !== "rest" && !a.injured);
      const trusted = state === "complete" || state === "recorded";
      return { ...last.row, rider_id: id, activities, receipt_status: state, gains: trusted ? gains : {},
        gains_detail: trusted ? details : {}, progress_before: trusted ? progressBefore : {}, gain_percent: trusted ? gainPercent : {},
        progress_after: trusted ? last.row.progress_after : undefined,
        status: trusted ? last.row.status : "unknown_pending",
        focus: active?.focus ?? last.row.focus, intensity: active?.intensity ?? last.row.intensity,
        fatigue_before: fatigueBefore, form_before: formBefore,
        fatigue: knownCondition && finite(last.row.fatigue) ? last.row.fatigue : null,
        form: knownCondition && finite(last.row.form) ? last.row.form : null,
        fatigue_delta: knownCondition && finite(last.row.fatigue) && fatigueBefore != null ? last.row.fatigue - fatigueBefore : undefined,
        race_day: activities.some(a=>a.race_day === true),
        injured: activities.some(a=>a.injured === true),
      };
    });
    const state: ReceiptStatus = rows.some(r=>r.receipt_status==="reconciliation") ? "reconciliation"
      : rows.some(r=>r.receipt_status==="pending") ? "pending"
      : rows.length > 0 && rows.every(r=>r.receipt_status==="complete") ? "complete" : "recorded";
    const latest = runs.at(-1)!;
    return { ...latest, tick_date: date, receipt_status: state,
      game_days: [...gameDays].sort((a,b)=>a-b),
      expected_game_days: expected.size ? [...expected].sort((a,b)=>a-b) : null,
      report: { riders: rows, condition_settled: state === "complete" },
    };
  });
}
