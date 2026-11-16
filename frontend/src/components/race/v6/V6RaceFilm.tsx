// #7861 · Løbsfilmen som én afspiller (spec 2026-11-07 F1-F7, wireframe v6c "Story").
// Venstre: ÉN film på den lyse kortflade (ejer 16/11). Ruteprofilen er etapesidens
// farvede profil og tidslinjen (stigninger med kategori og navn, mellemspurt, km og
// meter står på den), en guld linje med prik viser positionen, den guld km-skyder og Afspil styrer den, og
// kapitelnavnet står ved siden af. Under filmen: kapitlerne (start, udbruddet,
// stigningerne, spurten, finalen) og grupperne på vejen ved positionen.
// Højre: ÉT referat. Hver linje er en km, der hopper filmen dertil; linjen filmen
// står ved har aria-current. Referatet viser kun linjerne op til filmens position,
// så vinderen først står der, når filmen er i mål. "Din dag" og resultatet står i
// Resultater, ikke her. Kilde: kun løbsloggens historie (samme model som før).
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import I18nReadyGate from "../../I18nReadyGate.jsx";
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
import { useMeasuredWidth } from "../stagePageV2/StageProfileV2.tsx";
import { elevationAt, elevationSeries, profileScale, sortedClimbs, type ResultRow, type RoleOverride, type RoleRider, type StageProfile } from "../stagePageV2/stagePageV2Model.ts";
import { useStoryText } from "../stagePageV2/storyText.ts";
import { Button, Section, SectionHeader, SkeletonLines } from "../stagePageV2/ui.ts";
import V6Route from "./V6Route.tsx";
import {
  isClimbAttackLine, v6ChapterAt, v6ClimbAttackCopyKey, v6ClimbAttackLines, v6CurrentLine, v6FilmChapters, v6FilmProfileGeometry, v6MoreAhead,
  v6NextChapter, v6PlayStep, v6ReportLines, v6VisibleLines, type V6Chapter, type V6ClimbAttackLine,
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

/** Filmens og referatets pladsholdere, mens løbsloggen (eller teksterne) hentes. */
function FilmSkeleton({ filmTitle, reportTitle }: { filmTitle?: string; reportTitle?: string }) {
  return (
    <div data-race-section="race_story" className="@container">
      <div className="grid grid-cols-1 items-start gap-[14px] @4xl:grid-cols-[minmax(0,1fr)_minmax(320px,400px)]">
        <Section aria-label={filmTitle}>{filmTitle ? <SectionHeader title={filmTitle} /> : null}<SkeletonLines lines={6} /></Section>
        <Section aria-label={reportTitle}>{reportTitle ? <SectionHeader title={reportTitle} /> : null}<SkeletonLines lines={6} /></Section>
      </div>
    </div>
  );
}

/**
 * Filmens tekster ligger i namespacet "raceFilm", som hentes først, når filmen vises
 * (I18nReadyGate), ikke i første indlæsning (bundle-loftet, #7861).
 */
export default function V6RaceFilm(props: V6RaceFilmProps) {
  return <I18nReadyGate ns="raceFilm" fallback={<FilmSkeleton />}><V6RaceFilmLoaded {...props} /></I18nReadyGate>;
}

function V6RaceFilmLoaded({ raceId, stageNumber, isStageRace, profile, results, myTeamId, stageRoles, onShowResults }: V6RaceFilmProps) {
  const { t } = useTranslation(["races", "raceFilm"]);
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

  const filmTitle = t("raceFilm:title");
  const reportTitle = t("raceFilm:report.title");

  if (loading && !story) return <FilmSkeleton filmTitle={filmTitle} reportTitle={reportTitle} />;
  if (!story) {
    return (
      <Section aria-label={filmTitle}>
        <div data-race-section="race_story" className="flex flex-wrap items-center gap-3">
          <p className="m-0 min-w-[200px] flex-1 text-sm text-cz-2">{t(error ? "raceFilm:error" : "raceFilm:none")}</p>
          <Button variant="secondary" size="md" onClick={onShowResults}>{t("racePageV6.tab.results")}</Button>
        </div>
      </Section>
    );
  }
  return <FilmBody key={`${raceId}-${stageNumber}`} story={story} profile={profile} cast={cast} narrative={narrative} timelineVersion={ran?.timeline_version ?? null} ownRiders={ownRiders} onShowResults={onShowResults} />;
}

function FilmBody({ story, profile, cast, narrative, timelineVersion, ownRiders, onShowResults }: {
  story: NonNullable<ReturnType<typeof asStory>>;
  profile: StageProfile | null;
  cast: ReturnType<typeof castFrom>;
  narrative: StoryNarrativeContext;
  timelineVersion: number | null;
  ownRiders: readonly string[];
  onShowResults: () => void;
}) {
  const { t } = useTranslation(["races", "raceFilm"]);
  const text = useStoryText(cast);
  const D = story.distance_km ?? (Number(profile?.distance_km) || 0);
  const series = useMemo(() => elevationSeries(profile), [profile]);
  const climbs = useMemo(() => sortedClimbs(profile), [profile]);
  const timeTrial = isTimeTrialStory(story, profile?.profile_type, narrative.events);
  const storyLines = useMemo(() => (timeTrial ? [] : curateMoments(story, cast, undefined, narrative)), [story, cast, narrative, timeTrial]);
  // #7965 (Codex P1): angrebet op ad sidste stigning og dets udfald, som i den hidtidige film.
  const attackLines = useMemo(() => (timeTrial ? [] : v6ClimbAttackLines(narrative.events as Parameters<typeof v6ClimbAttackLines>[0], {
    timelineVersion, climbs: profile?.climbs ?? null, mine: cast.mine, ownRiderIds: ownRiders,
    effortByRider: (narrative.effortByRider ?? null) as Parameters<typeof v6ClimbAttackLines>[1]["effortByRider"], profileType: profile?.profile_type ?? null,
  })), [timeTrial, narrative, timelineVersion, profile, cast, ownRiders]);
  const lines = useMemo(() => v6ReportLines(storyLines, attackLines), [storyLines, attackLines]);
  const chapters = useMemo(() => v6FilmChapters({ distanceKm: D, climbs, sprints: profile?.sprints ?? [], lines: storyLines }), [D, climbs, profile, storyLines]);
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
    if (c.kind === "sprint") return t("raceFilm:chapter.sprint", { km: formatNumber(Math.round(c.km)) });
    return t(`raceFilm:chapter.${c.kind}`);
  };
  const visible = v6VisibleLines(lines, km);
  const current = v6CurrentLine(lines, km);
  const ahead = v6MoreAhead(lines, km);
  // Grupperne på vejen ved positionen; i mål er alle grupper "fremme", så dér står kun positionen (resultatet er i Resultater).
  const groups = useMemo(() => (story.precise_times && !timeTrial && km < D ? replayGroupsAt(story, frames, km, cast) : []), [story, frames, km, cast, D, timeTrial]);
  const { shown, rest } = pickGroups(groups, 2);
  const frame = frameAt(frames, km);
  const kmText = formatNumber(Math.round(km * 10) / 10, { maximumFractionDigits: 1 });
  const filmTitle = t("raceFilm:title");
  const reportTitle = t("raceFilm:report.title");

  return (
    <div data-race-section="race_story" className="@container">
      <div className="grid grid-cols-1 items-start gap-[14px] @4xl:grid-cols-[minmax(0,1fr)_minmax(320px,400px)]">
        <Section aria-label={filmTitle}>
          <SectionHeader title={filmTitle} meta={t("raceFilm:meta")} />
          {/* #8253/#7861 (ejer 16/11): filmen bruger v6's ÉNE fælles rute (V6Route): farvet profil,
              bjergpriser, mellemspurter, mål, punktlisten og farveforklaringen. Ovenpå kun positionen:
              en guld linje med en prik (og grupperne på vejen), lagt som overlay her, da V6Route
              ingen markør-prop har. */}
          <div data-film-surface className="text-cz-1">
            {profile && series && <FilmRoute profile={profile} km={km} groups={groups} />}
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              <button
                type="button"
                onClick={togglePlay}
                aria-label={playing ? t("stagePageV2.story.replay.pause") : t("stagePageV2.story.replay.play")}
                className="inline-flex min-h-11 flex-none items-center gap-1.5 rounded-cz border border-cz-border-strong px-3 text-sm font-semibold text-cz-1 hover:bg-cz-subtle"
              >
                <PlayIcon playing={playing} />
                <span aria-hidden="true">{playing ? t("stagePageV2.story.replay.pause") : t("raceFilm:play")}</span>
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
            <div role="group" aria-label={t("raceFilm:chaptersAria")} className="mt-3 flex flex-wrap gap-2">
              {chapters.map((c) => {
                const active = chapter === c;
                return (
                  <button
                    key={`${c.kind}-${c.km}`}
                    type="button"
                    aria-pressed={active}
                    onClick={() => jump(c.km)}
                    className={`rounded-cz border px-2.5 py-1 text-xs transition-colors duration-150 [@media(max-width:640px),(pointer:coarse)]:min-h-11 ${active ? "border-cz-accent bg-cz-accent/10 font-semibold text-cz-1" :"border-cz-border bg-cz-card text-cz-2 hover:text-cz-1"}`}
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
          <SectionHeader title={reportTitle} meta={timeTrial ? null : t("raceFilm:report.meta")} />
          {timeTrial ? (
            <div className="flex flex-wrap items-center gap-3">
              <p className="m-0 min-w-[200px] flex-1 text-sm text-cz-2">{t("stagePageV2.story.timeTrial")}</p>
              <Button variant="secondary" size="md" onClick={onShowResults}>{t("racePageV6.tab.results")}</Button>
            </div>
          ) : visible.length === 0 ? (
            <p className="m-0 border-t border-cz-border py-3 text-sm text-cz-2">{t("raceFilm:report.empty")}</p>
          ) : (
            <ol className="m-0 list-none p-0">
              {visible.map((l) => (isClimbAttackLine(l)
                ? <ClimbAttackReportLine key={l.id} line={l} current={current?.id === l.id} cast={cast} text={text} onJump={() => jump(l.km)} />
                : <ReportLine key={l.id} line={l} current={current?.id === l.id} text={text} onJump={() => jump(lineReplayKm(l, D || null))} />))}
            </ol>
          )}
          {!timeTrial && ahead && visible.length > 0 && (
            <p className="m-0 border-t border-dashed border-cz-border pt-2.5 text-xs text-cz-3">{t("raceFilm:report.ahead")}</p>
          )}
        </Section>
      </div>
    </div>
  );
}

type FilmGroups = ReturnType<typeof replayGroupsAt>;

/**
 * v6's fælles rute (V6Route, #8253) med filmens position ovenpå: guld linje og prik, eller
 * grupperne på vejen. V6Route har ingen markør-prop, så positionen er et overlay med samme
 * geometri som rutens profil (v6FilmProfileGeometry), målt i samme bredde.
 */
function FilmRoute({ profile, km, groups }: { profile: StageProfile; km: number; groups: FilmGroups }) {
  const [wrapRef, width] = useMeasuredWidth<HTMLDivElement>();
  const series = useMemo(() => elevationSeries(profile), [profile]);
  const scale = useMemo(() => (series ? profileScale(profile, series) : null), [profile, series]);
  const geo = series && scale && width > 0 ? v6FilmProfileGeometry({ width, profile, series, ...scale }) : null;
  const yAt = (at: number) => (geo && series ? geo.Y(elevationAt(series, Math.max(0, Math.min(geo.D, at)))) : 0);
  return (
    <div ref={wrapRef} className="relative">
      <V6Route profile={profile} />
      {geo && (
        <svg
          aria-hidden="true"
          data-film-position
          width={geo.W}
          height={geo.H}
          viewBox={`0 0 ${geo.W} ${geo.H}`}
          className="pointer-events-none absolute left-0 top-0 overflow-visible"
        >
          <line x1={geo.X(km)} x2={geo.X(km)} y1={geo.top - 30} y2={geo.bottom} stroke="rgb(var(--accent))" strokeWidth={2} />
          {groups.length === 0 && (
            <circle cx={geo.X(km)} cy={yAt(km)} r={6} fill="rgb(var(--accent))" stroke="var(--text-1)" strokeWidth={1} />
          )}
          {[...groups].sort((a, b) => b.gapS - a.gapS).map((g) => {
            if (g.km == null) return null;
            const x = Math.max(12, Math.min(geo.W - 12, geo.X(g.km))), y = yAt(g.km);
            return (
              <g key={g.groupId}>
                <circle cx={x} cy={y} r={g.front ? 6 : 4.5} fill={g.front ? "rgb(var(--accent))" : "var(--text-1)"} stroke={g.front ? "var(--text-1)" : "var(--bg-card)"} strokeWidth={g.front ? 1 : 1.5} />
                {g.mine.length > 0 && <circle cx={x} cy={y} r={10} fill="none" stroke="var(--text-1)" strokeWidth={2} />}
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

/** #7965: angrebet ved foden og dets udfald (to linjer), eller én linje uden topankomst. */
function ClimbAttackReportLine({ line, current, cast, text, onJump }: {
  line: V6ClimbAttackLine;
  current: boolean;
  cast: ReturnType<typeof castFrom>;
  text: ReturnType<typeof useStoryText>;
  onJump: () => void;
}) {
  const { t } = useTranslation("races");
  const id = line.riderIds[0];
  const rider = namesList(line.riderIds, cast, 1) || (id ? cast.nameOf(id) : null) || t("stagePageV2.story.aRider");
  return (
    <li>
      <button
        type="button"
        onClick={onJump}
        aria-current={current ? "step" : undefined}
        data-film-line={`climb-attack-${line.phase}`}
        className={`grid min-h-11 w-full grid-cols-[72px_minmax(0,1fr)] gap-2.5 border-t border-cz-border px-1 py-2 text-left hover:bg-cz-subtle ${current ? "bg-cz-subtle" : ""}`}
      >
        <span className="flex flex-col font-data text-xs font-semibold tabular-nums text-cz-1">
          <span>{t("stagePageV2.story.kmAt", { km: text.km(line.km) })}</span>
          {line.time != null && <span className="font-normal text-cz-3">{formatClock(line.time)}</span>}
        </span>
        <span className="text-sm text-cz-1">
          {t(`detail.film.event.${v6ClimbAttackCopyKey(line)}`, { rider, climb: line.climbName ?? "" })}
          {line.mineIds.length > 0 && (
            <span className="ml-1.5 inline-flex items-center gap-1.5 align-middle">
              <span className="rounded-sm bg-cz-1 px-1.5 py-0.5 font-data text-3xs font-bold uppercase tracking-[.08em] text-cz-body">{t("stagePageV2.story.you")}</span>
            </span>
          )}
        </span>
      </button>
    </li>
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
        <span className="flex flex-col font-data text-xs font-semibold tabular-nums text-cz-1">
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
