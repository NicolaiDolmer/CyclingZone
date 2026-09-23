// TrainingWeekPlan — fanen Week plan (#5485, aendring 6).
//
// Ejer 22/9: programmet oeverst paa siden var ikke til at forstaa ("Easy" om
// onsdagen mens rytternes celle sagde "Thresh"), og "Individuel ugeplan" gav 20
// doede klik: linket laa i raekkens yderste kolonne og foldede en raekke ud
// uden for synsfeltet. Programmet bor nu HER, som et gitter med ugens 7 dage
// som raekker, og "Plan for: Team / rytter" vaelger om man redigerer holdets
// rytme eller en enkelt rytters egen plan.
//
// Datamodellen er uaendret: en plan er en intensitet pr. UGEDAG (holdets
// weekPlan og rytterens riderWeekPlans fra useTraining). Loebsdags-kolonnerne
// vises kun naar dagen har mere end een loebsdag, og de viser ugedagens valg;
// at saette een loebsdag for sig kraever en udvidelse af modellen og er ikke
// bygget (kolonnerne paastaar derfor intet andet end hvad der gemmes).

import { useTranslation } from "react-i18next";
import type { RaceDayColumn } from "../../lib/trainingMobileModel.ts";
import { ChevronRightIcon } from "../ui/icons/index.jsx";

export type PlanForOption = { value: string; label: string };
export type OwnPlanRow = { id: string; name: string; summary: string };

