import { useTranslation } from "react-i18next";
import { SectionAction } from "../../components/ui";
import MonogramAvatar from "../../components/MonogramAvatar";
import { resolveGoalTitle } from "./boardroomFormat";

// #4557 (overblik + faner) · Vision og bestyrelse som to RESUMÉ-LINJER paa
// sidebaggrunden, ikke som to kort til. Fold-disciplinens punkt 1: nyt indhold
// bor i en linje der allerede findes, ikke i et tredje stablet kort. Hver linje
// siger konklusionen og fører til sin fane.

function SummaryRow({ label, faces = null, children, actionLabel, onAction }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2 border-t border-cz-border px-0.5 py-2.5">
      <p className="w-full flex-shrink-0 font-data text-3xs uppercase tracking-[.1em] text-cz-3 sm:w-24">
        {label}
      </p>
      {faces}
      <div className="min-w-0 flex-1 text-[13px]">{children}</div>
      <SectionAction onClick={onAction}>{actionLabel}</SectionAction>
    </div>
  );
}

export default function OverviewSummaryRows({ vision, board, onOpenVision, onOpenBoard }) {
  const { t } = useTranslation("board");

  const visionTitle = vision?.titleKey
    ? t(vision.titleKey, { defaultValue: t("boardroom.vision.cardTitle") })
    : t("boardroom.vision.cardTitle");
  // Naeste milepael = den foerste der ikke er afgjort. Ren laesning af
  // payloadens status-felt, ingen udregning her.
  const nextMilestone = (vision?.milestones || []).find((m) => m.status === "current")
    ?? (vision?.milestones || []).find((m) => m.status === "upcoming")
    ?? null;

  const members = board?.members || [];
  const quote = board?.chairmanQuote || null;

  return (
    <div className="mt-4">
      {vision && (
        <SummaryRow
          label={t("boardroom.overview.visionLabel")}
          actionLabel={t("boardroom.overview.openVision")}
          onAction={onOpenVision}
        >
          <span className="font-medium text-cz-1">{visionTitle}</span>{" "}
          {nextMilestone && (
            <span className="text-cz-2">
              {t("boardroom.overview.nextMilestone", {
                milestone: resolveGoalTitle(t, nextMilestone) || t(nextMilestone.labelKey, nextMilestone.labelParams || {}),
                season: nextMilestone.seasonNumber,
              })}
            </span>
          )}
        </SummaryRow>
      )}

      {members.length > 0 && (
        <SummaryRow
          label={t("boardroom.overview.boardLabel")}
          actionLabel={t("boardroom.overview.openBoard")}
          onAction={onOpenBoard}
          faces={
            <div className="flex flex-shrink-0 gap-1.5">
              {members.map((member) => (
                <MonogramAvatar
                  key={member.archetypeKey}
                  sizeClass="h-[26px] w-[26px]"
                  initials={member.initials}
                  initialsClass="text-3xs"
                  navy
                />
              ))}
            </div>
          }
        >
          {quote ? (
            <span className="text-cz-2">
              &ldquo;{t(quote.textKey, quote.textParams || {})}&rdquo; {quote.memberName}
            </span>
          ) : (
            <span className="text-cz-2">{t("boardroom.overview.boardNoQuote")}</span>
          )}
        </SummaryRow>
      )}
    </div>
  );
}
