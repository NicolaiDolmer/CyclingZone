// Traethedsgraense + "dagen efter en etape" (#4854 + #5620, spec 29/9 beslutning 5).
//
// ═══ HVAD DET ER ════════════════════════════════════════════════════════════
// To SPILLER-SKREVNE regler. Ingen af dem findes, foer spilleren selv har sat dem
// (G7: motoren muterer aldrig managerens program uden dennes egen regel; default
// er slukket = ingen raekke i team_training_rules).
//
//   1. Traethedsgraense: "over denne traethed: koer Let / Aktiv restitution /
//      Hvile i stedet". En holdregel (rider_id NULL) plus en valgfri undtagelse
//      pr. rytter (egen graense, eller "ingen graense for denne rytter").
//   2. Dagen efter en etape: foerste felt (slot 0) paa datoen er Aktiv
//      restitution, hvis rytteren koerte en etape paa den foregaaende dato.
//
// ═══ HVORDAN DET VIRKER ═════════════════════════════════════════════════════
//   · Reglen vurderes paa traethed VED DATOENS START (aabningstilstanden efter
//     nattens opgoerelse, #5928). Resultatet er dermed ens uanset hvornaar
//     spilleren logger ind eller trykker "Traen nu" (spec I1).
//   · Reglen RETTER ALDRIG planen (training_week_plans / training_plans). Den
//     erstatter kun det pas der faktisk koeres paa den ene loebsdag. Er rytteren
//     under graensen dagen efter, koerer han sit valgte program igen ("retur til
//     program", #5620) uden at nogen har rettet noget.
//   · Loeb er loeb: koerer eller er rytteren bundet til et loeb, eller er han
//     skadet, bruges programmet slet ikke, og reglen stemples ikke.
//   · Rapport-linjen faar `fatigue_rule` naar reglen slog til, saa ugestriben kan
//     vise hvilke dage og hvorfor.
//
// Rene funktioner herunder (ingen Date, ingen Math.random). DB-opslagene staar
// nederst og bruges af motoren og API'et.

import { programForChoice, RECOVERY_FOCUS, RECOVERY_INTENSITY } from "./trainingDayTypes.js";
import { evaluateFlagStage, readFlagStage } from "./featureStage.js";

export const TRAINING_FATIGUE_RULES_FLAG_KEY = "training_fatigue_rules";

// Erstatnings-passene, svageste foerst. "off" findes kun paa en rytter-undtagelse
// og betyder "ingen traethedsgraense for denne rytter".
export const FATIGUE_RULE_FALLBACKS = Object.freeze(["light", "recovery", "rest"] as const);
export type FatigueFallback = (typeof FATIGUE_RULE_FALLBACKS)[number];
const FALLBACK_RANK: Record<FatigueFallback, number> = { light: 1, recovery: 2, rest: 3 };

export type FatigueRuleRow = {
  rider_id: string | null;
  fatigue_threshold: number | null;
  fallback: string | null;
  recovery_after_stage: boolean | null;
};

export type ResolvedFatigueRule = {
  threshold: number | null;
  fallback: FatigueFallback | null;
  recoveryAfterStage: boolean;
};

export type FatigueRuleStamp = {
  kind: "fatigue" | "after_stage";
  fallback: FatigueFallback;
  fatigue: number;
  threshold: number | null;
  from_intensity: string;
};

export function isFatigueFallback(value: unknown): value is FatigueFallback {
  return typeof value === "string" && (FATIGUE_RULE_FALLBACKS as readonly string[]).includes(value);
}

export function isValidThreshold(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100;
}

// Rytterens regel slaar holdets (samme stige som TRAINING_RULES §4).
//   · Rytter-raekke med fallback "off"           → ingen traethedsgraense.
//   · Rytter-raekke med graense + fallback       → rytterens egen.
//   · Rytter-raekke uden graense (begge null)    → foelg holdet.
//   · recovery_after_stage null paa rytteren     → foelg holdet.
export function resolveRiderFatigueRule(
  teamRule: FatigueRuleRow | null | undefined,
  riderRule: FatigueRuleRow | null | undefined,
): ResolvedFatigueRule {
  let threshold: number | null = null;
  let fallback: FatigueFallback | null = null;
  const teamFatigueOk = teamRule && isValidThreshold(teamRule.fatigue_threshold) && isFatigueFallback(teamRule.fallback);
  if (riderRule && riderRule.fallback === "off") {
    threshold = null;
    fallback = null;
  } else if (riderRule && isValidThreshold(riderRule.fatigue_threshold) && isFatigueFallback(riderRule.fallback)) {
    threshold = riderRule.fatigue_threshold;
    fallback = riderRule.fallback;
  } else if (teamFatigueOk) {
    threshold = teamRule!.fatigue_threshold;
    fallback = teamRule!.fallback as FatigueFallback;
  }
  const riderAfter = riderRule?.recovery_after_stage;
  const recoveryAfterStage = typeof riderAfter === "boolean" ? riderAfter : teamRule?.recovery_after_stage === true;
  return { threshold, fallback, recoveryAfterStage };
}

