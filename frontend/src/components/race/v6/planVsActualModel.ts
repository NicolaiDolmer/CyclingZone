// #7865 · Løbssiden v6 trin 2a: Taktik på en kørt etape viser planen mod det der
// skete (beslutningslisten på #7778, valg 11 og 14; spec S9 i
// docs/drafts/spec-natboelge-2026-11-15.md). Ren logik, ingen React, intet netværk.
//
// Kilder, ingen andre:
//   - planen: holdets gemte etapeplan pr. rytter (GET team-orders, kun eget hold);
//   - det der skete: etapens optegnelse (tidslinjen) og målresultatet.
// Reglerne for hvert trin er de samme som Taktik-fanens opsummering i dag
// (stagePlanRecap + stagePlanOutcomes i StagePlanModel.ts), så de to steder aldrig
// siger noget forskelligt. Her lægges kun tre ting til:
//   1. Et trin uden hændelse i optegnelsen er "ikke set", aldrig "mislykket".
//   2. Et angreb på en stigning står som filmen viser det: ved en topankomst to
//      linjer (angrebet ved foden, udfaldet dér hvor motoren stemplede det), i
//      rigtig rækkefølge og aldrig som interval (valg 14, #8033).
//   3. Kun egne ryttere og ingen samlet dom over dagen.
// Ingen nye forklaringer fra motoren: teksterne er de kendsgerninger optegnelsen
// allerede bærer.
import {
  isStagePlanTask, planWithoutJerseyHunt, stagePlanOutcomes, stagePlanRecap,
  type StagePlanLeg, type StagePlanRecapItem, type StagePlanTask, type StagePlanTrigger,
} from "../StagePlanModel.ts";
import { ridersSplitKm, stagePlanContactFacts, type TimelineEvent } from "../../../lib/stageSplitTimes.ts";
import { honestTimelineEvents, type SpanClimb, type SpanTimelineEvent } from "../../../lib/stageTimelineKmSpan.ts";
import { roleRank } from "../../../lib/stageRoleVocabulary.ts";

/**
 * Markeringen for ét trin:
 *   seen        = optegnelsen viser trinnet som planlagt (grøn)
 *   differs     = optegnelsen viser noget andet (gul)
 *   fact        = en kendsgerning uden dom (placering, hvem han sad med)
 *   not_reached = rytteren nåede aldrig til trinnet (kæden stoppede før)
 *   not_seen    = intet i optegnelsen siger noget om trinnet
 */
export type StepMark = "seen" | "differs" | "fact" | "not_reached" | "not_seen";

export interface StepLine {
  /** i18n-nøgle i races-namespace. */
  key: string;
  params?: Record<string, string | number>;
  /** Hvor på ruten (km), når optegnelsen kender stedet. */
  km?: number | null;
}

export interface StepEnd {
  reason: string;
  km: number | null;
  /** Stigningens index, når trinnet sluttede på toppen af den. */
  komIndex: number | null;
}

export interface PlanStep {
  index: number;
  task: StagePlanTask;
  /** Trinnets skift-punkt som planen satte det; null for første trin. */
  from: StagePlanTrigger | null;
  previousTask: StagePlanTask | null;
  mark: StepMark;
  /** Hvor trinnet sluttede ifølge optegnelsen; null = ukendt eller ikke nået. */
  end: StepEnd | null;
  /** Det optegnelsen viser for trinnet, i rækkefølge. Tom = ingen linje. */
  lines: StepLine[];
}

export interface RiderPlanVsActual {
  riderId: string;
  name: string | null;
  role: string | null;
  /** false = holdet gemte ingen plan for rytteren; han kørte på sin rolle. */
  planned: boolean;
  steps: PlanStep[];
  /** Kun uden plan: det optegnelsen viser for hele dagen. */
  dayLines: StepLine[];
  /** Motoren kørte planen uden trøjejagt, fordi jagten var slukket (#7855). */
  ranWithoutHunt: boolean;
}

export interface TeamOrdersLike {
  riders?: Array<{ rider_id: string; race_role?: string | null }>;
  orders?: Array<{ stage_number: number; riders?: unknown[] }>;
}

export interface StageRolesLike {
  riders?: Array<{ rider_id: string; name?: string | null; race_role?: string | null; abandoned?: boolean }>;
  overrides?: Array<{ stage_number: number; rider_id: string; race_role?: string | null }>;
}

type Rec = Record<string, unknown>;
type RawEvent = { type?: string; km?: number; params?: Rec | null } & Rec;

const LEADER_ROLES = ["captain", "co_captain", "sprint_captain"];
const CLIMB_ATTACKS = new Set(["all_out_gain", "all_out_cracked"]);

