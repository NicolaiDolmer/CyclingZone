import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import Section, { SectionStack } from "../../ui/Section.jsx";
import { SkeletonLines } from "../../ui/Skeleton.jsx";
import Segmented from "../../ui/Segmented.jsx";
import { ClockIcon } from "../../ui/icons/index.jsx";
import type { DailyTrainingReceipt } from "../../../lib/trainingDailyReceipt.ts";
import { receiptPassScore, type ReceiptScoreView } from "../../../lib/trainingScoreView.ts";
import { buildMonthView, buildTodayView, type XpReceipt, type XpViewOptions } from "../../../lib/trainingReportXp.ts";
import { buildXpReportFixture, fixtureScoreOf } from "./xpReportFixture.ts";
import { EmptyState, ErrorState, SecondaryButton } from "./ui.ts";
import XpToday from "./XpToday.tsx";
import XpMonth from "./XpMonth.tsx";

// #7627 · The training report in XP: "Today" and "30 days" on one surface.
// Only rendered behind the XP switch with XP in the payload, or on the preview
// build with ?xpreport=on (then on the invented fixture). See XpReportSwitch.tsx.
// #8562: it also owns the loading, empty and error states of the report (the kit's
// EmptyState/ErrorState), and "Show older days" on the day strip.

type View = "today" | "days30";
type RosterRider = { id: string; nationality_code?: string | null; primary_type?: string | null; secondary_type?: string | null };
/** Preview build only: which state ?xpreport= shows. "on" is the filled report. */
export type XpReportPreviewState = "data" | "empty" | "error";

export default function TrainingReportXp({ runs, roster, trainingScore = null, fixture = false, fixtureState = "data", loading = false, error = false, onRetry }: {
  runs: DailyTrainingReceipt[]; roster?: RosterRider[] | null; trainingScore?: Record<string, ReceiptScoreView> | null; fixture?: boolean;
  fixtureState?: XpReportPreviewState; loading?: boolean; error?: boolean; onRetry?: () => void;
}) {
  // trainingXp is not inlined (bundle budget): it loads with this lazy surface, so
  // the surface waits for it behind the canonical skeleton instead of raw keys.
  const { t, ready } = useTranslation("trainingXp");
  const navigate = useNavigate();
  const [view, setView] = useState<View>("today");
  const [date, setDate] = useState<string | null>(null);
  const [showAllDays, setShowAllDays] = useState(false);
  const data = useMemo((): { receipts: XpReceipt[]; options: XpViewOptions } => {
    if (fixture) {
      // The preview's empty and error states carry no receipts, like the real ones.
      if (fixtureState !== "data") return { receipts: [], options: {} };
      const fx = buildXpReportFixture();
      return { receipts: fx.receipts, options: { nations: fx.nations, types: fx.types, scoreOf: fixtureScoreOf(fx.scores), abilities: fx.abilities } };
    }
    return {
      // The training page hands over receipts that useTraining/useTrainingHistory
      // already aggregated per date. Aggregating again would read each daily row as
      // one raw slot and drop the earlier slots' XP and sessions (Codex P2 on #8210).
      receipts: (runs ?? []) as XpReceipt[],
      options: {
        nations: Object.fromEntries((roster ?? []).map(r => [r.id, r.nationality_code ?? null])),
        types: Object.fromEntries((roster ?? []).map(r => [r.id, { primary: r.primary_type ?? null, secondary: r.secondary_type ?? null }])),
        scoreOf: (id, day, activity, seasonId) => receiptPassScore(trainingScore?.[id], day, seasonId, activity),
        // #7947: the roster rows carry the flattened abilities (TrainingPage flattenAbilities).
        abilities: Object.fromEntries((roster ?? []).map(r => [r.id, r])),
      },
    };
  }, [fixture, fixtureState, runs, roster, trainingScore]);
  const today = useMemo(() => buildTodayView(data.receipts, date, data.options, showAllDays), [data, date, showAllDays]);
  const month = useMemo(() => buildMonthView(data.receipts, data.options), [data]);
  if (!ready) return <Section className="mb-[14px]" data-testid="training-report-xp-loading"><SkeletonLines lines={10} /></Section>;
  if (!today || !month) {
    const failed = fixture ? fixtureState === "error" : error;
    const waiting = !fixture && loading;
    return (
      <Section className="mb-[14px]" data-testid="training-report-xp-state">
        {waiting ? <SkeletonLines lines={4} />
          : failed ? <ErrorState title={t("xpReport.loadError")} description={t("xpReport.loadErrorBody")}
              action={<SecondaryButton variant="secondary" size="sm" onClick={onRetry}>{t("xpReport.retry")}</SecondaryButton>} />
          : <EmptyState icon={<ClockIcon size={26} aria-hidden="true" />} title={t("xpReport.empty")} description={null}
              action={<SecondaryButton variant="secondary" size="sm" onClick={() => navigate("/training?tab=today")}>{t("xpReport.emptyAction")}</SecondaryButton>} />}
      </Section>
    );
  }
  const switcher = (
    <Segmented label={t("xpReport.viewLabel")} value={view} onChange={(v: View) => setView(v)}
      options={[{ value: "today", label: t("xpReport.today") }, { value: "days30", label: t("xpReport.days30") }]} />
  );
  return (
    <SectionStack className="mb-[14px]" data-testid="training-report-xp" data-source={fixture ? "fixture" : "live"}>
      {view === "today"
        ? <XpToday key={today.date} view={today} onPickDate={setDate} switcher={switcher} showAll={showAllDays} onToggleDays={() => setShowAllDays(v => !v)} />
        : <XpMonth view={month} switcher={switcher} onOpenDay={(day) => { setDate(day); setView("today"); }} />}
    </SectionStack>
  );
}
