// Skitse #7535: ruteprofilen og den lille profil fra wireframe v6c. Den store profil tegnes 1:1 i den
// bredde den faar (mindst 480 enheder), saa hoejden staar fast og teksten ikke skrumper paa telefonen.

import { useLayoutEffect, useRef, useState } from "react";
import type { StageProfile } from "./data.ts";
import { FINALE, TYPE_LABEL, WX } from "./model.ts";

const bandColor = (g: number) => (g < 3 ? "var(--g0)" : g < 6 ? "var(--g1)" : g < 8 ? "var(--g2)" : g < 10 ? "var(--g3)" : "var(--g4)");
const fmt = (v: number) => v.toLocaleString("en-GB");

export function Sprite() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <defs>
        <symbol id="i-flat" viewBox="0 0 24 24" fill="none" stroke="var(--terrain-flat)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M7 12h10" /></symbol>
        <symbol id="i-rolling" viewBox="0 0 24 24" fill="none" stroke="var(--terrain-rolling)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M6 13.5h3.5l2.5-2.5 2.5 2.5H18" /></symbol>
        <symbol id="i-hilly" viewBox="0 0 24 24" fill="none" stroke="var(--terrain-hilly)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M5.5 14.5l2.6-3.6 2.2 2.4 2.8-4.3 2.4 3.3 3-1.3" /></symbol>
        <symbol id="i-mountain" viewBox="0 0 24 24" fill="none" stroke="var(--terrain-mountain)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M5 16.5l3.5-8 3 5.5 3-8 4.5 10.5" /></symbol>
        <symbol id="i-high_mountain" viewBox="0 0 24 24" fill="none" stroke="var(--terrain-high-mountain)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M5 17l4-6 2 3 4-9 4.5 12" /><path d="M13.6 8.3l1.4 1.1 1.5-1" /></symbol>
        <symbol id="i-itt" viewBox="0 0 24 24" fill="none" stroke="var(--terrain-time-trial)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="13.5" cy="12" r="4.5" /><path d="M13.5 10v2l1.5 1" /><path d="M5.5 10.5h3M6.5 13.5h2" /></symbol>
        <symbol id="s-left" viewBox="0 0 16 16"><path d="M10 3L5 8l5 5" /></symbol>
        <symbol id="s-right" viewBox="0 0 16 16"><path d="M6 3l5 5-5 5" /></symbol>
        <symbol id="s-up" viewBox="0 0 10 10"><path d="M2 6.5L5 3.5l3 3" /></symbol>
        <symbol id="s-dn" viewBox="0 0 10 10"><path d="M2 3.5L5 6.5l3-3" /></symbol>
        <symbol id="w-sun" viewBox="0 0 16 16"><circle cx="8" cy="8" r="3" /><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6L13 13M3 13l1.4-1.4M11.6 4.4L13 3" /></symbol>
        <symbol id="w-rain" viewBox="0 0 16 16"><path d="M4 9h8a3 3 0 0 0 0-6 4 4 0 0 0-7.5 1A2.5 2.5 0 0 0 4 9z" /><path d="M5 12l-1 2M8 12l-1 2M11 12l-1 2" /></symbol>
        <symbol id="w-cloud" viewBox="0 0 16 16"><path d="M4 12h8a3 3 0 0 0 0-6 4 4 0 0 0-7.5 1A2.5 2.5 0 0 0 4 12z" /></symbol>
        <symbol id="w-wind" viewBox="0 0 16 16"><path d="M1 6h9a2 2 0 1 0-2-2M1 10h12a2 2 0 1 1-2 2" /></symbol>
        <symbol id="s-down" viewBox="0 0 9 9"><path d="M1 3l3.5 3.5L8 3" /></symbol>
      </defs>
    </svg>
  );
}

