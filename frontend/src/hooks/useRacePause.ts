import { useEffect, useMemo, useState } from "react";
import {
  fetchRacePauseInputs,
  resolveRacePause,
  type RacePause,
  type RacePauseInputs,
} from "../lib/racePause.ts";

// #6970/#7335 — den aktive loebs-pause (eller null). Kilderne (kontakten, notice,
// saeson, saesonskifte) hentes raat, og pausen udledes ved hvert render, saa en
// notice med ny starttid udloeber af sig selv (minut-tick) mens kontakten stadig
// kan holde pausen. Ikke-kritisk: en hente-fejl lader banneret forblive skjult,
// aldrig vaelte siden (samme princip som RaceControlBanner).
export default function useRacePause(enabled = true, refreshKey?: string): RacePause | null {
  const [inputs, setInputs] = useState<RacePauseInputs | null>(null);
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
    fetchRacePauseInputs()
      .then((next) => { if (active) { setInputs(next); setNowMs(Date.now()); } })
      .catch(() => { /* ikke-kritisk: banneret forbliver skjult */ });
    return () => { active = false; };
  }, [enabled, refreshKey]);

  // Stabil identitet: DashboardPage har pausen i en effect-deps-liste, saa et nyt
  // objekt pr. render (eller pr. minut-tick) maa ikke genkoere effekten.
  const resolved = enabled ? resolveRacePause(inputs, nowMs) : null;
  const paused = resolved != null;
  const newStartMs = resolved?.newStartMs ?? null;
  const silent = resolved?.silent === true;
  return useMemo<RacePause | null>(
    () => (paused ? (silent ? { paused: true, newStartMs, silent: true } : { paused: true, newStartMs }) : null),
    [paused, newStartMs, silent],
  );
}
