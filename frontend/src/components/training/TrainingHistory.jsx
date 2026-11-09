// TrainingHistory — træningsrapport-historik på TrainingPage (#1533).
//
// Viser de seneste dages daglige trænings-kørsler (training_day_runs) som en
// liste af dagskvitteringer (DailyTrainingReceipt, #5915). Ren visning — data
// kommer fra useTrainingHistory (RLS-begrænset SELECT, ingen ny datamodel).
//
// #6030: training_daily_receipt er on for alle (1/10). Den gamle dag-kort-
// historik (flag fra) er slettet; kvitteringen er den eneste visning.
//
// #7745: de kanoniske tilstande (PAGE_TEMPLATES): kortets hoved står altid,
// kun kroppen skifter. En fejlet hentning er en fejl-tilstand med "Prøv igen",
// aldrig en tom historik; den tomme tilstand har én vej videre.

import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { ClockIcon } from "../ui/icons/index.jsx";
import { SkeletonLines } from "../ui/Skeleton.jsx";
import Section, { SectionHeader } from "../ui/Section.jsx";
import EmptyState from "../ui/EmptyState.jsx";
import ErrorState from "../ui/ErrorState.jsx";
import Button from "../ui/Button.jsx";
import DailyTrainingReceipt from "./DailyTrainingReceipt.tsx";
import { copenhagenDayKey } from "../../lib/raceCentre.js";

export default function TrainingHistory({ history, trainingScore = null, condition = null, today = null, roster = null }) {
  const { t } = useTranslation("training");
  const navigate = useNavigate();
  const { runs, loading, error = false, refresh } = history;
  if (runs.length === 0) return <Section data-testid="training-history-state">
    <SectionHeader title={t("historyTitle")} />
    {loading ? <SkeletonLines lines={4} />
      : error ? <ErrorState title={t("dailyReceipt.loadError")} description={t("dailyReceipt.loadErrorBody")}
          action={/** @type {any} */ (<Button variant="secondary" size="sm" onClick={() => refresh?.()}>{t("dailyReceipt.retry")}</Button>)} />
      : <EmptyState icon={<ClockIcon size={26} aria-hidden="true" />} title={t("historyEmpty")} description={null}
          action={<Button variant="secondary" size="sm" onClick={() => navigate("/training?tab=today")}>{t("dailyReceipt.emptyAction")}</Button>} />}
  </Section>;
  return <div className="space-y-[14px]">{runs.map((run,index)=>
    <DailyTrainingReceipt key={`${run.tick_date}:${run.season_id ?? "legacy"}`} run={run} trainingScore={trainingScore} defaultExpanded={index===0} condition={today && run.tick_date===copenhagenDayKey(today.getTime()) ? condition : undefined} today={today ?? undefined} roster={today && roster && run.tick_date===copenhagenDayKey(today.getTime()) ? roster : undefined} />
  )}</div>;
}
