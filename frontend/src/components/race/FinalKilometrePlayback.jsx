// #3396 (bølge 1 — "The Final Kilometre"): 90s finale-afspilning af de sidste
// ~3 km, øverst på RaceDetailPage. Bygget UDELUKKENDE af rækker siden allerede
// har hentet (race_results + race_stage_moments) — ingen nye kald, ingen
// engine-writes. Ren afledningslogik bor i lib/finalKilometre.js (testet der);
// denne komponent er kun tidsstyring + rendering.
//
// prefers-reduced-motion (spec A6, hard krav — samme mønster som CountdownRing/
// useFlipRows): viser det statiske slutbillede uden nedtælling/animation.
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import RiderLink from "../RiderLink";
import { Flag } from "../Flag";
import { Section, SectionHeader, Button, FlagIcon, RefreshIcon } from "../ui";
import { buildFinalKilometrePlayback, countdownAt } from "../../lib/finalKilometre.js";

function formatDistance(m, t) {
  if (m >= 1000) return t("detail.finalKm.distanceKm", { value: (m / 1000).toFixed(1) });
  return t("detail.finalKm.distanceM", { value: m });
}

// Ét klikket-i-mål-rytterrække — .cz-overlay-pop (index.css) er den ALLEREDE
// godkendte fade/pop-reveal (ingen ny CSS); den spiller kun af når rækken
// mountes (React key = rider.id), aldrig ved re-render af allerede-viste rækker.
function ArrivalRow({ rider, t }) {
  return (
    <li className="cz-overlay-pop flex items-baseline justify-between gap-3 py-1.5 border-t border-cz-border first:border-t-0">
      <span className="flex items-baseline gap-2 min-w-0">
        <span className="font-data text-xs text-cz-3 w-5 shrink-0 tabular-nums">{rider.rank}</span>
        <RiderLink id={rider.riderId} className="text-cz-1 font-medium hover:text-cz-accent-t transition-colors truncate">
          {rider.nationality && <Flag code={rider.nationality} className="me-1" />}
          {rider.name}
        </RiderLink>
        {rider.photoFinish && (
          <span className="cz-chip-pulse shrink-0 inline-flex items-center rounded-full border border-cz-accent/40 bg-cz-accent/10 px-1.5 py-0.5 text-3xs font-semibold uppercase tracking-wide text-cz-accent-t">
            {t("detail.finalKm.photoFinish")}
          </span>
        )}
      </span>
      <span className="font-data text-xs text-cz-2 tabular-nums whitespace-nowrap shrink-0">{rider.gapLabel || ""}</span>
    </li>
  );
}

function ResultsList({ riders, overflowCount, t }) {
  if (!riders.length) return null;
  return (
    <ul className="mt-1">
      {riders.map((r) => <ArrivalRow key={r.id} rider={r} t={t} />)}
      {overflowCount > 0 && (
        <li className="pt-1.5 text-2xs text-cz-3">{t("detail.finalKm.moreFinishers", { count: overflowCount })}</li>
      )}
    </ul>
  );
}

function WinBadge({ winType, t }) {
  if (!winType) return null;
  return (
    <span className="font-data text-2xs uppercase tracking-[.08em] text-cz-3">
      {t(`detail.finalKm.winType.${winType}`)}
    </span>
  );
}

// Ren timing-hook: elapsed ms siden mount, rAF-drevet, throttlet til ~10 opdateringer/sek.
// Stopper loopet ved totalMs (ingen unødige re-renders efter afspilningen er slut).
function useElapsedMs(totalMs) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    let raf;
    let last = 0;
    const start = performance.now();
    const tick = (now) => {
      const e = now - start;
      if (e - last >= 90 || e >= totalMs) {
        last = e;
        setElapsed(Math.min(e, totalMs));
      }
      if (e < totalMs) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [totalMs]);
  return elapsed;
}

function AnimatedPlayback({ playback, t }) {
  const elapsed = useElapsedMs(playback.totalDurationMs);
  // Bevidst IKKE `Math.max(0, elapsed - countdownMs)` — det ville klampe til 0
  // under HELE nedtællingen, og vinderens atMs=0 ville matche `<= 0` med det
  // samme (rytteren "ankom" ved t=0). Kun når vi rent faktisk ER i ankomst-
  // fasen tæller ryttere som ankommet.
  const inArrivals = elapsed >= playback.countdownMs;
  const arrivalsElapsed = inArrivals ? elapsed - playback.countdownMs : -1;
  const arrived = inArrivals ? playback.riders.filter((r) => r.atMs <= arrivalsElapsed) : [];
  const complete = arrived.length === playback.riders.length;
  const winnerIn = arrived.length > 0;
  const { distanceM, secondsToGo } = countdownAt(elapsed, playback.countdownMs, playback.countdownStartM);

  return (
    <>
      <div className="text-center py-3">
        {!winnerIn ? (
          <>
            <div className="font-display text-[52px] sm:text-[68px] leading-none tabular-nums text-cz-1">
              {formatDistance(distanceM, t)}
            </div>
            <div className="font-data text-2xs uppercase tracking-[.12em] text-cz-3 mt-1">
              {t("detail.finalKm.secondsToGo", { count: secondsToGo })}
            </div>
          </>
        ) : (
          <div className="cz-overlay-pop font-display text-[36px] sm:text-[48px] leading-none uppercase text-cz-accent-t">
            {t("detail.finalKm.finishLine")}
          </div>
        )}
      </div>
      <ResultsList riders={arrived} overflowCount={complete ? playback.overflowCount : 0} t={t} />
    </>
  );
}

export default function FinalKilometrePlayback({ rows, moments, stageNumber, stageLabel }) {
  const { t } = useTranslation("races");
  const playback = useMemo(
    () => buildFinalKilometrePlayback({ rows, moments, stageNumber }),
    [rows, moments, stageNumber],
  );
  const [playId, setPlayId] = useState(0);
  // window.matchMedia er ikke reaktiv her (samme konvention som CountdownRing/
  // useFlipRows) — et skift af OS-indstillingen midt i en session er sjældent
  // nok til at et re-mount (fanebladsskift/replay) er acceptabelt.
  const reducedMotion = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  if (!playback.available) return null;

  return (
    <Section>
      <SectionHeader
        title={
          <span className="inline-flex items-center gap-2">
            <FlagIcon size={14} className="text-cz-3" aria-hidden="true" />
            {t("detail.finalKm.title")}
          </span>
        }
        meta={stageLabel}
      />
      {(playback.breakawayBeat || playback.winType) && (
        <p className="text-cz-2 text-sm leading-relaxed flex items-center gap-2 flex-wrap">
          {playback.breakawayBeat && (
            <span>{t(`detail.recap.${playback.breakawayBeat.key}`, { count: playback.breakawayBeat.count })}</span>
          )}
          <WinBadge winType={playback.winType} t={t} />
        </p>
      )}

      {reducedMotion ? (
        <ResultsList riders={playback.riders} overflowCount={playback.overflowCount} t={t} />
      ) : (
        <>
          <AnimatedPlayback key={playId} playback={playback} t={t} />
          <div className="mt-3 flex justify-end">
            <Button
              size="sm"
              variant="secondary"
              iconLeft={<RefreshIcon size={14} aria-hidden="true" />}
              onClick={() => setPlayId((n) => n + 1)}
            >
              {t("detail.finalKm.replay")}
            </Button>
          </div>
        </>
      )}
    </Section>
  );
}
