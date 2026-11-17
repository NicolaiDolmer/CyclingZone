// #8383 · Under løbsfilmen og referatet i Historie (ejer 17/11, #8275 runde 5 punkt 13 = A):
// det den gamle etapeside havde, i dens rækkefølge og med dens egne dele.
//   Din dag-sætningen  - YourDayCards linje ("X won ahead of Y. Your best was ...")
//   Vejret             - WeatherTag + vejrsætningen (RaceStoryCard)
//   Mellemtider        - SplitTable (RaceStoryCard)
//   Referat-afsnittet  - buildReport (RaceStoryCard)
//   Tabt tid           - ownTimeLoss + LossRow ("Where your riders lost time")
//   Kildelinjen        - "Every time, gap and sentence ..."
// En enkeltstart har ingen mellemtider eller referat; dér står dagens sætninger (#7725).
// Spoiler-reglen 7/11 bor i v6StoryExtrasModel.ts.
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { withTimeLimitFatigue } from "../../../lib/raceRecap.js";
import { filmKmValue } from "../../../lib/stageTimelineKmSpan.ts";
import { LossRow } from "../StageSplitTimes.jsx";
import { SplitTable } from "../stagePageV2/RaceStoryCard.tsx";
import {
  buildReport, castNames, dayWordSentences, myBestRider, ownOutSentences, ownTimeLoss, reportTextKey, splitRows,
  type Cast, type RaceStory, type StoryLine, type StoryNarrativeContext,
} from "../stagePageV2/raceStoryModel.ts";
import type { DnfRowInput, ResultRow, StageProfile } from "../stagePageV2/stagePageV2Model.ts";
import { stageWeather } from "../stagePageV2/stageWeather.ts";
import { useStoryText } from "../stagePageV2/storyText.ts";
import { Section } from "../stagePageV2/ui.ts";
import { WeatherTag, weatherSentenceKey } from "../stagePageV2/WeatherTag.tsx";
import { useSpoilerStory } from "../../spoiler/spoilerStoryContext.ts";
import { v6DaySentences, v6ExtrasView, v6ResultsSeen } from "./v6StoryExtrasModel.ts";

/** Filmens position og det filmen allerede har regnet ud (V6RaceFilm). */
export interface V6FilmPosition {
  km: number;
  distanceKm: number;
  /** Referatets linjer (curateMoments), som referat-afsnittet bygger på. */
  lines: StoryLine[];
  timeTrial: boolean;
}

export interface V6StoryExtrasProps extends V6FilmPosition {
  raceId: string | null;
  story: RaceStory;
  cast: Cast;
  narrative: StoryNarrativeContext;
  profile: StageProfile | null;
  results: ResultRow[];
  stageNumber: number;
  isStageRace: boolean;
  myTeamId: string | null;
  dnfRows: DnfRowInput[];
}

const SUBHEAD = "m-0 mb-1 font-data text-3xs font-semibold uppercase tracking-[.16em] text-cz-3";

