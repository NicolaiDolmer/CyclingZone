// Traeningsgrupper (#6000, beta): een beslutning for flere ryttere.
// Ejer-godkendt mockup 1/10 (docs/design/mockups-traen-nu-2026-09-29/training-groups-2026-10-01.png).
//
// ═══ HVAD EN GRUPPE ER ══════════════════════════════════════════════════════
// Et navn, en liste ryttere (hoejst een gruppe pr. rytter) og gruppens 35
// felter. Gruppen er IKKE et nyt lag i motoren: en gruppe-aendring skriver en
// KOPI ind i hver foelgende rytters egen raekke i training_week_plans (samme
// ejer-valg 1 som programmer, 26/9). Motoren laeser derfor praecis som i dag.
//
// ═══ STIGEN: RYTTER → GRUPPE → HOLD (mockup pin 6) ══════════════════════════
//   · Rytterens egen plan vinder: retter spilleren rytterens egne felter, saettes
//     `follows_group` = false, og gruppen roerer ham ikke mere (indtil spilleren
//     vaelger "Follow group" igen).
//   · Ellers gruppens plan (kopien i hans raekke).
//   · Ellers holdets plan (som i dag).
//
// ═══ REGEL A (pin 3) ════════════════════════════════════════════════════════
// Et felt med en etape er laast af loebet. Motoren springer allerede passet over
// paa en loebsdag hvor rytteren koerer (ejer-valg 2, "loeb er loeb"), saa en
// gruppe-aendring i det felt aendrer intet for ham: han beholder etapen.
//
// ═══ TRAETHEDSGRAENSE (pin 5) ═══════════════════════════════════════════════
// En gruppe kan faa sin egen undtagelse (graense + erstatning, eller "ingen
// graense"). Stigen er den samme: rytterens egen undtagelse → gruppens → holdets.
//
// Rene funktioner oeverst, DB-opslag nederst.

import { WEEKDAY_KEYS } from "./training.js";
import { readFlagStage, evaluateFlagStage } from "./featureStage.js";
import { isValidProgramWeekDays } from "./trainingPrograms.js";
import type { FatigueRuleRow } from "./trainingFatigueRules.ts";

export const TRAINING_GROUPS_FLAG_KEY = "training_groups";
export const GROUP_NAME_MAX = 40;
export const GROUPS_TABLE = "training_groups";
export const MEMBERS_TABLE = "training_group_members";

export type GroupRow = {
  id: string;
  team_id: string;
  name: string;
  days: unknown;
  program_key: string | null;
  fatigue_threshold: number | null;
  fallback: string | null;
};

export type MemberRow = {
  rider_id: string;
  group_id: string;
  team_id: string;
  follows_group: boolean;
};

type WeekDays = Record<string, unknown>;

// ── Rene funktioner ─────────────────────────────────────────────────────────

// Navnet trimmes; 1..40 tegn. null = ugyldigt.
export function normalizeGroupName(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (trimmed.length < 1 || trimmed.length > GROUP_NAME_MAX) return null;
  return trimmed;
}

// Unikke rytter-id'er der faktisk er holdets egne (fremmede id'er og dubletter
// falder fra). null = input er ikke en liste af strenge.
export function sanitizeRiderIds(riderIds: unknown, ownIds: readonly string[]): string[] | null {
  if (!Array.isArray(riderIds) || !riderIds.every((id) => typeof id === "string")) return null;
  const own = new Set(ownIds);
  return [...new Set(riderIds as string[])].filter((id) => own.has(id));
}

// Hvem foelger gruppen? Medlemmer der stadig er holdets ryttere og ikke har
// faaet deres egen plan rettet bagefter.
export function followerIds(members: readonly MemberRow[], groupId: string, ownIds: readonly string[]): string[] {
  const own = new Set(ownIds);
  return members
    .filter((m) => m.group_id === groupId && m.follows_group !== false && own.has(m.rider_id))
    .map((m) => m.rider_id);
}

// Gruppens felter, eller - foer spilleren har rettet noget - startpunktet:
// foerste medlems nuvaerende uge (hans egne felter, ellers hans saaede uge).
// Medlemmerne sorteres, saa svaret er det samme fra GET og fra PUT /cell.
export function groupSeedDays({
  group, memberIds, ownDaysByRider, seedsByRider,
}: {
  group: Pick<GroupRow, "days">;
  memberIds: readonly string[];
  ownDaysByRider: ReadonlyMap<string, unknown>;
  seedsByRider: Readonly<Record<string, unknown>>;
}): { days: WeekDays | null; isSeed: boolean } {
  if (isValidProgramWeekDays(group.days)) return { days: group.days as WeekDays, isSeed: false };
  for (const riderId of [...memberIds].sort()) {
    const own = ownDaysByRider.get(riderId);
    if (isValidProgramWeekDays(own)) return { days: own as WeekDays, isSeed: true };
    const seed = seedsByRider[riderId];
    if (isValidProgramWeekDays(seed)) return { days: seed as WeekDays, isSeed: true };
  }
  return { days: null, isSeed: true };
}

