// #6570 · "Final 5 km" som TV-grafik (artifact v7): moerk scene, vejen med
// 5/4/3/2/1 km-skilte, flamme rouge og maallinje, grupperne som prikker to i
// bredden, callouts i faste baner, side-panelet "Gaps", sprint close-up fra
// 500 m, afspilning 6x/12x/30x og uret.
//
// Alt kommer fra loebshistorien: foererlinjen giver hvor foereren er ved
// race-tid t, og en gruppe med hul g er dér hvor foereren var g sekunder
// foer (kontraktens km_behind). Prod har op til 25 grupper i finalen: fronten
// + hoejst 3 navngives, din gruppe altid, resten samles i een linje.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { formatNumber } from "../../../lib/intl.js";
import { elevationAt, type ElevationSeries } from "./stagePageV2Model.ts";
import {
  finaleCaptions, finaleEndTime, finaleStateAt, formatClock, namesList, pickGroups,
  type Cast, type FinaleData, type FinaleGroup, type RaceStory, type StoryLine,
} from "./raceStoryModel.ts";
import { useMeasuredWidth } from "./StageProfileV2.tsx";
import { useStoryText } from "./storyText.ts";
import { Segmented } from "./ui.ts";

const SPEEDS = ["6", "12", "30"] as const;

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

export function PlayIcon({ playing }: { playing: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
      {playing ? <path d="M7 4h4v16H7zM14 4h4v16h-4z" /> : <path d="M7 4l13 8-13 8z" />}
    </svg>
  );
}

export interface FinaleViewProps {
  story: RaceStory;
  data: FinaleData;
  cast: Cast;
  lines: StoryLine[];
  series: ElevationSeries | null;
  stageLabel: string;
}