// Erstatnings-passet for et (focus, intensity)-par. null = passet er allerede
// lige saa let eller lettere, saa reglen aendrer intet (og stemples ikke).
//   light    : samme session, men paa let belastning (fokus bevares). Kun hvis
//              dagen er normal eller haard.
//   recovery : Aktiv restitution, med mindre dagen allerede er restitution/hvile.
//   rest     : Hvile (spillerens fokus bevares hen over hviledagen, samme
//              regel som programForChoice), med mindre dagen allerede er hvile.
export function downgradeProgram(
  program: { focus: string | null | undefined; intensity: string | null | undefined },
  fallback: FatigueFallback,
): { focus: string; intensity: string } | null {
  const intensity = program.intensity ?? "normal";
  if (intensity === "rest") return null;
  if (fallback === "rest") {
    const previousFocus = program.focus === RECOVERY_FOCUS ? null : program.focus ?? null;
    const chosen = programForChoice({ dayType: "rest", previousFocus });
    return chosen.ok ? { focus: chosen.focus as string, intensity: chosen.intensity as string } : null;
  }
  if (intensity === RECOVERY_INTENSITY || program.focus === RECOVERY_FOCUS) return null;
  if (fallback === "recovery") return { focus: RECOVERY_FOCUS, intensity: RECOVERY_INTENSITY };
  if (intensity === "normal" || intensity === "hard") {
    return { focus: program.focus ?? "endurance", intensity: "easy" };
  }
  return null;
}

// Dagens pas for EEN rytter paa EEN loebsdag efter reglerne.
//   fatigueAtDateStart  : traethed ved datoens start (aabningstilstanden).
//   slotIndex           : loebsdagens plads paa datoen (0 = foerste felt).
//   rodeStagePreviousDate: koerte rytteren en etape paa den foregaaende dato?
// Gaelder begge regler, vinder det tungeste erstatnings-pas (Hvile > Aktiv
// restitution > Let). Returnerer { focus, intensity, stamp } hvor stamp er null
// naar intet blev aendret.
export function applyFatigueRules({
  program, rule, fatigueAtDateStart, slotIndex = 0, rodeStagePreviousDate = false,
}: {
  program: { focus: string | null | undefined; intensity: string | null | undefined };
  rule: ResolvedFatigueRule | null | undefined;
  fatigueAtDateStart: number;
  slotIndex?: number;
  rodeStagePreviousDate?: boolean;
}): { focus: string | null | undefined; intensity: string | null | undefined; stamp: FatigueRuleStamp | null } {
  const unchanged = { focus: program.focus, intensity: program.intensity, stamp: null };
  if (!rule) return unchanged;
  const fatigue = Number(fatigueAtDateStart);
  const candidates: Array<{ kind: FatigueRuleStamp["kind"]; fallback: FatigueFallback }> = [];
  if (rule.threshold != null && rule.fallback && Number.isFinite(fatigue) && fatigue > rule.threshold) {
    candidates.push({ kind: "fatigue", fallback: rule.fallback });
  }
  if (rule.recoveryAfterStage && slotIndex === 0 && rodeStagePreviousDate) {
    candidates.push({ kind: "after_stage", fallback: "recovery" });
  }
  candidates.sort((a, b) => FALLBACK_RANK[b.fallback] - FALLBACK_RANK[a.fallback]);
  for (const candidate of candidates) {
    const next = downgradeProgram(program, candidate.fallback);
    if (!next) continue;
    return {
      focus: next.focus,
      intensity: next.intensity,
      stamp: {
        kind: candidate.kind,
        fallback: candidate.fallback,
        fatigue: Number.isFinite(fatigue) ? Math.round(fatigue) : 0,
        threshold: candidate.kind === "fatigue" ? rule.threshold : null,
        from_intensity: program.intensity ?? "normal",
      },
    };
  }
  return unchanged;
}

// ── DB ─────────────────────────────────────────────────────────────────────

type Supa = { from: (table: string) => any };

