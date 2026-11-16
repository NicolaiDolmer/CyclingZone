// #7861 · Løbsfilmen som én afspiller (spec 2026-11-07 F1-F7, wireframe v6c "Story").
// Venstre: ÉN film på en mørk filmflade. Ruteprofilen er tidslinjen (stigninger og
// mellemspurt står på den), den guld km-skyder og Afspil styrer positionen, og
// kapitelnavnet står ved siden af. Under filmen: kapitlerne (start, udbruddet,
// stigningerne, spurten, finalen) og grupperne på vejen ved positionen.
// Højre: ÉT referat. Hver linje er en km, der hopper filmen dertil; linjen filmen
// står ved har aria-current. Referatet viser kun linjerne op til filmens position,
// så vinderen først står der, når filmen er i mål. "Din dag" og resultatet står i
// Resultater, ikke her. Kilde: kun løbsloggens historie (samme model som før).
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useStageTimeline } from "../../../hooks/useStageTimeline.js";
import { formatNumber } from "../../../lib/intl.js";
import { ownRiderIdsForOneDay } from "../../../lib/oneDayTimeline.ts";
import { effectiveEffortByRider, ownRiderIdsForStage } from "../../../lib/stageSplitTimes.ts";
import { fetchTeamOrders } from "../../../lib/tacticsOrdersAdapter.js";
import type { TeamOrdersContext } from "../../stageOrders/stageOrdersRecap.ts";
import { PlayIcon, prefersReducedMotion } from "../stagePageV2/FinaleView.tsx";
import {
  asStory, castFrom, curateMoments, formatClock, frameAt, isTimeTrialStory, lineReplayKm, namesList, pickGroups, replayGroupsAt,
  wholeStageFrames, type StoryLine, type StoryNarrativeContext,
} from "../stagePageV2/raceStoryModel.ts";
import StageProfileV2 from "../stagePageV2/StageProfileV2.tsx";
import { elevationSeries, sortedClimbs, type ResultRow, type RoleOverride, type RoleRider, type StageProfile } from "../stagePageV2/stagePageV2Model.ts";
import { useStoryText } from "../stagePageV2/storyText.ts";
import { Button, Section, SectionHeader, SkeletonLines } from "../stagePageV2/ui.ts";
import {
  v6ChapterAt, v6CurrentLine, v6FilmChapters, v6MoreAhead, v6NextChapter, v6PlayStep, v6VisibleLines, type V6Chapter,
} from "./v6RaceFilmModel.ts";

export interface V6RaceFilmProps {
  raceId: string | null;
  stageNumber: number;
  isStageRace: boolean;
  profile: StageProfile | null;
  results: ResultRow[];
  myTeamId: string | null;
  stageRoles: null | false | { riders?: RoleRider[]; overrides?: RoleOverride[] };
  /** Skift til Resultater (enkeltstart og en etape uden film peger dertil). */
  onShowResults: () => void;
}

const NO_RIDERS: RoleRider[] = [];

