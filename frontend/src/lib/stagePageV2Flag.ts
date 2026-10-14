// #6570 · Klient til GET /api/races/stage-page-v2 (backend/lib/stagePageV2Flag.js).
//
// Svaret er en bar boolean, evalueret SERVER-SIDE mod viewerens beta-status.
// Aldrig blokerende og aldrig kastende: ethvert fejlsvar giver false = den
// nuvaerende loebsside, samme fail-safe som serverens evaluateFlagStage.
//
// Preview (VITE_PREVIEW_MOCK): der findes ingen backend, og preview-vieweren er
// ejeren (admin = beta-tester), saa flaget laeses som "beta for mig" = true.
// `?v2=off` i URL'en viser den nuvaerende side, saa et foer/efter-billede kan
// tages paa samme preview. Parameteren virker KUN i preview-bygget.
import { useEffect, useState } from "react";
import { apiFetch } from "./apiFetch.ts";
import { authHeaders } from "./supabase.ts";

/** Ren: preview-svaret ud fra URL'ens query. null = ikke preview. */
export function resolvePreviewOverride(search: string, isPreview: boolean): boolean | null {
  if (!isPreview) return null;
  const v = new URLSearchParams(search).get("v2");
  return v !== "off";
}

/** Ren: { enabled } fra serveren → boolean. Alt andet end praecis true = false. */
export function parseStagePageV2Response(data: unknown): boolean {
  return typeof data === "object" && data !== null && (data as { enabled?: unknown }).enabled === true;
}

export async function fetchStagePageV2Enabled(): Promise<boolean> {
  try {
    const headers = await authHeaders({ json: false });
    if (!headers) return false;
    const res = await apiFetch("/api/races/stage-page-v2", { headers });
    return res.ok ? parseStagePageV2Response(res.data) : false;
  } catch {
    return false;
  }
}

/** null = henter endnu, ellers boolean. */
export function useStagePageV2(): boolean | null {
  const isPreview = Boolean(import.meta.env.VITE_PREVIEW_MOCK);
  const search = typeof window !== "undefined" ? window.location.search : "";
  const override = resolvePreviewOverride(search, isPreview);
  const [enabled, setEnabled] = useState<boolean | null>(override);

  useEffect(() => {
    if (override !== null) {
      setEnabled(override);
      return;
    }
    let alive = true;
    fetchStagePageV2Enabled().then((value) => {
      if (alive) setEnabled(value);
    });
    return () => {
      alive = false;
    };
  }, [override]);

  return enabled;
}