export default function FinaleView({ story, data, cast, lines, series, stageLabel }: FinaleViewProps) {
  const { t } = useTranslation("races");
  const text = useStoryText(cast);
  const [wrapRef, width] = useMeasuredWidth<HTMLDivElement>();
  const tEnd = useMemo(() => finaleEndTime(story, data, cast), [story, data, cast]);
  // Start ved flamme rouge (artifact v7); play fra slut starter forfra ved 5 km.
  const flammeT = useMemo(() => {
    for (let i = 1; i < data.line.length; i++) {
      const a = data.line[i - 1], b = data.line[i];
      const km = data.endKm - 1;
      if (b.km >= km) return b.km === a.km ? b.time : a.time + ((b.time - a.time) * (km - a.km)) / (b.km - a.km);
    }
    return data.t0;
  }, [data]);
  const [raceT, setRaceT] = useState(() => Math.max(data.t0, Math.min(tEnd, flammeT)));
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>("12");
  const last = useRef(0);

  useEffect(() => {
    if (!playing) return undefined;
    let raf = 0;
    last.current = performance.now();
    const tick = (now: number) => {
      const dt = (now - last.current) / 1000;
      last.current = now;
      let done = false;
      setRaceT((prev) => {
        const next = Math.min(tEnd, prev + dt * Number(speed));
        if (next >= tEnd) done = true;
        return next;
      });
      if (done) { setPlaying(false); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, tEnd]);

  function togglePlay() {
    if (playing) { setPlaying(false); return; }
    if (prefersReducedMotion()) { setRaceT(tEnd); return; }
    if (raceT >= tEnd - 0.01) setRaceT(data.t0);
    setPlaying(true);
  }

  const state = finaleStateAt(story, data, cast, raceT);
  const narrow = width > 0 && width < 560;
  const { shown, rest } = pickGroups(state.groups, narrow ? 2 : 3);
  const captions = useMemo(() => finaleCaptions(lines, data), [lines, data]);
  const caption = [...captions].reverse().find((l) => l.km <= state.leaderKm + 1e-6) ?? null;

  const labelFor = (g: FinaleGroup): string => {
    if (g.rest && g.riderIds.length < 3) return t("stagePageV2.story.group.peloton");
    const names = namesList(g.riderIds, cast, 2);
    if (names) return names;
    return t("stagePageV2.story.group.riders", { count: g.size ?? 0 });
  };
  const gapFor = (g: FinaleGroup): string => (g.front ? t("stagePageV2.story.group.leads") : `+${formatClock(g.gapS)}`);
  const toGoText = (km: number): string => (km <= 0.0005
    ? t("stagePageV2.story.final.finish")
    : km < 1
      ? t("stagePageV2.story.final.toGoM", { m: formatNumber(Math.round((km * 1000) / 10) * 10) })
      : t("stagePageV2.story.final.toGoKm", { km: formatNumber(Math.round(km * 10) / 10, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) }));

  // Fart paa stedet fra foererlinjen (motorens konstante tempo pr. interval).
  let speedKmh: number | null = null;
  for (let i = 1; i < data.line.length; i++) {
    const a = data.line[i - 1], b = data.line[i];
    if (b.km >= state.leaderKm - 1e-9 && b.time > a.time) { speedKmh = ((b.km - a.km) / (b.time - a.time)) * 3600; break; }
  }

  // ── Scenen ──
  const W = Math.max(1, width);
  const H = narrow ? 250 : 380;
  const FL = 20, FR = W - 20;
  const roadBottom = H - (narrow ? 50 : 62);
  const roadTop = H - (narrow ? 110 : 160);
  const X = (km: number) => FL + ((km - data.startKm) / (data.endKm - data.startKm)) * (FR - FL);
  const elev = (km: number) => (series ? elevationAt(series, Math.max(0, Math.min(data.endKm - 0.001, km))) : 0);
  const hs: number[] = [];
  for (let k = data.startKm; k <= data.endKm + 1e-9; k += 0.05) hs.push(elev(k));
  const hMin = Math.min(...hs), hMax = Math.max(...hs);
  const Y = (km: number) => (hMax - hMin < 1 ? roadBottom : roadBottom - ((elev(km) - hMin) / (hMax - hMin)) * (roadBottom - roadTop));
  const road: Array<[number, number]> = [];
  for (let k = data.startKm; k <= data.endKm + 1e-9; k += 0.05) road.push([X(k), Y(k)]);
  const pxPerKm = (FR - FL) / (data.endKm - data.startKm);
  const markers: Array<[number, string]> = [0, 1, 2, 3].map((i) => [data.startKm + i, `${5 - i} KM`]);
  markers.push([data.endKm - 0.5, "500 M"], [data.endKm - 0.2, "200 M"]);

  function dots(g: FinaleGroup) {
    const n = Math.max(1, Math.min(narrow ? 16 : 26, g.size ?? 1));
    const out: ReactNode[] = [];
    const myIndex = g.mine.length ? 0 : -1;
    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / 2), side = i % 2;
      const k = g.km - (row * 7) / pxPerKm;
      if (k < data.startKm - 0.001) break;
      const x = X(k) - (side ? 3 : 0), y = Y(k) - 7 - side * 9;
      const fill = g.front ? "rgb(var(--accent))" : "var(--text-sidebar-2)";
      out.push(<circle key={`${g.groupId}-${i}`} cx={x} cy={y} r={narrow ? 4 : 5} fill={i === myIndex ? "var(--text-sidebar-1)" : fill} stroke="var(--bg-sidebar)" strokeWidth={1.2} />);
      if (i === myIndex) out.push(<circle key={`${g.groupId}-me`} cx={x} cy={y} r={narrow ? 7.5 : 9} fill="none" stroke="var(--text-sidebar-1)" strokeWidth={2} />);
    }
    return out;
  }

  // Callouts i faste baner: fronten oeverst, saa i hul-orden, saa linjerne aldrig krydser.
  const laneGroups = narrow ? shown.filter((g) => g.front || g.mine.length).slice(0, 2) : shown;
  const callouts = laneGroups.map((g, lane) => {
    if (g.km < data.startKm) return null;
    const l1 = labelFor(g) + (g.mine.length ? ` · ${t("stagePageV2.story.you")}` : "");
    const l2 = g.front ? t("stagePageV2.story.group.leads") : `+${formatClock(g.gapS)}${g.size ? ` · ${t("stagePageV2.story.group.riders", { count: g.size })}` : ""}`;
    const fs = narrow ? 11 : 12;
    const w = Math.max(l1.length, l2.length) * (fs * 0.6) + 18;
    const h = 2 * (fs + 4) + 8;
    const x = X(g.km);
    const bx = Math.max(6, Math.min(W - w - 6, x - w / 2));
    const by = (narrow ? 58 : 86) + lane * (h + 6);
    return (
      <g key={`c-${g.groupId}`}>
        <line x1={x} x2={x} y1={by + h} y2={Y(g.km) - 14} stroke="var(--text-sidebar-3)" strokeWidth={1} />
        <rect x={bx} y={by} width={w} height={h} rx={3} fill="var(--bg-sidebar)" stroke={g.front ? "rgb(var(--accent))" : "var(--border-sidebar)"} />
        <text x={bx + 9} y={by + fs + 4} fontSize={fs} fontWeight={700} fill="var(--text-sidebar-1)" className="font-data">{l1}</text>
        <text x={bx + 9} y={by + 2 * (fs + 4) + 1} fontSize={fs} fill="var(--text-sidebar-2)" className="font-data tabular-nums">{l2}</text>
      </g>
    );
  });
  const behind = shown.filter((g) => g.km < data.startKm);

  // Sprint close-up: et vindue paa 300 m der foelger foereren fra 500 m.
  const closeOpen = state.toGoKm <= 0.5;
  const finishers = cast.finishers.slice(0, 3);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_230px]">
        <div ref={wrapRef} className="min-w-0 overflow-hidden rounded-cz bg-cz-sidebar">
          {width > 0 && (
            <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("stagePageV2.story.final.aria")} className="block">
              <path d={`M${FL},${H} ${road.map(([x, y]) => `L${x},${y}`).join(" ")} L${FR},${H} Z`} fill="var(--bg-sidebar-hover)" />
              <path d={`M${road.map(([x, y]) => `${x},${y}`).join(" L")}`} fill="none" stroke="var(--text-sidebar-3)" strokeWidth={3} strokeLinecap="round" />
              {markers.map(([k, label]) => (
                <g key={label}>
                  <line x1={X(k)} x2={X(k)} y1={Y(k)} y2={Y(k) - (narrow ? 50 : 80)} stroke="var(--border-sidebar)" strokeDasharray="2 4" />
                  <text x={X(k) + (k === data.startKm ? 2 : 0)} y={Y(k) + 20} textAnchor={k === data.startKm ? "start" : "middle"} fontSize={narrow ? 9 : 11} fontWeight={700} letterSpacing=".08em" fill="var(--text-sidebar-3)" className="font-data">{label}</text>
                </g>
              ))}
              {(() => {
                const k = data.endKm - 1, x = X(k), y = Y(k), hgt = narrow ? 60 : 92;
                return (
                  <g>
                    <line x1={x} x2={x} y1={y} y2={y - hgt} stroke="rgb(var(--danger))" strokeWidth={2} />
                    <path d={`M${x},${y - hgt} L${x + 24},${y - hgt + 9} L${x},${y - hgt + 18} Z`} fill="rgb(var(--danger))" />
                    <text x={x} y={y + 20} textAnchor="middle" fontSize={narrow ? 9 : 11} fontWeight={700} letterSpacing=".08em" fill="rgb(var(--danger))" className="font-data">1 KM</text>
                  </g>
                );
              })()}
              {(() => {
                const x = X(data.endKm), y = Y(data.endKm), rows = narrow ? 8 : 12;
                const cells = [];
                for (let r = 0; r < rows; r++) for (let c = 0; c < 2; c++) cells.push(<rect key={`${r}-${c}`} x={x - 6 + c * 6} y={y - rows * 6 - 20 + r * 6} width={6} height={6} fill={(r + c) % 2 ? "var(--bg-sidebar)" : "var(--text-sidebar-1)"} />);
                return <g>{cells}<line x1={x} x2={x} y1={y - 20} y2={y} stroke="var(--text-sidebar-1)" strokeWidth={2} /></g>;
              })()}
              {[...state.groups].sort((a, b) => b.gapS - a.gapS).filter((g) => g.km >= data.startKm).map((g) => <g key={g.groupId}>{dots(g)}</g>)}
              {callouts}
              {behind.map((g, i) => (
                <g key={`b-${g.groupId}`}>
                  <path d={`M${FL - 8},${(narrow ? 140 : 210) + i * 22} l9,-6 v12 z`} fill="var(--text-sidebar-1)" />
                  <text x={FL + 6} y={(narrow ? 144 : 214) + i * 22} fontSize={narrow ? 10 : 12} fill="var(--text-sidebar-1)" className="font-data tabular-nums">
                    {t("stagePageV2.story.final.back", { label: labelFor(g), dist: formatNumber(Math.round((data.startKm - g.km) * 10) / 10, { maximumFractionDigits: 1 }) })}
                  </text>
                </g>
              ))}
              <text x={18} y={narrow ? 36 : 52} fontSize={narrow ? 30 : 44} fill="var(--text-sidebar-1)" className="font-display" letterSpacing=".02em">{toGoText(state.toGoKm)}</text>
              <text x={20} y={narrow ? 50 : 72} fontSize={narrow ? 9 : 11} fontWeight={700} letterSpacing=".16em" fill="var(--text-sidebar-3)" className="font-data">{stageLabel.toUpperCase()}</text>
              <text x={W - 18} y={narrow ? 28 : 40} textAnchor="end" fontSize={narrow ? 17 : 24} fontWeight={600} fill="var(--text-sidebar-1)" className="font-data tabular-nums">{formatClock(Math.min(raceT, tEnd))}</text>
              <text x={W - 18} y={narrow ? 44 : 62} textAnchor="end" fontSize={narrow ? 10 : 12} fill="var(--text-sidebar-2)" className="font-data tabular-nums">
                {state.leaderFinished ? t("stagePageV2.story.final.winningTime") : speedKmh ? t("stagePageV2.story.final.speed", { kmh: formatNumber(Math.round(speedKmh)) }) : ""}
              </text>
              {caption && (
                <g>
                  <rect x={0} y={H - 24} width={W} height={24} fill="var(--bg-sidebar)" opacity={0.85} />
                  <text x={16} y={H - 8} fontSize={narrow ? 11 : 13} fill="var(--text-sidebar-1)" className="font-data">{`${text.kmLabel(caption)} · ${text.lineText(caption)}`}</text>
                </g>
              )}
            </svg>
          )}
        </div>
        <aside className="flex min-w-0 flex-col" aria-label={t("stagePageV2.story.final.gaps")}>
          <div className="mb-1 font-data text-3xs font-semibold uppercase tracking-[.16em] text-cz-3">{t("stagePageV2.story.final.gaps")}</div>
          <ul>
            {shown.map((g) => (
              <li key={g.groupId} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-0.5 border-t border-cz-border py-2">
                <span className={`block h-2.5 w-2.5 rounded-full ${g.front ? "bg-cz-accent" : "bg-cz-1"} ${g.mine.length ? "ring-2 ring-cz-1 ring-offset-2 ring-offset-cz-card" : ""}`} aria-hidden="true" />
                <span className="truncate text-sm font-semibold text-cz-1">{labelFor(g)}</span>
                <span className="font-data text-sm font-semibold tabular-nums text-cz-1">{gapFor(g)}</span>
                <span className="col-start-2 col-end-4 truncate text-xs text-cz-2">
                  {g.mine.length ? `${t("stagePageV2.story.you")}: ${namesList(g.mine, cast, 2)} · ` : ""}
                  {g.finished ? t("stagePageV2.story.final.finished") : g.km < data.startKm ? t("stagePageV2.story.final.behindMark") : toGoText(g.toGoKm).toLowerCase()}
                </span>
              </li>
            ))}
            {rest && (
              <li className="border-t border-cz-border py-2 text-xs text-cz-2 tabular-nums">
                {t("stagePageV2.story.group.rest", { groups: rest.groups, riders: rest.riders, min: formatClock(rest.minGap), max: formatClock(rest.maxGap) })}
              </li>
            )}
          </ul>
          <p className="m-0 border-t border-cz-border pt-2 text-2xs text-cz-3">{t("stagePageV2.story.final.gapsFoot")}</p>
        </aside>
      </div>

      <div className="rounded-cz border border-cz-border px-3.5 py-2.5">
        <div className="mb-1.5 flex flex-wrap items-center gap-2">
          <span className="flex-1 font-data text-3xs font-semibold uppercase tracking-[.16em] text-cz-3">{t("stagePageV2.story.final.closeUp")}</span>
          <span className="font-data text-xs tabular-nums text-cz-2">
            {!closeOpen ? t("stagePageV2.story.final.closeUpOpens") : state.leaderFinished ? t("stagePageV2.story.final.closeUpDone") : t("stagePageV2.story.final.toGoM", { m: formatNumber(Math.round(state.toGoKm * 1000)) }).toLowerCase()}
          </span>
        </div>
        {closeOpen && !state.leaderFinished && <CloseUp state={state} labelFor={labelFor} endKm={data.endKm} />}
        {closeOpen && state.leaderFinished && finishers.length > 0 && (
          <ol className="m-0 flex list-none flex-wrap gap-x-5 gap-y-1 p-0 font-data text-sm tabular-nums">
            {finishers.map((f, i) => (
              <li key={f.riderId} className={cast.mine.has(f.riderId) ? "font-semibold text-cz-1" : "text-cz-1"}>
                {`${f.rank}. ${cast.nameOf(f.riderId) ?? ""}`}
                {i > 0 && f.gap ? <span className="ml-1.5 text-cz-2">{f.gap.startsWith("+") ? f.gap : ""}</span> : null}
              </li>
            ))}
          </ol>
        )}
        {!closeOpen && <p className="m-0 text-xs text-cz-3">{t("stagePageV2.story.final.closeUpHint")}</p>}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={togglePlay}
          aria-label={playing ? t("stagePageV2.story.replay.pause") : t("stagePageV2.story.final.play")}
          className="inline-flex h-11 w-11 flex-none items-center justify-center rounded-cz border border-cz-border text-cz-1 hover:bg-cz-subtle"
        >
          <PlayIcon playing={playing} />
        </button>
        <input
          type="range"
          min={data.t0}
          max={tEnd}
          step={0.5}
          value={raceT}
          onChange={(e) => { setPlaying(false); setRaceT(Number(e.target.value)); }}
          aria-label={t("stagePageV2.story.final.scrubAria")}
          aria-valuetext={toGoText(state.toGoKm)}
          className="h-11 min-w-32 flex-1 accent-cz-1"
        />
        <Segmented
          label={t("stagePageV2.story.final.speedAria")}
          value={speed}
          onChange={(v) => setSpeed(v as (typeof SPEEDS)[number])}
          options={SPEEDS.map((s) => ({ value: s, label: `${s}×` }))}
          className="[&>button]:min-h-11 [&>button]:min-w-11"
        />
      </div>
    </div>
  );
}