export default function V6RaceFilm({ raceId, stageNumber, isStageRace, profile, results, myTeamId, stageRoles, onShowResults }: V6RaceFilmProps) {
  const { t } = useTranslation("races");
  const { timeline, loading, error } = useStageTimeline(raceId, stageNumber, { story: true });
  const story = useMemo(() => asStory((timeline as { story?: unknown } | null)?.story), [timeline]);
  const riders = stageRoles ? stageRoles.riders ?? NO_RIDERS : NO_RIDERS;
  const cast = useMemo(() => castFrom(results, riders, stageNumber, myTeamId), [results, riders, stageNumber, myTeamId]);

  // Samme ordre-opslag som den nuværende historie (StagePageV2): en v4-etapes forklaringer
  // venter på holdets egne ordrer; et fejlet opslag påstår intet om ordrernes virkning.
  const ran = timeline as { timeline_version?: number; created_at?: string | null; events?: StoryNarrativeContext["events"] } | null;
  const v4 = (ran?.timeline_version ?? 1) >= 2;
  const ownRiders = useMemo(
    () => (isStageRace ? ownRiderIdsForStage(results, stageNumber, myTeamId) : ownRiderIdsForOneDay(results, myTeamId)),
    [isStageRace, results, stageNumber, myTeamId],
  );
  const needsOrders = v4 && ownRiders.length > 0 && Boolean(raceId);
  const [orders, setOrders] = useState<{ key: string; value: TeamOrdersContext | null } | null>(null);
  const ordersKey = `${raceId}:${stageNumber}`;
  useEffect(() => {
    if (!needsOrders || !raceId) return undefined;
    let live = true;
    fetchTeamOrders({ raceId })
      .then((value) => { if (live) setOrders({ key: ordersKey, value: value as TeamOrdersContext | null }); })
      .catch(() => { /* catch-ok: ukendte ordrer kan ikke bære en påstand om ordrernes virkning */ });
    return () => { live = false; };
  }, [needsOrders, raceId, ordersKey]);
  const knownOrders = orders?.key === ordersKey ? orders : null;

  const narrative = useMemo<StoryNarrativeContext>(() => {
    const teamNameById = new Map<string, string>();
    for (const row of results) {
      const id = row.team_id ?? row.rider?.team?.id;
      const name = row.team_name ?? row.rider?.team?.name;
      if (id && name) teamNameById.set(String(id), name);
    }
    return {
      profileType: profile?.profile_type ?? null,
      climbs: profile?.climbs ?? null,
      events: ran?.events ?? [],
      ranAt: ran?.created_at ?? null,
      teamNameById,
      effortByRider: v4 && !knownOrders ? null : effectiveEffortByRider(stageRoles, knownOrders?.value, stageNumber, { v4, ranAt: ran?.created_at ?? null }),
    };
  }, [results, profile, ran, v4, knownOrders, stageRoles, stageNumber]);

  const filmTitle = t("racePageV6.film.title");
  const reportTitle = t("racePageV6.film.report.title");

  if (loading && !story) {
    return (
      <div data-race-section="race_story" className="@container">
        <div className="grid grid-cols-1 items-start gap-[14px] @4xl:grid-cols-[minmax(0,1fr)_minmax(320px,400px)]">
          <Section aria-label={filmTitle}><SectionHeader title={filmTitle} /><SkeletonLines lines={6} /></Section>
          <Section aria-label={reportTitle}><SectionHeader title={reportTitle} /><SkeletonLines lines={6} /></Section>
        </div>
      </div>
    );
  }
  if (!story) {
    return (
      <Section aria-label={filmTitle}>
        <div data-race-section="race_story" className="flex flex-wrap items-center gap-3">
          <p className="m-0 min-w-[200px] flex-1 text-sm text-cz-2">{t(error ? "racePageV6.film.error" : "racePageV6.film.none")}</p>
          <Button variant="secondary" size="md" onClick={onShowResults}>{t("racePageV6.tab.results")}</Button>
        </div>
      </Section>
    );
  }
  return <FilmBody key={`${raceId}-${stageNumber}`} story={story} profile={profile} cast={cast} narrative={narrative} onShowResults={onShowResults} />;
}

