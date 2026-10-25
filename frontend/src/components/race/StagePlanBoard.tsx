// #7003 (ejer 25/10, spec 2026-10-25-taktik-roller-design.md §11 punkt 2):
// ETAPEPLAN LANGS RUTEN paa Taktik-fanen. Erstatter intentions- og ordre-
// kolonnerne naar planen er slaaet til for loebet (flaget stage_plan_v1 +
// s5_profiles_v3, serverens `stage_plan_enabled`).
//
// Hver rytter har en kort kaede af opgaver. Desktop: en raekke pr. rytter med
// kaeden og "Aendr"; editoren folder ud under raekken. Mobil: kaeden paa én linje,
// et tryk aabner editoren. Assistentens forslag staar stiplet indtil manageren
// trykker "Brug assistentens plan" (de fleste goer bare det). Fanens guldknap
// ("Gem etape N") gemmer planen sammen med resten; denne komponent har ingen
// guldknap.
//
// Efter etapen viser kaeden hvad rytteren faktisk gjorde i hvert led, laest af
// tidslinjens stage_plan_leg-events (samme idé som ordre-opsummeringen, #6299).
//
// Fog of war: kun opgaver, stigningernes navne og km. Ingen tal fra motoren.

import { useEffect, useMemo, useState } from "react";
import { authHeaders } from "../../lib/supabase";
import { apiFetch } from "../../lib/apiFetch.ts";
import { waypointsFor } from "../../lib/stageRouteProfile.js";
import { Button, CheckIcon, ChevronRightIcon, LockIcon, MinusIcon, PlusIcon, Select, XIcon } from "../ui/index.js";
import {
  nextLeg,
  planRole,
  removeLeg,
  setLegTask,
  setLegTrigger,
  setRiderPlan,
  stagePlanRecap,
  stagePlanRouteFromRaw,
  suggestStagePlan,
  taskOptions,
  triggerKey,
  triggerOptions,
  validateStagePlanLegs,
} from "./StagePlanModel.ts";
import type { StagePlanLeg, StagePlanRecapItem, StagePlanRole, StagePlanRoute, StagePlanTask, StagePlanTrigger } from "./StagePlanModel.ts";

type TFn = (key: string, opts?: Record<string, unknown>) => string;
type PlanRider = { rider_id: string; name?: string | null; abandoned?: boolean };
type PlanOrderRider = { rider_id: string; plan?: StagePlanLeg[] | null };
type PlanOrder = { riders?: PlanOrderRider[] } & Record<string, unknown>;
type StageProfile = { climbs?: unknown; distance_km?: unknown; profile_type?: unknown } & Record<string, unknown>;
type TimelineEvent = { type?: unknown; km?: unknown; params?: Record<string, unknown> | null };

const API = import.meta.env.VITE_API_URL;

/** Etapens rute til planen: profilens egne felter (samme som serveren laeser). */
function routeForProfile(profile: StageProfile | null | undefined): StagePlanRoute {
  if (!profile) return stagePlanRouteFromRaw(null);
  if (Array.isArray(profile.climbs)) return stagePlanRouteFromRaw(profile);
  // Uden raa climbs: bygget af profilens vejpunkter (samme index-regel).
  const climbs: unknown[] = [];
  for (const w of (waypointsFor(profile) as Array<Record<string, unknown>>).filter((p) => p.kind === "kom")) {
    climbs[w.index as number] = { name: w.name, crest_km: w.km, category: w.category, summit_finish: w.summit_finish };
  }
  return stagePlanRouteFromRaw({ distance_km: profile.distance_km, profile_type: profile.profile_type, climbs });
}

function climbLabel(t: TFn, route: StagePlanRoute, komIndex: number): string {
  const climb = route.climbs.find((c) => c.index === komIndex);
  if (!climb) return "—";
  return climb.name || t("stagePlan.climbFallback", { category: climb.category });
}

function triggerLabel(t: TFn, route: StagePlanRoute, from: StagePlanTrigger | undefined, previousTask: StagePlanTask | undefined): string {
  if (!from) return "";
  if (from.at === "kom") return t("stagePlan.from.kom", { climb: climbLabel(t, route, from.kom_index) });
  if (from.at === "dropped" && previousTask === "breakaway") return t("stagePlan.from.caught");
  return t(`stagePlan.from.${from.at}`);
}

