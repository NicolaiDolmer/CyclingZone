import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Modal from "../ui/Modal.jsx";
import Button from "../ui/Button.jsx";
import { ChevronRightIcon, ClockIcon } from "../ui/icons/index.jsx";
import { fetchPlayerFeatureFlags } from "../../lib/playerFeatureFlags.js";
import { ageForSeason } from "../../lib/riderAge.js";
import { formatNumber } from "../../lib/intl.js";
import type { XpReceipt, XpRiderType } from "../../lib/trainingReportXp.ts";
import { XP_REPORT_FLAG_KEY } from "./reportXp/XpReportSwitch.tsx";
import { formatDay } from "./reportXp/ui.ts";
import { buildXpReportFixture, XP_FIXTURE_LAST_DATE } from "./reportXp/xpReportFixture.ts";
import {
  MOMENT_TOTAL_MS, buildMomentView, easeOut, momentMode, momentWaitingIds, orderRiders, previewMoment, rowProgress, xpAt,
  type MomentRosterRider, type MomentRow, type MomentTier, type MomentView,
} from "./TrainNowMomentModel.ts";
import type { TrainNowPressResult } from "./TrainNowState.ts";

// #8363 (owner choice A, 19/11) · "Today's training": right after Train now the
// day plays in its own view. One row per rider in the team's fixed order, a bar
// that fills and XP that counts up, abilities that rose as small green marks over
// the bar. Under six seconds for any team size, one tap skips it, no motion with
// prefers-reduced-motion. It ends with one line and "See the report", which opens
// the Report tab on today. Sketch: R5Moment.tsx (PR #8248).
//
// Behind the XP switch only (see TrainNowMomentModel.momentMode): switch off or
// no XP in the date's receipt, and it closes itself without drawing anything.

type RosterRider = {
  id: string; firstname?: string | null; lastname?: string | null; birthdate?: string | null;
  primary_type?: string | null; secondary_type?: string | null;
};

const FILL: Record<MomentTier, string> = { best: "bg-cz-accent", mid: "bg-cz-success", low: "bg-cz-2" };
const NUM = "font-data tabular-nums";

function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/** Invented ages for the preview fixture's invented riders (preview build only). */
function fixtureAge(id: string): number {
  const n = Number(id.replace(/\D/g, "")) || 0;
  return 21 + ((n * 7) % 14);
}

function useMomentData({ preview, flagOn, runs, roster, seasonYear, tickDate, waitingIds }: {
  preview: boolean; flagOn: boolean; runs: XpReceipt[]; roster: RosterRider[]; seasonYear: number | null;
  tickDate: string | null; waitingIds: string[];
}): MomentView | null {
  return useMemo(() => {
    const mode = momentMode({ preview, flagOn, runs, date: tickDate });
    if (mode === "off") return null;
    if (mode === "fixture") {
      const fx = buildXpReportFixture();
      const names = new Map((fx.receipts[0]?.report.riders ?? []).map(r => [r.rider_id, r.name ?? r.rider_id]));
      // The fixture's "roster": its riders by last name, as the training page orders the team.
      const fixtureRoster = orderRiders(Object.keys(fx.types).map((id): MomentRosterRider => (
        { id, name: names.get(id) ?? id, age: fixtureAge(id), type: fx.types[id] })), []);
      return buildMomentView(fx.receipts, XP_FIXTURE_LAST_DATE, { roster: fixtureRoster, options: { types: fx.types, nations: fx.nations } });
    }
    const team: MomentRosterRider[] = roster.map(r => ({
      id: r.id,
      name: [r.firstname, r.lastname].filter(Boolean).join(" ") || r.id,
      age: (ageForSeason(r.birthdate, seasonYear) as number | null) ?? null,
      type: { primary: r.primary_type ?? null, secondary: r.secondary_type ?? null } satisfies XpRiderType,
    }));
    return buildMomentView(runs, tickDate!, { roster: team, waitingIds, options: { types: Object.fromEntries(team.map(r => [r.id, r.type ?? null])) } });
  }, [preview, flagOn, runs, roster, seasonYear, tickDate, waitingIds]);
}

function Row({ row, p }: { row: MomentRow; p: number }) {
  const { t } = useTranslation("training");
  const { t: tRider } = useTranslation("rider");
  const { t: tTypes } = useTranslation("riderTypes");
  const done = p >= 1;
  const type = row.type?.primary ? tTypes(`types.${row.type.primary}`) : null;
  const focus = row.focus ? tRider(`training.focus_${row.focus}`) : row.raced ? t("trainNowMoment.raced") : t("trainNowMoment.rest");
  return (
    <li className="flex flex-col gap-1 border-t border-cz-border px-3 py-2 first:border-t-0" data-testid="train-now-moment-row" data-tier={row.tier} data-waiting={row.waiting || undefined}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-[13px] font-semibold text-cz-1">{row.name}</span>
          {type && <span className="shrink-0 text-2xs text-cz-2">{type}</span>}
          {row.age != null && <span className={`shrink-0 text-2xs text-cz-3 ${NUM}`}>{t("trainNowMoment.age", { age: row.age })}</span>}
        </span>
        {!row.waiting && (
          <span className={`shrink-0 text-[13px] font-semibold text-cz-1 ${NUM}`}>
            <span aria-hidden="true">{t("trainNowMoment.xp", { xp: formatNumber(xpAt(row.xp, p)) })}</span>
            <span className="sr-only">{t("trainNowMoment.xp", { xp: formatNumber(row.xp) })}</span>
          </span>
        )}
      </div>
      {row.waiting ? (
        <p className="inline-flex items-center gap-1 text-2xs text-cz-3" data-testid="train-now-moment-waiting">
          <ClockIcon size={12} aria-hidden="true" />{t("trainNowMoment.waiting")}
        </p>
      ) : (
        <>
          <div className="flex min-h-[18px] items-center justify-between gap-2">
            <span className="min-w-0 truncate text-3xs text-cz-3">{focus}</span>
            <span className="flex shrink-0 flex-wrap justify-end gap-1">
              {done && row.tier === "best" && <span className="text-2xs font-semibold text-cz-accent-t">{t("trainNowMoment.best")}</span>}
              {done && row.gains.map(g => (
                <span key={g.key} className={`inline-flex items-center gap-0.5 rounded-cz bg-cz-success-bg px-1.5 py-px text-2xs font-semibold text-cz-success ${NUM}`} data-testid="train-now-moment-gain">
                  {tRider(`racePreview.derived.${g.key}`)}
                  {g.from != null && g.to != null
                    ? <>{" "}{formatNumber(g.from)}<ChevronRightIcon size={10} aria-hidden="true" />{formatNumber(g.to)}</>
                    : <>{" "}{t("trainNowMoment.points", { count: g.points })}</>}
                </span>
              ))}
            </span>
          </div>
          <span className="block h-1.5 overflow-hidden rounded-cz bg-cz-border" aria-hidden="true">
            <span className={`block h-full ${FILL[row.tier]}`} style={{ width: `${Math.round(row.share * easeOut(p) * 100)}%` }} />
          </span>
        </>
      )}
    </li>
  );
}

