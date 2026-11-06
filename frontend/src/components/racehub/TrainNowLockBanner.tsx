// #6383: Train now-låsen vist FØR man gemmer — samme banner og samme tekster som
// udtagelsespanelet (#6139/#6372, RaceSelectionPanel), her til dagsboardet og
// sæsonmatrixen. Tidspunktet er spillets tid (Europe/Copenhagen).
import { useTranslation } from "react-i18next";
import { LockIcon } from "../ui";
import { trainNowLockCopy } from "../training/trainNowClock.ts";

type TrainNowLockBannerProps = { pressedAt?: string | null; testId?: string; className?: string };

export default function TrainNowLockBanner({ pressedAt, testId = "train-now-lock-banner", className = "mb-3" }: TrainNowLockBannerProps) {
  const { t, i18n } = useTranslation("races");
  // #7558: lås-teksten følger dagen trykket faktisk skete (en flerdagsrace viser gårsdagens lås).
  const copy = trainNowLockCopy(t, pressedAt, i18n.language);
  return (
    <div
      role="status"
      data-testid={testId}
      className={`${className} rounded-cz px-3 py-2 flex items-start gap-2 text-xs text-cz-1 bg-cz-warning-bg border border-cz-warning/30`}
    >
      <LockIcon size={14} aria-hidden="true" className="mt-px shrink-0 text-cz-warning" />
      <span>
        <span className="font-semibold">{copy.title}</span>{" "}
        {copy.body}
      </span>
    </div>
  );
}