function TaskChip({ t, task, dashed = false, compact = false }: { t: TFn; task: StagePlanTask; dashed?: boolean; compact?: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-cz border px-2 py-0.5 text-2xs font-medium whitespace-nowrap ${
        compact ? "min-w-0 truncate" : ""
      } ${dashed ? "border-dashed border-cz-border text-cz-3" : "border-cz-border bg-cz-subtle text-cz-1"}`}
    >
      {compact ? <span className="truncate">{t(`stagePlan.task.${task}`)}</span> : t(`stagePlan.task.${task}`)}
    </span>
  );
}

/** Kaeden som chips. `compact` = mobil: én linje, kun opgaverne. */
function PlanChain({ t, legs, route, dashed = false, compact = false }: { t: TFn; legs: StagePlanLeg[]; route: StagePlanRoute; dashed?: boolean; compact?: boolean }) {
  return (
    <span className={`flex items-center gap-1.5 ${compact ? "min-w-0 overflow-hidden" : "flex-wrap"}`}>
      {legs.map((leg, i) => (
        <span key={i} className={`inline-flex items-center gap-1.5 ${compact ? "min-w-0" : ""}`}>
          {i > 0 && <ChevronRightIcon size={12} aria-hidden="true" className="shrink-0 text-cz-3" />}
          {i > 0 && !compact && (
            <span className="text-3xs text-cz-3 whitespace-nowrap">{triggerLabel(t, route, leg.from, legs[i - 1].task)}</span>
          )}
          <TaskChip t={t} task={leg.task} dashed={dashed} compact={compact} />
        </span>
      ))}
    </span>
  );
}

function recapLine(t: TFn, route: StagePlanRoute, legs: StagePlanLeg[], item: StagePlanRecapItem, i: number): string {
  if (item.status === "skipped") return t("stagePlan.recap.skipped");
  if (item.status === "not_reached") return t("stagePlan.recap.notReached");
  const km = item.endKm == null ? null : Math.round(item.endKm);
  if (item.endReason === "kom") {
    const from = legs[i + 1]?.from;
    return t("stagePlan.recap.kom", { climb: from?.at === "kom" ? climbLabel(t, route, from.kom_index) : "—" });
  }
  return t(`stagePlan.recap.${item.endReason}`, { km });
}

/** Efter etapen: hvad rytteren faktisk gjorde i hvert led. */
function PlanRecap({ t, legs, route, events, riderId }: { t: TFn; legs: StagePlanLeg[]; route: StagePlanRoute; events: TimelineEvent[]; riderId: string }) {
  const items = stagePlanRecap(legs, events, riderId);
  return (
    <ul className="space-y-1">
      {items.map((item, i) => {
        const ridden = item.status === "done" || item.status === "to_finish" || item.status === "abandoned";
        return (
          <li key={i} className="flex items-start gap-2 text-xs">
            <span className="w-3.5 shrink-0 pt-0.5 text-cz-success">
              {ridden ? <CheckIcon size={12} aria-hidden="true" /> : <MinusIcon size={12} aria-hidden="true" className="text-cz-3" />}
            </span>
            <span className={ridden ? "text-cz-1" : "text-cz-3"}>
              <span className="font-medium">{t(`stagePlan.task.${item.task}`)}</span>
              {", "}
              <span className="tabular-nums">{recapLine(t, route, legs, item, i)}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Editoren for én rytter: ét trin pr. linje, kun gyldige valg. */
function PlanEditor({ t, riderName, legs, role, route, suggestion, disabled, onChange, onClear }: {
  t: TFn; riderName?: string | null; legs: StagePlanLeg[]; role: StagePlanRole; route: StagePlanRoute;
  suggestion: StagePlanLeg[] | null; disabled: boolean; onChange: (legs: StagePlanLeg[]) => void; onClear: () => void;
}) {
  const addable = nextLeg(legs, role, route);
  return (
    <div className="rounded-cz border border-cz-border bg-cz-card overflow-hidden">
      <div className="flex items-baseline justify-between gap-3 px-3.5 py-2 border-b border-cz-border">
        <span className="text-xs font-semibold text-cz-1">{t("stagePlan.editTitle", { name: riderName || "—" })}</span>
        <span className="text-3xs text-cz-3 whitespace-nowrap">{t("stagePlan.effortNote")}</span>
      </div>
      <ol>
        {legs.map((leg, i) => {
          const tasks = taskOptions(legs, i, role, route);
          const triggers = i > 0 ? triggerOptions(legs, i, role, route) : [];
          return (
            <li key={i} className="px-3.5 py-2 border-b border-cz-border flex flex-wrap items-end gap-2">
              <span className="text-3xs uppercase tracking-wider text-cz-3 w-full sm:w-14 sm:pb-2">
                {t("stagePlan.stepLabel", { number: i + 1 })}
              </span>
              {i > 0 && (
                <label className="flex-1 min-w-[9rem] sm:flex-none sm:w-48">
                  <span className="sr-only">{t("stagePlan.switchLabel")}</span>
                  <Select
                    size="sm"
                    disabled={disabled}
                    value={triggerKey(leg.from)}
                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                      const from = triggers.find((f) => triggerKey(f) === e.target.value);
                      if (from) onChange(setLegTrigger(legs, i, from, role, route));
                    }}
                  >
                    {triggers.map((from) => (
                      <option key={triggerKey(from)} value={triggerKey(from)}>
                        {triggerLabel(t, route, from, legs[i - 1].task)}
                      </option>
                    ))}
                  </Select>
                </label>
              )}
              <label className="flex-1 min-w-[9rem] sm:flex-none sm:w-56">
                <span className="sr-only">{t("stagePlan.taskLabel")}</span>
                <Select
                  size="sm"
                  disabled={disabled}
                  value={leg.task}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => onChange(setLegTask(legs, i, e.target.value as StagePlanTask, role, route))}
                >
                  {tasks.map((task) => (
                    <option key={task} value={task}>{t(`stagePlan.task.${task}`)}</option>
                  ))}
                </Select>
              </label>
              {i > 0 && (
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={t("stagePlan.removeStepAria", { number: i + 1, name: riderName || "—" })}
                  onClick={() => onChange(removeLeg(legs, i, role, route))}
                  className="p-1.5 text-cz-3 hover:text-cz-1 disabled:opacity-50"
                >
                  <XIcon size={14} aria-hidden="true" />
                </button>
              )}
            </li>
          );
        })}
      </ol>
      <div className="px-3.5 py-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {addable && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange([...legs, addable])}
            className="inline-flex items-center gap-1 text-xs font-medium text-cz-accent-t hover:underline disabled:opacity-50"
          >
            <PlusIcon size={12} aria-hidden="true" />
            {t("stagePlan.addStep")}
          </button>
        )}
        {suggestion && JSON.stringify(suggestion) !== JSON.stringify(legs) && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange(suggestion)}
            className="text-xs font-medium text-cz-accent-t hover:underline disabled:opacity-50"
          >
            {t("stagePlan.useSuggestion")}
          </button>
        )}
        <button
          type="button"
          disabled={disabled}
          onClick={onClear}
          className="text-xs font-medium text-cz-2 hover:text-cz-1 hover:underline disabled:opacity-50"
        >
          {t("stagePlan.clearPlan")}
        </button>
      </div>
      <p className="px-3.5 py-2 border-t border-cz-border text-3xs text-cz-3">{t("stagePlan.rulesNote")}</p>
    </div>
  );
}

/** Tidslinjen for en koert etape (kun til opsummeringen). null = henter/ikke klar. */
function useStageTimeline(raceId: string, stageNumber: number, enabled: boolean): TimelineEvent[] | null {
  const [state, setState] = useState<{ key: string | null; events: TimelineEvent[] | null }>({ key: null, events: null });
  const key = enabled ? `${raceId}:${stageNumber}` : null;
  useEffect(() => {
    if (!key) return undefined;
    let active = true;
    (async () => {
      const headers = await authHeaders({ json: false });
      if (!headers) return;
      const res = (await apiFetch(`${API}/api/races/${raceId}/timeline?stage=${stageNumber}`, { headers })) as unknown as { ok: boolean; data?: { events?: unknown } | null }; // catch-ok: ikke-ok = ingen opsummering
      if (active) setState({ key, events: res.ok && Array.isArray(res.data?.events) ? (res.data?.events as TimelineEvent[]) : [] });
    })().catch(() => { if (active) setState({ key, events: [] }); });
    return () => { active = false; };
  }, [key, raceId, stageNumber]);
  return state.key === key ? state.events : null;
}

export default function StagePlanBoard({
  t,
  raceId,
  activeStage,
  isOneDay,
  riders,
  roleFor,
  order,
  onChangeOrder,
  profile,
  stageLocked,
  stageCompleted,
  saving,
  teamHasSprintCaptain,
  renderRoleCell,
  rolePickerFor,
  onEditorOpen,
}: {
  t: TFn;
  raceId: string;
  activeStage: number;
  isOneDay: boolean;
  riders: PlanRider[];
  roleFor: (rider: PlanRider) => unknown;
  order: PlanOrder;
  onChangeOrder: (transform: (order: PlanOrder) => PlanOrder) => void;
  profile?: StageProfile | null;
  stageLocked: boolean;
  stageCompleted: boolean;
  saving: boolean;
  teamHasSprintCaptain: boolean;
  renderRoleCell: (rider: PlanRider) => React.ReactNode;
  rolePickerFor?: (rider: PlanRider) => React.ReactNode;
  onEditorOpen?: () => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const route = useMemo(() => routeForProfile(profile), [profile]);
  const events = useStageTimeline(raceId, activeStage, stageCompleted);
  const planByRider = new Map<string, StagePlanLeg[] | null>((order?.riders ?? []).map((r): [string, StagePlanLeg[] | null] => [r.rider_id, Array.isArray(r.plan) && r.plan.length ? r.plan : null]));
  const timeTrial = route.profile_type === "itt" || route.profile_type === "itt_hilly" || route.profile_type === "ttt";

  const suggestionFor = (rider: PlanRider) => suggestStagePlan({ role: planRole(roleFor(rider)), route, teamHasSprintCaptain });
  const editable = (rider: PlanRider) => !stageLocked && !rider.abandoned && !timeTrial;
  const missing = riders.filter((r) => editable(r) && !planByRider.get(r.rider_id));

  function setPlan(riderId: string, plan: StagePlanLeg[] | null) {
    onChangeOrder((o) => setRiderPlan(o, riderId, plan));
  }
  function applyAssistant() {
    onChangeOrder((o) => missing.reduce((acc, r) => {
      const legs = suggestionFor(r);
      return legs ? setRiderPlan(acc, r.rider_id, legs) : acc;
    }, o));
  }
  function toggle(riderId: string) {
    setOpenId((cur) => (cur === riderId ? null : riderId));
    onEditorOpen?.();
  }

  const planColumn = isOneDay ? t("stagePlan.colPlanRaceDay") : t("stagePlan.colPlan", { number: activeStage });

  function renderPlanCell(rider: PlanRider, { compact = false }: { compact?: boolean } = {}) {
    const legs = planByRider.get(rider.rider_id);
    const role = planRole(roleFor(rider));
    if (timeTrial) return <span className="text-xs text-cz-3">{t("stagePlan.timeTrial")}</span>;
    if (legs && stageCompleted) {
      if (events === null) return <PlanChain t={t} legs={legs} route={route} compact={compact} />;
      if (!events.length) {
        return (
          <>
            <PlanChain t={t} legs={legs} route={route} compact={compact} />
            <p className="mt-1 text-3xs text-cz-3">{t("stagePlan.recap.pending")}</p>
          </>
        );
      }
      return <PlanRecap t={t} legs={legs} route={route} events={events} riderId={rider.rider_id} />;
    }
    if (legs) {
      const fits = validateStagePlanLegs(legs, role, route) === null;
      return (
        <>
          <PlanChain t={t} legs={legs} route={route} compact={compact} />
          {!fits && <p className="mt-1 text-3xs text-cz-warning">{t("stagePlan.noFit")}</p>}
        </>
      );
    }
    if (stageLocked) {
      return (
        <span className="inline-flex items-center gap-1 text-3xs text-cz-3">
          <LockIcon size={11} aria-hidden="true" />
          {t(stageCompleted ? "stagePlan.noPlanLocked" : "stagePlan.noPlan")}
        </span>
      );
    }
    const suggestion = suggestionFor(rider);
    return (
      <>
        {suggestion && (
          <span className={`flex items-center gap-1.5 ${compact ? "min-w-0" : ""}`}>
            {compact
              ? <span className="sr-only">{t("stagePlan.suggestion")}</span>
              : <span className="text-3xs uppercase tracking-wider text-cz-3 shrink-0">{t("stagePlan.suggestion")}</span>}
            <PlanChain t={t} legs={suggestion} route={route} dashed compact={compact} />
          </span>
        )}
        {!compact && <p className="mt-1 text-3xs text-cz-3">{t("stagePlan.noPlan")}</p>}
      </>
    );
  }

  function renderEditor(rider: PlanRider) {
    const role = planRole(roleFor(rider));
    const suggestion = suggestionFor(rider);
    const legs = planByRider.get(rider.rider_id) ?? suggestion ?? [];
    if (!legs.length) return null;
    return (
      <PlanEditor
        t={t}
        riderName={rider.name}
        legs={legs}
        role={role}
        route={route}
        suggestion={suggestion}
        disabled={saving}
        onChange={(next) => setPlan(rider.rider_id, next)}
        onClear={() => { setPlan(rider.rider_id, null); setOpenId(null); }}
      />
    );
  }

  return (
    <div data-testid="stage-plan-board">
      <div className="px-4 py-2.5 border-b border-cz-border flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-3xs uppercase tracking-wide text-cz-3">{t("stagePlan.title")}</p>
          <p className="text-xs text-cz-2 mt-0.5 leading-snug">{t("stagePlan.help")}</p>
        </div>
        {missing.length > 0 && (
          <Button variant="secondary" size="sm" disabled={saving} onClick={applyAssistant} className="self-start sm:self-auto shrink-0">
            {t("stagePlan.useAssistant")}
          </Button>
        )}
      </div>

      {/* Desktop: tabel. Under sm: én linje pr. rytter (ingen vandret scroll, #1834). */}
      <div className="hidden sm:block">
        <table data-sort-exempt="Etapeplan: rytterne i taktik-fanens raekkefoelge (sorteres dér)" className="w-full text-sm">
          <thead>
            <tr className="border-b border-cz-border">
              <th className="px-4 py-2 text-left font-medium text-xs uppercase tracking-wide text-cz-3">{t("intention.colRider")}</th>
              <th className="px-4 py-2 text-left font-medium text-xs uppercase tracking-wide text-cz-3">{t("intention.colRole")}</th>
              <th className="px-4 py-2 text-left font-medium text-xs uppercase tracking-wide text-cz-3">{planColumn}</th>
            </tr>
          </thead>
          <tbody>
            {riders.map((rider) => {
              const rolePicker = rolePickerFor?.(rider) ?? null;
              const open = openId === rider.rider_id && editable(rider) && !rolePicker;
              const has = Boolean(planByRider.get(rider.rider_id));
              return [
                <tr key={rider.rider_id} className={`border-b border-cz-border ${open || rolePicker ? "" : "last:border-0"}`}>
                  <td className="px-4 py-2.5 align-top text-cz-1 font-medium">{rider.name || "—"}</td>
                  <td className="px-4 py-2.5 align-top">{renderRoleCell(rider)}</td>
                  <td className="px-4 py-2.5 align-top">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">{renderPlanCell(rider)}</div>
                      {editable(rider) && (
                        <button
                          type="button"
                          disabled={saving}
                          aria-expanded={open}
                          onClick={() => toggle(rider.rider_id)}
                          className="text-xs font-medium text-cz-accent-t hover:underline disabled:opacity-50 whitespace-nowrap"
                        >
                          {open ? t("stagePlan.close") : t(has ? "stagePlan.change" : "stagePlan.setPlan")}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>,
                open || rolePicker ? (
                  <tr key={`${rider.rider_id}-edit`} className="border-b border-cz-border last:border-0 bg-cz-subtle">
                    <td colSpan={3} className="px-4 pb-3.5 pt-0">{rolePicker ?? renderEditor(rider)}</td>
                  </tr>
                ) : null,
              ];
            })}
          </tbody>
        </table>
      </div>

      <ul className="sm:hidden divide-y divide-cz-border">
        {riders.map((rider) => {
          const rolePicker = rolePickerFor?.(rider) ?? null;
          const open = openId === rider.rider_id && editable(rider) && !rolePicker;
          return (
            <li key={rider.rider_id} className="px-4 py-3">
              <span className="block text-cz-1 font-medium text-sm truncate">{rider.name || "—"}</span>
              <div className="mt-0.5">{renderRoleCell(rider)}</div>
              {editable(rider) && !stageCompleted ? (
                <button
                  type="button"
                  disabled={saving}
                  aria-expanded={open}
                  aria-label={t("stagePlan.editTitle", { name: rider.name || "—" })}
                  onClick={() => toggle(rider.rider_id)}
                  className="mt-2 w-full flex items-center justify-between gap-2 text-left disabled:opacity-50"
                >
                  <span className="min-w-0 flex-1">{renderPlanCell(rider, { compact: true })}</span>
                  <span className="text-3xs text-cz-accent-t whitespace-nowrap shrink-0">
                    {open ? t("stagePlan.close") : t("stagePlan.tapToEdit")}
                  </span>
                </button>
              ) : (
                <div className="mt-2">{renderPlanCell(rider, { compact: !stageCompleted })}</div>
              )}
              {rolePicker && <div className="mt-2.5">{rolePicker}</div>}
              {open && <div className="mt-2.5">{renderEditor(rider)}</div>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