export function MiniProfile({ q }: { q: StageProfile }) {
  const h = q.h;
  const step = Math.max(1, Math.floor(h.length / 60));
  const pts = h.filter((_, i) => i % step === 0);
  const mx = Math.max(...pts);
  const mn = Math.min(...pts);
  const rng = Math.max(mx - mn, 300);
  const line = pts.map((e, i) => `${((i / (pts.length - 1)) * 100).toFixed(1)},${(26 - ((e - mn) / rng) * 22).toFixed(1)}`).join(" ");
  const D = q.km || 1;
  return (
    <span className="mini-w">
      <svg className="mini" viewBox="0 0 100 26" preserveAspectRatio="none" aria-hidden="true">
        <polygon points={`0,26 ${line} 100,26`} fill="var(--g0)" />
      </svg>
      {q.climbs.filter((c) => c.cat).map((c) => {
        const i = Math.min(h.length - 1, Math.round((c.crest / D) * (h.length - 1)));
        return <i key={c.name + c.crest} title={`${c.name} (${c.cat})`} style={{ left: `${((c.crest / D) * 100).toFixed(1)}%`, top: `${(((26 - ((h[i] - mn) / rng) * 22) / 26) * 24).toFixed(1)}px` }} />;
      })}
    </span>
  );
}

