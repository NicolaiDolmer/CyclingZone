// #7865 · Løbssiden v6 trin 2a: Taktik på en kørt etape viser din plan mod det
// der skete (valg 11 og 14 på #7778; spec S9). Kun egne ryttere, pr. etape, ingen
// samlet dom. Reglerne bor i planVsActualModel.ts; her er kun visningen.
//
// Mobil først (valg 19): et kort pr. rytter, trinnene under hinanden med planen
// over det optegnelsen viser. Fra md: planen og optegnelsen side om side.
// Data: etapens optegnelse (tidslinjen) og holdets egne ordrer; intet andet hold
// læses. Uden optegnelse står en ærlig tom tilstand, aldrig en gættet plan.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useStageTimeline } from "../../../hooks/useStageTimeline.js";
import { fetchTeamOrders } from "../../../lib/tacticsOrdersAdapter.js";
import { roleLabelKey } from "../../../lib/stageRoleVocabulary.ts";
import { ownRiderIdsForStage } from "../../../lib/stageSplitTimes.ts";
import { ownRiderIdsForOneDay } from "../../../lib/oneDayTimeline.ts";
import { CheckIcon as CheckIconJs, InfoIcon as InfoIconJs, MinusIcon as MinusIconJs, XIcon as XIconJs } from "../../ui/index.js";
import { isTimeTrialProfile, type StagePlanTask, type StagePlanTrigger } from "../StagePlanModel.ts";
import { teamPlanRouteFromProfile } from "../tacticsReady7864.ts";
import type { ResultRow, StageProfile } from "../stagePageV2/stagePageV2Model.ts";
import { RiderLink, Section, SectionHeader, SkeletonLines } from "../stagePageV2/ui.ts";
import { planVsActual, type PlanStep, type StageRolesLike, type StepLine, type StepMark, type TeamOrdersLike } from "./planVsActualModel.ts";

type IconComponent = (props: { size?: number; className?: string; "aria-hidden"?: boolean | "true" }) => ReactNode;
const CheckIcon = CheckIconJs as unknown as IconComponent;
const XIcon = XIconJs as unknown as IconComponent;
const MinusIcon = MinusIconJs as unknown as IconComponent;
const InfoIcon = InfoIconJs as unknown as IconComponent;

type TFn = (key: string, opts?: Record<string, unknown>) => string;

export interface V6TacticsAfterProps {
  raceId: string | null;
  stageNumber: number;
  isStageRace: boolean;
  results: ResultRow[];
  myTeamId: string | null;
  stageRoles: StageRolesLike | null | false;
  profile: StageProfile | null;
}

/** Ikonet og tonen for hver markering; ordet står altid ved, så farven aldrig er alene. */
const MARK: Record<StepMark, { Icon: IconComponent; tone: string; word: string | null }> = {
  seen: { Icon: CheckIcon, tone: "text-cz-success", word: null },
  differs: { Icon: XIcon, tone: "text-cz-warning", word: null },
  fact: { Icon: InfoIcon, tone: "text-cz-3", word: null },
  not_reached: { Icon: MinusIcon, tone: "text-cz-3", word: "racePageV6.tacticsAfter.mark.notReached" },
  not_seen: { Icon: MinusIcon, tone: "text-cz-3", word: "racePageV6.tacticsAfter.mark.notSeen" },
};

function climbName(t: TFn, climbs: ReadonlyArray<{ index: number; name: string | null; category: string }>, komIndex: number | null): string {
  const climb = komIndex == null ? null : climbs.find((c) => c.index === komIndex);
  if (!climb) return "—";
  return climb.name || t("stagePlan.climbFallback", { category: climb.category });
}

function triggerText(t: TFn, climbs: ReadonlyArray<{ index: number; name: string | null; category: string }>, from: StagePlanTrigger | null, previous: StagePlanTask | null): string | null {
  if (!from) return null;
  if (from.at === "kom") return t("stagePlan.from.kom", { climb: climbName(t, climbs, from.kom_index) });
  if (from.at === "dropped" && previous === "breakaway") return t("stagePlan.from.caught");
  return t(`stagePlan.from.${from.at}`);
}

