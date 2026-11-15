import { useTranslation } from "react-i18next";
import { formatNumber } from "../../../lib/intl.js";
import { copenhagenDayKey } from "../../../lib/raceCentre.js";

// #7627 (variant C's day strip): how much of the squad's progress on the date
// came from races. Only rendered when the squad raced on the date. "Today" is
// only said about today's date; an older date says "this date".
export default function RaceShareStrip({ percent, date, today }: { percent: number; date: string; today?: Date }) {
  const { t } = useTranslation("training");
  const isToday = today != null && copenhagenDayKey(today.getTime()) === date;
  const fmt = (value: number): string => formatNumber(value);
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-cz-border pb-3" data-testid="daily-receipt-race-share">
      <p className="text-[13px] tabular-nums text-cz-1">{t(isToday ? "raceSource.shareToday" : "raceSource.shareDate", { percent: fmt(percent) })}</p>
      <span className="flex h-2 w-full overflow-hidden rounded-[2px] border border-cz-border bg-cz-subtle sm:w-40" role="img"
        aria-label={t("raceSource.shareBar", { training: fmt(100 - percent), race: fmt(percent) })}>
        <span className="block h-full bg-cz-border-strong" style={{ width: `${100 - percent}%` }} />
        <span className="block h-full bg-cz-accent" style={{ width: `${percent}%` }} />
      </span>
    </div>
  );
}
