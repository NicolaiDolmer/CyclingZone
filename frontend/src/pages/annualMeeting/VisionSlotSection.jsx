import { useTranslation } from "react-i18next";
import { Section, SectionHeader } from "../../components/ui";
import { resolveMeetingGoalTitle } from "./meetingFormat";

// #4557 (S-M2c) · A7-kortet mellem trin 2 og 3 (spec §4.4): vises kun naar
// backend har fundet et aabent vision-slot. ÉT foreslaaet mile, Accept/
// Decline. Ingen tvunget valg — svares der ikke, forbliver slottet aabent
// til naeste moede (samme regel som et decline, spec §4.4).
export default function VisionSlotSection({ visionSlot, choice, onChoose }) {
  const { t } = useTranslation("board");
  if (!visionSlot) return null;

  const title = resolveMeetingGoalTitle(t, visionSlot.goal);

  return (
    <Section>
      <SectionHeader title={t("boardroom.meeting.visionSlot.title")} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13.5px] font-medium text-cz-1">{title}</p>
          <p className="font-data text-2xs uppercase tracking-[.06em] tabular-nums text-cz-3">
            {t("boardroom.meeting.visionSlot.targetSeason", { season: visionSlot.target_season_number })}
          </p>
        </div>
        <div className="flex flex-shrink-0 gap-[6px]">
          <button
            type="button"
            onClick={() => onChoose(true)}
            className={`rounded-cz-pill border px-3 py-[5px] text-xs font-medium transition-colors duration-150 ${
              choice === true ? "border-cz-sidebar bg-cz-sidebar font-semibold text-cz-sidebar-1" : "border-cz-border bg-cz-card text-cz-2 hover:border-cz-3"
            }`}
          >
            {t("boardroom.meeting.visionSlot.accept")}
          </button>
          <button
            type="button"
            onClick={() => onChoose(false)}
            className={`rounded-cz-pill border px-3 py-[5px] text-xs font-medium transition-colors duration-150 ${
              choice === false ? "border-cz-sidebar bg-cz-sidebar font-semibold text-cz-sidebar-1" : "border-cz-border bg-cz-card text-cz-2 hover:border-cz-3"
            }`}
          >
            {t("boardroom.meeting.visionSlot.decline")}
          </button>
        </div>
      </div>
    </Section>
  );
}
