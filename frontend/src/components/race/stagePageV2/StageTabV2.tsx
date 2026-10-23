// #6570 · Etape-fanen: fase-styret (ejer 14/10).
//   FOER etapen: profil farvet efter stigning, terraen/afslutning (+ underlag
//     kun naar det ikke er asfalt), stigningerne km-for-km, "The day demands",
//     din opstilling med route fit, favoritter, og EN guld-knap til taktikken.
//   EFTER etapen: "Your day" oeverst, saa profilen som et smalt baand.
import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { formatNumber } from "../../../lib/intl.js";
import { profileLabelKey, finaleLabelKey } from "../../../lib/stageProfileConfig.js";
import {
  dayDemands, elevationSeries, favouritesFor, lineupFor, sortedClimbs, surfaceOf,
  type ResultRow, type RoleOverride, type RoleRider, type StageProfile,
} from "./stagePageV2Model.ts";
import StageProfileV2, { GradientLegend } from "./StageProfileV2.tsx";
import ClimbCard from "./ClimbCard.tsx";
import YourDayCard, { type CareerEvent } from "./YourDayCard.tsx";
import RaceStoryCard from "./RaceStoryCard.tsx";
import { castFrom, type RaceStory } from "./raceStoryModel.ts";
import { stageWeather, type StageWeather } from "./stageWeather.ts";
import { WeatherTag } from "./WeatherTag.tsx";
import { Button, Flag, RiderLink, Section, SectionHeader, SectionStack, SkeletonLines, TerrainTypeGlyph } from "./ui.ts";

function FitBar({ fit }: { fit: number }) {
  const { t } = useTranslation("races");
  const on = Math.round(fit / 10);
  return (
    <span className="flex flex-none items-center gap-2" role="img" aria-label={t("stagePageV2.lineup.fitAria", { fit })}>
      <span className="grid w-[70px] grid-cols-10 gap-[2px]" aria-hidden="true">
        {Array.from({ length: 10 }, (_, i) => (
          <i key={i} className={`block h-[7px] rounded-sm ${i < on ? "bg-cz-1" : "bg-cz-subtle"}`} />
        ))}
      </span>
      <span className="w-6 text-right font-data text-xs tabular-nums text-cz-1">{fit}</span>
    </span>
  );
}