function endText(t: TFn, climbs: ReadonlyArray<{ index: number; name: string | null; category: string }>, step: PlanStep): string | null {
  const end = step.end;
  // "Til mål" gentager blot linjen over (placeringen eller "kom i mål"), så den udelades.
  if (!end || end.reason === "finish") return null;
  if (end.reason === "kom") return t("stagePlan.recap.kom", { climb: climbName(t, climbs, end.komIndex) });
  return t(`stagePlan.recap.${end.reason}`, { km: end.km == null ? "—" : Math.round(end.km) });
}

function Line({ t, line }: { t: TFn; line: StepLine }) {
  return (
    <span className="block">
      {t(line.key, line.params)}
      {line.km != null && <span className="ml-1.5 font-data text-2xs text-cz-3 tabular-nums whitespace-nowrap">{t("racePageV6.tacticsAfter.km", { km: Math.round(line.km) })}</span>}
    </span>
  );
}

function StepRow({ t, step, climbs }: { t: TFn; step: PlanStep; climbs: ReadonlyArray<{ index: number; name: string | null; category: string }> }) {
  const { Icon, tone, word } = MARK[step.mark];
  const trigger = triggerText(t, climbs, step.from, step.previousTask);
  const end = endText(t, climbs, step);
  return (
    <li data-step-mark={step.mark} className="grid gap-x-6 gap-y-1 border-t border-cz-border py-2.5 md:grid-cols-2">
      <div className="min-w-0">
        <span className="block font-data text-2xs uppercase tracking-wider text-cz-3 tabular-nums">
          {t("racePageV6.tacticsAfter.step", { number: step.index + 1 })}
          {trigger && <span className="normal-case tracking-normal"> · {trigger}</span>}
        </span>
        <span className="block text-sm font-semibold text-cz-1">{t(`stagePlan.task.${step.task}`)}</span>
      </div>
      <div className="flex min-w-0 items-start gap-2 text-sm">
        <span className={`w-4 flex-none pt-0.5 ${tone}`}><Icon size={14} aria-hidden="true" /></span>
        <span className={`min-w-0 ${step.mark === "not_reached" || step.mark === "not_seen" ? "text-cz-3" : "text-cz-1"}`}>
          {word && <span className="block">{t(word)}</span>}
          {step.lines.map((line, i) => <Line key={i} t={t} line={line} />)}
          {end && <span className="block text-xs text-cz-3 tabular-nums">{end}</span>}
        </span>
      </div>
    </li>
  );
}

