import { useTranslation } from "react-i18next";
import type { ComponentType, ReactNode } from "react";
import { Link } from "react-router";
import { SectionAction, SectionHeader } from "../ui";
import type { AcademyPrognosis } from "./AcademyPrognosisCell";
import PotentialRoleBox from "./PotentialRoleBox";
import { potentialFromAcademy } from "../../lib/potentialDisplay6853";

const stages = ["learning", "broad", "narrow", "final"] as const;
// The shared JSX primitives infer their default props too narrowly for TSX.
const ReportHeader = SectionHeader as ComponentType<{ title: string; as: string; action: ReactNode }>;
const ReadMore = SectionAction as unknown as ComponentType<{ as: typeof Link; to: string; children: ReactNode }>;

export default function AcademyScoutingPrognosis({ prognosis }: { prognosis: AcademyPrognosis }) {
  const { t } = useTranslation("academy");
  const current = stages.findIndex(stage => stage === prognosis.stage);
  const band = prognosis.band && Number.isFinite(prognosis.band.lo) && Number.isFinite(prognosis.band.hi) ? prognosis.band : null;
  const display = potentialFromAcademy(prognosis); // #6853: typeboks ved bedste rolle
  return (
    <div data-testid="academy-scouting-prognosis">
      <ReportHeader
        as="h3"
        title={t("prognosis.report.title")}
        action={<ReadMore as={Link} to="/help?section=academy">{t("prognosis.report.readMore")}</ReadMore>}
      />
      <ol aria-label={t("prognosis.report.progress")} className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        {stages.map((stage, index) => (
          <li key={stage} data-stage={stage} aria-current={index === current ? "step" : undefined}
            className={`flex items-baseline gap-2 border-t border-cz-border pt-2 text-xs ${index === current ? "font-semibold text-cz-1" : index < current ? "text-cz-2" : "text-cz-3"}`}>
            <span className="font-data text-2xs tabular-nums">{index + 1}</span>
            <span>{t(`prognosis.report.stages.${stage}`)}</span>
          </li>
        ))}
      </ol>
      <dl className="mt-4 grid gap-3 border-t border-cz-border pt-4 sm:grid-cols-2">
        <div>
          <dt className="text-2xs text-cz-3">{t("prognosis.report.forecast")}</dt>
          <dd data-testid="academy-scouting-band" className="mt-1 font-data text-sm text-cz-1 tabular-nums">
            {band ? t("prognosis.report.range", { lo: band.lo, hi: band.hi }) : t("prognosis.report.noEstimate")}
            {display?.showRole && <PotentialRoleBox role={display.role} lo={display.lo} hi={display.hi} variant="full" className="ms-2 align-middle" />}
          </dd>
        </div>
        <div>
          <dt className="text-2xs text-cz-3">{t("prognosis.report.nextStage")}</dt>
          <dd data-testid="academy-scouting-next" className="mt-1 font-data text-sm text-cz-1 tabular-nums">
            {prognosis.nextStageDays != null
              ? t("prognosis.report.trainingDays", { days: prognosis.nextStageDays })
              : t(prognosis.stage === "final" ? "prognosis.report.complete" : "prognosis.report.unavailable")}
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-xs text-cz-2">{t("prognosis.report.learningContext")}</p>
    </div>
  );
}