export default function V6StoryExtras({
  km, distanceKm, lines, timeTrial, raceId, story, cast, narrative, profile, results, stageNumber, isStageRace, myTeamId, dnfRows,
}: V6StoryExtrasProps) {
  const { t } = useTranslation("races");
  const text = useStoryText(cast);
  const spoiler = useSpoilerStory();
  const events = narrative.events;
  // #7701: egne udgåede som referat-sætninger, tidsgrænse-ryttere med træthed som årsag (som StageTabV2).
  const outRows = useMemo<DnfRowInput[]>(() => withTimeLimitFatigue(dnfRows, events), [dnfRows, events]);
  const ownOut = useMemo(() => ownOutSentences(outRows, myTeamId, cast), [outRows, myTeamId, cast]);
  const dayWords = useMemo(() => dayWordSentences(events, cast), [events, cast]);
  const me = useMemo(() => myBestRider(story, cast), [story, cast]);
  const allRows = useMemo(() => (timeTrial ? [] : splitRows(story, me)), [timeTrial, story, me]);
  const report = useMemo(() => (timeTrial ? [] : buildReport(story, lines, cast, ownOut, dayWords)), [timeTrial, story, lines, cast, ownOut, dayWords]);
  const loss = useMemo(() => ownTimeLoss(story, cast, narrative), [story, cast, narrative]);
  const daySentences = useMemo(
    () => v6DaySentences({ results, stageNumber, isStageRace, myTeamId, dnfRows: outRows }),
    [results, stageNumber, isStageRace, myTeamId, outRows],
  );
  const weather = stageWeather(profile, "after", story);
  const weatherSentence = weatherSentenceKey(weather);

  const view = v6ExtrasView({ km, distanceKm, spoilerActive: spoiler.active, resultsSeen: v6ResultsSeen(raceId, stageNumber), splitRows: allRows });
  const dayLine = view.day && daySentences.length > 0 ? daySentences.map((s) => t(s.key, s.params)).join(" ") : null;
  const ttWords = timeTrial && view.full && dayWords.length > 0 ? dayWords.map((s) => t(reportTextKey(s.key), s.params)).join(" ") : null;
  const showSplits = !timeTrial && (view.rows.length > 0 || (view.full && allRows.length === 0));
  const showReport = view.full && report.length > 0;
  const showLoss = view.full && !timeTrial && (loss.entries.length > 0 || Boolean(loss.unknown));
  const right = showReport || showLoss || (view.full && !timeTrial);
  if (!dayLine && !weather && !ttWords && !showSplits && !right) return null;

  const title = isStageRace ? t("stagePageV2.story.title", { number: stageNumber }) : t("stagePageV2.story.titleOneDay");
  return (
    <div data-race-section="story_extras" className="mt-[14px]"><Section aria-label={title}>
      {dayLine && <p data-story-extra="day" className="m-0 mb-3 max-w-[72ch] text-[15px] leading-relaxed text-cz-1">{dayLine}</p>}
      {weather && (
        <p data-story-extra="weather" className="m-0 mb-3 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-cz-2">
          <WeatherTag weather={weather} className="font-data font-semibold text-cz-1" />
          {weatherSentence && <span>{t(weatherSentence)}</span>}
        </p>
      )}
      {ttWords && <p data-story-extra="time-trial" className="m-0 mb-3 max-w-[72ch] text-[15px] leading-relaxed text-cz-1">{ttWords}</p>}
      {(showSplits || right) && (
        <div className={`grid grid-cols-1 gap-6 @4xl:grid-cols-[minmax(0,1fr)_minmax(320px,400px)] ${dayLine || weather || ttWords ? "border-t border-cz-border pt-4" : ""}`}>
          {showSplits && (
            <div data-story-extra="splits" className="min-w-0">
              <h3 className={SUBHEAD}>{t("stagePageV2.story.splits.title")}</h3>
              <SplitTable rows={view.rows} cast={cast} me={me} precise={story.precise_times} />
            </div>
          )}
          {right && (
            <div className="flex min-w-0 flex-col gap-4">
              {showReport && (
                <div data-race-section="report">
                  <h3 className={SUBHEAD}>{t("stagePageV2.story.report.title")}</h3>
                  <p className="m-0 max-w-[72ch] text-[15px] leading-relaxed text-cz-1">
                    {report.map((s) => t(reportTextKey(s.key), s.params)).join(" ")}
                  </p>
                </div>
              )}
              {showLoss && (
                <div data-story-extra="loss">
                  <h3 className={SUBHEAD}>{t("detail.film.split.lossTitle")}</h3>
                  <ul className="m-0 list-none p-0">
                    {loss.entries.map((entry, i) => (
                      <LossRow key={`${entry.riderId}-${entry.km}-${i}`} entry={entry} kmLabel={filmKmValue(entry.shown, text.km)} riderNameById={castNames(cast)} teamNameById={narrative.teamNameById} t={t} />
                    ))}
                    {loss.unknown && <li className="border-t border-cz-border py-1.5 text-sm leading-snug text-cz-1 first:border-t-0">{t("stagePageV2.story.lossUnknown", { names: loss.unknown })}</li>}
                  </ul>
                </div>
              )}
              <p className="m-0 font-data text-2xs text-cz-3">{t("stagePageV2.story.source")}</p>
            </div>
          )}
        </div>
      )}
    </Section></div>
  );
}