export default function TrainingWeekPlan({
  weekdays,
  todayWeekday,
  columns,
  planFor,
  planForOptions,
  onPlanFor,
  intro,
  intensities,
  intensityFor,
  onSetDay,
  changedCount,
  saving,
  onSave,
  onUndo,
  resetLabel = null,
  onReset,
  message,
  ownPlans,
  onOpenOwnPlan,
}: {
  weekdays: readonly string[];
  todayWeekday: string;
  columns: RaceDayColumn[];
  planFor: string;
  planForOptions: PlanForOption[];
  onPlanFor: (value: string) => void;
  intro: string;
  intensities: readonly string[];
  intensityFor: (weekday: string) => string;
  onSetDay: (weekday: string, intensity: string) => void;
  changedCount: number;
  saving: boolean;
  onSave: () => void;
  onUndo: () => void;
  resetLabel?: string | null;
  onReset?: () => void;
  message: { type: string; text: string } | null;
  ownPlans: OwnPlanRow[];
  onOpenOwnPlan: (riderId: string) => void;
}) {
  const { t } = useTranslation("training");
  const tRider = useTranslation("rider").t;
  const multi = columns.length > 1;
  const intensityLabel = (k: string) => tRider(`training.intensity_${k}`);

  return (
    <div className="space-y-3.5" data-testid="training-week-plan">
      <section className="overflow-hidden rounded-cz border border-cz-border bg-cz-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-cz-border px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-cz-1">{t("weekPlan.title")}</h2>
            <p className="mt-0.5 text-[12.5px] text-cz-2">{intro}</p>
          </div>
          <label className="flex items-center gap-2">
            <span className="font-data text-2xs font-semibold uppercase tracking-[.04em] text-cz-3">{t("weekPlan.planFor")}</span>
            <select
              value={planFor}
              onChange={(event) => onPlanFor(event.target.value)}
              aria-label={t("weekPlan.planFor")}
              className="min-w-[170px] rounded-cz border border-cz-border bg-cz-card px-2.5 py-1.5 text-xs text-cz-1"
            >
              {planForOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="px-3 py-3 sm:px-5">
          <div
            className="grid overflow-hidden rounded-cz border border-cz-border"
            style={{
              gridTemplateColumns: `minmax(56px, 110px) minmax(0, ${multi ? "170px" : "1fr"})${
                multi ? ` repeat(${columns.length}, minmax(0, 1fr))` : ""
              }`,
            }}
          >
            <span className="bg-cz-subtle px-2.5 py-1.5 font-data text-3xs font-semibold uppercase tracking-[.06em] text-cz-3">
              {t("weekPlan.colDay")}
            </span>
            <span className="border-s border-cz-border bg-cz-subtle px-2.5 py-1.5 font-data text-3xs font-semibold uppercase tracking-[.06em] text-cz-3">
              {t("weekPlan.colWholeDay")}
            </span>
            {multi &&
              columns.map((column) => (
                <span
                  key={column.key}
                  className="border-s border-cz-border bg-cz-subtle px-1 py-1.5 text-center font-data text-3xs font-semibold uppercase tracking-[.06em] text-cz-3"
                >
                  {t("mobile.raceDayShort", { n: column.index })}
                </span>
              ))}
            {weekdays.map((weekday) => {
              const isToday = weekday === todayWeekday;
              const current = intensityFor(weekday);
              const rowBg = isToday ? "bg-cz-subtle" : "bg-cz-card";
              return (
                <div key={weekday} className="contents" data-testid="training-week-plan-row">
                  <span className={`flex items-center gap-2 border-t border-cz-border px-2.5 py-1.5 text-[13px] font-semibold text-cz-1 ${rowBg}`}>
                    {t(`weekday_${weekday}`)}
                    {isToday && (
                      <span className="rounded-[3px] bg-cz-1 px-1 font-data text-3xs font-bold uppercase tracking-[.08em] text-cz-card">
                        {t("weekPlan.today")}
                      </span>
                    )}
                  </span>
                  <span className={`border-s border-t border-cz-border px-1.5 py-1 ${rowBg}`}>
                    <select
                      value={current}
                      disabled={saving}
                      aria-label={`${t("weekPlan.colWholeDay")} · ${t(`weekday_${weekday}`)}`}
                      onChange={(event) => onSetDay(weekday, event.target.value)}
                      className="w-full rounded-cz border border-cz-border bg-cz-card px-2 py-1 text-xs text-cz-1 disabled:opacity-50"
                    >
                      {intensities.map((k) => (
                        <option key={k} value={k}>
                          {intensityLabel(k)}
                        </option>
                      ))}
                    </select>
                  </span>
                  {multi &&
                    columns.map((column) => (
                      <span
                        key={column.key}
                        className={`flex items-center justify-center border-s border-t border-cz-border px-1 py-1.5 font-data text-2xs ${
                          current === "rest" ? "text-cz-3" : "font-semibold text-cz-2"
                        } ${rowBg}`}
                      >
                        {intensityLabel(current)}
                      </span>
                    ))}
                </div>
              );
            })}
          </div>
          {/* #5485 (23/9): den gamle lange forklaring ("The rhythm is a
              default ... consistency bonus ...") under gitteret er vaek.
              Introen oeverst er nok paa fladen; resten bor i Hjaelp (#4025). */}
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-cz-border px-4 py-3 sm:px-5">
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="inline-flex min-h-[34px] items-center rounded-cz border border-cz-border bg-cz-card px-3.5 text-[13px] font-medium text-cz-1 transition-colors hover:bg-cz-subtle disabled:opacity-50"
          >
            {saving ? t("loading") : t("weekPlan.save")}
          </button>
          {changedCount > 0 && (
            <button type="button" onClick={onUndo} className="text-xs font-medium text-cz-accent-t hover:underline">
              {t("weekPlan.undo")}
            </button>
          )}
          {resetLabel && onReset && (
            <button type="button" onClick={onReset} disabled={saving} className="text-xs font-medium text-cz-danger hover:underline disabled:opacity-50">
              {resetLabel}
            </button>
          )}
          {message && (
            <span role="status" className={`text-xs ${message.type === "ok" ? "text-cz-success" : "text-cz-danger"}`}>
              {message.text}
            </span>
          )}
          {changedCount > 0 && (
            <span className="ms-auto font-data text-xs tabular-nums text-cz-3">
              {t("weekPlan.unsaved", { n: changedCount })}
            </span>
          )}
        </div>
      </section>

      <section className="overflow-hidden rounded-cz border border-cz-border bg-cz-card">
        <div className="border-b border-cz-border px-4 py-3 sm:px-5">
          <h2 className="text-[15px] font-semibold text-cz-1">{t("individualWeekPlanOverviewTitle")}</h2>
        </div>
        {ownPlans.length === 0 ? (
          <p className="px-4 py-3 text-sm text-cz-3 sm:px-5">{t("weekPlan.ownPlansEmpty")}</p>
        ) : (
          <ul className="divide-y divide-cz-border">
            {ownPlans.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => onOpenOwnPlan(row.id)}
                  className="flex min-h-11 w-full items-center justify-between gap-3 px-4 py-2 text-start hover:bg-cz-subtle sm:px-5"
                >
                  <span className="min-w-0">
                    <span className="text-[13px] font-medium text-cz-1">{row.name}</span>
                    <span className="ms-2 font-data text-3xs uppercase tracking-[.05em] text-cz-3">{row.summary}</span>
                  </span>
                  <ChevronRightIcon size={14} aria-hidden="true" className="flex-none text-cz-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