export default function TrainNowMoment({ open, onClose, onOpenReport, runs, roster, seasonYear = null, tickDate, result = null }: {
  open: boolean;
  onClose: () => void;
  onOpenReport: () => void;
  runs: XpReceipt[] | null | undefined;
  roster: RosterRider[] | null | undefined;
  seasonYear?: number | null;
  tickDate: string | null | undefined;
  /** The press's answer (TrainNowClient): who still waits for today's race. */
  result?: TrainNowPressResult | null;
}) {
  const waitingIds = useMemo(() => momentWaitingIds(result), [result]);
  const { t } = useTranslation("training");
  const isPreview = Boolean(import.meta.env.VITE_PREVIEW_MOCK);
  const preview = previewMoment(isPreview, typeof window === "undefined" ? "" : window.location.search);
  // null = not known yet: draw nothing until the switch has answered.
  const [flagOn, setFlagOn] = useState<boolean | null>(preview ? false : null);
  useEffect(() => {
    if (!open || preview) return undefined;
    let alive = true;
    fetchPlayerFeatureFlags().then((flags: Record<string, boolean>) => { if (alive) setFlagOn(flags[XP_REPORT_FLAG_KEY] === true); });
    return () => { alive = false; };
  }, [open, preview]);

  const view = useMomentData({
    preview, flagOn: flagOn === true, runs: (runs ?? []) as XpReceipt[], roster: roster ?? [], seasonYear,
    tickDate: tickDate ?? null, waitingIds,
  });
  const known = preview || flagOn !== null;

  // Switch off or no XP on the date: close without a trace, the page stays as before.
  useEffect(() => {
    if (open && known && !view) onClose();
  }, [open, known, view, onClose]);

  const [t01, setT01] = useState(() => (reducedMotion() ? 1 : 0));
  const [skipped, setSkipped] = useState(false);
  const playing = open && !!view;
  useEffect(() => {
    if (!playing || skipped || reducedMotion()) return undefined;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const next = Math.min(1, (now - start) / MOMENT_TOTAL_MS);
      setT01(next);
      if (next < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, skipped]);

  if (!open || !view) return null;
  const finished = t01 >= 1;
  const count = view.rows.length;
  const half = Math.ceil(count / 2);
  const columns = [view.rows.slice(0, half), view.rows.slice(half)].filter(col => col.length > 0);
  const skip = () => { setSkipped(true); setT01(1); };

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={t("trainNowMoment.title")}
      description={t("trainNowMoment.subtitle", { date: formatDay(view.date, { weekday: "long", day: "numeric", month: "long" }), count })}
      closeLabel={t("trainNowMoment.close")}
      titleId="train-now-moment-title"
      footer={finished ? (
        <>
          <p className="me-auto flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 self-center text-[13px] text-cz-1" data-testid="train-now-moment-summary">
            <span className="font-semibold">{t("trainNowMoment.summaryRiders", { count: view.riders })}</span>
            <span className="text-cz-3" aria-hidden="true">·</span>
            <span className={NUM}>{t("trainNowMoment.summaryXp", { xp: formatNumber(view.xp) })}</span>
            <span className="text-cz-3" aria-hidden="true">·</span>
            <span>{t("trainNowMoment.summaryPoints", { count: view.points })}</span>
          </p>
          <Button variant="primary" onClick={onOpenReport} className="shrink-0" data-testid="train-now-moment-report">{t("trainNowMoment.openReport")}</Button>
        </>
      ) : (
        <Button variant="secondary" onClick={skip} data-testid="train-now-moment-skip">{t("trainNowMoment.skip")}</Button>
      )}
    >
      <div className="-mx-2 grid gap-3 sm:grid-cols-2" data-testid="train-now-moment" data-finished={finished || undefined}>
        {columns.map((col, c) => (
          <ul key={c} className="min-w-0 rounded-cz border border-cz-border" aria-label={c === 0 ? t("trainNowMoment.listLabel") : undefined}>
            {col.map((row, i) => <Row key={row.id} row={row} p={rowProgress(t01, c * half + i, count)} />)}
          </ul>
        ))}
      </div>
    </Modal>
  );
}
