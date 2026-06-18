import { useTranslation } from "react-i18next";

// #1451 · Løb-for-løb historik for bestyrelsens tilfredshed. Visnings-only:
// renderer board_satisfaction_events fra /board/status. Tom → render intet
// (så panelet ikke står med en gabende boks før første weekend).
export default function BoardSatisfactionTimeline({ events = [] }) {
  const { t } = useTranslation("board");
  if (!events.length) return null;
  const rows = [...events].sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));

  return (
    <div className="mt-4">
      <p className="text-cz-3 text-xs uppercase tracking-wider mb-2">{t("satisfactionTimeline.heading")}</p>
      <div className="divide-y divide-cz-border">
        {rows.map((e) => {
          const delta = e.satisfaction_delta ?? 0;
          const up = delta > 0;
          const flat = delta === 0;
          const deltaColor = flat ? "text-cz-3" : up ? "text-cz-success" : "text-cz-danger";
          const sign = up ? "+" : "";
          return (
            <div key={e.id} className="flex items-center justify-between py-2">
              <div className="min-w-0">
                <p className="text-cz-1 text-sm font-medium truncate">{e.race_name || t("satisfactionTimeline.unknownRace")}</p>
                <p className="text-cz-3 text-xs">
                  {t("satisfactionTimeline.goals", { met: e.goals_met, total: e.goals_total })}
                  {e.reason_category ? ` · ${t(`category.${e.reason_category}`, { defaultValue: e.reason_category })}` : ""}
                </p>
              </div>
              <span className={`text-sm font-medium tabular-nums ${deltaColor}`}>
                {flat ? t("satisfactionTimeline.flat") : `${sign}${delta}%`}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
