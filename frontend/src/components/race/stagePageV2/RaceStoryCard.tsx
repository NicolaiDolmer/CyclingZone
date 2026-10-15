// #6570 · Profilkortet efter etapen (artifact v7): tre visninger
//   The route   - profilen som foer etapen
//   Whole stage - replay paa profilen: scrubber + play, grupperne som prikker
//                 (foerergruppen guld, dine ryttere markeret), resten daempet
//   Final 5 km  - TV-grafikken (kun med praecise tider)
// og under dem historien: "How it unfolded" (kurateret til ca. 8 linjer),
// "Split times" og "Report". Kilde: kun loebslog-kontrakten (#6632).
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { formatNumber } from "../../../lib/intl.js";
import type { Climb, ElevationSeries, StageProfile } from "./stagePageV2Model.ts";
import {
  buildReport, curateMoments, finaleData, formatClock, lineReplayKm, myBestRider, namesList, pickGroups,
  replayGroupsAt, splitRows, wholeStageFrames, frameAt,
  isPeloton, type Cast, type RaceStory, type ReplayGroup, type SplitRow, type StoryLine,
} from "./raceStoryModel.ts";
import StageProfileV2, { GradientLegend } from "./StageProfileV2.tsx";
import FinaleView, { PlayIcon, prefersReducedMotion } from "./FinaleView.tsx";
import { useStoryText } from "./storyText.ts";
import { Button, Section, Segmented } from "./ui.ts";

type View = "route" | "stage" | "final";

export interface RaceStoryCardProps {
  story: RaceStory;
  profile: StageProfile | null;
  series: ElevationSeries | null;
  climbs: Climb[];
  cast: Cast;
  title: string;
  /** Endagsloeb: fanen hedder "Whole race" i stedet for "Whole stage". */
  oneDay?: boolean;
  /** Kort etikette til TV-grafikken, fx "Stage 3". */
  hudLabel: string;
  /** "The route": profilen som foer etapen (StageTabV2 tegner den). */
  routeBody: ReactNode;
  onOpenStandings: () => void;
}

export default function RaceStoryCard({ story, profile, series, climbs, cast, title, oneDay = false, hudLabel, routeBody, onOpenStandings }: RaceStoryCardProps) {
  const { t } = useTranslation("races");
  const D = story.distance_km ?? (Number(profile?.distance_km) || 0);
  const finale = useMemo(() => finaleData(story), [story]);
  const lines = useMemo(() => curateMoments(story, cast), [story, cast]);
  const [view, setView] = useState<View>(story.time_trial ? "route" : "stage");
  const [km, setKm] = useState<number>(D);

  if (story.time_trial) {
    return (
      <Section aria-label={title}>
        <h2 className="m-0 mb-3 font-data text-[15px] font-semibold text-cz-1">{title}</h2>
        {routeBody}
        <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-cz-border pt-3">
          <p className="m-0 flex-1 text-sm text-cz-2">{t("stagePageV2.story.timeTrial")}</p>
          <Button variant="secondary" size="md" onClick={onOpenStandings}>{t("stagePageV2.cta.fullResult")}</Button>
        </div>
      </Section>
    );
  }

  const options = [
    { value: "route", label: t("stagePageV2.story.view.route") },
    { value: "stage", label: t(oneDay ? "stagePageV2.story.view.race" : "stagePageV2.story.view.stage") },
    ...(finale ? [{ value: "final", label: t("stagePageV2.story.view.final") }] : []),
  ];

  function jumpTo(line: StoryLine) {
    setKm(lineReplayKm(line, D || null));
    setView("stage");
  }

  return (
    <Section aria-label={title}>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="m-0 min-w-[180px] flex-1 font-data text-[15px] font-semibold text-cz-1">{title}</h2>
        <Segmented
          label={t("stagePageV2.story.viewsAria")}
          value={view}
          onChange={(v) => setView(v as View)}
          options={options}
          className="[&>button]:min-h-11"
        />
      </div>
      {/* Forklaringen gaelder kun en log uden praecise tider (CodeRabbit). */}
      {!finale && !story.precise_times && <p className="m-0 mb-3 text-xs text-cz-3">{t("stagePageV2.story.noFinal")}</p>}

      {view === "route" && routeBody}
      {view === "stage" && (
        <ReplayView story={story} profile={profile} series={series} climbs={climbs} cast={cast} km={km} onKm={setKm} />
      )}
      {view === "final" && finale && (
        <FinaleView story={story} data={finale} cast={cast} lines={lines} series={series} stageLabel={hudLabel} />
      )}

      {view !== "route" && (
        <StorySection story={story} lines={lines} cast={cast} km={view === "stage" ? km : null} onJump={jumpTo} />
      )}
    </Section>
  );
}

