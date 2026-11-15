import { lazy, useEffect, useState, type ReactNode } from "react";
import { fetchPlayerFeatureFlags } from "../../../lib/playerFeatureFlags.js";
import { hasXpFields } from "../../../lib/trainingReportXp.ts";
import type { TrainingRun } from "../../../lib/trainingDailyReceipt.ts";
import type { ReceiptScoreView } from "../../../lib/trainingScoreView.ts";

// #7627 · Which report the Report tab shows.
//
//   off      (default) today's report, exactly as before.
//   live     the XP switch (development_xp_model) reads as on for this viewer AND
//            the stored receipts carry XP. Neither holds today: the key is not in
//            /api/feature-flags' allowlist and the engine does not write XP to
//            the report, so players never see this surface.
//   fixture  preview build only (VITE_PREVIEW_MOCK) with ?xpreport=on: the
//            invented fixture, so the owner can see the surface before anything
//            is switched on (spec §7.1, "Preview").
export const XP_REPORT_FLAG_KEY = "development_xp_model";
export const XP_REPORT_PREVIEW_PARAM = "xpreport";
export type XpReportMode = "off" | "live" | "fixture";

export function previewXpReport(isPreview: boolean, search: string): boolean {
  return isPreview && new URLSearchParams(search).get(XP_REPORT_PREVIEW_PARAM) === "on";
}

export function xpReportMode({ preview, flagOn, runs }: { preview: boolean; flagOn: boolean; runs: TrainingRun[] | null | undefined }): XpReportMode {
  if (preview) return "fixture";
  return flagOn && hasXpFields(runs as never) ? "live" : "off";
}

const TrainingReportXp = lazy(() => import("./TrainingReportXp.tsx"));

export default function XpReportSwitch({ runs, roster, trainingScore, children }: {
  runs: TrainingRun[]; roster?: Array<{ id: string; nationality_code?: string | null }> | null;
  trainingScore?: Record<string, ReceiptScoreView> | null; children: ReactNode;
}) {
  const isPreview = Boolean(import.meta.env.VITE_PREVIEW_MOCK);
  const preview = previewXpReport(isPreview, typeof window === "undefined" ? "" : window.location.search);
  const [flagOn, setFlagOn] = useState(false);
  useEffect(() => {
    if (isPreview) return undefined;
    let alive = true;
    fetchPlayerFeatureFlags().then((flags: Record<string, boolean>) => { if (alive) setFlagOn(flags[XP_REPORT_FLAG_KEY] === true); });
    return () => { alive = false; };
  }, [isPreview]);
  const mode = xpReportMode({ preview, flagOn, runs });
  if (mode === "off") return <>{children}</>;
  return <TrainingReportXp runs={runs} roster={roster} trainingScore={trainingScore} fixture={mode === "fixture"} />;
}