function FilmBody({ story, profile, cast, narrative, onShowResults }: {
  story: NonNullable<ReturnType<typeof asStory>>;
  profile: StageProfile | null;
  cast: ReturnType<typeof castFrom>;
  narrative: StoryNarrativeContext;
  onShowResults: () => void;
}) {
  const { t } = useTranslation("races");
  const text = useStoryText(cast);
  const D = story.distance_km ?? (Number(profile?.distance_km) || 0);
  const series = useMemo(() => elevationSeries(profile), [profile]);
  const climbs = useMemo(() => sortedClimbs(profile), [profile]);
  const timeTrial = isTimeTrialStory(story, profile?.profile_type, narrative.events);
  const lines = useMemo(() => (timeTrial ? [] : curateMoments(story, cast, undefined, narrative)), [story, cast, narrative, timeTrial]);
  const chapters = useMemo(() => v6FilmChapters({ distanceKm: D, climbs, sprints: profile?.sprints ?? [], lines }), [D, climbs, profile, lines]);
  const frames = useMemo(() => wholeStageFrames(story), [story]);

  // F6: filmen starter ved start, så intet er afsløret, før man selv spiller den.
  const [km, setKm] = useState(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return undefined;
    const step = v6PlayStep(D);
    const id = setInterval(() => {
      setKm((cur) => {
        const next = Math.min(D, cur + step);
        if (next >= D) setPlaying(false);
        return next;
      });
    }, 100);
    return () => clearInterval(id);
  }, [playing, D]);

  function togglePlay() {
    if (playing) { setPlaying(false); return; }
    // Reduceret bevægelse: Afspil hopper til næste kapitel i stedet for at rulle.
    if (prefersReducedMotion()) { setKm(v6NextChapter(chapters, km)?.km ?? D); return; }
    if (km >= D) setKm(0);
    setPlaying(true);
  }
  const jump = (to: number) => { setPlaying(false); setKm(Math.max(0, Math.min(D, to))); };

  const chapter = v6ChapterAt(chapters, km);
  const chapterLabel = (c: V6Chapter) => {
    if (c.kind === "climb") return c.name || t("stagePageV2.story.splits.climb");
    if (c.kind === "sprint") return t("racePageV6.film.chapter.sprint", { km: formatNumber(Math.round(c.km)) });
    return t(`racePageV6.film.chapter.${c.kind}`);
  };
  const visible = v6VisibleLines(lines, km);
  const current = v6CurrentLine(lines, km);
  const ahead = v6MoreAhead(lines, km);
  // Grupperne på vejen ved positionen; i mål er alle grupper "fremme", så dér står kun positionen (resultatet er i Resultater).
  const groups = useMemo(() => (story.precise_times && km < D ? replayGroupsAt(story, frames, km, cast) : []), [story, frames, km, cast, D]);
  const { shown, rest } = pickGroups(groups, 2);
  const frame = frameAt(frames, km);
  const kmText = formatNumber(Math.round(km * 10) / 10, { maximumFractionDigits: 1 });
  const filmTitle = t("racePageV6.film.title");
  const reportTitle = t("racePageV6.film.report.title");

  return (
    <div data-race-section="race_story" className="@container">
      <div className="grid grid-cols-1 items-start gap-[14px] @4xl:grid-cols-[minmax(0,1fr)_minmax(320px,400px)]">
        <Section aria-label={filmTitle}>
          <SectionHeader title={filmTitle} meta={t("racePageV6.film.meta")} />
          {/* Den mørke filmflade: mørkt tema lokalt, så profilens egne farver følger med i begge temaer. */}
          <div data-theme="dark" data-film-surface className="rounded-cz border border-cz-border bg-cz-card px-3 pb-2 pt-3 text-cz-1">
            {profile && series && (
              <StageProfileV2
                profile={profile}
                series={series}
                climbs={climbs}
                selectedClimb={null}
                onSelectClimb={() => {}}
                band
                progressKm={km}
                overlay={(geo) => (
                  <g aria-hidden="true">
                    <line x1={geo.X(km)} x2={geo.X(km)} y1={geo.top - 6} y2={geo.bottom} stroke="rgb(var(--accent))" strokeWidth={2} />
                    {groups.length === 0 && (
                      <circle cx={geo.X(km)} cy={geo.Y(geo.elevation(km))} r={5} fill="rgb(var(--accent))" stroke="var(--bg-card)" strokeWidth={1.5} />
                    )}
                    {[...groups].sort((a, b) => b.gapS - a.gapS).map((g) => {
                      if (g.km == null) return null;
                      const x = Math.max(12, Math.min(geo.W - 12, geo.X(g.km))), y = geo.Y(geo.elevation(g.km)) - 6;
                      return (
                        <g key={g.groupId}>
                          <circle cx={x} cy={y} r={g.front ? 6 : 4.5} fill={g.front ? "rgb(var(--accent))" : "var(--text-1)"} stroke="var(--bg-card)" strokeWidth={1.5} />
                          {g.mine.length > 0 && <circle cx={x} cy={y} r={10} fill="none" stroke="var(--text-1)" strokeWidth={2} />}
                        </g>
                      );
                    })}
                  </g>
                )}
              />
            )}
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              <button
                type="button"
                onClick={togglePlay}
                aria-label={playing ? t("stagePageV2.story.replay.pause") : t("stagePageV2.story.replay.play")}
                className="inline-flex min-h-11 flex-none items-center gap-1.5 rounded-cz border border-cz-border-strong px-3 text-sm font-semibold text-cz-1 hover:bg-cz-subtle"
              >
                <PlayIcon playing={playing} />
                <span aria-hidden="true">{playing ? t("stagePageV2.story.replay.pause") : t("racePageV6.film.play")}</span>
              </button>
              <input
                type="range"
                min={0}
                max={D}
                step={0.5}
                value={km}
                onChange={(e) => jump(Number(e.target.value))}
                aria-label={t("stagePageV2.story.replay.scrubAria")}
                aria-valuetext={chapter ? `${t("stagePageV2.story.kmAt", { km: kmText })} · ${chapterLabel(chapter)}` : t("stagePageV2.story.kmAt", { km: kmText })}
                className="h-11 min-w-[140px] flex-1 accent-cz-accent"
              />
              <span className="flex-none font-data text-xs font-semibold tabular-nums text-cz-1">
                {story.precise_times && frame?.leader_time_s != null
                  ? t("stagePageV2.story.replay.positionTime", { km: kmText, time: formatClock(frame.leader_time_s) })
                  : t("stagePageV2.story.kmAt", { km: kmText })}
              </span>
              {chapter && <span aria-live="polite" className="flex-none text-sm text-cz-2">{chapterLabel(chapter)}</span>}
            </div>
          </div>
          {chapters.length > 1 && (
            <div role="group" aria-label={t("racePageV6.film.chaptersAria")} className="mt-3 flex flex-wrap gap-2">
              {chapters.map((c) => {
                const active = chapter === c;
                return (
                  <button
                    key={`${c.kind}-${c.km}`}
                    type="button"
                    aria-pressed={active}
                    onClick={() => jump(c.km)}
                    className={`rounded-cz border px-2.5 py-1 text-xs transition-colors duration-150 [@media(max-width:640px),(pointer:coarse)]:min-h-11 ${active ? "border-cz-accent bg-cz-accent/10 font-semibold text-cz-accent-t" : "border-cz-border bg-cz-card text-cz-2 hover:text-cz-1"}`}
                  >
                    {chapterLabel(c)}
                  </button>
                );
              })}
            </div>
          )}
          {shown.length > 0 && (
            <ul className="m-0 mt-3 grid list-none grid-cols-1 gap-x-6 p-0 @xl:grid-cols-2">
              {shown.map((g) => (
                <li key={g.groupId} className="flex min-h-11 items-center gap-2.5 border-t border-cz-border py-1.5">
                  <span className={`block h-2.5 w-2.5 flex-none rounded-full ${g.front ? "bg-cz-accent" : "bg-cz-1"} ${g.mine.length ? "ring-2 ring-cz-1 ring-offset-2 ring-offset-cz-card" : ""}`} aria-hidden="true" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-semibold text-cz-1">
                      {g.peloton ? t("stagePageV2.story.group.peloton") : namesList(g.riderIds, cast, 2, g.size) || t("stagePageV2.story.group.riders", { count: g.size ?? 0 })}
                    </span>
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
                <li className="flex min-h-11 items-center border-t border-cz-border py-1.5 text-xs tabular-nums text-cz-2 @xl:col-span-2">
                  {t("stagePageV2.story.group.rest", { groups: rest.groups, riders: rest.riders, min: formatClock(rest.minGap), max: formatClock(rest.maxGap) })}
                </li>
              )}
            </ul>
          )}
        </Section>

        <Section aria-label={reportTitle}>
          <SectionHeader title={reportTitle} meta={timeTrial ? null : t("racePageV6.film.report.meta")} />
          {timeTrial ? (
            <div className="flex flex-wrap items-center gap-3">
              <p className="m-0 min-w-[200px] flex-1 text-sm text-cz-2">{t("stagePageV2.story.timeTrial")}</p>
              <Button variant="secondary" size="md" onClick={onShowResults}>{t("racePageV6.tab.results")}</Button>
            </div>
          ) : visible.length === 0 ? (
            <p className="m-0 border-t border-cz-border py-3 text-sm text-cz-2">{t("racePageV6.film.report.empty")}</p>
          ) : (
            <ol className="m-0 list-none p-0">
              {visible.map((l) => <ReportLine key={l.id} line={l} current={current?.id === l.id} text={text} onJump={() => jump(lineReplayKm(l, D || null))} />)}
            </ol>
          )}
          {!timeTrial && ahead && visible.length > 0 && (
            <p className="m-0 border-t border-dashed border-cz-border pt-2.5 text-xs text-cz-3">{t("racePageV6.film.report.ahead")}</p>
          )}
        </Section>
      </div>
    </div>
  );
}