// ── Whole stage ──────────────────────────────────────────────────────────

function ReplayView({ story, profile, series, climbs, cast, km, onKm }: {
  story: RaceStory; profile: StageProfile | null; series: ElevationSeries | null; climbs: Climb[]; cast: Cast; km: number; onKm: (km: number) => void;
}) {
  const { t } = useTranslation("races");
  const D = story.distance_km ?? 0;
  const frames = useMemo(() => wholeStageFrames(story), [story]);
  const [playing, setPlaying] = useState(false);
  const groups = useMemo(() => replayGroupsAt(story, frames, km, cast), [story, frames, km, cast]);
  const frame = frameAt(frames, km);

  useEffect(() => {
    if (!playing) return undefined;
    // Hele etapen paa ca. 15 s.
    const step = Math.max(0.5, Math.round(D / 150));
    const id = setInterval(() => {
      const next = Math.min(D, km + step);
      onKm(next);
      if (next >= D) setPlaying(false);
    }, 100);
    return () => clearInterval(id);
  }, [playing, km, D, onKm]);

  function togglePlay() {
    if (playing) { setPlaying(false); return; }
    if (prefersReducedMotion()) { onKm(D); return; }
    if (km >= D) onKm(0);
    setPlaying(true);
  }

  const labelFor = (g: ReplayGroup): string => {
    if (isPeloton(g.rest, g.size)) return t("stagePageV2.story.group.peloton");
    return namesList(g.riderIds, cast, 2, g.size) || t("stagePageV2.story.group.riders", { count: g.size ?? 0 });
  };
  const { shown, rest } = pickGroups(groups, 2);
  const kmText = formatNumber(Math.round(km * 10) / 10, { maximumFractionDigits: 1 });

  return (
    <div className="flex flex-col gap-3">
      {profile && series && (
        <div>
          <StageProfileV2
            profile={profile}
            series={series}
            climbs={climbs}
            selectedClimb={null}
            onSelectClimb={() => {}}
            band
            progressKm={km}
            overlay={story.precise_times ? (geo) => (
              <g aria-hidden="true">
                {[...groups].sort((a, b) => b.gapS - a.gapS).map((g) => {
                  if (g.km == null) return null;
                  // Ringen (r 10 + streg) maa ikke klippes ved maal eller start.
                  const x = Math.max(12, Math.min(geo.W - 12, geo.X(g.km))), y = geo.Y(geo.elevation(g.km)) - 6;
                  return (
                    <g key={g.groupId}>
                      <circle cx={x} cy={y} r={g.front ? 6 : 4.5} fill={g.front ? "rgb(var(--accent))" : "var(--text-1)"} stroke="var(--bg-card)" strokeWidth={1.5} />
                      {g.mine.length > 0 && <circle cx={x} cy={y} r={10} fill="none" stroke="var(--text-1)" strokeWidth={2} />}
                    </g>
                  );
                })}
              </g>
            ) : undefined}
          />
          <div className="mt-2"><GradientLegend /></div>
        </div>
      )}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={togglePlay}
          aria-label={playing ? t("stagePageV2.story.replay.pause") : t("stagePageV2.story.replay.play")}
          className="inline-flex h-11 w-11 flex-none items-center justify-center rounded-cz border border-cz-border text-cz-1 hover:bg-cz-subtle"
        >
          <PlayIcon playing={playing} />
        </button>
        <input
          type="range"
          min={0}
          max={D}
          step={0.5}
          value={km}
          onChange={(e) => { setPlaying(false); onKm(Number(e.target.value)); }}
          aria-label={t("stagePageV2.story.replay.scrubAria")}
          aria-valuetext={t("stagePageV2.story.kmAt", { km: kmText })}
          className="h-11 min-w-0 flex-1 accent-cz-1"
        />
        <span className="w-[104px] flex-none text-right font-data text-xs tabular-nums text-cz-2">
          {story.precise_times && frame?.leader_time_s != null
            ? t("stagePageV2.story.replay.positionTime", { km: kmText, time: formatClock(frame.leader_time_s) })
            : t("stagePageV2.story.kmAt", { km: kmText })}
        </span>
      </div>
      {story.precise_times && shown.length > 0 && (
        <ul className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
          {shown.map((g) => (
            <li key={g.groupId} className="flex min-h-11 items-center gap-2.5 border-t border-cz-border py-1.5">
              <span className={`block h-2.5 w-2.5 flex-none rounded-full ${g.front ? "bg-cz-accent" : "bg-cz-1"} ${g.mine.length ? "ring-2 ring-cz-1 ring-offset-2 ring-offset-cz-card" : ""}`} aria-hidden="true" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-semibold text-cz-1">{labelFor(g)}</span>
                <span className="truncate text-2xs text-cz-2">
                  {g.mine.length ? `${t("stagePageV2.story.you")}: ${namesList(g.mine, cast, 2)}` : g.size ? t("stagePageV2.story.group.riders", { count: g.size }) : ""}
                </span>
              </span>
              <span className="flex-none font-data text-sm font-semibold tabular-nums text-cz-1">
                {g.front ? t("stagePageV2.story.group.leads") : `+${formatClock(g.gapS)}`}
              </span>
            </li>
          ))}
          {rest && (
            <li className="flex min-h-11 items-center border-t border-cz-border py-1.5 text-xs tabular-nums text-cz-2 sm:col-span-2">
              {t("stagePageV2.story.group.rest", { groups: rest.groups, riders: rest.riders, min: formatClock(rest.minGap), max: formatClock(rest.maxGap) })}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

// ── Historien: oejeblikke, mellemtider, referat ───────────────────────────

function StorySection({ story, lines, cast, km, onJump }: { story: RaceStory; lines: StoryLine[]; cast: Cast; km: number | null; onJump: (l: StoryLine) => void }) {
  const { t } = useTranslation("races");
  const text = useStoryText(cast);
  const me = useMemo(() => myBestRider(story, cast), [story, cast]);
  const rows = useMemo(() => splitRows(story, me), [story, me]);
  const report = useMemo(() => buildReport(story, lines, cast), [story, lines, cast]);
  const current = km == null ? null : [...lines].reverse().find((l) => l.km <= km + 1e-6) ?? null;

  return (
    <div className="mt-4 grid grid-cols-1 gap-6 border-t border-cz-border pt-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <div className="min-w-0">
        <h3 className="m-0 mb-1 font-data text-3xs font-semibold uppercase tracking-[.16em] text-cz-3">{t("stagePageV2.story.unfolded")}</h3>
        <ol className="m-0 list-none p-0">
          {lines.map((l) => {
            const later = km != null && l.km > km + 1e-6;
            const note = text.mineNote(l);
            return (
              <li key={l.id}>
                <button
                  type="button"
                  onClick={() => onJump(l)}
                  aria-current={current?.id === l.id ? "step" : undefined}
                  className={`grid min-h-11 w-full grid-cols-[84px_minmax(0,1fr)] gap-2.5 border-t border-cz-border px-1 py-2 text-left hover:bg-cz-subtle ${current?.id === l.id ? "bg-cz-subtle" : ""} ${later ? "opacity-45" : ""}`}
                >
                  <span className="flex flex-col font-data text-xs font-semibold tabular-nums text-cz-2">
                    <span>{text.kmLabel(l)}</span>
                    {l.time != null && <span className="font-normal text-cz-3">{formatClock(l.time)}</span>}
                  </span>
                  <span className="text-sm text-cz-1">
                    {text.lineText(l)}
                    {note !== null && (
                      <span className="ml-1.5 inline-flex items-center gap-1.5 align-middle">
                        <span className="rounded-sm bg-cz-1 px-1.5 py-0.5 font-data text-3xs font-bold uppercase tracking-[.08em] text-cz-body">{t("stagePageV2.story.you")}</span>
                        {note && <span className="text-xs font-semibold text-cz-1">{note}</span>}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        <div className="min-w-0">
          <h3 className="m-0 mb-1 font-data text-3xs font-semibold uppercase tracking-[.16em] text-cz-3">{t("stagePageV2.story.splits.title")}</h3>
          <SplitTable rows={rows} cast={cast} me={me} precise={story.precise_times} />
        </div>
        {report.length > 0 && (
          <div>
            <h3 className="m-0 mb-1 font-data text-3xs font-semibold uppercase tracking-[.16em] text-cz-3">{t("stagePageV2.story.report.title")}</h3>
            <p className="m-0 max-w-[72ch] text-[15px] leading-relaxed text-cz-1">
              {report.map((s) => t(`stagePageV2.story.report.${s.key}`, s.params)).join(" ")}
            </p>
          </div>
        )}
        <p className="m-0 font-data text-2xs text-cz-3">{t("stagePageV2.story.source")}</p>
      </div>
    </div>
  );
}

function SplitTable({ rows, cast, me, precise }: { rows: SplitRow[]; cast: Cast; me: string | null; precise: boolean }) {
  const { t } = useTranslation("races");
  const meName = me ? cast.nameOf(me) : null;
  const pointName = (r: SplitRow) => r.kind === "finish"
    ? t("stagePageV2.story.splits.finish")
    : r.kind === "sprint"
      ? r.name ?? t("stagePageV2.story.splits.sprint")
      : t("stagePageV2.story.splits.top", { name: r.name ?? t("stagePageV2.story.splits.climb") });
  const leading = (r: SplitRow) => {
    if (isPeloton(r.leaderIsRest, r.leaderSize)) return t("stagePageV2.story.group.peloton");
    return namesList(r.leaderIds, cast, 2, r.leaderSize) || (r.leaderSize ? t("stagePageV2.story.group.riders", { count: r.leaderSize }) : "-");
  };
  const myGap = (r: SplitRow) => {
    if (!r.myGap) return "-";
    return r.myGap.in_front ? "0:00" : `+${formatClock(r.myGap.gap_s)}`;
  };
  if (!rows.length) return <p className="m-0 border-t border-cz-border py-2 text-sm text-cz-3">{t("stagePageV2.story.splits.none")}</p>;
  const kmCell = (r: SplitRow) => (
    <td className="border-t border-cz-border py-2 pr-2 align-top">
      <span className="block font-semibold text-cz-1 [overflow-wrap:anywhere]">{pointName(r)}</span>
      <span className="block text-2xs text-cz-3">{t("stagePageV2.story.kmAt", { km: formatNumber(Math.round(r.km * 10) / 10, { maximumFractionDigits: 1 }) })}</span>
    </td>
  );
  // Uden praecise tider: kun stedet og hvem der var foerst over (passagens
  // point; for maal etapens vinder i resultatet).
  const firstName = (r: SplitRow) => {
    const id = r.firstId ?? (r.kind === "finish" ? cast.finishers[0]?.riderId ?? null : null);
    return (id && cast.nameOf(id)) || "-";
  };
  if (!precise) {
    return (
      <table className="w-full table-fixed border-collapse font-data text-xs tabular-nums sm:text-[13px]">
        <thead>
          <tr className="text-left font-data text-3xs font-semibold uppercase tracking-[.12em] text-cz-3">
            <th scope="col" className="w-[55%] border-b border-cz-border py-1.5 pr-2 font-semibold">{t("stagePageV2.story.splits.point")}</th>
            <th scope="col" className="border-b border-cz-border py-1.5 font-semibold">{t("stagePageV2.story.splits.first")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              {kmCell(r)}
              <td className="border-t border-cz-border py-2 align-top text-cz-1"><span className="block truncate">{firstName(r)}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  return (
    <table className="w-full table-fixed border-collapse font-data text-xs tabular-nums sm:text-[13px]">
      <thead>
        <tr className="text-left font-data text-3xs font-semibold uppercase tracking-[.12em] text-cz-3">
          <th scope="col" className="w-[38%] border-b border-cz-border py-1.5 pr-2 font-semibold">{t("stagePageV2.story.splits.point")}</th>
          <th scope="col" className="w-[19%] border-b border-cz-border py-1.5 pr-2 text-right font-semibold">{t("stagePageV2.story.splits.leaderTime")}</th>
          <th scope="col" className="border-b border-cz-border py-1.5 pr-2 font-semibold">{t("stagePageV2.story.splits.leading")}</th>
          {me && <th scope="col" className="w-[18%] border-b border-cz-border py-1.5 text-right font-semibold"><span className="block truncate">{meName ?? t("stagePageV2.story.you")}</span></th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            {kmCell(r)}
            <td className="border-t border-cz-border py-2 pr-2 text-right align-top text-cz-1">{r.leaderTime != null ? formatClock(r.leaderTime) : "-"}</td>
            <td className="border-t border-cz-border py-2 pr-2 align-top text-cz-1"><span className="block truncate">{leading(r)}</span></td>
            {me && <td className="border-t border-cz-border py-2 text-right align-top font-semibold text-cz-1">{myGap(r)}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