function ProfileCard({ profile, stageLabel, band, selectedClimb, onSelectClimb, bare = false, weather = null }: { profile: StageProfile; stageLabel: string; band: boolean; selectedClimb: number; onSelectClimb: (i: number) => void; bare?: boolean; weather?: StageWeather | null }) {
  const { t } = useTranslation("races");
  const series = useMemo(() => elevationSeries(profile), [profile]);
  const climbs = useMemo(() => sortedClimbs(profile), [profile]);
  const terrainKey = profileLabelKey(profile.profile_type);
  const finaleKey = finaleLabelKey(profile.finale_type);
  const surface = surfaceOf(profile);
  const axes: Array<[string, ReactNode]> = [];
  if (terrainKey) axes.push([t("stagePageV2.axes.terrain"), <TerrainTypeGlyph profileType={profile.profile_type} size={18} showLabel labelClassName="" className="gap-1.5" />]);
  if (finaleKey) axes.push([t("stagePageV2.axes.finish"), t(`detail.${finaleKey}`)]);
  if (surface) axes.push([t("stagePageV2.axes.surface"), t("stagePageV2.axes.surfaceValue", { kind: surface.kind, count: surface.count, km: formatNumber(surface.km) })]);
  if (weather) axes.push([t("stagePageV2.axes.weather"), <WeatherTag weather={weather} />]);
  const sprint = (profile.sprints ?? []).find((s) => s.kind === "intermediate");

  const stats = t("stagePageV2.profile.stats", {
    km: formatNumber(Math.round(Number(profile.distance_km) || 0)),
    gain: formatNumber(Math.round(Number(profile.elevation_gain_m) || 0)),
    climbs: climbs.length,
  });
  const body = (
    <>
      {bare && <p className="m-0 mb-3 font-data text-xs tabular-nums text-cz-3">{stats}</p>}
      {!band && axes.length > 0 && (
        <dl className="mb-3 flex flex-wrap gap-2">
          {axes.map(([label, value]) => (
            <div key={label} className="flex min-w-24 flex-col rounded-cz border border-cz-border px-2.5 py-1.5">
              <dt className="font-data text-3xs font-semibold uppercase tracking-[.12em] text-cz-3">{label}</dt>
              <dd className="m-0 font-data text-sm font-semibold text-cz-1">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {series
        ? <StageProfileV2 profile={profile} series={series} climbs={climbs} selectedClimb={band ? null : selectedClimb} onSelectClimb={onSelectClimb} band={band} />
        : null}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <GradientLegend />
        {sprint && <span className="ml-auto font-data text-2xs tabular-nums text-cz-3">{t("stagePageV2.profile.sprint", { km: formatNumber(Math.round(Number(sprint.km))) })}</span>}
      </div>
      {series?.source === "synthetic" && !band && <p className="m-0 mt-2 text-xs text-cz-3">{t("stagePageV2.profile.drawn")}</p>}
    </>
  );
  // #6570: "The route" i loebshistoriens kort er samme profil uden egen ramme.
  if (bare) return body;

  return (
    <Section aria-label={stageLabel}>
      <SectionHeader title={stageLabel} meta={stats} />
      {body}
    </Section>
  );
}

export interface StageTabV2Props {
  stageNumber: number;
  stagesCompleted: number;
  isStageRace: boolean;
  phase: "before" | "after";
  profile: StageProfile | null;
  results: ResultRow[];
  stagePointRows: ResultRow[];
  stageLoaded: boolean;
  /** Erstatter "Your day" naar etapens resultater ikke kunne hentes (#6570). */
  stageErrorSlot: ReactNode;
  myTeamId: string | null;
  stageRoles: null | false | { riders?: RoleRider[]; overrides?: RoleOverride[] };
  careerEvents: CareerEvent[];
  tacticsAction: { label: string; onClick: () => void } | null;
  onOpenStandings: () => void;
  emptyState: ReactNode;
  /** #6570 spor 2: loebshistorien fra loebsloggen; null = ingen (nuvaerende visning). */
  story?: RaceStory | null;
}

export default function StageTabV2({
  stageNumber, stagesCompleted, isStageRace, phase, profile, results, stagePointRows, stageLoaded, stageErrorSlot, myTeamId,
  stageRoles, careerEvents, tacticsAction, onOpenStandings, emptyState, story = null,
}: StageTabV2Props) {
  const { t } = useTranslation("races");
  const [selectedClimb, setSelectedClimb] = useState<number>(() => Math.max(0, sortedClimbs(profile).length - 1));
  const climbs = useMemo(() => sortedClimbs(profile), [profile]);
  const series = useMemo(() => elevationSeries(profile), [profile]);
  const stageLabel = isStageRace ? t("stagePageV2.profile.title", { number: stageNumber }) : t("stagePageV2.profile.titleOneDay");
  const riders = useMemo(() => (stageRoles ? stageRoles.riders ?? [] : []), [stageRoles]);
  const overrides = stageRoles ? stageRoles.overrides ?? [] : [];
  const lineup = lineupFor(riders, overrides, stageNumber);
  const favourites = favouritesFor(results, stagePointRows, stageNumber, myTeamId, stagesCompleted);
  const fitById = new Map(lineup.map((r) => [r.riderId, r.fit]));
  const demands = dayDemands(profile?.demand_vector);
  const climbIndex = Math.min(selectedClimb, Math.max(0, climbs.length - 1));
  const cast = useMemo(() => castFrom(results, riders, stageNumber, myTeamId), [results, riders, stageNumber, myTeamId]);
  const weather = stageWeather(profile, phase, story);

  if (phase === "after") {
    return (
      <SectionStack>
        {stageErrorSlot ?? (
          <YourDayCard
            results={results}
            stageNumber={stageNumber}
            isStageRace={isStageRace}
            loaded={stageLoaded}
            myTeamId={myTeamId}
            careerEvents={careerEvents}
            primaryAction={tacticsAction}
            onOpenStandings={onOpenStandings}
          />
        )}
        {story ? (
          <RaceStoryCard
            story={story}
            profile={profile}
            series={series}
            climbs={climbs}
            cast={cast}
            oneDay={!isStageRace}
            title={isStageRace ? t("stagePageV2.story.title", { number: stageNumber }) : t("stagePageV2.story.titleOneDay")}
            hudLabel={isStageRace ? t("stagePageV2.stripStage", { number: stageNumber }) : t("stagePageV2.story.hudOneDay")}
            weather={weather}
            routeBody={profile && series ? <ProfileCard profile={profile} stageLabel={stageLabel} band={false} selectedClimb={climbIndex} onSelectClimb={setSelectedClimb} bare weather={weather} /> : null}
            onOpenStandings={onOpenStandings}
          />
        ) : profile && series && <ProfileCard profile={profile} stageLabel={stageLabel} band selectedClimb={climbIndex} onSelectClimb={setSelectedClimb} />}
      </SectionStack>
    );
  }

  if (!profile) return <>{emptyState}</>;

  return (
    <SectionStack>
      <ProfileCard profile={profile} stageLabel={stageLabel} band={false} selectedClimb={climbIndex} onSelectClimb={setSelectedClimb} weather={weather} />
      <div className="grid grid-cols-1 items-start gap-[14px] lg:grid-cols-[1.35fr_1fr]">
        <SectionStack>
          <ClimbCard profile={profile} series={series} climbs={climbs} selected={climbIndex} onSelect={setSelectedClimb} />
        </SectionStack>
        <SectionStack>
          {demands.length > 0 && (
            <Section aria-label={t("stagePageV2.demands.title")}>
              <SectionHeader title={t("stagePageV2.demands.title")} />
              <dl className="m-0 grid grid-cols-[1fr_auto]">
                {demands.map((d) => (
                  <div key={d.ability} className="contents">
                    <dt className="border-t border-cz-border py-2 text-sm font-semibold text-cz-1">{t(`detail.ability.${d.ability}`)}</dt>
                    <dd className={`m-0 border-t border-cz-border py-2 text-right font-data text-2xs font-bold uppercase tracking-[.08em] ${d.level === "decides" ? "text-cz-1" : d.level === "matters" ? "text-cz-2" : "text-cz-3"}`}>
                      {t(`stagePageV2.demands.${d.level}`)}
                    </dd>
                  </div>
                ))}
              </dl>
            </Section>
          )}
          <Section aria-label={t("stagePageV2.lineup.title")}>
            <SectionHeader title={t("stagePageV2.lineup.title")} meta={t("stagePageV2.lineup.fit")} />
            {stageRoles === null && <SkeletonLines lines={4} />}
            {stageRoles === false && <p className="text-xs text-cz-3">{t("racePage.team.loadError")}</p>}
            {stageRoles && !lineup.length && <p className="text-sm text-cz-3">{t("stagePageV2.lineup.empty")}</p>}
            {lineup.length > 0 && (
              <ul className="mb-3">
                {lineup.map((r) => (
                  <li key={r.riderId} className="flex min-h-11 items-center gap-2.5 border-t border-cz-border px-1 py-1.5">
                    <span className="flex min-w-0 flex-1 flex-col">
                      <RiderLink id={r.riderId} className="truncate text-sm font-semibold text-cz-1 hover:text-cz-accent-t">{r.name}</RiderLink>
                      {r.role && <span className="truncate text-2xs text-cz-3">{t(`tacticsOrders.roleLabel.${r.role}`)}</span>}
                    </span>
                    {r.fit !== null ? <FitBar fit={r.fit} /> : <span className="w-[102px] flex-none text-right font-data text-xs text-cz-3">-</span>}
                  </li>
                ))}
              </ul>
            )}
            {tacticsAction && (
              <Button variant="primary" size="md" className="w-full sm:w-auto" onClick={tacticsAction.onClick}>{tacticsAction.label}</Button>
            )}
          </Section>
          {favourites.length > 0 && (
            <Section aria-label={t("stagePageV2.favourites.title")}>
              <SectionHeader title={t("stagePageV2.favourites.title")} />
              <ul>
                {favourites.map((f, i) => {
                  const fit = f.mine ? fitById.get(f.riderId) ?? null : null;
                  return (
                    <li key={f.riderId} className={`flex min-h-11 items-center gap-2.5 border-t border-cz-border px-1 py-1.5 ${f.mine ? "bg-cz-subtle" : ""}`}>
                      <span className="w-4 flex-none font-data text-xs tabular-nums text-cz-3">{i + 1}</span>
                      {f.nation && <Flag code={f.nation} className="flex-none" />}
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="flex min-w-0 items-center gap-2">
                          <RiderLink id={f.riderId} className="truncate text-sm font-semibold text-cz-1 hover:text-cz-accent-t">{f.name}</RiderLink>
                          {f.mine && <span className="flex-none rounded-sm bg-cz-1 px-1.5 py-0.5 font-data text-3xs font-bold uppercase tracking-[.08em] text-cz-body">{t("stagePageV2.favourites.you")}</span>}
                        </span>
                        <span className="text-2xs text-cz-2">
                          {f.reasons.map((r) => t(`stagePageV2.favourites.${r.key}`, r.params)).join(" · ")}
                        </span>
                      </span>
                      {fit !== null && <span className="flex-none font-data text-xs tabular-nums text-cz-1">{fit}</span>}
                    </li>
                  );
                })}
              </ul>
              <p className="m-0 border-t border-cz-border pt-2.5 text-xs text-cz-3">{t("stagePageV2.favourites.foot")}</p>
            </Section>
          )}
        </SectionStack>
      </div>
    </SectionStack>
  );
}
