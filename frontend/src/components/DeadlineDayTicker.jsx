import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";

const API = import.meta.env.VITE_API_URL;

async function getToken() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

// #1355 (WCAG 2.2.2 Pause, Stop, Hide): den scrollende ticker bevæger sig >5s
// uden afbrydelse. Vi respekterer `prefers-reduced-motion: reduce` ved at starte
// pauset, og giver en synlig pause/resume-knap så brugeren altid kan stoppe den.
function prefersReducedMotion() {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(prefersReducedMotion);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

export default function DeadlineDayTicker({ onActiveChange }) {
  const { t } = useTranslation("common");
  const [events, setEvents] = useState([]);
  const [active, setActive] = useState(false);
  const reducedMotion = useReducedMotion();
  // Manuelt pause-toggle. Default-pauset hvis brugeren har bedt om reduceret
  // bevægelse — så animationen aldrig starter uden samtykke.
  const [paused, setPaused] = useState(prefersReducedMotion);

  // Hvis OS-præferencen skifter til "reduce" mens tickeren er åben, så pause med
  // det samme (forward-guard mod at bevægelsen kører videre efter et systemskift).
  useEffect(() => {
    if (reducedMotion) setPaused(true);
  }, [reducedMotion]);

  async function fetchStatus() {
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch(`${API}/api/deadline-day/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setActive(data.active);
    } catch { /* best-effort polling: tolerate transient fetch failures */ }
  }

  async function fetchTicker() {
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch(`${API}/api/deadline-day/ticker`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      setEvents(await res.json());
    } catch { /* best-effort polling: tolerate transient fetch failures */ }
  }

  useEffect(() => {
    fetchStatus();
    const iv = setInterval(fetchStatus, 60_000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    if (onActiveChange) onActiveChange(active);
  }, [active, onActiveChange]);

  useEffect(() => {
    if (!active) { setEvents([]); return; }
    fetchTicker();
    const iv = setInterval(fetchTicker, 10_000);
    return () => clearInterval(iv);
  }, [active]);

  if (!active || events.length === 0) return null;

  const text = events.map(e => e.text).join("   •   ");
  // Bevægelsen er stoppet hvis brugeren har pauset ELLER ønsker reduceret bevægelse.
  const animationStopped = paused || reducedMotion;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 bg-[#0a0a0f]/95 border-t border-[#e8c547]/15 overflow-hidden h-8 flex items-center">
      {/* Når animationen er stoppet bliver striben scrollbar, så hele indholdet
          forbliver læsbart uden bevægelse (WCAG 2.2.2 — indhold må ikke gå tabt). */}
      <div
        className={`flex-1 min-w-0 flex whitespace-nowrap text-[11px] text-cz-accent/60 font-medium tracking-wide select-none ${
          animationStopped ? "overflow-x-auto" : "animate-ticker"
        }`}
      >
        <span>{text}&nbsp;&nbsp;&nbsp;&bull;&nbsp;&nbsp;&nbsp;</span>
        {!animationStopped && (
          <span aria-hidden="true">{text}&nbsp;&nbsp;&nbsp;&bull;&nbsp;&nbsp;&nbsp;</span>
        )}
      </div>
      <button
        type="button"
        onClick={() => setPaused(p => !p)}
        aria-pressed={animationStopped}
        title={animationStopped ? t("deadlineTicker.resume") : t("deadlineTicker.pause")}
        aria-label={animationStopped ? t("deadlineTicker.resume") : t("deadlineTicker.pause")}
        className="flex-shrink-0 h-full px-2.5 flex items-center justify-center text-cz-accent/70 hover:text-cz-accent transition-colors border-l border-[#e8c547]/15"
      >
        {animationStopped ? (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true">
            <path d="M2 1.5v7l6-3.5-6-3.5z" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true">
            <rect x="2" y="1.5" width="2.2" height="7" />
            <rect x="5.8" y="1.5" width="2.2" height="7" />
          </svg>
        )}
      </button>
    </div>
  );
}