function CloseUp({ state, labelFor, endKm }: { state: ReturnType<typeof finaleStateAt>; labelFor: (g: FinaleGroup) => string; endKm: number }) {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>();
  const W = Math.max(1, width), H = 64, L = 12, R = W - 12;
  // Vindue i meter til stregen: fra foereren +50 m til 250 m bag.
  const lead = Math.max(0, (endKm - state.leaderKm) * 1000);
  const m0 = Math.max(0, lead - 50), m1 = lead + 250;
  const X = (toGoM: number) => L + ((m1 - toGoM) / (m1 - m0)) * (R - L);
  const ticks: number[] = [];
  for (let m = Math.ceil(m0 / 50) * 50; m <= m1; m += 50) ticks.push(m);
  const inView = state.groups.filter((g) => {
    const m = (endKm - g.km) * 1000;
    return m >= m0 && m <= m1;
  }).slice(0, 4);
  return (
    <div ref={ref}>
      {width > 0 && (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={inView.map((g) => labelFor(g)).join(", ")} className="block">
          <line x1={L} x2={R} y1={44} y2={44} stroke="var(--border)" strokeWidth={2} />
          {ticks.map((m) => (
            <g key={m}>
              <line x1={X(m)} x2={X(m)} y1={39} y2={49} stroke="var(--text-3)" />
              <text x={X(m)} y={62} textAnchor="middle" fontSize={10} fill="var(--text-3)" className="font-data tabular-nums">{m === 0 ? "0" : `${m} m`}</text>
            </g>
          ))}
          {m0 <= 0 && (
            <g>{Array.from({ length: 6 }, (_, r) => <rect key={r} x={X(0) - 3 + (r % 2) * 3} y={14 + r * 5} width={3} height={5} fill="var(--text-1)" />)}</g>
          )}
          {inView.map((g, i) => {
            const x = X((endKm - g.km) * 1000);
            return (
              <g key={g.groupId}>
                <circle cx={x} cy={36} r={6} fill={g.front ? "rgb(var(--accent))" : "var(--text-2)"} />
                {g.mine.length > 0 && <circle cx={x} cy={36} r={10} fill="none" stroke="var(--text-1)" strokeWidth={2} />}
                <text x={x} y={i % 2 ? 22 : 12} textAnchor={x > W * 0.7 ? "end" : "start"} fontSize={11} fontWeight={700} fill="var(--text-1)" className="font-data">{labelFor(g)}</text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

