import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { formatDeadlineDayCountdown } from "../lib/deadlineDayCountdown";

const API = import.meta.env.VITE_API_URL;

const PHASE = {
  anticipation: {
    bar: "bg-cz-accent/10 border-[#e8c547]/25",
    dot: "bg-cz-accent",
    label: "text-cz-accent/80",
    countdown: "text-cz-accent",
    pulse: false,
  },
  pressure: {
    bar: "bg-red-900/35 border-red-500/35",
    dot: "bg-cz-danger-bg0",
    label: "text-red-400",
    countdown: "text-red-300",
    pulse: false,
  },
  chaos: {
    bar: "bg-red-950/55 border-red-400/50",
    dot: "bg-red-400 animate-pulse",
    label: "text-red-300",
    countdown: "text-white",
    pulse: true,
  },
};

export default function DeadlineDayBanner() {
  const { t } = useTranslation("dashboard");
  const [status, setStatus] = useState(null);
  const [secs, setSecs] = useState(null);
  const tickRef = useRef(null);
  const pollRef = useRef(null);

  const fetchStatus = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch(`${API}/api/deadline-day/status`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setStatus(data);
      setSecs(data.seconds_remaining !== null ? Math.floor(data.seconds_remaining) : null);
    } catch { /* best-effort polling: tolerate transient fetch failures */ }
  }, []);

  useEffect(() => {
    fetchStatus();
    pollRef.current = setInterval(fetchStatus, 30000);
    return () => clearInterval(pollRef.current);
  }, [fetchStatus]);

  // Lokal nedtælling hvert sekund
  const countdownActive = secs !== null && secs > 0;
  const countdownMinute = countdownActive ? Math.floor(secs / 60) : secs;

  useEffect(() => {
    clearInterval(tickRef.current);
    if (!countdownActive) return;
    tickRef.current = setInterval(() => {
      setSecs(prev => {
        if (prev <= 1) { clearInterval(tickRef.current); fetchStatus(); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(tickRef.current);
  }, [countdownActive, countdownMinute, fetchStatus]); // genstart kun ved minutskift

  if (!status?.active) return null;

  const cfg = PHASE[status.phase] || PHASE.pressure;
  const countdown = formatDeadlineDayCountdown(secs, t);

  return (
    <div className={`border-b ${cfg.bar} px-4 py-2 flex items-center justify-between gap-4 min-h-[36px]`}>
      <div className="flex items-center gap-2.5">
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot}`} />
        <span className={`text-[10px] font-black tracking-[0.18em] uppercase ${cfg.label}`}>
          {t("deadlineDayBanner.title")}
        </span>
        {status.override === "on" && (
          <span className="text-[9px] text-cz-3 uppercase tracking-wider ms-1">TEST</span>
        )}
      </div>
      {countdown && (
        <span className={`font-mono text-sm font-bold tabular-nums ${cfg.countdown} ${cfg.pulse ? "animate-pulse" : ""}`}>
          {countdown}
        </span>
      )}
    </div>
  );
}