// Tabellen kan mangle et par minutter efter deploy (auto-migrate.yml, #2642).
// Saa findes der ingen regler endnu, og motoren koerer praecis som foer.
export function isMissingRulesTable(error: { code?: string; message?: string } | null | undefined): boolean {
  return error?.code === "42P01" || error?.code === "PGRST205";
}

export async function isTrainingFatigueRulesEnabled(supabase: Supa, opts: { isBetaTester?: boolean } = {}) {
  return evaluateFlagStage(await readFlagStage(supabase, TRAINING_FATIGUE_RULES_FLAG_KEY), opts);
}

// Motorens svar for ET hold (ingen viewer): on → true; beta → kun hvis holdets
// ejer er beta-tester. KASTER ved et fejlet opslag (samme kontrakt som
// isTrainingProgramsEnabledForTeam): et gaet er en anden session end spilleren
// har bedt om. Naeste sweep proever igen. ASCII-only beskeder.
async function isEnabledForTeam(supabase: Supa, teamId: string): Promise<boolean> {
  const { data: flagRow, error: flagError } = await supabase
    .from("app_config").select("value").eq("key", TRAINING_FATIGUE_RULES_FLAG_KEY).maybeSingle();
  if (flagError) throw new Error(`training_fatigue_rules flag load: ${flagError.message ?? flagError}`);
  const stage = flagRow?.value ?? null;
  if (stage === true || stage === "on") return true;
  if (stage !== "beta") return false;
  const { data: team, error: teamError } = await supabase
    .from("teams").select("user_id").eq("id", teamId).maybeSingle();
  if (teamError) throw new Error(`training_fatigue_rules owner load (team ${teamId}): ${teamError.message ?? teamError}`);
  if (!team?.user_id) return false;
  const { data: user, error: userError } = await supabase
    .from("users").select("role, is_beta_tester").eq("id", team.user_id).maybeSingle();
  if (userError) throw new Error(`training_fatigue_rules owner beta load (team ${teamId}): ${userError.message ?? userError}`);
  return user?.role === "admin" || user?.is_beta_tester === true;
}

export async function loadFatigueRuleRows(supabase: Supa, teamId: string) {
  return supabase.from("team_training_rules")
    .select("rider_id, fatigue_threshold, fallback, recovery_after_stage")
    .eq("team_id", teamId);
}

export type TeamFatigueRules = {
  forRider: (riderId: string) => ResolvedFatigueRule;
  anyAfterStage: (riderIds: string[]) => boolean;
};

// Holdets regler til motoren, eller null naar holdet ingen har (eller flaget er
// slukket for holdet). Hold uden regler betaler ét opslag og intet andet.
export async function loadTeamFatigueRules(supabase: Supa, teamId: string): Promise<TeamFatigueRules | null> {
  const { data, error } = await loadFatigueRuleRows(supabase, teamId);
  if (error) {
    if (isMissingRulesTable(error)) return null;
    throw new Error(`training fatigue rules load (team ${teamId}): ${error.message ?? error}`);
  }
  const rows = (data ?? []) as FatigueRuleRow[];
  if (rows.length === 0) return null;
  if (!(await isEnabledForTeam(supabase, teamId))) return null;
  const teamRule = rows.find((row) => row.rider_id == null) ?? null;
  const riderRules = new Map(rows.filter((row) => row.rider_id != null).map((row) => [row.rider_id as string, row]));
  const forRider = (riderId: string) => resolveRiderFatigueRule(teamRule, riderRules.get(riderId) ?? null);
  return {
    forRider,
    anyAfterStage: (riderIds) => riderIds.some((id) => forRider(id).recoveryAfterStage),
  };
}

// Hvem af rytterne koerte en etape paa `previousDate`? Kilden er etape-
// regnskabet training_race_loads (én raekke pr. koert etape, skrevet af loebet,
// #5928). Kun brugt naar mindst én rytter har reglen sat, og kun paa datoens
// foerste felt. KASTER ved fejl (regel-gate: et gaet giver et andet pas).
export async function loadRiderIdsWithStageOnDate(
  supabase: Supa, { riderIds, previousDate }: { riderIds: string[]; previousDate: string },
): Promise<Set<string>> {
  if (riderIds.length === 0) return new Set();
  // pagination-safe: ét holds ryttere paa én dato (maks 5 etaper pr. rytter).
  const { data, error } = await supabase.from("training_race_loads")
    .select("rider_id").eq("tick_date", previousDate).in("rider_id", riderIds);
  if (error) throw new Error(`training fatigue rules stage lookup (${previousDate}): ${error.message ?? error}`);
  return new Set(((data ?? []) as Array<{ rider_id: string }>).map((row) => row.rider_id));
}

export function previousDateString(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
