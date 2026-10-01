// TodayRowMobile — Training -> Today paa telefonen, retning A (#5685 + #5630).
//
// Ejer-go 1/10: docs/design/mockups-5630-5685-mobile-day-choice-2026-10-01
// (directions.png, kolonne A). Hver rytter er een raekke med:
//   1. "Fatigue tonight ~X" (samme prognose som Program -> Plan, #5933), farvet
//      groen/gul/roed mod skadegraensen. Tekst + farve, aldrig kun farve.
//   2. Saesonens evne-fremgang (#5630), saa listen er informativ foer man
//      aabner en rytter.
//   3. Rest / Recovery / Program som segmenteret valg: eet tryk saetter dagens
//      AABNE traeningsfelter. Etapefelter bevares (regel A) — kaldet er det
//      samme som desktoppens hurtig-knapper, saa serveren afgoer det.
// Efter Train now for i dag er valget laast (beslutning 2). "Rest for several"
// (#5638) bevares: markerings-tilstanden goer navne-knappen til en til/fra-knap.
//
// Ren praesentation: hver callback peger paa TrainingPage's eksisterende state
// og mutationer. Ingen fetch, ingen egen prognose-formel (I5).
//
// TASTE: hairline, 5px radius, ingen skygge, ingen piller, tabular figures,
// touch-targets >= 40 px, guld kun som "quiet active" i segmentet.

