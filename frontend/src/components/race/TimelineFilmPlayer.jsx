// #3859 (bølge 2 — løbsfilm-afspilleren, EFTER-tilstanden): fri-scrubbing
// afspilning af en etapes event-tidslinje (spec §2.2/§2.4,
// docs/superpowers/specs/2026-08-17-race-event-log-stage-timeline-design.md).
// LAZY-loaded fra StoryOfTheStageSection (React.lazy + eget chunk — bundle-
// vagten har ~6 KB luft, se den fils toppkommentar for hvorfor).
//
// Ren afledning bor i lib/stageTimelineFilm.js (testet der, samme adskillelse
// som FinalKilometrePlayback/finalKilometre.js); denne fil er kun tidsstyring +
// rendering. prefers-reduced-motion (spec A6-mønster) → statisk fuldt feed uden
// scrubber/animation, samme konvention som FinalKilometrePlayback.
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Modal from "../ui/Modal.jsx";
import { Button, RefreshIcon, PlayIcon, PauseIcon } from "../ui";
import { formatNumber } from "../../lib/intl.js";
import {
  buildFilmTimeline, kmToX, eventsPlayedUpTo, describeEvent, climbMarkerHeight,
} from "../../lib/stageTimelineFilm.js";

const PLOT_WIDTH = 820;
const AXIS_Y = 46;
const SCRUB_HEIGHT = 64;
const CURVE_WIDTH = 820;
const CURVE_HEIGHT = 56;
const CURVE_PAD_T = 6;
const CURVE_PAD_B = 14;
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

// Film-scrubber: km-akse med stignings-trekanter (kategori-skaleret højde) +
// gold fremdrifts-linje + catch-punkt-markør. Rent dekorativ SVG — den
// egentlige interaktion (fri scrubbing) sidder i range-inputtet under grafen,
// som giver native tastatur-/skærmlæser-a11y helt gratis.
function ScrubberGraphic({ built, scrubKm, distanceKm, t }) {
  const progressX = kmToX(scrubKm, distanceKm, PLOT_WIDTH);
  return (
    <svg viewBox={`0 0 ${PLOT_WIDTH} ${SCRUB_HEIGHT}`} className="block w-full h-auto" aria-hidden="true">
      <line x1={0} y1={AXIS_Y} x2={PLOT_WIDTH} y2={AXIS_Y} stroke="var(--border)" strokeWidth="1" />
      <line x1={0} y1={AXIS_Y} x2={progressX} y2={AXIS_Y} stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" />
      {built.climbMarkers.map((c, i) => {
        const x = kmToX(c.km, distanceKm, PLOT_WIDTH);
        const h = climbMarkerHeight(c.category);
        return (
          <path
            key={`climb-${i}`}
            d={`M${(x - 4).toFixed(1)},${AXIS_Y} L${x.toFixed(1)},${(AXIS_Y - h).toFixed(1)} L${(x + 4).toFixed(1)},${AXIS_Y} Z`}
            fill="rgb(var(--jersey-mountain-bg) / 0.75)"
          />
        );
      })}
      {built.catchKm != null && (
        <circle cx={kmToX(built.catchKm, distanceKm, PLOT_WIDTH)} cy={AXIS_Y} r="3.5" fill="var(--bg-card)" stroke="var(--text-2)" strokeWidth="1.5" />
      )}
      <circle cx={progressX} cy={AXIS_Y} r="4.5" fill="var(--accent)" />
      <text x={0} y={SCRUB_HEIGHT - 2} className="font-data" fontSize="9" fill="var(--text-3)">0 {t("detail.route.stats.km")}</text>
      <text x={PLOT_WIDTH} y={SCRUB_HEIGHT - 2} textAnchor="end" className="font-data" fontSize="9" fill="var(--text-3)">
        {formatNumber(distanceKm)} {t("detail.route.stats.km")}
      </text>
    </svg>
  );
}

// Forsprings-kurven (gap_update-punkter) — lille SVG, ikke en fuld graf-komponent.
function GapCurve({ gapCurve, distanceKm, scrubKm, t }) {
  if (!gapCurve.length) return null;
  const maxGap = Math.max(...gapCurve.map((p) => p.gapSeconds), 30) * 1.15;
  const plotH = CURVE_HEIGHT - CURVE_PAD_T - CURVE_PAD_B;
  const x = (km) => kmToX(km, distanceKm, CURVE_WIDTH);
  const y = (gap) => CURVE_PAD_T + plotH - (gap / maxGap) * plotH;
  const path = gapCurve.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.km).toFixed(1)},${y(p.gapSeconds).toFixed(1)}`).join(" ");
  return (
    <div className="mt-3">
      <p className="text-cz-3 text-3xs uppercase tracking-wider font-semibold mb-1">{t("detail.film.gapCurveTitle")}</p>
      <svg viewBox={`0 0 ${CURVE_WIDTH} ${CURVE_HEIGHT}`} className="block w-full h-auto" role="img" aria-label={t("detail.film.gapCurveTitle")}>
        <line x1={0} y1={CURVE_PAD_T + plotH} x2={CURVE_WIDTH} y2={CURVE_PAD_T + plotH} stroke="var(--border)" strokeWidth="1" />
        <path d={path} fill="none" stroke="var(--text-2)" strokeWidth="1.75" />
        <line x1={x(scrubKm)} y1={CURVE_PAD_T} x2={x(scrubKm)} y2={CURVE_PAD_T + plotH} stroke="var(--accent)" strokeWidth="1.5" strokeDasharray="2,2" />
      </svg>
    </div>
  );
}

function AnimatedFilm({ built, distanceKm, riderNameById, teamNameById, t }) {
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
      <ScrubberGraphic built={built} scrubKm={scrubKm} distanceKm={distanceKm} t={t} />
      <input
        type="range"
        min={0}
        max={distanceKm || 0}
        step={0.1}
        value={scrubKm}
        onChange={handleScrub}
        aria-label={t("detail.film.scrubberLabel")}
        className="w-full cursor-pointer accent-cz-accent -mt-2"
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
      <GapCurve gapCurve={built.gapCurve} distanceKm={distanceKm} scrubKm={scrubKm} t={t} />
    </>
  );
}

function StaticFilm({ built, distanceKm, riderNameById, teamNameById, t }) {
  return (
    <>
      <EventFeed events={built.feedEvents} riderNameById={riderNameById} teamNameById={teamNameById} emptyKey="detail.film.feedEmpty" t={t} />
      <GapCurve gapCurve={built.gapCurve} distanceKm={distanceKm} scrubKm={distanceKm} t={t} />
    </>
  );
}

export default function TimelineFilmPlayer({ open, onClose, timeline, distanceKm, riderNameById, teamNameById, stageLabel }) {
  const { t } = useTranslation("races");
  const built = buildFilmTimeline({ events: timeline?.events, distanceKm });
  const resolvedDistanceKm = distanceKm ?? built.distanceKm ?? 0;
  // window.matchMedia er ikke reaktiv her — samme konvention som FinalKilometre-
  // Playback/CountdownRing (et OS-skift midt i en session tolereres).
  const reducedMotion = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  return (
    <Modal open={open} onClose={onClose} title={t("detail.film.title")} description={stageLabel} size="xl" closeLabel={t("common:actions.close")}>
      {reducedMotion ? (
        <StaticFilm built={built} distanceKm={resolvedDistanceKm} riderNameById={riderNameById} teamNameById={teamNameById} t={t} />
      ) : (
        <AnimatedFilm built={built} distanceKm={resolvedDistanceKm} riderNameById={riderNameById} teamNameById={teamNameById} t={t} />
      )}
    </Modal>
  );
}
