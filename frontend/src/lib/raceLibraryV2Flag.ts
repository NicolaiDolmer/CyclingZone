// #6514 · Klient til GET /api/races/race-library-v2 (backend/lib/raceLibraryV2Flag.js).
//
// Svaret er en bar boolean, evalueret SERVER-SIDE mod viewerens beta-status.
// Aldrig blokerende og aldrig kastende: ethvert fejlsvar giver false = den
// nuværende kalender og det nuværende arkiv, samme fail-safe som serverens
// evaluateFlagStage. Mønster kopieret fra stagePageV2Flag.ts.
//
// Preview (VITE_PREVIEW_MOCK): der findes ingen backend, og preview-vieweren er
// ejeren (admin = beta-tester), så flaget læses som "beta for mig" = true.
// `?lib2=off` i URL'en viser den nuværende visning, så et før/efter-billede kan
// tages på samme preview. Parameteren virker KUN i preview-bygget.
import { useEffect, useState } from "react";
import { apiFetch } from "./apiFetch.ts";
import { isViewerChangeEvent } from "./viewerChange.ts";
import { authHeaders, supabase } from "./supabase.ts";

// requestRaceLibraryV2 kaster aldrig; kun et haengende kald skal give false efter timeout.
const withTimeout = (p: Promise<boolean>, ms: number): Promise<boolean> =>
  Promise.race([p, new Promise<boolean>((resolve) => setTimeout(resolve, ms, false))]);

async function requestRaceLibraryV2(): Promise<boolean> {
  try {
    const headers = await authHeaders({ json: false });
    if (!headers) return false;
    const res = await apiFetch("/api/races/race-library-v2", { headers });
    return res.ok && (res.data as { enabled?: unknown } | null)?.enabled === true;
  } catch {
    return false;
  }
}

// Ét kald pr. viewer pr. sideindlæsning: kalenderen og Resultater spørger begge, og svaret
// ændrer sig kun når ejeren flytter flaget. Kun et sandt svar huskes; et false
// (fx før login er klar, eller et timeout) spørges igen ved næste mount.
let cached: Promise<boolean> | null = null;
let authListenerInstalled = false;
// Codex-fund: svaret er viewer-bundet. Modulet overlever logout i samme SPA-fane,
// så cachen tømmes når viewer skifter (samme mønster som logEvent.js).
function installAuthListener(): void {
  if (authListenerInstalled) return;
  authListenerInstalled = true;
  supabase.auth.onAuthStateChange((event) => {
    if (isViewerChangeEvent(event)) cached = null;
  });
}
function fetchRaceLibraryV2Enabled(): Promise<boolean> {
  installAuthListener();
  if (!cached) {
    cached = withTimeout(requestRaceLibraryV2(), 4000).then((v) => {
      if (!v) cached = null;
      return v;
    });
  }
  return cached;
}

/** null = henter endnu, ellers boolean. */
export function useRaceLibraryV2(): boolean | null {
  const isPreview = Boolean(import.meta.env.VITE_PREVIEW_MOCK);
  // Preview: "beta for mig" = true; ?lib2=off viser den nuvaerende visning.
  const override = isPreview ? new URLSearchParams(window.location.search).get("lib2") !== "off" : null;
  const [enabled, setEnabled] = useState<boolean | null>(override);

  useEffect(() => {
    if (override !== null) {
      setEnabled(override);
      return;
    }
    let alive = true;
    fetchRaceLibraryV2Enabled().then((value) => {
      if (alive) setEnabled(value);
    });
    return () => {
      alive = false;
    };
  }, [override]);

  return enabled;
}