function ReportLine({ line, current, text, onJump }: { line: StoryLine; current: boolean; text: ReturnType<typeof useStoryText>; onJump: () => void }) {
  const { t } = useTranslation("races");
  const note = text.mineNote(line);
  return (
    <li>
      <button
        type="button"
        onClick={onJump}
        aria-current={current ? "step" : undefined}
        className={`grid min-h-11 w-full grid-cols-[72px_minmax(0,1fr)] gap-2.5 border-t border-cz-border px-1 py-2 text-left hover:bg-cz-subtle ${current ? "bg-cz-subtle" : ""}`}
      >
        <span className="flex flex-col font-data text-xs font-semibold tabular-nums text-cz-accent-t">
          <span>{text.kmLabel(line)}</span>
          {line.time != null && <span className="font-normal text-cz-3">{formatClock(line.time)}</span>}
        </span>
        <span className="text-sm text-cz-1">
          {text.lineText(line)}
          {note !== null && (
            <span className="ml-1.5 inline-flex items-center gap-1.5 align-middle">
              <span className="rounded-sm bg-cz-1 px-1.5 py-0.5 font-data text-3xs font-bold uppercase tracking-[.08em] text-cz-body">{t("stagePageV2.story.you")}</span>
              {note && <span className="text-xs font-semibold text-cz-1">{note}</span>}
            </span>
          )}
          {line.narratives?.map((n, index) => (
            <span key={index} className="mt-1 block text-sm text-cz-2">{t("detail.film.event." + n.key, n.params)}</span>
          ))}
        </span>
      </button>
    </li>
  );
}
