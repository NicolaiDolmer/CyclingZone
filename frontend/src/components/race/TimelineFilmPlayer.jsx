// #3859 (bølge 2 — løbsfilm-afspilleren, EFTER-tilstanden): fri-scrubbing
// afspilning af en etapes event-tidslinje (spec §2.2/§2.4,
// docs/superpowers/specs/2026-08-17-race-event-log-stage-timeline-design.md).
// LAZY-loaded fra StoryOfTheStageSection (React.lazy + eget chunk — bundle-
// vagten har ~6 KB luft, se den fils toppkommentar for hvorfor).
//
// Ren afledning bor i lib/stageTimelineFilm.js (testet der, samme adskillelse
// som FinalKilometrePlayback/finalKilometre.js); denne fil er kun tidsstyring +
// rendering. Selve scrubber-grafikken (etapens ÆGTE rute-silhuet, ejer-fix
// 17/8) bor i StageFilmScrubber.jsx. prefers-reduced-motion (spec A6-mønster)
// → statisk fuldt feed uden scrubber/animation, samme konvention som
// FinalKilometrePlayback.
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Modal from "../ui/Modal.jsx";
import { Button, RefreshIcon, PlayIcon, PauseIcon } from "../ui";
import { formatNumber } from "../../lib/intl.js";
import { buildFilmTimeline, eventsPlayedUpTo, describeEvent } from "../../lib/stageTimelineFilm.js";
import StageFilmScrubber from "./StageFilmScrubber.jsx";

// Hele etapens film afspiller over dette vindue ved auto-play (mount-baseret
// timing, samme rAF-princip som FinalKilometrePlayback's useElapsedMs) — fri
// scrubbing virker altid, uafhængigt af om auto-play kører (mockup-kontrakten).
const FILM_DURATION_MS = 40_000;

function FeedRow({ event, riderNameById, teamNameById, t }) {
  const described = describeEvent(event, { riderNameById, teamNameById });
  if (!described) return null;
  return (
    <li className="cz-overlay-pop flex items-baseline justify-between gap-3 py-1.5 border-t border-cz-border first:border-t-0">
      <span className="font-data text-2xs text-cz-3 tabular-nums shrink-0 w-14">
        {t("detail.film.km", { value: formatNumber(event.km) })}
      </span>
      <span className="text-cz-1 text-sm leading-snug text-end flex-1">
        {t(`detail.film.event.${described.key}`, described.params)}
      </span>
    </li>
  );
}

function EventFeed({ events, riderNameById, teamNameById, emptyKey, t }) {
  if (!events.length) {
    return <p className="text-center text-cz-3 text-xs py-4">{t(emptyKey)}</p>;
  }
  return (
    <ul className="max-h-64 overflow-y-auto">
      {events.map((e, i) => (
        <FeedRow key={`${e.type}-${e.km}-${i}`} event={e} riderNameById={riderNameById} teamNameById={teamNameById} t={t} />
      ))}
    </ul>
  );
}

function AnimatedFilm({ profile, built, distanceKm, riderNameById, teamNameById, t }) {
  const [scrubKm, setScrubKm] = useState(0);
  const [playing, setPlaying] = useState(true);
  // Ref-spejl af scrubKm så rAF-effekten kan læse "hvor vi er nu" uden at have
  // scrubKm som dependency (ville genstarte loopet hver frame — samme fælde
  // FinalKilometrePlayback undgår ved kun at depende af totalMs).
  const scrubKmRef = useRef(0);
  useEffect(() => { scrubKmRef.current = scrubKm; }, [scrubKm]);

  useEffect(() => {
    if (!playing || !(distanceKm > 0)) return undefined;
    const startAt = performance.now();
    const startKm = scrubKmRef.current;
    let raf;
    const tick = () => {
      const dt = performance.now() - startAt;
      const next = Math.min(distanceKm, startKm + (dt / FILM_DURATION_MS) * distanceKm);
      setScrubKm(next);
      if (next >= distanceKm) { setPlaying(false); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, distanceKm]);

  const playedEvents = eventsPlayedUpTo(built.feedEvents, scrubKm);
  const atEnd = scrubKm >= distanceKm;

  const handleScrub = (e) => {
    setPlaying(false);
    setScrubKm(Number(e.target.value));
  };
  const handlePlayPause = () => {
    if (atEnd) { setScrubKm(0); setPlaying(true); return; }
    setPlaying((p) => !p);
  };

  return (
    <>
      <StageFilmScrubber
        profile={profile} feedEvents={built.feedEvents} climbMarkers={built.climbMarkers}
        catchKm={built.catchKm} gapCurve={built.gapCurve} scrubKm={scrubKm} distanceKm={distanceKm} t={t}
      />
      <input
        type="range"
        min={0}
        max={distanceKm || 0}
        step={0.1}
        value={scrubKm}
        onChange={handleScrub}
        aria-label={t("detail.film.scrubberLabel")}
        className="w-full cursor-pointer accent-cz-accent -mt-1"
      />
      <div className="mt-2 flex justify-end">
        <Button
          size="sm"
          variant="secondary"
          iconLeft={atEnd ? <RefreshIcon size={14} aria-hidden="true" /> : playing ? <PauseIcon size={14} aria-hidden="true" /> : <PlayIcon size={14} aria-hidden="true" />}
          onClick={handlePlayPause}
        >
          {atEnd ? t("detail.film.replay") : playing ? t("detail.film.pause") : t("detail.film.play")}
        </Button>
      </div>
      <div className="mt-3">
        <EventFeed events={playedEvents} riderNameById={riderNameById} teamNameById={teamNameById} emptyKey="detail.film.feedEmpty" t={t} />
      </div>
    </>
  );
}

function StaticFilm({ profile, built, distanceKm, riderNameById, teamNameById, t }) {
  return (
    <>
      <StageFilmScrubber
        profile={profile} feedEvents={built.feedEvents} climbMarkers={built.climbMarkers}
        catchKm={built.catchKm} gapCurve={built.gapCurve} scrubKm={distanceKm} distanceKm={distanceKm} t={t}
      />
      <div className="mt-3">
        <EventFeed events={built.feedEvents} riderNameById={riderNameById} teamNameById={teamNameById} emptyKey="detail.film.feedEmpty" t={t} />
      </div>
    </>
  );
}

export default function TimelineFilmPlayer({ open, onClose, timeline, profile, distanceKm, riderNameById, teamNameById, stageLabel }) {
  const { t } = useTranslation("races");
  const built = buildFilmTimeline({ events: timeline?.events, distanceKm });
  const profileDistanceKm = Number(profile?.distance_km);
  const resolvedDistanceKm = distanceKm ?? (Number.isFinite(profileDistanceKm) ? profileDistanceKm : null) ?? built.distanceKm ?? 0;
  // window.matchMedia er ikke reaktiv her — samme konvention som FinalKilometre-
  // Playback/CountdownRing (et OS-skift midt i en session tolereres).
  const reducedMotion = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  return (
    <Modal open={open} onClose={onClose} title={t("detail.film.title")} description={stageLabel} size="xl" closeLabel={t("common:actions.close")}>
      {reducedMotion ? (
        <StaticFilm profile={profile} built={built} distanceKm={resolvedDistanceKm} riderNameById={riderNameById} teamNameById={teamNameById} t={t} />
      ) : (
        <AnimatedFilm profile={profile} built={built} distanceKm={resolvedDistanceKm} riderNameById={riderNameById} teamNameById={teamNameById} t={t} />
      )}
    </Modal>
  );
}
