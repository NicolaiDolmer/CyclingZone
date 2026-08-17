// #3859 (bølge 2 — mockup-kontrakt godkendt 17/8): "The story of the stage" —
// 3-5 kuraterede nøgle-events for en KØRT etape + gold "Watch the race film"-
// knap der åbner løbsfilm-afspilleren. Placeres på RaceDetailPage's etape-fane
// (kun etaper med resultater — se caller). Gater selv på at tidslinje-data
// findes (spec §2.4's 404-degradering, useStageTimeline.js) — renderer INTET
// for løb uden tidslinje (S3-forward-only, spec §4 valg 3A: ældre løb får
// aldrig en opfundet film).
//
// TimelineFilmPlayer er LAZY-loaded (React.lazy + eget chunk, samme mønster som
// Layout.jsx's FeedbackModal) — kun hentet når "Watch the race film" klikkes,
// så bundle-vagtens ~6 KB luft holder uanset hvor mange der besøger etape-fanen.
import { lazy, Suspense, useState } from "react";
import { useTranslation } from "react-i18next";
import { Section, SectionHeader, Button, PlayIcon } from "../ui";
import { formatNumber } from "../../lib/intl.js";
import { useStageTimeline } from "../../hooks/useStageTimeline.js";
import { selectStoryEvents } from "../../lib/stageTimelineStory.js";
import { describeEvent } from "../../lib/stageTimelineFilm.js";

const TimelineFilmPlayer = lazy(() => import("./TimelineFilmPlayer.jsx"));

function StoryRow({ event, riderNameById, teamNameById, t }) {
  const described = describeEvent(event, { riderNameById, teamNameById });
  if (!described) return null;
  return (
    <li className="flex items-baseline gap-3 py-1.5 border-t border-cz-border first:border-t-0">
      <span className="font-data text-2xs text-cz-3 tabular-nums shrink-0 w-14">
        {t("detail.film.km", { value: formatNumber(event.km) })}
      </span>
      <span className="text-cz-1 text-sm leading-snug">
        {t(`detail.film.event.${described.key}`, described.params)}
      </span>
    </li>
  );
}

export default function StoryOfTheStageSection({ raceId, stageNumber, distanceKm, riderNameById, teamNameById, stageLabel }) {
  const { t } = useTranslation("races");
  const { timeline } = useStageTimeline(raceId, stageNumber);
  const [playerOpen, setPlayerOpen] = useState(false);

  if (!timeline?.events?.length) return null;
  const story = selectStoryEvents(timeline.events);
  if (!story.length) return null;

  return (
    <Section>
      <SectionHeader title={t("detail.film.storyTitle")} />
      <ul>
        {story.map((event, i) => (
          <StoryRow key={`${event.type}-${event.km}-${i}`} event={event} riderNameById={riderNameById} teamNameById={teamNameById} t={t} />
        ))}
      </ul>
      <div className="mt-3 flex justify-end">
        <Button size="sm" variant="primary" iconLeft={<PlayIcon size={14} aria-hidden="true" />} onClick={() => setPlayerOpen(true)}>
          {t("detail.film.watchButton")}
        </Button>
      </div>
      {playerOpen && (
        <Suspense fallback={null}>
          <TimelineFilmPlayer
            open={playerOpen}
            onClose={() => setPlayerOpen(false)}
            timeline={timeline}
            distanceKm={distanceKm}
            riderNameById={riderNameById}
            teamNameById={teamNameById}
            stageLabel={stageLabel}
          />
        </Suspense>
      )}
    </Section>
  );
}
