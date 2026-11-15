import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { SectionStack } from "../../ui/Section.jsx";
import Segmented from "../../ui/Segmented.jsx";
import { aggregateTrainingRuns, type TrainingRun } from "../../../lib/trainingDailyReceipt.ts";
import { receiptPassScore, type ReceiptScoreView } from "../../../lib/trainingScoreView.ts";
import { buildMonthView, buildTodayView, type XpReceipt, type XpViewOptions } from "../../../lib/trainingReportXp.ts";
import { buildXpReportFixture, fixtureScoreOf } from "./xpReportFixture.ts";
import XpToday from "./XpToday.tsx";
import XpMonth from "./XpMonth.tsx";

// #7627 · The training report in XP: "Today" and "30 days" on one surface.
// Only rendered behind the XP switch with XP in the payload, or on the preview
// build with ?xpreport=on (then on the invented fixture). See XpReportSwitch.tsx.

type View = "today" | "days30";
type RosterRider = { id: string; nationality_code?: string | null };

export default function TrainingReportXp({ runs, roster, trainingScore = null, fixture = false }: {
  runs: TrainingRun[]; roster?: RosterRider[] | null; trainingScore?: Record<string, ReceiptScoreView> | null; fixture?: boolean;
}) {
  const { t } = useTranslation("training");
  const [view, setView] = useState<View>("today");
  const [date, setDate] = useState<string | null>(null);
  const data = useMemo((): { receipts: XpReceipt[]; options: XpViewOptions } => {
    if (fixture) {
      const fx = buildXpReportFixture();
      return { receipts: fx.receipts, options: { nations: fx.nations, scoreOf: fixtureScoreOf(fx.scores) } };
    }
    return {
      receipts: aggregateTrainingRuns(runs) as XpReceipt[],
      options: {
        nations: Object.fromEntries((roster ?? []).map(r => [r.id, r.nationality_code ?? null])),
        scoreOf: (id, day, activity, seasonId) => receiptPassScore(trainingScore?.[id], day, seasonId, activity),
      },
    };
  }, [fixture, runs, roster, trainingScore]);
  const today = useMemo(() => buildTodayView(data.receipts, date, data.options), [data, date]);
  const month = useMemo(() => buildMonthView(data.receipts, data.options), [data]);
  if (!today || !month) return null;
  const switcher = (
    <Segmented label={t("xpReport.viewLabel")} value={view} onChange={(v: View) => setView(v)}
      options={[{ value: "today", label: t("xpReport.today") }, { value: "days30", label: t("xpReport.days30") }]} />
  );
  return (
    <SectionStack className="mb-[14px]" data-testid="training-report-xp" data-source={fixture ? "fixture" : "live"}>
      {view === "today"
        ? <XpToday key={today.date} view={today} onPickDate={setDate} switcher={switcher} />
        : <XpMonth view={month} switcher={switcher} onOpenDay={(day) => { setDate(day); setView("today"); }} />}
    </SectionStack>
  );
}