export default function V6TacticsAfter({ raceId, stageNumber, isStageRace, results, myTeamId, stageRoles, profile }: V6TacticsAfterProps) {
  const { t } = useTranslation("races");
  const timeTrial = isTimeTrialProfile(profile?.profile_type ?? null);
  const { timeline, loading, error } = useStageTimeline(timeTrial ? null : raceId, stageNumber) as {
    timeline: { events?: unknown[]; timeline_version?: number | null } | null; loading: boolean; error: boolean;
  };

  // Kun eget hold: GET team-orders svarer for den indloggede managers hold alene.
  const [orders, setOrders] = useState<{ raceId: string; value: TeamOrdersLike | null } | null>(null);
  useEffect(() => {
    if (!raceId || timeTrial) return undefined;
    let live = true;
    fetchTeamOrders({ raceId })
      .then((value) => { if (live) setOrders({ raceId, value: value as TeamOrdersLike | null }); })
      .catch(() => { if (live) setOrders({ raceId, value: null }); /* catch-ok: ukendte ordrer viser ingen plan, aldrig en gættet */ });
    return () => { live = false; };
  }, [raceId, timeTrial]);
  const knownOrders = orders && orders.raceId === raceId ? orders : null;

  const climbs = useMemo(() => teamPlanRouteFromProfile(profile as Record<string, unknown> | null).climbs, [profile]);
  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of (stageRoles || null)?.riders ?? []) if (r.name) map.set(String(r.rider_id), r.name);
    return map;
  }, [stageRoles]);
  const rankById = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of results) {
      const id = r.rider_id ?? r.rider?.id;
      const stageRow = isStageRace ? r.result_type === "stage" && (r.stage_number ?? 1) === stageNumber : r.result_type === "gc" || r.result_type === "stage";
      if (id && stageRow && typeof r.rank === "number") map.set(String(id), r.rank);
    }
    return map;
  }, [results, isStageRace, stageNumber]);
  const riderIds = useMemo(
    () => (isStageRace ? ownRiderIdsForStage(results, stageNumber, myTeamId) : ownRiderIdsForOneDay(results, myTeamId)),
    [isStageRace, results, stageNumber, myTeamId],
  );

  const riders = useMemo(() => {
    if (!timeline || !knownOrders?.value) return [];
    return planVsActual({
      orders: knownOrders.value,
      stageRoles,
      stageNumber,
      riderIds,
      nameOf: (id) => nameById.get(id) ?? null,
      events: (timeline.events ?? []) as Array<{ type?: string; km?: number; params?: Record<string, unknown> | null }>,
      timelineVersion: timeline.timeline_version ?? null,
      climbs: Array.isArray(profile?.climbs) ? (profile?.climbs as unknown as Array<{ crest_km?: number | null; length_km?: number | null; name?: string | null }>) : null,
      rankOf: (id) => rankById.get(id) ?? null,
    });
  }, [timeline, knownOrders, stageRoles, stageNumber, riderIds, nameById, profile, rankById]);

  const title = t("racePageV6.tacticsAfter.title");
  const meta = isStageRace ? t("racePageV6.tacticsAfter.metaStage", { number: stageNumber }) : t("racePageV6.tacticsAfter.metaRace");

  let body: ReactNode;
  if (timeTrial) {
    body = <p className="m-0 border-t border-cz-border py-2.5 text-sm text-cz-3">{t("stagePlan.timeTrial")}</p>;
  } else if (loading || (raceId && !knownOrders && !error)) {
    body = <SkeletonLines lines={4} />;
  } else if (!timeline || error) {
    body = <p className="m-0 border-t border-cz-border py-2.5 text-sm text-cz-3">{t("stagePlan.recap.pending")}</p>;
  } else if (!riders.length) {
    body = <p className="m-0 border-t border-cz-border py-2.5 text-sm text-cz-3">{t("racePageV6.tacticsAfter.noRiders")}</p>;
  } else {
    body = (
      <>
        <p className="m-0 pb-2.5 text-sm text-cz-2">{t("racePageV6.tacticsAfter.intro")}</p>
        <div aria-hidden="true" className="hidden gap-x-6 border-t border-cz-border py-2 font-data text-2xs uppercase tracking-wider text-cz-3 md:grid md:grid-cols-2">
          <span>{t("racePageV6.tacticsAfter.colPlan")}</span>
          <span>{t("racePageV6.tacticsAfter.colRecord")}</span>
        </div>
        <ul className="m-0 p-0">
          {riders.map((rider) => {
            const roleKey = roleLabelKey(rider.role);
            return (
              <li key={rider.riderId} data-plan-rider={rider.riderId} className="border-t border-cz-border pt-3 pb-1">
                <div className="flex min-h-11 items-baseline gap-2">
                  <RiderLink id={rider.riderId} className="min-w-0 truncate text-sm font-semibold text-cz-1 hover:text-cz-accent-t">{rider.name || t("tacticsOrders.riderFallback")}</RiderLink>
                  {roleKey && <span className="flex-none text-xs text-cz-3">{t(roleKey)}</span>}
                </div>
                {rider.planned ? (
                  <ol className="m-0 p-0">
                    {rider.steps.map((step) => <StepRow key={step.index} t={t} step={step} climbs={climbs} />)}
                  </ol>
                ) : (
                  <div className="grid gap-x-6 gap-y-1 border-t border-cz-border py-2.5 md:grid-cols-2">
                    <span className="text-sm text-cz-2">{t("stagePlan.noPlanLocked")}</span>
                    <span className="min-w-0 text-sm text-cz-1">
                      {rider.dayLines.length
                        ? rider.dayLines.map((line, i) => <Line key={i} t={t} line={line} />)
                        : <span className="text-cz-3">{t("racePageV6.tacticsAfter.mark.notSeen")}</span>}
                    </span>
                  </div>
                )}
                {rider.ranWithoutHunt && <p className="m-0 pb-2 text-xs text-cz-3">{t("stagePlan.huntOffNote")}</p>}
              </li>
            );
          })}
        </ul>
      </>
    );
  }

  return (
    <div data-race-section="tactics_after">
      <Section aria-label={title}>
        <SectionHeader title={title} meta={meta} />
        {body}
      </Section>
    </div>
  );
}