const OUTCOME_TO_MARK: Record<string, StepMark> = {
  done: "seen",
  failed: "differs",
  info: "fact",
  not_reached: "not_reached",
  none: "not_seen",
};

function str(value: unknown): string | null {
  return typeof value === "string" && value ? value : typeof value === "number" ? String(value) : null;
}

function finite(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Kun en kæde hvor hvert led har en kendt opgave er en plan; alt andet = ingen plan. */
export function legsFromRaw(raw: unknown): StagePlanLeg[] | null {
  if (!Array.isArray(raw) || !raw.length) return null;
  const legs: StagePlanLeg[] = [];
  for (const leg of raw as Array<Rec | null>) {
    if (!leg || !isStagePlanTask(leg.task)) return null;
    const from = leg.from as StagePlanTrigger | undefined;
    const out: StagePlanLeg = { task: leg.task };
    if (from && typeof from === "object" && typeof (from as Rec).at === "string") out.from = from;
    if (typeof leg.hunt === "string") out.hunt = leg.hunt as StagePlanLeg["hunt"];
    legs.push(out);
  }
  return legs;
}

/** Den rytter holdarbejdet gjaldt: motorens rækkefølge for holdets leder (samme som Taktik-fanen). */
function teamLeaderFor(riderId: string, roleOf: Map<string, string | null>, nameOf: (id: string) => string | null): { id: string; name: string } | null {
  for (const role of LEADER_ROLES) {
    for (const [id, r] of roleOf) {
      if (id !== riderId && r === role) {
        const name = nameOf(id);
        if (name) return { id, name };
      }
    }
  }
  return null;
}

/**
 * Angrebet på en stigning, som filmen viser det: to linjer ved en topankomst
 * (foden uden resultat, derefter udfaldet), ellers én linje ved toppen.
 * `within` afgør om linjen hører til trinnet (efter motorens eget stempel).
 */
function climbAttackLines(shown: readonly SpanTimelineEvent[], riderId: string, within: (km: number) => boolean): { lines: StepLine[]; held: boolean } | null {
  const mine = shown.filter((e) => CLIMB_ATTACKS.has(e.type ?? "") && str(e.params?.rider_id) === riderId);
  const lines: StepLine[] = [];
  let held: boolean | null = null;
  for (const e of mine) {
    const stamp = finite(e.recorded_km) ?? finite(e.km);
    if (stamp == null || !within(stamp)) continue;
    const km = finite(e.km);
    if (e.climb_phase === "attack") {
      lines.push(e.climb_name
        ? { key: "racePageV6.tacticsAfter.line.attackFootNamed", params: { climb: e.climb_name }, km }
        : { key: "racePageV6.tacticsAfter.line.attackFoot", km });
      continue;
    }
    const gain = e.type === "all_out_gain";
    held = gain;
    lines.push({ key: gain ? "racePageV6.tacticsAfter.line.attackHeld" : "racePageV6.tacticsAfter.line.attackCracked", km });
  }
  return lines.length && held !== null ? { lines, held } : null;
}

/** Kom han i udbruddet? Kun når optegnelsen navngiver ham. */
function breakLine(events: readonly RawEvent[], riderId: string): StepLine | null {
  const named = (type: string) => events.find((e) => e?.type === type && Array.isArray(e.params?.rider_ids) && (e.params?.rider_ids as unknown[]).map(String).includes(riderId));
  const formed = named("breakaway_formed");
  if (formed) return { key: "stagePlan.recap.outcome.inBreak", km: finite(formed.km) };
  return named("breakaway_attempt") ? { key: "stagePlan.recap.outcome.failed" } : null;
}

export interface PlanVsActualInput {
  /** fetchTeamOrders-svaret (kun eget hold). null = ukendt. */
  orders: TeamOrdersLike | null | undefined;
  stageRoles?: StageRolesLike | null | false;
  stageNumber: number;
  /** Egne ryttere der kørte etapen; tom = holdets udtagelse fra ordre-svaret. */
  riderIds: readonly string[];
  nameOf: (id: string) => string | null;
  /** Etapens optegnelse (tidslinjens rå events). */
  events: readonly RawEvent[];
  timelineVersion: number | null;
  /** Etapeprofilens stigninger (foden udledes af dem). */
  climbs?: readonly SpanClimb[] | null;
  /** Placering på etapen fra målresultatet. */
  rankOf?: (id: string) => number | null;
}

/** Planen mod det der skete for hver egen rytter (kaptajnen først). */
export function planVsActual(input: PlanVsActualInput): RiderPlanVsActual[] {
  const { orders, stageRoles = null, stageNumber, nameOf, timelineVersion, climbs = null, rankOf = () => null } = input;
  const events = input.events ?? [];
  if (!orders) return [];
  const roster = (orders.riders ?? []).map((r) => String(r.rider_id));
  const ids = input.riderIds.length ? input.riderIds.map(String) : roster;
  if (!ids.length) return [];

  const roles = stageRoles || null;
  const roleOf = new Map<string, string | null>();
  for (const r of roles?.riders ?? []) roleOf.set(String(r.rider_id), r.race_role ?? null);
  for (const r of orders.riders ?? []) if (r.race_role) roleOf.set(String(r.rider_id), r.race_role);
  for (const o of roles?.overrides ?? []) {
    if (Number(o.stage_number) === stageNumber && o.race_role) roleOf.set(String(o.rider_id), o.race_role);
  }
  const row = (orders.orders ?? []).find((o) => Number(o.stage_number) === stageNumber) ?? null;
  const planOf = new Map<string, StagePlanLeg[] | null>();
  for (const r of (row?.riders ?? []) as Array<Rec | null>) {
    const id = str(r?.rider_id);
    if (id) planOf.set(id, legsFromRaw(r?.plan));
  }

  const film = events as TimelineEvent[];
  const shown = honestTimelineEvents(events as SpanTimelineEvent[], { timelineVersion, climbs });

  const out = ids.map((riderId): RiderPlanVsActual => {
    const name = nameOf(riderId);
    const role = roleOf.get(riderId) ?? null;
    const saved = planOf.get(riderId) ?? null;
    const ranWithoutHunt = events.some((e) => e?.type === "stage_plan_hunt_fallback" && str(e.params?.rider_id) === riderId);
    const rank = rankOf(riderId);

    if (!saved) {
      const dayLines: StepLine[] = [];
      const brk = breakLine(events, riderId);
      if (brk) dayLines.push(brk);
      const attack = climbAttackLines(shown, riderId, () => true);
      if (attack) dayLines.push(...attack.lines);
      if (rank != null) dayLines.push({ key: "stagePlan.recap.outcome.rank", params: { rank } });
      return { riderId, name, role, planned: false, steps: [], dayLines, ranWithoutHunt };
    }

    const legs = ranWithoutHunt ? planWithoutJerseyHunt(saved) : saved;
    const items = stagePlanRecap(legs, events as Array<{ type?: unknown; km?: unknown; params?: Rec | null }>, riderId);
    const leader = teamLeaderFor(riderId, roleOf, nameOf);
    const outcomes = stagePlanOutcomes(items, events as Array<{ type?: unknown; km?: unknown; params?: Rec | null }>, riderId, {
      ...stagePlanContactFacts(film, riderId),
      rank,
      leader: leader ? { name: leader.name, splitKm: (fromKm: number, toKm: number) => ridersSplitKm(film, riderId, leader.id, fromKm, toKm) } : null,
    });

    const steps = items.map((item: StagePlanRecapItem, i): PlanStep => {
      const outcome = outcomes[i];
      let mark: StepMark = OUTCOME_TO_MARK[outcome.mark] ?? "not_seen";
      let lines: StepLine[] = outcome.word ? [{ key: outcome.word.key, ...(outcome.word.params ? { params: outcome.word.params } : {}) }] : [];
      const ran = item.status !== "skipped" && item.status !== "not_reached";
      // Et angreb på en stigning står som filmen viser det (valg 14), og afløser den korte linje.
      if (ran && item.task === "attack") {
        const from = item.fromKm ?? 0;
        const to = item.endKm ?? Infinity;
        const attack = climbAttackLines(shown, riderId, (km) => km > from && km <= to);
        if (attack) {
          lines = attack.lines;
          mark = attack.held ? "seen" : "differs";
        }
      }
      const endFrom = item.endLeg == null ? undefined : legs[item.endLeg]?.from;
      const end: StepEnd | null = ran && item.endReason
        ? { reason: item.endReason, km: item.endKm == null ? null : item.endKm, komIndex: endFrom?.at === "kom" ? endFrom.kom_index : null }
        : null;
      return {
        index: i,
        task: item.task,
        from: legs[i]?.from ?? null,
        previousTask: i > 0 ? legs[i - 1].task : null,
        mark,
        end,
        lines,
      };
    });
    return { riderId, name, role, planned: true, steps, dayLines: [], ranWithoutHunt };
  });

  return out.sort((a, b) => roleRank(a.role) - roleRank(b.role) || String(a.name ?? "").localeCompare(String(b.name ?? "")));
}
