import { useTranslation } from "react-i18next";
import { ClockIcon } from "../ui/icons/index.jsx";
import { SkeletonLines } from "../ui/Skeleton.jsx";
import Section, { SectionHeader } from "../ui/Section.jsx";
import EmptyState from "../ui/EmptyState.jsx";
import DailyTrainingReceipt from "./DailyTrainingReceipt.tsx";
import { copenhagenDayKey } from "../../lib/raceCentre.js";

export default function TrainingHistory({ history, trainingScore = null, condition = null, today = null }) {
  const { t } = useTranslation("training");
  const { runs, loading } = history;
  if (loading && runs.length === 0) return <Section><SkeletonLines lines={4} /></Section>;
  if (runs.length === 0) return <Section>
    <SectionHeader title={t("historyTitle")} />
    <EmptyState icon={<ClockIcon size={26} aria-hidden="true" />} title={t("historyEmpty")} />
  </Section>;
  return <div className="space-y-[14px]">{runs.map((run,index)=>
    <DailyTrainingReceipt key={`${run.tick_date}:${run.season_id ?? "legacy"}`} run={run} trainingScore={trainingScore} defaultExpanded={index===0} condition={today && run.tick_date===copenhagenDayKey(today.getTime()) ? condition : undefined} today={today ?? undefined} />
  )}</div>;
}