// Gruppens undtagelse som en rytter-raekke (samme form som team_training_rules),
// eller null naar gruppen ingen undtagelse har.
export function groupRuleRow(group: Pick<GroupRow, "fatigue_threshold" | "fallback">): FatigueRuleRow | null {
  if (group.fallback === "off") {
    return { rider_id: null, fatigue_threshold: null, fallback: "off", recovery_after_stage: null };
  }
  if (["light", "recovery", "rest"].includes(group.fallback ?? "") && Number.isInteger(group.fatigue_threshold)) {
    return { rider_id: null, fatigue_threshold: group.fatigue_threshold, fallback: group.fallback, recovery_after_stage: null };
  }
  return null;
}

// Den raekke resolveRiderFatigueRule skal se for rytteren: hans egen undtagelse
// hvis han har en graense eller "off", ellers gruppens (med hans egen
// "dagen efter en etape"-indstilling bevaret), ellers hans egen raekke som foer.
export function effectiveRiderRuleRow(
  riderRule: FatigueRuleRow | null | undefined,
  groupRule: FatigueRuleRow | null | undefined,
): FatigueRuleRow | null {
  const ownLimit = !!riderRule && (riderRule.fallback === "off" || Number.isInteger(riderRule.fatigue_threshold));
  if (ownLimit || !groupRule) return riderRule ?? null;
  return {
    ...groupRule,
    rider_id: riderRule?.rider_id ?? null,
    recovery_after_stage: riderRule?.recovery_after_stage ?? null,
  };
}

// Validering af en undtagelse fra klienten: { mode: "team" | "own" | "off", threshold?, fallback? }.
export function groupFatiguePatch(body: unknown): { fatigue_threshold: number | null; fallback: string | null } | null {
  const { mode, threshold = null, fallback = null } = (body ?? {}) as Record<string, unknown>;
  if (mode === "team") return { fatigue_threshold: null, fallback: null };
  if (mode === "off") return { fatigue_threshold: null, fallback: "off" };
  if (mode === "own"
    && typeof threshold === "number" && Number.isInteger(threshold) && threshold >= 0 && threshold <= 100
    && typeof fallback === "string" && ["light", "recovery", "rest"].includes(fallback)) {
    return { fatigue_threshold: threshold, fallback };
  }
  return null;
}

// En selvstaendig kopi af gruppens uge (ingen delte objekter mellem raekker).
export function copyWeekDays(days: WeekDays): WeekDays {
  const out: WeekDays = {};
  for (const weekday of WEEKDAY_KEYS) {
    const entry = days[weekday] as { session: string; intensity: string; slots?: Array<string | null> };
    out[weekday] = {
      session: entry.session,
      intensity: entry.intensity,
      ...(entry.slots ? { slots: [...entry.slots] } : {}),
    };
  }
  return out;
}

// ── DB ─────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supa = { from: (table: string) => any };
type PgError = { code?: string; message?: string } | null | undefined;

// Tabellerne kan mangle et par minutter efter deploy (auto-migrate.yml, #2642).
export function isMissingGroupsTable(error: PgError): boolean {
  return error?.code === "42P01" || error?.code === "PGRST205";
}

export async function isTrainingGroupsEnabled(supabase: Supa, opts: { isBetaTester?: boolean } = {}) {
  return evaluateFlagStage(await readFlagStage(supabase, TRAINING_GROUPS_FLAG_KEY), opts);
}

// Motorens svar for ET hold (ingen viewer): on → true; beta → kun hvis holdets
// ejer er beta-tester. KASTER ved et fejlet opslag (regel-gate, samme kontrakt
// som trainingFatigueRules.ts). ASCII-only beskeder.
async function isEnabledForTeam(supabase: Supa, teamId: string): Promise<boolean> {
  const { data: flagRow, error: flagError } = await supabase
    .from("app_config").select("value").eq("key", TRAINING_GROUPS_FLAG_KEY).maybeSingle();
  if (flagError) throw new Error(`training_groups flag load: ${flagError.message ?? flagError}`);
  const stage = flagRow?.value ?? null;
  if (stage === true || stage === "on") return true;
  if (stage !== "beta") return false;
  const { data: team, error: teamError } = await supabase
    .from("teams").select("user_id").eq("id", teamId).maybeSingle();
  if (teamError) throw new Error(`training_groups owner load (team ${teamId}): ${teamError.message ?? teamError}`);
  if (!team?.user_id) return false;
  const { data: user, error: userError } = await supabase
    .from("users").select("role, is_beta_tester").eq("id", team.user_id).maybeSingle();
  if (userError) throw new Error(`training_groups owner beta load (team ${teamId}): ${userError.message ?? userError}`);
  return user?.role === "admin" || user?.is_beta_tester === true;
}

