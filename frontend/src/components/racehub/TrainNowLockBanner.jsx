// #6383: Train now-låsen vist FØR man gemmer — samme banner og samme tekster som
// udtagelsespanelet (#6139/#6372, RaceSelectionPanel), her til dagsboardet og
// sæsonmatrixen. Tidspunktet er spillets tid (Europe/Copenhagen).
import { useTranslation } from "react-i18next";
import { LockIcon } from "../ui";
import { trainNowClock } from "../training/trainNowClock.ts";

export default function TrainNowLockBanner({ pressedAt, testId = "train-now-lock-banner", className = "mb-3" }) {
  const { t } = useTranslation("races");
  const time = trainNowClock(pressedAt);
  return (
    <div
      role="status"
      data-testid={testId}
      className={`${className} rounded-cz px-3 py-2 flex items-start gap-2 text-xs text-cz-1 bg-cz-warning-bg border border-cz-warning/30`}
    >
      <LockIcon size={14} aria-hidden="true" className="mt-px shrink-0 text-cz-warning" />
      <span>
        <span className="font-semibold">{t("selection.trainNowLock.title")}</span>{" "}
        {time ? t("selection.trainNowLock.bodyAt", { time }) : t("selection.trainNowLock.body")}
      </span>
    </div>
  );
}
