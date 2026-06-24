// Race Hub Fase 1 — delt kontekstbånd: scope-pills + sæson-tidslinje.
// "mine" er funktionel; "division"/"others" er deaktiveret (Fase 5). Ejer ikke URL —
// RaceHubBoard sender day/scope + callbacks ned.
import { useTranslation } from "react-i18next";

export default function ContextBand({ scope, day, timeline, onScopeChange, onDayChange }) {
  const { t } = useTranslation("races");
  const total = timeline?.totalDays ?? 60;
  const days = timeline?.days ?? [];
  const scopes = [
    { key: "mine", enabled: true },
    { key: "division", enabled: false },
    { key: "others", enabled: false },
  ];
  return (
    <div className="bg-cz-subtle border border-cz-border rounded-cz px-4 py-3 mb-4">
      <div className="flex gap-2 mb-3" role="tablist" aria-label={t("racehub.heading")}>
        {scopes.map((s) => (
          <button
            key={s.key}
            type="button"
            disabled={!s.enabled}
            title={s.enabled ? undefined : t("racehub.scope.soon")}
            onClick={() => s.enabled && onScopeChange(s.key)}
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
          {days.map((d) => (
            <button
              key={d.day}
              type="button"
              title={d.dateText || t("racehub.timeline.dayOf", { day: d.day, total })}
              aria-current={d.day === day ? "true" : undefined}
              onClick={() => onDayChange(d.day)}
              className={`flex-1 h-4 rounded-sm transition-colors ${
                d.day === day ? "bg-cz-accent" : d.hasMyRace ? "bg-cz-card hover:bg-cz-elevated" : "bg-cz-card/40 hover:bg-cz-card"
              }`}
            />
          ))}
        </div>
        <button type="button" aria-label={t("racehub.timeline.next")} disabled={day >= total}
          onClick={() => onDayChange(day + 1)} className="text-cz-3 hover:text-cz-1 disabled:opacity-30 px-1">›</button>
      </div>
      <div className="flex justify-end mt-1.5">
        <span className="text-xs text-cz-accent-t font-medium">
          {t("racehub.timeline.dayOf", { day, total })} — {t("racehub.timeline.youAreHere")}
        </span>
      </div>
    </div>
  );
}
