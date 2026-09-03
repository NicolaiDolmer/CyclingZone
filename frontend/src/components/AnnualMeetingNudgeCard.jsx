import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { Section, SectionHeader, Button, ClipboardIcon } from "./ui";

// #4557 (S-M2d) · Dashboard-genvej til aarsmoedet (spec §MASTER S-M2d
// "dashboard-bestyrelseskort peger på boardroom"). Boardroomens EGEN
// gold-CTA i headeren ("Enter annual meeting") dækker allerede besøg TIL
// /board, men et dashboard-nudge betyder at spilleren ikke selv skal huske
// at klikke sig ind — samme rolle som SeasonWrapNudgeCard/SeasonStartGuideCard
// spiller for andre tidsbegrænsede beslutninger.
//
// PRESENTATIONAL ONLY — DashboardPage.jsx afgør synlighed via ét let
// GET /board/meeting-kald (meetingApi.js::fetchBoardMeeting, samme kill-
// switch-sikre moenster som Boardroom-headerens egen CTA: {available:false}
// for alle ikke-beta-hold, netværksfejl → skjult, aldrig en fejlflade).
//
// Sekundær (ikke gold) med vilje: kortet konkurrerer ikke med dashboardets
// eksisterende gold-CTA-prioritetskæde (dashboardGoldCta.js) — aarsmødet sker
// højst 1x/sæson og har sin egen gold-CTA i selve Boardroom, to klik væk.
export default function AnnualMeetingNudgeCard({ daysLeft }) {
  const { t } = useTranslation("dashboard");
  const navigate = useNavigate();

  return (
    <Section>
      <SectionHeader
        title={t("cards.board.meetingNudge.title")}
        meta={
          daysLeft != null
            ? t("cards.board.meetingNudge.daysLeft", { count: daysLeft })
            : undefined
        }
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-[13px] text-cz-2">
          <ClipboardIcon size={16} aria-hidden="true" className="flex-shrink-0 text-cz-3" />
          {t("cards.board.meetingNudge.subtitle")}
        </p>
        <Button variant="secondary" size="sm" onClick={() => navigate("/board/meeting")}>
          {t("cards.board.meetingNudge.cta")}
        </Button>
      </div>
    </Section>
  );
}
