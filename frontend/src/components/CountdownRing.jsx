// #2577: Closing countdown ring — vises kun ved <= 10s tilbage i auktionsflader
// (AuctionsPage-tabel + RiderStatsPage-bidpanel). Danger (aldrig gold) de sidste
// 3s: gold er reserveret til lederen (D-SEM). Respekterer prefers-reduced-motion
// ved at fryse ringen og kun ticke tallet (spec A6, hard krav).
import { useEffect, useState } from "react";

const R = 9, C = 2 * Math.PI * R; // 24px viewBox, matcher ikon-grid

export default function CountdownRing({ closesAt, windowSecs = 10 }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, []);
  const left = Math.max(0, (new Date(closesAt) - now) / 1000);
  const frac = Math.min(1, left / windowSecs);
  const danger = left <= 3;
  const color = danger ? "rgb(var(--danger))" : "rgb(var(--accent-t))";
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  return (
    <span className="inline-flex items-center gap-1.5 font-mono tabular-nums text-xs"
          style={{ color }} role="timer" aria-live="off">
      <svg width="20" height="20" viewBox="0 0 24 24" style={{ transform: "rotate(-90deg)" }} aria-hidden="true">
        <circle cx="12" cy="12" r={R} fill="none" stroke="var(--bg-subtle)" strokeWidth="2.5" />
        <circle cx="12" cy="12" r={R} fill="none" stroke={color} strokeWidth="2.5"
                strokeLinecap="round" strokeDasharray={C}
                strokeDashoffset={reduced ? 0 : C * (1 - frac)}
                style={{ transition: "stroke var(--dur) linear" }} />
      </svg>
      0:{String(Math.ceil(left)).padStart(2, "0")}
    </span>
  );
}
