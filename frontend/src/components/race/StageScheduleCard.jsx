// StageScheduleCard — player-facing etape-kalender for et kommende løb (#1597).
//
// Viser race_stage_schedule (ét scheduled_at pr. etape, faste København-slots)
// med klokkeslæt + en live "næste etape om X"-countdown. Tabellen har en
// authenticated SELECT-policy (database/2026-06-20-races-stage-progress.sql), så
// klienten kan læse den direkte — samme supabase-fetch-mønster som resten af
// RaceDetailPage (race_stage_profiles).
//
// Degraderer pænt: ingen schedule-rækker (gamle/PCM-løb, eller scheduler ikke
// aktiveret) → komponenten renderer INTET. Den lover aldrig en tid den ikke har.
//
// Tider RENDERES eksplicit i Europe/Copenhagen (CET/CEST), så en spiller i en
// anden tidszone ser det rigtige faste slot ([[feedback_timezone_copenhagen]]).

import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../../lib/supabase";
import { ClockIcon } from "../ui/icons/index.jsx";
import {
  RACE_TIMEZONE,
  stageStatus,
  countdownParts,
  countdownSegments,
  relativeDayKey,
} from "../../lib/stageScheduleConfig.js";

// Klokkeslæt i København-tid med eksplicit zone-label (fx "15:00 CEST").
function formatStageTime(scheduledAt, locale) {
  try {
    return new Intl.DateTimeFormat(locale || "en", {
      timeZone: RACE_TIMEZONE,
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(scheduledAt);
  } catch {
    return "";
  }
}

// Fuld dato i København-tid (fx "4 Jul" / "4. jul.") — kun når dagen ikke er
// i dag/i morgen, så de nære etaper bruger de venlige relative labels.
function formatStageDate(scheduledAt, locale) {
  try {
    return new Intl.DateTimeFormat(locale || "en", {
      timeZone: RACE_TIMEZONE,
      day: "numeric",
      month: "short",
    }).format(scheduledAt);
  } catch {
    return "";
  }
}

// Live countdown-tekst for "næste etape". Re-render drives af nowMs-ticken i
// parent, så vi ikke holder en timer pr. række.
function countdownText(scheduledAt, nowMs, t) {
  const parts = countdownParts(scheduledAt.getTime() - nowMs);
  if (!parts) return t("detail.stageSchedule.startingNow");
  const segments = countdownSegments(parts).map((s) =>
    t(`detail.stageSchedule.countdown${s.unit[0].toUpperCase()}${s.unit.slice(1)}`, { count: s.count })
  );
  return `${t("detail.stageSchedule.countdownPrefix")} ${segments.join(" ")}`;
}

export default function StageScheduleCard({ raceId, stagesCompleted = 0 }) {
  const { t, i18n } = useTranslation("races");
  const [rows, setRows] = useState(null); // null = loading, [] = none
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    (async () => {
      const { data, error } = await supabase
        .from("race_stage_schedule")
        .select("stage_number, scheduled_at")
        .eq("race_id", raceId)
        .order("stage_number", { ascending: true });
      if (cancelled) return;
      // Fejl eller tom → behandl som "ingen kalender" (komponenten skjuler sig).
      setRows(error ? [] : (data ?? []));
    })();
    return () => { cancelled = true; };
  }, [raceId]);

  // Et minut-tick rækker til en kalender-countdown (vi viser ikke sekunder).
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const stages = useMemo(() => {
    if (!rows) return [];
    return rows
      .map((r) => {
        const date = new Date(r.scheduled_at);
        return Number.isNaN(date.getTime())
          ? null
          : { stageNumber: r.stage_number, date, status: stageStatus(r.stage_number, stagesCompleted) };
      })
      .filter(Boolean);
  }, [rows, stagesCompleted]);

  // Skjul komponenten helt indtil vi VED at der findes en kalender.
  if (rows === null || stages.length === 0) return null;

  const locale = i18n.language || "en";
  const nextStage = stages.find((s) => s.status === "next");

  return (
    <div className="bg-cz-card border border-cz-border rounded-cz overflow-hidden">
      <div className="px-4 py-3 border-b border-cz-border flex items-center gap-2">
        <ClockIcon size={16} className="text-cz-accent-t flex-shrink-0" />
        <div className="min-w-0">
          <h2 className="font-semibold text-cz-1 text-sm leading-tight">{t("detail.stageSchedule.title")}</h2>
          <p className="text-cz-3 text-[11px] leading-tight">{t("detail.stageSchedule.subtitle")}</p>
        </div>
        {nextStage && (
          <div className="ms-auto text-right flex-shrink-0">
            <p className="text-cz-3 text-[10px] uppercase tracking-wider leading-none">{t("detail.stageSchedule.nextStageLabel")}</p>
            <p className="text-cz-accent-t font-mono text-xs font-bold mt-0.5 tabular-nums whitespace-nowrap">
              {countdownText(nextStage.date, nowMs, t)}
            </p>
          </div>
        )}
      </div>

      <ul className="divide-y divide-cz-border">
        {stages.map((s) => {
          const dayKey = relativeDayKey(s.date, new Date(nowMs));
          const dayLabel = dayKey ? t(`detail.stageSchedule.${dayKey}`) : formatStageDate(s.date, locale);
          const timeLabel = formatStageTime(s.date, locale);
          const isNext = s.status === "next";
          return (
            <li
              key={s.stageNumber}
              className={`flex items-center gap-3 px-4 py-2.5 ${isNext ? "bg-cz-accent/[0.06]" : ""}`}
            >
              <span
                className={`font-mono text-xs w-6 text-right flex-shrink-0 ${
                  isNext ? "text-cz-accent-t font-bold" : s.status === "done" ? "text-cz-3" : "text-cz-2"
                }`}
              >
                {s.stageNumber}
              </span>
              <span className={`text-sm flex-1 min-w-0 truncate ${s.status === "done" ? "text-cz-3" : "text-cz-1"}`}>
                {t("detail.stageSchedule.stageLabel", { number: s.stageNumber })}
              </span>

              {s.status === "done" ? (
                <span className="text-[10px] uppercase tracking-wider text-cz-3 font-medium flex-shrink-0">
                  {t("detail.stageSchedule.done")}
                </span>
              ) : (
                <span className="text-right flex-shrink-0 whitespace-nowrap">
                  <span className={`text-sm tabular-nums ${isNext ? "text-cz-1 font-semibold" : "text-cz-2"}`}>
                    {timeLabel}
                  </span>
                  <span className="text-cz-3 text-[11px] ms-1.5">{dayLabel}</span>
                </span>
              )}
            </li>
          );
        })}
      </ul>

      <p className="px-4 py-2 border-t border-cz-border text-cz-3 text-[10px]">
        {t("detail.stageSchedule.timezoneNote")}
      </p>
    </div>
  );
}
