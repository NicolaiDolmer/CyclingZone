// #8298 · Wireframe v6c's ordre-tabel bygget af ren data fra værten (RaceTacticsTab).
// Værten ejer tilstanden og reglerne; her omsættes de til rækker og kontroller, og
// teksterne kommer fra "tactics"-namespacet (hentes først med panelet, #8298).
import { useTranslation } from "react-i18next";
import { useEffect, type ReactNode } from "react";
import { useV6TacticsSummary } from "../race/v6/v6TacticsSaved.ts";
import TacticsRiderTable, { type TacticsRiderRow } from "./TacticsRiderTable.tsx";
import { ExtraChip, LevelSegmented, PartPicker, RoleButton } from "./TacticsControls.tsx";
import EffortSegmented from "./EffortSegmented.tsx";
import RiderChampionJersey from "../rider/ChampionJersey.tsx";
import RiderTalentMark from "../rider/TalentMark.tsx";
import type { DayLoad, EffortLevel, RoutePartLabel, TodayLine } from "./tacticsV6cModel.ts";
import type { StagePlanTask } from "../race/StagePlanModel.ts";
import { taskCostWord, type TaskCostWord } from "../race/tacticsReady7864.ts";

type TFn = { (key: string): string; (key: string, opts: Record<string, unknown>): string };

export type BoardToday = TodayLine | { key: "effort"; effort: string } | { key: "roleDefault" } | { key: "abandoned"; text: string };

export interface BoardRider {
  id: string;
  name: string | null;
  nation: string | null;
  abandoned: boolean;
  roleLabel: string;
  roleOpen: boolean;
  roleEditable: boolean;
  rolePicker: ReactNode | null;
  rating: number | null;
  form: number | null;
  fatigue: number | null;
  routeMatch: number | null;
  timeLimitMark: ReactNode | null;
  today: BoardToday;
  level: EffortLevel | null;
  levelEditable: boolean;
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
  onPart: (id: string, index: number, task: StagePlanTask) => void;
  onStep: (id: string, step: string) => void;
  onExtra: (id: string, key: "tryBreak" | "sprintTrain") => void;
  onLock: (id: string) => void;
  onFollowTeam: (id: string) => void;
}

const shortName = (name: string | null) => {
  if (!name) return "—";
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0][0]}. ${parts.slice(1).join(" ")}` : name;
};

export default function TacticsBoardV6c({ riders, partLabels, allOrders, summary, taskLabel, costLabel, onRole, onLevel, onPart, onStep, onExtra, onLock, onFollowTeam }: TacticsBoardV6cProps) {
  const { t } = useTranslation("tactics") as unknown as { t: TFn };
  const report = useV6TacticsSummary();
  const summaryStage = summary?.stage ?? null;
  const summaryCount = summary?.assistant ?? null;
  useEffect(() => {
    report?.(summaryStage == null || summaryCount == null ? null : { stage: summaryStage, assistant: summaryCount });
  }, [report, summaryStage, summaryCount]);
  useEffect(() => () => report?.(null), [report]);
  const partLabel = (label: RoutePartLabel) => (label.key === "toClimb" ? t("orders.toClimb", { name: label.name }) : t(`orders.${label.key}`));
  const labels = partLabels.map(partLabel);
  const todayText = (today: BoardToday): string => {
    switch (today.key) {
      case "abandoned": return today.text;
      case "effort": return t(`today.effort.${today.effort}`);
      case "attack": return today.climb ? t("today.attack", { climb: today.climb }) : t("today.attackFinale");
      case "shelterLeader": return today.leader ? t("today.shelterLeader", { leader: today.leader }) : t("today.shelterLeaderNone");
      default: return t(`today.${today.key}`);
    }
  };

  const rows: TacticsRiderRow[] = riders.map((r) => {
    const level = (fill: boolean) => (r.levelText != null
      ? <span className="text-xs text-cz-2">{r.levelText}</span>
      : (
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
      today: todayText(r.today),
      effort: level(false),
      effortMobile: level(true),
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
      extra: r.extras.length || r.canFollowTeam ? (
        <>
          {r.canFollowTeam && (
            <button type="button" onClick={() => onFollowTeam(r.id)} className="inline-flex h-7 items-center whitespace-nowrap rounded-cz border border-cz-border bg-cz-card px-2 text-xs font-medium text-cz-1 hover:bg-cz-subtle [@media(max-width:640px),(pointer:coarse)]:h-11">
              {t("orders.followTeam")}
            </button>
          )}
          {r.extras.map((x) => (
            <ExtraChip key={x.key} label={t(`orders.${x.key}`)} on={x.on} disabled={x.disabled} reason={x.reason} onToggle={() => onExtra(r.id, x.key)} />
          ))}
        </>
      ) : null,
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

  return (
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
  );
}
