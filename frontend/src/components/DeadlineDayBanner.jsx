import { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";

const API = import.meta.env.VITE_API_URL;

const PHASE = {
  anticipation: {
    bar: "bg-[#e8c547]/10 border-[#e8c547]/25",
    dot: "bg-[#e8c547]",
    label: "text-[#e8c547]/80",
    countdown: "text-[#e8c547]",
    pulse: false,
  },
  pressure: {
    bar: "bg-red-900/35 border-red-500/35",
    dot: "bg-red-500",
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

function formatCountdown(secs) {
  if (secs === null || secs <= 0) return null;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  const pad = n => String(n).padStart(2, "0");
  if (h > 0) return `${h}t ${pad(m)}m ${pad(s)}s`;
  return `${pad(m)}:${pad(s)}`;
}

export default function DeadlineDayBanner() {
  const [status, setStatus] = useState(null);
  const [secs, setSecs] = useState(null);
  const tickRef = useRef(null);
  const pollRef = useRef(null);

  async function fetchStatus() {
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
    } catch {}
  }

  useEffect(() => {
    fetchStatus();
    pollRef.current = setInterval(fetchStatus, 30000);
    return () => clearInterval(pollRef.current);
  }, []);

  // Lokal nedtælling hvert sekund
  useEffect(() => {
    clearInterval(tickRef.current);
    if (!secs || secs <= 0) return;
    tickRef.current = setInterval(() => {
      setSecs(prev => {
        if (prev <= 1) { clearInterval(tickRef.current); fetchStatus(); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(tickRef.current);
  }, [secs !== null && secs > 0 ? Math.floor(secs / 60) : secs]); // genstart kun ved minutskift

  if (!status?.active) return null;

  const cfg = PHASE[status.phase] || PHASE.pressure;
  const countdown = formatCountdown(secs);

  return (
    <div className={`border-b ${cfg.bar} px-4 py-2 flex items-center justify-between gap-4 min-h-[36px]`}>
      <div className="flex items-center gap-2.5">
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot}`} />
        <span className={`text-[10px] font-black tracking-[0.18em] uppercase ${cfg.label}`}>
          Deadline Day
        </span>
        {status.override === "on" && (
          <span className="text-[9px] text-white/20 uppercase tracking-wider ml-1">TEST</span>
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
