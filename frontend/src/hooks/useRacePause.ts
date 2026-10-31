import { useEffect, useState } from "react";
import { fetchRacePause, isRacePauseActive, type RacePause } from "../lib/racePause.ts";

// #6970 — den aktive loebs-pause (eller null). Ikke-kritisk: en hente-fejl lader
// banneret forblive skjult, aldrig vaelte siden (samme princip som RaceControlBanner).
// Et minut-tick lader en pause udloebe af sig selv naar den nye start er naaet.
export default function useRacePause(enabled = true, refreshKey?: string): RacePause | null {
  const [pause, setPause] = useState<RacePause | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Uret er uafhængigt af refreshKey: navigation må ikke nulstille minut-tick'et,
  // ellers kan en udløbet pause blive stående, når man skifter side oftere end hvert minut.
  useEffect(() => {
    if (!enabled) return undefined;
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    fetchRacePause()
      .then((p) => { if (active) { setPause(p); setNowMs(Date.now()); } })
      .catch(() => { /* ikke-kritisk: banneret forbliver skjult */ });
    return () => { active = false; };
  }, [enabled, refreshKey]);

  return enabled && isRacePauseActive(pause, nowMs) ? pause : null;
}
