// #4854 + #5620 — rene hjaelpere til traethedsgraense-panelet (ingen React).

export type FatigueFallback = "light" | "recovery" | "rest";
export const FATIGUE_FALLBACKS: readonly FatigueFallback[] = ["light", "recovery", "rest"];

export type RuleView = { threshold: number | null; fallback: string | null; recoveryAfterStage: boolean | null };
export type RosterRider = { id: string; name: string; fatigue: number };
export type RecentHit = {
  date: string; gameDay: number | null; riderId: string;
  kind: "fatigue" | "after_stage"; fallback: FatigueFallback; fatigue: number; threshold: number | null;
};
export type FatigueRulesResponse = {
  enabled?: boolean;
  today?: string;
  days?: string[];
  team?: RuleView | null;
  riders?: Record<string, RuleView>;
  roster?: RosterRider[];
  recent?: RecentHit[];
};

export type ExceptionMode = "team" | "own" | "off";

export function isFallback(value: unknown): value is FatigueFallback {
  return typeof value === "string" && (FATIGUE_FALLBACKS as readonly string[]).includes(value);
}

export function isThreshold(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100;
}

// Rytter-raekkens tilstand i UI'et.
export function exceptionMode(rule: RuleView | null | undefined): ExceptionMode {
  if (!rule) return "team";
  if (rule.fallback === "off") return "off";
  if (isThreshold(rule.threshold) && isFallback(rule.fallback)) return "own";
  return "team";
}

// Den graense der faktisk gaelder for en rytter (samme stige som motoren):
// egen undtagelse > holdreglen. null = ingen graense.
export function effectiveLimit(
  team: RuleView | null | undefined, rider: RuleView | null | undefined,
): { threshold: number; fallback: FatigueFallback } | null {
  const mode = exceptionMode(rider);
  if (mode === "off") return null;
  if (mode === "own") return { threshold: rider!.threshold as number, fallback: rider!.fallback as FatigueFallback };
  if (team && isThreshold(team.threshold) && isFallback(team.fallback)) {
    return { threshold: team.threshold, fallback: team.fallback };
  }
  return null;
}

// Hvor mange ryttere er OVER deres graense lige nu (traethed efter seneste opgoerelse).
export function ridersOverLimit(
  roster: RosterRider[], team: RuleView | null | undefined, riders: Record<string, RuleView>,
): number {
  return roster.filter((r) => {
    const limit = effectiveLimit(team, riders[r.id]);
    return limit != null && r.fatigue > limit.threshold;
  }).length;
}

// Ugestriben: én celle pr. dato; flere loebsdage samme dato for samme rytter
// taeller som én rytter (reglen vurderes paa datoens start). Stempler med
// forskellige slags (fx etape-regel paa felt 1 og traethed paa resten) beholdes.
export function stripDays(days: string[], recent: RecentHit[]) {
  return days.map((date) => {
    const hits = recent.filter((h) => h.date === date);
    const byRider = new Map<string, RecentHit[]>();
    for (const hit of hits) {
      const list = byRider.get(hit.riderId) ?? [];
      if (!list.some((h) => h.kind === hit.kind && h.fallback === hit.fallback)) list.push(hit);
      byRider.set(hit.riderId, list);
    }
    return { date, riders: [...byRider.entries()].map(([riderId, list]) => ({ riderId, hits: list })) };
  });
}

const WEEKDAY_BY_UTC = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export function weekdayKey(date: string): string {
  return WEEKDAY_BY_UTC[new Date(`${date}T12:00:00Z`).getUTCDay()];
}