import { Fragment, useEffect, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import RiderBadges from "../rider/RiderBadges.jsx";
import { squadBadgeKey } from "../../lib/squadBadge.ts";
import type { ForecastEntry } from "./FatigueForecastModel.ts";
import { rowForecast, seasonGainItems, type QuickChoice } from "./todayRowModel.ts";

const TONE_TEXT = { ok: "text-cz-success", warn: "text-cz-warning", risk: "text-cz-danger" } as const;

export type TodayRowRider = {
  id: string;
  firstname?: string | null;
  lastname?: string | null;
  squad?: string | null;
};

export type TodayRowsMobileProps = {
  riders: TodayRowRider[];
  choices: readonly QuickChoice[];
  metaFor: (riderId: string) => string | null;
  stageToday: (riderId: string) => boolean;
  forecastFor: (riderId: string) => ForecastEntry | null;
  forecastSettled?: boolean;
  seasonGainsFor: (riderId: string) => Record<string, unknown> | null;
  pressedFor: (riderId: string) => QuickChoice | null;
  onChoose: (riderId: string, choice: QuickChoice) => void;
  busyFor: (riderId: string) => boolean;
  locked: boolean;
  selectedRiderId: string | null;
  onSelectRider: (riderId: string) => void;
  detailFor: (riderId: string, detailId: string) => ReactNode;
  openFirstForTour?: boolean;
  picked?: ReadonlySet<string> | null;
  onTogglePick?: (riderId: string) => void;
  sortSlot?: ReactNode;
  bulkSlot?: ReactNode;
};

export default function TodayRowsMobile({
  riders,
  choices,
  metaFor,
  stageToday,
  forecastFor,
  forecastSettled = false,
  seasonGainsFor,
  pressedFor,
  onChoose,
  busyFor,
  locked,
  selectedRiderId,
  onSelectRider,
  detailFor,
  openFirstForTour = false,
  picked = null,
  onTogglePick,
  sortSlot = null,
  bulkSlot = null,
}: TodayRowsMobileProps) {
  const { t } = useTranslation("training");
  const tRider = useTranslation("rider").t;
  const pickMode = picked != null;

  // #2819: touren peger paa fremgangen i rytterens kort; fold den oeverste
  // rytter ud een gang, kun mens touren koerer (samme regel som tabellen).
  const didOpenForTour = useRef(false);
  useEffect(() => {
    if (!openFirstForTour || didOpenForTour.current) return;
    if (selectedRiderId || riders.length === 0) return;
    didOpenForTour.current = true;
    onSelectRider(riders[0].id);
  }, [openFirstForTour, selectedRiderId, riders, onSelectRider]);

  const choiceLabel = (choice: QuickChoice) => t(`oneTap.choice_${choice}`);

  return (
    <div className="space-y-3" data-testid="training-today-rows">
      {sortSlot}
      {bulkSlot}
      {locked && (
        <p className="text-xs text-cz-3" data-testid="training-today-rows-locked">
          {t("oneTap.locked")}
        </p>
      )}
      <ul className="overflow-hidden rounded-cz border border-cz-border bg-cz-card">
        {riders.map((rider, index) => {
          const name = `${rider.firstname ?? ""} ${rider.lastname ?? ""}`.trim();
          const meta = metaFor(rider.id);
          const stage = stageToday(rider.id);
          const forecast = rowForecast(forecastFor(rider.id));
          const gains = seasonGainItems(seasonGainsFor(rider.id));
          const pressed = pressedFor(rider.id);
          const busy = busyFor(rider.id);
          const isPicked = pickMode && picked.has(rider.id);
          const isOpen = !pickMode && rider.id === selectedRiderId;
          const detailId = `training-today-row-detail-${rider.id}`;
          return (
            <Fragment key={rider.id}>
              <li
                className={`border-b border-cz-border px-3 py-2.5 last:border-b-0 ${isPicked ? "bg-cz-accent/5" : ""}`}
                data-testid="training-today-row"
                data-rider-id={rider.id}
                data-picked={pickMode ? String(isPicked) : undefined}
              >
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => (pickMode ? onTogglePick?.(rider.id) : onSelectRider(rider.id))}
                    aria-pressed={pickMode ? isPicked : undefined}
                    aria-expanded={pickMode ? undefined : isOpen}
                    aria-controls={isOpen ? detailId : undefined}
                    data-tour={index === 0 ? "training-focus" : undefined}
                    className="-my-1 flex min-h-10 min-w-0 flex-1 items-center gap-2 text-start"
                  >
                    {pickMode && (
                      <span
                        aria-hidden="true"
                        data-testid="training-mobile-pick-box"
                        className={`flex h-4 w-4 flex-none items-center justify-center rounded-cz border ${
                          isPicked ? "border-cz-accent bg-cz-accent text-cz-on-accent" : "border-cz-3 bg-cz-card"
                        }`}
                      >
                        {isPicked && (
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
                            <path d="M20 6L9 17l-5-5" />
                          </svg>
                        )}
                      </span>
                    )}
                    <span className="flex min-w-0 flex-col">
                      <span className="flex min-w-0 items-center gap-1">
                        <span title={name} className="min-w-0 truncate text-sm font-medium text-cz-1">{name}</span>
                        <RiderBadges badges={[squadBadgeKey(rider.squad)]} className="flex-none" />
                      </span>
                      <span className="truncate text-xs tabular-nums text-cz-3">
                        {[meta, stage ? t("oneTap.stageToday") : null].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                  </button>
                  {forecast && (
                    <span
                      className="flex-none pt-0.5 text-xs text-cz-2"
                      data-testid="training-today-row-forecast"
                      data-band={forecast.tone}
                      aria-label={t(forecastSettled ? "forecast.ariaSettled" : "forecast.aria", {
                        value: forecast.value,
                        band: t(`forecast.band_${forecast.tone}`),
                      })}
                    >
                      {t("forecast.label")}{" "}
                      <span className={`font-data font-semibold tabular-nums ${TONE_TEXT[forecast.tone]}`}>
                        {forecastSettled ? forecast.value : t("oneTap.approx", { value: forecast.value })}
                      </span>
                    </span>
                  )}
                </div>

                {gains.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-x-2 text-xs tabular-nums" data-testid="training-today-row-season">
                    <span className="text-cz-3">{t("oneTap.season")}</span>
                    {gains.map((gain) => (
                      <span key={gain.ability} className="text-cz-2">
                        <span className="font-data font-semibold text-cz-success">+{gain.points}</span>{" "}
                        {tRider(`racePreview.derived.${gain.ability}`).toLowerCase()}
                      </span>
                    ))}
                  </div>
                )}

                {!pickMode && (
                  <div
                    role="group"
                    aria-label={t("oneTap.groupAria", { name })}
                    className="mt-2 grid grid-cols-3 overflow-hidden rounded-cz border border-cz-border"
                    data-testid="training-today-row-choice"
                  >
                    {choices.map((choice, i) => {
                      const active = pressed === choice;
                      const disabled = locked || busy;
                      return (
                        <button
                          key={choice}
                          type="button"
                          aria-pressed={active}
                          disabled={disabled}
                          data-choice={choice}
                          onClick={active ? undefined : () => onChoose(rider.id, choice)}
                          className={`min-h-10 px-2 text-xs font-medium transition-colors duration-150 ${
                            i > 0 ? "border-s border-cz-border" : ""
                          } ${
                            active
                              ? "cursor-default bg-cz-accent/10 font-semibold text-cz-accent-t"
                              : disabled
                                ? "cursor-not-allowed bg-cz-card text-cz-3 opacity-60"
                                : "bg-cz-card text-cz-2 hover:text-cz-1"
                          }`}
                        >
                          {choiceLabel(choice)}
                        </button>
                      );
                    })}
                  </div>
                )}
              </li>
              {isOpen && (
                <li id={detailId} className="border-b border-cz-border p-2 last:border-b-0" data-testid="training-today-row-detail">
                  {detailFor(rider.id, detailId)}
                </li>
              )}
            </Fragment>
          );
        })}
      </ul>
    </div>
  );
}
