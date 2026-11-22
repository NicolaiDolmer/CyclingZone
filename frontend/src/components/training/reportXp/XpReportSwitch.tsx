import { lazy, useEffect, useState, type ReactNode } from "react";
import { fetchPlayerFeatureFlags } from "../../../lib/playerFeatureFlags.js";
import { hasXpFields } from "../../../lib/trainingReportXp.ts";
import type { DailyTrainingReceipt } from "../../../lib/trainingDailyReceipt.ts";
import type { ReceiptScoreView } from "../../../lib/trainingScoreView.ts";
import type { XpReportPreviewState } from "./TrainingReportXp.tsx";

// #7627 · Which report the Report tab shows.
//
//   off      (default) today's report, exactly as before.
//   live     the XP switch (development_xp_model) reads as on for this viewer AND
//            the stored receipts carry XP, or there are no receipts at all (#8562: the
//            surface then shows the loading, empty or error state). Neither holds today: the key is not in
//            /api/feature-flags' allowlist and the engine does not write XP to
//            the report, so players never see this surface.
//   fixture  preview build only (VITE_PREVIEW_MOCK) with ?xpreport=on: the
//            invented fixture, so the owner can see the surface before anything
//            is switched on (spec §7.1, "Preview"). ?xpreport=empty and =error show
//            the two states.
export const XP_REPORT_FLAG_KEY = "development_xp_model";
export const XP_REPORT_PREVIEW_PARAM = "xpreport";
export type XpReportMode = "off" | "live" | "fixture";

/** ?xpreport=on is the filled fixture; =empty and =error show the two states (#8562). */
export function previewXpReportState(search: string): XpReportPreviewState | null {
  const value = new URLSearchParams(search).get(XP_REPORT_PREVIEW_PARAM);
  return value === "on" ? "data" : value === "empty" || value === "error" ? value : null;
}

export function previewXpReport(isPreview: boolean, search: string): boolean {
  return isPreview && previewXpReportState(search) !== null;
}

export function xpReportMode({ preview, flagOn, runs }: { preview: boolean; flagOn: boolean; runs: DailyTrainingReceipt[] | null | undefined }): XpReportMode {
  if (preview) return "fixture";
  if (!flagOn) return "off";
  // No receipts at all (loading, a failed fetch or a season with no training yet): the XP surface
  // shows the state. Receipts without XP keep today's report.
  return hasXpFields(runs as never) || !runs?.length ? "live" : "off";
}

const TrainingReportXp = lazy(() => import("./TrainingReportXp.tsx"));

export default function XpReportSwitch({ runs, roster, trainingScore, loading = false, error = false, onRetry, children }: {
  runs: DailyTrainingReceipt[]; roster?: Array<{ id: string; nationality_code?: string | null }> | null;
  trainingScore?: Record<string, ReceiptScoreView> | null; loading?: boolean; error?: boolean; onRetry?: () => void; children: ReactNode;
}) {
  const isPreview = Boolean(import.meta.env.VITE_PREVIEW_MOCK);
  const search = typeof window === "undefined" ? "" : window.location.search;
  const preview = previewXpReport(isPreview, search);
  const [flagOn, setFlagOn] = useState(false);
  useEffect(() => {
    if (isPreview) return undefined;
    let alive = true;
    fetchPlayerFeatureFlags().then((flags: Record<string, boolean>) => { if (alive) setFlagOn(flags[XP_REPORT_FLAG_KEY] === true); });
    return () => { alive = false; };
  }, [isPreview]);
  const mode = xpReportMode({ preview, flagOn, runs });
  if (mode === "off") return <>{children}</>;
  return <TrainingReportXp runs={runs} roster={roster} trainingScore={trainingScore} fixture={mode === "fixture"}
    fixtureState={previewXpReportState(search) ?? "data"} loading={loading} error={error} onRetry={onRetry} />;
}
