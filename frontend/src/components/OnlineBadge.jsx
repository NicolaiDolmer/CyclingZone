import { useTranslation } from "react-i18next";

function timeAgo(dateStr, t) {
  if (!dateStr) return t("time.never");
  const diff = Date.now() - new Date(dateStr).getTime();
  const min  = Math.floor(diff / 60000);
  if (min < 1)  return t("time.justNow");
  if (min < 60) return t("time.minutesAgo", { m: min });
  const h = Math.floor(min / 60);
  if (h < 24)   return t("time.hoursAgo", { h });
  const d = Math.floor(h / 24);
  return t("time.daysAgo", { d });
}

export default function OnlineBadge({ isOnline, lastSeen }) {
  const { t } = useTranslation("common");
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-cz-pill flex-shrink-0 ${isOnline ? "bg-cz-success" : "bg-cz-border"}`} />
      <span className={`text-xs ${isOnline ? "text-cz-success" : "text-cz-3"}`}>
        {isOnline ? t("time.onlineNow") : timeAgo(lastSeen, t)}
      </span>
    </span>
  );
}
