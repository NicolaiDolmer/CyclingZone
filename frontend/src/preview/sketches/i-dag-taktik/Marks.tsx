// Skitse #7535 "I dag": billed-paategninger, kun til PR-billederne (slaas til med ?cap= og ?mark=).
// Caption = nummer + een saetning braendt ind oeverst. Frames = roed ramme + nummer om hvert
// element med data-mark. Flow = numrerede pile mellem elementerne med data-flow (vejen ind).
// Maales fra DOM'en, saa rammerne foelger layoutet ved alle bredder.

import { useLayoutEffect, useState } from "react";

const RED = "rgb(var(--danger))";

type Box = { key: string; label: string; x: number; y: number; w: number; h: number };

function measure(attr: string): Box[] {
  return [...document.querySelectorAll<HTMLElement>(`[${attr}]`)]
    .filter((el) => el.offsetParent !== null || el.getClientRects().length > 0)
    .map((el, i) => {
      const r = el.getBoundingClientRect();
      return { key: `${attr}-${i}`, label: el.getAttribute(attr) ?? "", x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height };
    })
    .filter((b) => b.w > 0 && b.h > 0);
}

function useBoxes(attr: string, on: boolean) {
  const [boxes, setBoxes] = useState<Box[]>([]);
  useLayoutEffect(() => {
    if (!on) return;
    const run = () => setBoxes(measure(attr));
    run();
    const t = window.setTimeout(run, 300);
    document.fonts?.ready.then(run);
    window.addEventListener("resize", run);
    const ro = new ResizeObserver(run);
    ro.observe(document.body);
    return () => { window.clearTimeout(t); window.removeEventListener("resize", run); ro.disconnect(); };
  }, [attr, on]);
  return boxes;
}

export function Caption({ n, text }: { n: string; text: string }) {
  return (
    <div style={{ background: "var(--bg-sidebar)", color: "white", padding: "14px 20px", display: "flex", gap: 12, alignItems: "center", fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 16, lineHeight: 1.35 }}>
      <span style={{ background: RED, color: "white", borderRadius: 999, minWidth: 30, height: 30, display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 15, flex: "none" }}>{n}</span>
      <span>{text}</span>
    </div>
  );
}

const pin = (label: string, x: number, y: number) => (
  <span style={{ position: "absolute", left: Math.max(x, 18), top: Math.max(y, 14), transform: "translate(-80%, -60%)", background: RED, color: "white", borderRadius: 999, minWidth: 24, height: 24, padding: "0 6px", display: "inline-flex", alignItems: "center", justifyContent: "center", font: "700 13px/1 'DM Sans', system-ui, sans-serif", outline: "2px solid white" }}>{label}</span>
);

export function Frames({ on }: { on: boolean }) {
  const boxes = useBoxes("data-mark", on);
  if (!on) return null;
  return (
    <div aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, width: 0, height: 0, zIndex: 50, pointerEvents: "none" }}>
      {boxes.map((b) => (
        <div key={b.key}>
          <div style={{ position: "absolute", left: b.x - 4, top: b.y - 4, width: b.w + 8, height: b.h + 8, border: `2.5px solid ${RED}`, borderRadius: 6 }} />
          {pin(b.label, b.x - 4, b.y - 4)}
        </div>
      ))}
    </div>
  );
}

/** Vejen ind: 1 sidebjaelken, 2 'Today', 3 dagens liste. Pilene gaar fra kant til kant. */
export function FlowArrows({ on }: { on: boolean }) {
  const boxes = useBoxes("data-flow", on).sort((a, b) => a.label.localeCompare(b.label));
  if (!on || boxes.length < 2) return null;
  const W = document.documentElement.scrollWidth;
  const H = document.documentElement.scrollHeight;
  const edge = (from: Box, to: Box): [number, number, number, number] => {
    const fx = from.x + from.w, fy = from.y + from.h / 2;
    const tx = to.x + to.w / 2, ty = to.y;
    if (to.y > from.y + from.h) return [from.x + from.w / 2, from.y + from.h, tx, ty];
    return [fx, fy, to.x, to.y + to.h / 2];
  };
  return (
    <div aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, width: 0, height: 0, zIndex: 50, pointerEvents: "none" }}>
      <svg width={W} height={H} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
        <defs>
          <marker id="flow-head" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10z" fill={RED} />
          </marker>
        </defs>
        {boxes.map((b) => (
          <rect key={`r-${b.key}`} x={b.x - 4} y={b.y - 4} width={b.w + 8} height={b.h + 8} rx={6} fill="none" stroke={RED} strokeWidth={2.5} />
        ))}
        {boxes.slice(1).map((to, i) => {
          const from = boxes[i];
          const [x1, y1, x2, y2] = edge(from, to);
          const mx = (x1 + x2) / 2;
          // op og til hoejre (sidebjaelken til sidehovedet): ned ad rillen ved sidebjaelken og hen over
          // sidehovedet, saa pilen ikke krydser indholdet
          if (to.y + to.h < from.y && to.x > from.x + from.w) {
            const gx = from.x + from.w + 14, top = to.y - 24, cx = to.x + to.w / 2;
            return <path key={`p-${to.key}`} d={`M${from.x + from.w + 6} ${y1} H${gx} V${top} H${cx} V${to.y - 10}`} fill="none" stroke={RED} strokeWidth={3} strokeLinejoin="round" markerEnd="url(#flow-head)" />;
          }
          const d = y2 > y1 + 40 && Math.abs(x2 - x1) < 400
            ? `M${x1} ${y1 + 6} C ${x1} ${(y1 + y2) / 2}, ${x2} ${(y1 + y2) / 2}, ${x2} ${y2 - 8}`
            : `M${x1 + 8} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2 - 10} ${y2}`;
          return <path key={`p-${to.key}`} d={d} fill="none" stroke={RED} strokeWidth={3} markerEnd="url(#flow-head)" />;
        })}
      </svg>
      {boxes.map((b) => <span key={`n-${b.key}`}>{pin(b.label, b.x - 4, b.y - 4)}</span>)}
    </div>
  );
}