function ProfileSvg({ p, W, baseH, attackKm }: { p: StageProfile; W: number; baseH: number; attackKm: number | null }) {
  const h = p.h;
  const D = p.km;
  const nC = p.climbs.length;
  const rowsL = nC > 2 && W < 900 ? 3 : 2;
  const LS = rowsL === 3 ? 30 : 16;
  const extra = rowsL === 3 ? 44 : 0;
  const H = baseH + extra;
  const top = 46 + extra;
  const bot = 30;
  const left = 62;
  const yMax = Math.ceil((Math.max(...h) + 150) / 500) * 500;
  const yMin = Math.max(0, Math.floor((Math.min(...h) - 150) / 500) * 500);
  const X = (km: number) => left + (km / D) * (W - left - 8);
  const Y = (e: number) => top + (1 - (e - yMin) / (yMax - yMin)) * (H - top - bot);
  const step = p.step || D / (h.length - 1);
  const climbs = p.segs.filter((s) => s[0] === "c");
  const desc = p.segs.filter((s) => s[0] === "d");
  const slices: string[] = [];
  const cols: string[] = [];
  for (let i = 0; i < h.length - 1; i++) {
    const km = i * step;
    const g = ((h[i + 1] - h[i]) / (step * 1000)) * 100;
    const inDesc = desc.some((s) => km >= s[1] && km < s[2]);
    cols.push(inDesc || g < 0 ? "var(--gd)" : bandColor(g));
    slices.push(`M${X(km).toFixed(1)} ${H - bot} L${X(km).toFixed(1)} ${Y(h[i]).toFixed(1)} L${X(km + step).toFixed(1)} ${Y(h[i + 1]).toFixed(1)} L${X(km + step).toFixed(1)} ${H - bot}Z`);
  }
  const line = h.map((e, i) => `${i ? "L" : "M"}${X(i * step).toFixed(1)} ${Y(e).toFixed(1)}`).join(" ");
  const grid: number[] = [];
  for (let e = yMin; e <= yMax; e += 500) grid.push(e);
  const OFF = (i: number) => (rowsL === 3 ? ((i % 3) - 2) * LS : (i % 2) * 16);
  const ticks = [0, ...p.climbs.map((c) => c.crest).filter((k) => k < D - 8), D];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Stage ${p.n} profile, ${D} km`}>
      {grid.map((e) => (
        <g key={e}>
          <line x1={left} x2={W - 8} y1={Y(e)} y2={Y(e)} stroke="var(--line)" />
          <text x={left - 6} y={Y(e) + 4} textAnchor="end" fontSize="11" fill="var(--t3)">{`${fmt(e)} m`}</text>
        </g>
      ))}
      <rect x={X(D - 10)} y={top - 4} width={X(D) - X(D - 10)} height={H - bot - top + 4} fill="var(--sub)" opacity=".7" />
      {slices.map((d, i) => <path key={i} d={d} fill={cols[i]} />)}
      <path d={line} fill="none" stroke="var(--t1)" strokeWidth="1.6" />
      {p.sprints.map((km) => {
        const x = X(km);
        return (
          <g key={km}>
            <line x1={x} x2={x} y1={top + 30} y2={H - bot} stroke="var(--good)" strokeDasharray="3 3" />
            <rect x={x - 9} y={top + 22} width="18" height="16" rx="3" fill="var(--good)" />
            <text x={x} y={top + 34} textAnchor="middle" fontSize="10" fontWeight="700" fill="#fff">S</text>
          </g>
        );
      })}
      {p.climbs.map((c, i) => {
        const seg = climbs.find((s) => Math.abs(s[2] - c.crest) < 1.5);
        const from = seg ? seg[1] : c.crest - c.len;
        const x = X(c.crest);
        const idx = Math.min(h.length - 1, Math.round(c.crest / step));
        const y = Y(h[idx]);
        const anchor = x > W - 220 ? "end" : "start";
        const tx = anchor === "end" ? x - 22 : x + 22;
        const bx = Math.min(x, W - 12);
        return (
          <g key={c.name + c.crest}>
            <line x1={x} x2={x} y1={y} y2={top - 6 + OFF(i)} stroke="var(--t2)" />
            <rect x={bx - 11} y={top - 24 + OFF(i)} width="22" height="18" rx="3" fill="var(--kom)" />
            <text x={bx} y={top - 11 + OFF(i)} textAnchor="middle" fontSize="11" fontWeight="700" fill="#fff">{c.cat}</text>
            <text x={tx} y={top - 14 + OFF(i)} textAnchor={anchor} fontSize="12.5" fontWeight="700" fill="var(--t1)">{c.name}</text>
            <text x={tx} y={top + 1 + OFF(i)} textAnchor={anchor} fontSize="11" fill="var(--t2)">{`${c.len} km · ${c.grad} % · ${fmt(Math.round(h[idx]))} m`}</text>
            <rect x={X(from)} y={H - bot + 4} width={X(c.crest) - X(from)} height="6" fill="var(--kom)" />
          </g>
        );
      })}
      {attackKm != null && <line x1={X(attackKm)} x2={X(attackKm)} y1={top} y2={H - bot} stroke="var(--bad)" strokeWidth="3" />}
      {ticks.map((k) => (
        <text key={k} x={X(k)} y={H - 6} textAnchor={k === 0 ? "start" : k === D ? "end" : "middle"} fontSize="11" fill="var(--t3)">
          {k === 0 || k === D ? `${k} km` : k}
        </text>
      ))}
    </svg>
  );
}

/** "Stage N · the route": fakta-linje, profilen i farvebaand og forklaringen. */
export function RouteCard({ p, attackKm }: { p: StageProfile; attackKm: number | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(1000);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => setW(Math.max(480, Math.round(el.clientWidth) || 1000));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const wx = WX[p.weather] ?? WX.sun;
  return (
    <section className="card">
      <h2>
        {`Stage ${p.n} · the route`}
        <small>{`${fmt(p.gain)} m · ${p.climbs.length} climbs · ${p.sprints.length} intermediate sprints`}</small>
      </h2>
      <div className="tiles">
        <div className="tile"><div className="k">Terrain</div><div className="v"><svg className="ic"><use href={`#i-${p.type}`} /></svg>{TYPE_LABEL[p.type]}</div></div>
        <div className="tile"><div className="k">Finish</div><div className="v">{FINALE[p.finale] ?? p.finale}</div></div>
        <div className="tile"><div className="k">Weather</div><div className="v"><svg className="wx"><use href={`#${wx[0]}`} /></svg>{wx[1]}</div></div>
      </div>
      <div className="prof" ref={ref}>
        <ProfileSvg p={p} W={w} baseH={200} attackKm={attackKm} />
      </div>
      <div className="legend">
        <span><i style={{ background: "var(--g0)" }} />under 3 %</span>
        <span><i style={{ background: "var(--g1)" }} />3-6 %</span>
        <span><i style={{ background: "var(--g2)" }} />6-8 %</span>
        <span><i style={{ background: "var(--g3)" }} />8-10 %</span>
        <span><i style={{ background: "var(--g4)" }} />over 10 %</span>
        <span><i style={{ background: "var(--gd)" }} />descent</span>
        <span><i style={{ background: "var(--good)" }} />intermediate sprint</span>
        <span><i style={{ background: "var(--sub)" }} />last 10 km</span>
        {attackKm != null && <span><i style={{ background: "var(--bad)" }} />attack point</span>}
      </div>
    </section>
  );
}
