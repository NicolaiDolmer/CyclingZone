import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";

const API = import.meta.env.VITE_API_URL;

// #3859 (bølge 2 — løbsfilm-afspilleren): henter spec §2.4's afspilnings-API
// (docs/superpowers/specs/2026-08-17-race-event-log-stage-timeline-design.md)
// — `GET /api/races/:raceId/timeline?stage=N` → { timeline_version, stage_number,
// events }. Bygget mod SPEC-KONTRAKTEN mens backenden (#3860) landede samtidig i
// en anden worktree; kalder det ægte endpoint her (samme fetch-mønster som
// useActionSummary.js), men tests mocker det (aldrig ægte netværkskald i tests).
//
// 404 (ingen tidslinje for denne etape/dette løb endnu — S3-forward-only, spec
// §4 valg 3A) degraderer PÆNT til `timeline: null`. Forbrugeren (StoryOfTheStage-
// Section) renderer da INTET i stedet for en fejlmelding — samme princip som
// FinalKilometrePlayback's `available: false`.
export function useStageTimeline(raceId, stageNumber) {
  const [timelineState, setTimelineState] = useState(null);
  const timeline = timelineState?.raceId === raceId && timelineState?.stageNumber === stageNumber ? timelineState.data : null;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!raceId || !stageNumber) { setTimelineState(null); return undefined; }

    (async () => {
      setLoading(true);
      setError(false);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const headers = session ? { Authorization: `Bearer ${session.access_token}` } : {};
        const res = await fetch(
          `${API}/api/races/${encodeURIComponent(raceId)}/timeline?stage=${encodeURIComponent(stageNumber)}`,
          { headers },
        );
        if (cancelled) return;
        if (res.status === 404) { setTimelineState(null); return; }
        if (!res.ok) { setError(true); setTimelineState(null); return; }
        const data = await res.json().catch(() => null);
        // Degraderer ærligt hvis kontrakten ikke er opfyldt (fx en flad {} fra
        // en endnu-ikke-live backend) — ingen events-liste = ingen film/historie.
        setTimelineState(data && Array.isArray(data.events) ? { raceId, stageNumber, data } : null);
      } catch {
        if (!cancelled) { setError(true); setTimelineState(null); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [raceId, stageNumber]);

  return { timeline, loading, error };
}
