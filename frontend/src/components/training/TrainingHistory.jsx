// TrainingHistory — træningsrapport-historik på TrainingPage (#1533).
//
// Viser de seneste dages daglige trænings-kørsler (training_day_runs) som en
// liste af dagskvitteringer (DailyTrainingReceipt, #5915). Ren visning — data
// kommer fra useTrainingHistory (RLS-begrænset SELECT, ingen ny datamodel).
//
// #6030: training_daily_receipt er on for alle (1/10). Den gamle dag-kort-
// historik (flag fra) er slettet; kvitteringen er den eneste visning.

import { useTranslation } from "react-i18next";
import { ClockIcon } from "../ui/icons/index.jsx";
import { SkeletonLines } from "../ui/Skeleton.jsx";
import Section, { SectionHeader } from "../ui/Section.jsx";
import EmptyState from "../ui/EmptyState.jsx";
import DailyTrainingReceipt from "./DailyTrainingReceipt.tsx";
import { copenhagenDayKey } from "../../lib/raceCentre.js";

export default function TrainingHistory({ history, trainingScore = null, condition = null, today = null, roster = null }) {
  const { t } = useTranslation("training");
  const { runs, loading } = history;
  if (loading && runs.length === 0) return <Section><SkeletonLines lines={4} /></Section>;
  if (runs.length === 0) return <Section>
    <SectionHeader title={t("historyTitle")} />
    <EmptyState icon={<ClockIcon size={26} aria-hidden="true" />} title={t("historyEmpty")} />
  </Section>;
  return <div className="space-y-[14px]">{runs.map((run,index)=>
    <DailyTrainingReceipt key={`${run.tick_date}:${run.season_id ?? "legacy"}`} run={run} trainingScore={trainingScore} defaultExpanded={index===0} condition={today && run.tick_date===copenhagenDayKey(today.getTime()) ? condition : undefined} today={today ?? undefined} roster={today && roster && run.tick_date===copenhagenDayKey(today.getTime()) ? roster : undefined} />
  )}</div>;
}
