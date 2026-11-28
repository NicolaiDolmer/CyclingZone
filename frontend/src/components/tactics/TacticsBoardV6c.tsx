// #8298 · Wireframe v6c's ordre-tabel bygget af ren data fra værten (RaceTacticsTab).
// Værten ejer tilstanden og reglerne; her omsættes de til rækker og kontroller, og
// teksterne kommer fra "tactics"-namespacet (hentes først med panelet, #8298).
import { useTranslation } from "react-i18next";
import { useEffect, useState, type ReactNode } from "react";
import { useV6TacticsSummary } from "../race/v6/v6TacticsSaved.ts";
import TacticsRiderTable, { type TacticsRiderRow } from "./TacticsRiderTable.tsx";
import { ExtraChip, LevelSegmented, PartPicker, RoleButton } from "./TacticsControls.tsx";
import EffortSegmented from "./EffortSegmented.tsx";
import TacticsPhoneBoard from "./mobile/TacticsPhoneBoard.tsx"; // #8386
import RiderChampionJersey from "../rider/ChampionJersey.tsx";
import RiderTalentMark from "../rider/TalentMark.tsx";
import type { DayLoad, EffortLevel, RoutePartLabel, TodayLine } from "./tacticsV6cModel.ts";
import { QUICK_TASK, type QuickEffort } from "./quickEffort8356.ts";
import type { StagePlanRole, StagePlanTask } from "../race/StagePlanModel.ts";
import { taskCostWord, type TaskCostWord } from "../race/tacticsReady7864.ts";
import { LongAttackPanel7884, LongAttackSheet7884, type LongAttackOption7884 } from "./LongAttackPicker7884.tsx"; // #8828
import { valleyWord7884, type AttackPlace7884 } from "./longAttack7884Model.ts"; // #8828

type TFn = { (key: string): string; (key: string, opts: Record<string, unknown>): string };

export type BoardToday = TodayLine | { key: "effort"; effort: string } | { key: "roleDefault" } | { key: "abandoned"; text: string };

export interface BoardRider {
  id: string;
  name: string | null;
  nation: string | null;
  abandoned: boolean;
  /** #8386: rollens værdi til telefonens sortering (spillets rollehierarki). */
  role?: string | null;
  roleLabel: string;
  roleOpen: boolean;
  roleEditable: boolean;
  rolePicker: ReactNode | null;
  rating: number | null;
  form: number | null;
  fatigue: number | null;
  routeMatch: number | null;
  timeLimitMark: ReactNode | null;
  today: readonly BoardToday[];
  level: EffortLevel | null;
  levelEditable: boolean;
  quickEffort?: { role: StagePlanRole; value: QuickEffort | null; errors: Record<string, string | null> };
  /** Låst etape / udgået: teksten i stedet for vælgeren. */
  levelText: string | null;
  parts: Array<{ task: StagePlanTask; options: StagePlanTask[]; editable: boolean }> | null;
  dropped: StagePlanTask | null;
  /** "No plan yet. He rides on his role." (allerede oversat), eller null. */
  noPlanNote: string | null;
  steps: { steps: string[]; value: string; labelFor: (s: string) => string; blocked: (s: string) => string | null; editable: boolean } | null;
  extras: Array<{ key: "tryBreak" | "sprintTrain"; on: boolean; disabled: boolean; reason: string | null }>;
  lock: { on: boolean; disabled: boolean } | null;
  dayLoad: DayLoad | null;
  /** Rytteren har sit eget valg: "Follow team plan" i ordrerne sender ham tilbage. */
  canFollowTeam: boolean;
  /**
   * #8828 (kun naar loebet tager imod stederne): "Angrib paa <sted>". `value` er stedets noegle i planen,
   * `blocked` de steder der ikke kan ligge i rytterens plan (kronologien). Udeladt = intet valg.
   */
  attack?: { value: string | null; places: AttackPlace7884[]; blocked: ReadonlySet<string>; editable: boolean } | null;
}

export interface TacticsBoardV6cProps {
  riders: BoardRider[];
  partLabels: RoutePartLabel[];
  allOrders: boolean;
  /** #8298 pkt. 28: hvor mange ryttere der kører assistentens plan (hero'ens linje på løbssiden v6). */
  summary: { stage: number; assistant: number } | null;
  /** Opgavens navn (races: stagePlan.task.*). */
  taskLabel: (task: StagePlanTask) => string;
  /** Prisordet (races: stagePlanReady.price.*). */
  costLabel: (cost: TaskCostWord) => string;
  onRole: (id: string) => void;
  onLevel: (id: string, level: EffortLevel) => void;
  onQuickEffort: (id: string, effort: QuickEffort) => void;
  normalEffortLabel: string;
  onPart: (id: string, index: number, task: StagePlanTask) => void;
  onStep: (id: string, step: string) => void;
  onExtra: (id: string, key: "tryBreak" | "sprintTrain") => void;
  onLock: (id: string) => void;
  onFollowTeam: (id: string) => void;
  /** #8828: "Angrib paa" et sted (noeglen), eller null = intet angreb. */
  onAttack?: (id: string, place: string | null) => void;
}