// Holdets grupper + medlemmer. Manglende tabeller = ingen grupper.
export async function loadTeamGroups(supabase: Supa, teamId: string): Promise<{ groups: GroupRow[]; members: MemberRow[] }> {
  const [groupsRes, membersRes] = await Promise.all([
    supabase.from(GROUPS_TABLE)
      .select("id, team_id, name, days, program_key, fatigue_threshold, fallback")
      .eq("team_id", teamId).order("created_at", { ascending: true }),
    supabase.from(MEMBERS_TABLE).select("rider_id, group_id, team_id, follows_group").eq("team_id", teamId),
  ]);
  if (isMissingGroupsTable(groupsRes.error) || isMissingGroupsTable(membersRes.error)) return { groups: [], members: [] };
  if (groupsRes.error) throw new Error(`training groups load: ${groupsRes.error.message}`);
  if (membersRes.error) throw new Error(`training group members load: ${membersRes.error.message}`);
  return { groups: (groupsRes.data ?? []) as GroupRow[], members: (membersRes.data ?? []) as MemberRow[] };
}

// Gruppernes traethedsundtagelser til motoren og prognosen: rider_id → raekke.
// Hold uden gruppe-undtagelser betaler eet opslag og intet andet. KASTER ved
// fejl (regel-gate: et gaet giver et andet pas); manglende tabel = ingen.
export async function loadGroupFatigueRuleRows(supabase: Supa, teamId: string): Promise<Map<string, FatigueRuleRow>> {
  const out = new Map<string, FatigueRuleRow>();
  const { data, error } = await supabase.from(GROUPS_TABLE)
    // pagination-safe: one team's groups (a handful).
    .select("id, fatigue_threshold, fallback").eq("team_id", teamId);
  if (error) {
    if (isMissingGroupsTable(error)) return out;
    throw new Error(`training group rules load (team ${teamId}): ${error.message ?? error}`);
  }
  const rules = new Map<string, FatigueRuleRow>();
  for (const group of (data ?? []) as GroupRow[]) {
    const row = groupRuleRow(group);
    if (row) rules.set(group.id, row);
  }
  if (rules.size === 0) return out;
  if (!(await isEnabledForTeam(supabase, teamId))) return out;
  const { data: members, error: membersError } = await supabase.from(MEMBERS_TABLE)
    .select("rider_id, group_id").eq("team_id", teamId).in("group_id", [...rules.keys()]);
  if (membersError) throw new Error(`training group rule members load (team ${teamId}): ${membersError.message ?? membersError}`);
  for (const member of (members ?? []) as MemberRow[]) {
    const row = rules.get(member.group_id);
    if (row) out.set(member.rider_id, { ...row, rider_id: member.rider_id });
  }
  return out;
}

// Spilleren retter disse rytteres EGEN plan: de foelger ikke laengere gruppen.
// Kaldes FOER rettelsen skrives og KASTER ved fejl (CodeRabbit-fund): ellers
// kunne rettelsen gemmes, mens rytteren stadig staar som foelger, og naeste
// gruppe-aendring ville overskrive hans egen plan. Lykkes markeringen, men
// rettelsen fejler, er rytteren blot koblet fra med sin uaendrede plan.
// En manglende tabel (foer migrationen) = ingen grupper = intet at markere.
export async function markRidersOwnPlan(supabase: Supa, teamId: string, riderIds: readonly string[]): Promise<void> {
  // Kaldes med een rytter ad gangen (et felt / et program paa een rytter).
  for (const riderId of riderIds) {
    const { error } = await supabase.from(MEMBERS_TABLE).update({ follows_group: false })
      .eq("team_id", teamId).eq("rider_id", riderId);
    if (error && !isMissingGroupsTable(error)) throw new Error(`training groups own-plan mark: ${error.message}`);
  }
}

// "Hele truppen" fik et program: alle gruppers felter bliver det samme program,
// saa gruppens viste plan og medlemmernes kopi ikke siger to forskellige ting.
// Fail-safe som markRidersOwnPlan.
export async function syncGroupsToSquadProgram(
  supabase: Supa, teamId: string, programKey: string, days: WeekDays, report: (err: Error) => void = () => {},
): Promise<void> {
  try {
    const { error } = await supabase.from(GROUPS_TABLE)
      .update({ days, program_key: programKey, updated_at: new Date().toISOString() }).eq("team_id", teamId);
    // Fejlede gruppe-opdateringen, meldes ingen ind igen (CodeRabbit-fund):
    // ellers ville de foelge en gruppe der stadig baerer det gamle program.
    if (error) {
      if (!isMissingGroupsTable(error)) report(new Error(`training groups squad sync: ${error.message}`));
      return;
    }
    const { error: followError } = await supabase.from(MEMBERS_TABLE).update({ follows_group: true }).eq("team_id", teamId);
    if (followError && !isMissingGroupsTable(followError)) report(new Error(`training groups squad follow: ${followError.message}`));
  } catch (err) {
    report(err instanceof Error ? err : new Error(String(err)));
  }
}
