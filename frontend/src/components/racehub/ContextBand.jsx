// Race Hub Fase 1 — delt kontekstbånd: scope-pills + sæson-tidslinje.
// Fase 5 (#1835 / S6): "division"/"others" er nu aktive (read-only browse via
// DivisionStartLists). Ejer ikke URL — RaceHubBoard/DivisionStartLists sender
// day/scope + callbacks ned.
import { useTranslation } from "react-i18next";

export default function ContextBand({ scope, day, currentDay, timeline, onScopeChange, onDayChange }) {
  const { t } = useTranslation("races");
  const total = timeline?.totalDays ?? 60;
  const days = timeline?.days ?? [];
  const scopes = [
    { key: "mine", enabled: true },
    { key: "division", enabled: true },
    { key: "others", enabled: true },
  ];
  return (
    <div className="bg-cz-subtle border border-cz-border rounded-cz px-4 py-3 mb-4">
      <div className="flex gap-2 mb-3" role="tablist" aria-label={t("racehub.heading")}>
        {scopes.map((s) => (
          <button
            key={s.key}
            type="button"
            role="tab"
            aria-selected={scope === s.key}
            disabled={!s.enabled}
            title={s.enabled ? undefined : t("racehub.scope.soon")}
            // #1919: klik på den allerede-aktive pill er en no-op (ingen state-skift) →
            // talte som "dead click" i Clarity. Spring kaldet over når den er valgt.
            onClick={() => { if (s.enabled && scope !== s.key) onScopeChange(s.key); }}
            className={`text-xs uppercase tracking-wide px-3 py-1.5 rounded-full border transition-colors ${
              scope === s.key
                ? "bg-cz-accent text-cz-on-accent border-cz-accent"
                : s.enabled
                ? "border-cz-border text-cz-2 hover:bg-cz-card"
                : "border-cz-border text-cz-3 opacity-50 cursor-not-allowed"
            }`}
          >
            {t(`racehub.scope.${s.key}`)}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button type="button" aria-label={t("racehub.timeline.prev")} disabled={day <= 1}
          onClick={() => onDayChange(day - 1)} className="text-cz-3 hover:text-cz-1 disabled:opacity-30 px-1">‹</button>
        <div className="flex gap-px flex-1" role="group" aria-label={t("racehub.timeline.dayOf", { day, total })}>
          {days.map((d) => {
            const isFocus = d.day === day;
            const isToday = d.day === currentDay;
            const base = isFocus
              ? "bg-cz-accent"
              : d.hasMyRace
              ? "bg-cz-card hover:bg-cz-elevated"
              : "bg-cz-card/40 hover:bg-cz-card";
            // "I dag" markeres med inset-ring når den ikke i forvejen er den fokuserede dag.
            const todayRing = isToday && !isFocus ? "ring-1 ring-inset ring-cz-accent-t/70" : "";
            return (
              <button
                key={d.day}
                type="button"
                title={`${t("racehub.timeline.dayOf", { day: d.day, total })}${isToday ? ` — ${t("racehub.timeline.youAreHere")}` : ""}`}
                aria-current={isFocus ? "true" : undefined}
                // #1919: klik på den allerede-fokuserede dag er en no-op → dead click.
                onClick={() => { if (d.day !== day) onDayChange(d.day); }}
                className={`flex-1 h-4 rounded-sm transition-colors ${base} ${todayRing}`}
              />
            );
          })}
        </div>
        <button type="button" aria-label={t("racehub.timeline.next")} disabled={day >= total}
          onClick={() => onDayChange(day + 1)} className="text-cz-3 hover:text-cz-1 disabled:opacity-30 px-1">›</button>
      </div>
      <div className="flex justify-end mt-1.5">
        <span className="text-xs text-cz-accent-t font-medium">
          {t("racehub.timeline.dayOf", { day, total })}
          {day === currentDay ? ` — ${t("racehub.timeline.youAreHere")}` : ""}
        </span>
      </div>
    </div>
  );
}