const QUICK_STEPS = ["save", "normal", "protect"] as const;
const quickEffortFor = (step: string): QuickEffort => step === "save" ? "easy" : step === "protect" ? "hard" : "normal";

const shortName = (name: string | null) => {
  if (!name) return "—";
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0][0]}. ${parts.slice(1).join(" ")}` : name;
};

export default function TacticsBoardV6c({ riders, partLabels, allOrders, summary, taskLabel, costLabel, onRole, onLevel, onQuickEffort, normalEffortLabel, onPart, onStep, onExtra, onLock, onFollowTeam, onAttack }: TacticsBoardV6cProps) {
  const { t } = useTranslation("tactics") as unknown as { t: TFn };
  // #8828: hvilken rytters "Angrib paa"-valg der er aabent, og paa hvilken flade (panel paa computer, ark paa telefon).
  const [attackOpen, setAttackOpen] = useState<{ id: string; surface: "desktop" | "phone" } | null>(null);
  const placeTitle = (place: AttackPlace7884): string => {
    const l = place.label;
    if (l.key === "finale") return t("attack7884.finale");
    const base = l.key === "climb" ? l.name : t("attack7884.unnamed", { category: l.category, km: l.km });
    return l.summit_finish ? t("attack7884.summit", { name: base }) : base;
  };
  const placeFacts = (place: AttackPlace7884): string => {
    const f = place.facts;
    if (place.kind === "finale") return t("attack7884.factFinale", { km: f.foot_km });
    const parts: string[] = [];
    if (f.category) parts.push(f.category === "HC" ? "HC" : t("attack7884.factCategory", { category: f.category }));
    parts.push(t("attack7884.factFoot", { km: f.foot_km }));
    if (f.climbs_after > 0) parts.push(t(f.climbs_after === 1 ? "attack7884.factClimbAfter" : "attack7884.factClimbsAfter", { count: f.climbs_after }));
    if (f.summit_finish) parts.push(t("attack7884.factSummit"));
    const valley = valleyWord7884(f);
    if (valley) parts.push(t(valley === "longValley" ? "attack7884.factLongValley" : "attack7884.factValley"));
    return parts.join(" · ");
  };
  const attackPrice = costLabel(taskCostWord("attack"));
  const report = useV6TacticsSummary();
  const summaryStage = summary?.stage ?? null;
  const summaryCount = summary?.assistant ?? null;
  useEffect(() => {
    report?.(summaryStage == null || summaryCount == null ? null : { stage: summaryStage, assistant: summaryCount });
  }, [report, summaryStage, summaryCount]);
  useEffect(() => () => report?.(null), [report]);
  const partLabel = (label: RoutePartLabel) => {
    if (label.key === "toClimb") return t("orders.toClimb", { name: label.name });
    if (label.key === "toClimbUnnamed") return t("orders.toClimbUnnamed", { category: label.category, km: label.km }); // #8828
    return t(`orders.${label.key}`);
  };
  const labels = partLabels.map(partLabel);
  const todayText = (today: BoardToday): string => {
    switch (today.key) {
      case "abandoned": return today.text;
      case "effort": return t(`today.effort.${today.effort}`);
      case "attack": return t("today.attack", { climb: today.climb });
      case "attackUnspecified": return t("short.attack");
      case "shelterLeader": return today.leader ? t("today.shelterLeader", { leader: today.leader }) : t("today.shelterLeaderNone");
      default: return t(`today.${today.key}`);
    }
  };

  // #8828: "Angrib paa <sted>" (wireframet): chippen med prisordet aabner valget; uden sted staar "Intet angreb".
  const attackPlaceOf = (r: BoardRider): AttackPlace7884 | null => (r.attack?.value ? r.attack.places.find((p) => p.key === r.attack!.value) ?? null : null);
  const attackChip = (r: BoardRider, surface: "desktop" | "phone"): ReactNode => {
    if (!r.attack || !onAttack) return null;
    const place = attackPlaceOf(r);
    return (
      <span className="inline-flex items-center gap-1.5" key={`attack-${surface}`}>
        <button
          type="button"
          data-testid="long-attack-chip"
          aria-haspopup="dialog"
          aria-expanded={attackOpen?.id === r.id && attackOpen.surface === surface}
          disabled={!r.attack.editable}
          onClick={() => setAttackOpen(attackOpen?.id === r.id && attackOpen.surface === surface ? null : { id: r.id, surface })}
          className={`inline-flex h-7 items-center whitespace-nowrap rounded-cz border px-2 text-xs transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 [@media(max-width:640px),(pointer:coarse)]:h-11 ${
            place ? "border-cz-border-strong bg-cz-card font-medium text-cz-1 hover:bg-cz-subtle" : "border-cz-border bg-cz-card text-cz-3 hover:bg-cz-subtle"
          }`}
        >
          {place ? t("attack7884.chip", { place: placeTitle(place) }) : t("attack7884.none")}
        </button>
        {place && <span className="whitespace-nowrap text-xs font-semibold text-cz-danger">{attackPrice}</span>}
      </span>
    );
  };
  const openRider = attackOpen ? riders.find((r) => r.id === attackOpen.id && r.attack) ?? null : null;
  const pickerProps = openRider && openRider.attack && onAttack ? {
    title: t("attack7884.title"),
    subtitle: t("attack7884.subtitle", { name: openRider.name || "—", role: openRider.roleLabel }),
    options: openRider.attack.places.map((p): LongAttackOption7884 => ({ key: p.key, title: placeTitle(p), facts: placeFacts(p), blocked: openRider.attack!.blocked.has(p.key) ? t("attack7884.blocked") : null })),
    value: openRider.attack.value,
    noneLabel: t("attack7884.none"),
    price: attackPrice,
    rule: "",
    chooseLabel: (title: string) => (title ? t("attack7884.choose", { place: title }) : t("attack7884.chooseNone")),
    removeLabel: t("attack7884.remove"),
    closeLabel: t("attack7884.close"),
    disabled: !openRider.attack.editable,
    onPick: (key: string | null) => onAttack(openRider.id, key),
    onClose: () => setAttackOpen(null),
  } : null;

  const extraFor = (r: BoardRider, surface: "desktop" | "phone"): ReactNode => (r.extras.length || r.canFollowTeam || r.attack ? (
    <>
      {attackChip(r, surface)}
      {r.canFollowTeam && (
        <button type="button" onClick={() => onFollowTeam(r.id)} className="inline-flex h-7 items-center whitespace-nowrap rounded-cz border border-cz-border bg-cz-card px-2 text-xs font-medium text-cz-1 hover:bg-cz-subtle [@media(max-width:640px),(pointer:coarse)]:h-11">
          {t("orders.followTeam")}
        </button>
      )}
      {r.extras.map((x) => (
        <ExtraChip key={x.key} label={t(`orders.${x.key}`)} on={x.on} disabled={x.disabled} reason={x.reason} onToggle={() => onExtra(r.id, x.key)} />
      ))}
    </>
  ) : null);
  const phoneExtra = (_desktop: ReactNode, r: BoardRider): ReactNode => extraFor(r, "phone");

  const rows: TacticsRiderRow[] = riders.map((r) => {
    const quick = r.quickEffort;
    const level = (fill: boolean, compact = false) => (r.levelText != null
      ? <span className="text-xs text-cz-2">{r.levelText}</span>
      : quick ? (
        <EffortSegmented
          label={t("level.aria", { name: r.name || "—" })}
          steps={QUICK_STEPS}
          value={QUICK_STEPS.find(step => quickEffortFor(step) === quick.value) ?? null}
          labelFor={(step) => step === "normal" ? normalEffortLabel : t("level." + quickEffortFor(step))}
          describeFor={compact ? undefined : (step) => taskLabel(QUICK_TASK[quick.role][quickEffortFor(step)])}
          blockedReason={(step) => {
            const error = quick.errors[quickEffortFor(step)];
            if (!error) return null;
            if (error === "stage_plan_train_after_breakaway") return t("orders.trainAfterBreak");
            if (error === "stage_plan_terminal_not_last") return t("orders.quickNoOpeningTask");
            if (error === "stage_plan_task_not_for_role") return t("orders.notForRole");
            return t("orders.quickInvalidPlan");
          }}
          disabled={!r.levelEditable}
          onPick={(step) => onQuickEffort(r.id, quickEffortFor(step))}
          fill={fill}
        />
      ) : (
        <LevelSegmented
          label={t("level.aria", { name: r.name || "—" })}
          value={r.level}
          labelFor={(l) => t(`level.${l}`)}
          disabled={!r.levelEditable}
          onPick={(l) => onLevel(r.id, l)}
          fill={fill}
        />
      ));
    return {
      id: r.id,
      name: r.name,
      shortName: shortName(r.name),
      nation: r.nation,
      marks: <><RiderChampionJersey riderId={r.id} /><RiderTalentMark riderId={r.id} /></>,
      abandoned: r.abandoned,
      roleLabel: r.roleLabel,
      roleButton: <RoleButton label={r.roleLabel} open={r.roleOpen} disabled={!r.roleEditable} ariaLabel={r.roleLabel} onClick={() => onRole(r.id)} />,
      rolePicker: r.rolePicker,
      rating: r.rating,
      form: r.form,
      fatigue: r.fatigue,
      routeMatch: r.routeMatch,
      timeLimitMark: r.timeLimitMark,
      today: [...r.today.map(todayText), ...(attackPlaceOf(r) ? [t("attack7884.today", { place: placeTitle(attackPlaceOf(r)!) })] : [])].join(" · "), // #8828
      effort: level(false),
      effortMobile: level(true),
      effortPhone: level(false, true), // #8386: telefonlisten viser kun Easy, Normal, Hard; opgaveteksten staar i arket
      parts: r.parts?.map((part, index) => {
        const opt = (task: StagePlanTask) => ({ value: task, label: taskLabel(task), cost: taskCostWord(task) });
        return {
          label: labels[index] ?? "",
          short: t(`short.${part.task}`),
          cost: taskCostWord(part.task),
          control: (
            <PartPicker
              value={opt(part.task)}
              options={part.options.map(opt)}
              costLabel={costLabel}
              ariaLabel={`${labels[index] ?? ""}: ${r.name || "—"}`}
              disabled={!part.editable}
              onPick={(task) => onPart(r.id, index, task as StagePlanTask)}
            />
          ),
        };
      }) ?? null,
      extra: extraFor(r, "desktop"),
      note: r.noPlanNote ?? (r.dropped ? t("orders.ifDropped", { task: taskLabel(r.dropped) }) : null),
      steps: r.steps ? (
        <EffortSegmented
          label={`${t("orders.steps")}: ${r.name || "—"}`}
          steps={r.steps.steps}
          value={r.steps.value}
          labelFor={r.steps.labelFor}
          blockedReason={r.steps.blocked}
          disabled={!r.steps.editable}
          onPick={(step) => onStep(r.id, step)}
        />
      ) : null,
      lock: r.lock ? {
        on: r.lock.on,
        disabled: r.lock.disabled,
        label: t(r.lock.on ? "lock.on" : "lock.off", { name: r.name || "—" }),
        title: t("lock.title"),
        onToggle: () => onLock(r.id),
      } : null,
      dayLoad: r.dayLoad,
    };
  });

  // #8386: under panelets telefon-grænse står udgave B (TacticsPhoneBoard) i stedet for tabellen.
  return (
    <>
    <div className="@min-[58.5rem]/tactics:hidden">
      <TacticsPhoneBoard rows={rows.map((row, i) => ({ row: riders[i]?.attack ? { ...row, extra: phoneExtra(row.extra, riders[i]) } : row, role: riders[i]?.role ?? null }))} partLabels={labels} allOrders={allOrders} />
      {pickerProps && attackOpen?.surface === "phone" && <LongAttackSheet7884 key={openRider!.id} {...pickerProps} rule={t("attack7884.ruleShort")} />}
    </div>
    <div className={`hidden @min-[58.5rem]/tactics:block ${pickerProps && attackOpen?.surface === "desktop" ? "@min-[80rem]/tactics:grid @min-[80rem]/tactics:grid-cols-[minmax(0,1fr)_26.25rem] @min-[80rem]/tactics:items-start @min-[80rem]/tactics:gap-4" : ""}`}>
    <div className="min-w-0">
    <TacticsRiderTable
      rows={rows}
      allOrders={allOrders}
      partLabels={labels}
      columns={{
        rider: t("col.rider"), role: t("col.role"), rating: t("col.rating"), form: t("col.form"), routeMatch: t("col.routeMatch"),
        fatigueNow: t("col.fatigueNow"), today: t("col.today"), effort: t("col.effort"), orders: t("col.orders"), lock: t("col.lock"), dayLoad: t("col.dayLoad"),
      }}
      words={{
        orders: (name) => t("orders.buttonAria", { name }),
        ordersButton: t("orders.button"),
        extra: t("orders.extra"),
        steps: t("orders.steps"),
        dayLoad: (load) => t(`dayLoad.${load}`),
        numbers: (row) => t("mobile.numbers", { rating: row.rating ?? "—", form: row.form ?? "—", match: row.routeMatch ?? "—", fatigue: row.fatigue ?? "—" }),
      }}
    />
    </div>
    {pickerProps && attackOpen?.surface === "desktop" && (
      <div className="mt-4 @min-[80rem]/tactics:mt-0"><LongAttackPanel7884 key={openRider!.id} {...pickerProps} rule={t("attack7884.rule")} /></div>
    )}
    </div>
    </>
  );
}
