// #7535 · Ruteprofilen i planlaegningssiden, som wireframet (ejervalg 16/11, punkt 4 D): én etape-linje
// (pile, "Etape 1 af 5", etapens type, km og hoejdemeter, prikker og "Skjul profil") og derunder ÉN stor
// profil. Profilen er loebssidens egen tegning: etape-fanens StageProfileV2 med hoejdeakse og navngivne
// stigninger, naar etapen har en hoejdeserie; ellers loebssidens kompakte kort. Ingen ny tegning.
// Aabner altid paa etape 1. "Skjul profil" folder den til etape-linjen, og valget huskes af siden for alle
// loeb (ogsaa naeste gang siden aabnes).
//
// #8419 punkt 8 (ejer 26/11, "should be available everywhere theres a stage profile"): under profilen staar
// loebssidens finaledetaljer: terraen, afslutning og den valgte stigning (laengde, stigningsprocent og km
// til maal), med loebssidens egne tekster. Den sidste stigning er valgt som paa loebssiden; et klik paa en
// anden stigning i profilen viser dens tal. I et etapeloeb foelger profilen Match-vaelgerens etape.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  SkeletonLines,
  StageProfileCard,
  LegacyStageProfileCard,
  TerrainTypeGlyph,
  hasRouteData,
} from "./primitives.ts";
import StageProfileV2 from "../race/stagePageV2/StageProfileV2.tsx";
import { climbDetail, elevationSeries, sortedClimbs, type Climb, type ElevationSeries, type StageProfile } from "../race/stagePageV2/stagePageV2Model.ts";
import { finaleLabelKey } from "../../lib/stageProfileConfig.js";
import { formatNumber } from "../../lib/intl.js";

interface StageProfileRow {
  stage_number?: number | null;
  profile_type?: string | null;
  distance_km?: number | null;
  elevation_gain_m?: number | null;
  [key: string]: unknown;
}

const one = (v: number) => formatNumber(Math.round(v * 10) / 10, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/**
 * Finaledetaljerne under profilen (punkt 8): terraen, afslutning og den valgte stigning med laengde,
 * stigningsprocent og km til maal. Loebssidens egne tekster (races-navnerummet), ingen ny tegning.
 */
function FinaleFacts({ profile, series, climb }: { profile: StageProfile; series: ElevationSeries | null; climb: Climb | null }) {
  const { t } = useTranslation("races");
  const finaleKey = finaleLabelKey(profile.finale_type) as string | null;
  const detail = climb ? climbDetail(profile, series, climb) : null;
  const facts: Array<[string, ReactNode]> = [];
  if (profile.profile_type) {
    facts.push([t("stagePageV2.axes.terrain"), <TerrainTypeGlyph profileType={profile.profile_type} size={14} showLabel labelClassName="" className="gap-1.5" />]);
  }
  if (finaleKey) facts.push([t("stagePageV2.axes.finish"), t(`detail.${finaleKey}`)]);
  if (climb && detail) {
    facts.push([t("stagePageV2.climbs.length"), `${one(Number(climb.length_km))} km`]);
    facts.push([t("stagePageV2.climbs.average"), `${one(Number(climb.avg_gradient))} %`]);
    facts.push([t("stagePageV2.climbs.toFinish"), `${formatNumber(detail.kmToGo)} km`]);
  }
  if (!facts.length) return null;
  return (
    <div className="mt-2.5" data-testid="planning-finale-facts">
      {climb?.name && <p className="mb-1.5 text-xs font-semibold text-cz-1">{climb.name}</p>}
      <dl className="flex flex-wrap gap-2">
        {facts.map(([label, value]) => (
          <div key={label} className="flex min-w-24 flex-col rounded-cz border border-cz-border px-2.5 py-1.5">
            <dt className="text-2xs text-cz-3">{label}</dt>
            <dd className="m-0 font-data text-[13px] font-semibold tabular-nums text-cz-1">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Den store profil for én etape (etape-fanens tegning), med den sidste stigning valgt som dér. */
function BigProfile({ profile }: { profile: StageProfile }) {
  const series = useMemo(() => elevationSeries(profile), [profile]);
  const climbs = useMemo(() => sortedClimbs(profile), [profile]);
  const [selectedClimb, setSelectedClimb] = useState(() => Math.max(0, climbs.length - 1));
  useEffect(() => setSelectedClimb(Math.max(0, climbs.length - 1)), [climbs]);
  if (!series) return null;
  const index = Math.min(selectedClimb, Math.max(0, climbs.length - 1));
  return (
    <div data-testid="planning-big-profile">
      <StageProfileV2 profile={profile} series={series} climbs={climbs} selectedClimb={index} onSelectClimb={setSelectedClimb} />
      <FinaleFacts profile={profile} series={series} climb={climbs[index] ?? null} />
    </div>
  );
}

export default function RouteProfile({
  raceId,
  profiles,
  loading,
  hidden,
  onToggleHidden,
  hasClassifications,
  index: controlledIndex,
  onIndex,
}: {
  raceId: string;
  profiles: StageProfileRow[];
  loading: boolean;
  hidden: boolean;
  onToggleHidden: () => void;
  hasClassifications: boolean;
  /** Den viste etape (0-baseret), naar fladen selv styrer den (Taktik foelger profilens etape). */
  index?: number;
  onIndex?: (index: number) => void;
}) {
  const { t } = useTranslation("planning");
  const [ownIndex, setOwnIndex] = useState(0);
  useEffect(() => setOwnIndex(0), [raceId]); // altid etape 1 ved nyt loeb
  const index = controlledIndex ?? ownIndex;
  const setIndex = (next: number) => (onIndex ? onIndex(next) : setOwnIndex(next));

  const total = profiles.length;
  const multi = total > 1;
  const safe = Math.min(index, Math.max(0, total - 1));
  const profile = profiles[safe] ?? null;
  const big = !!profile && hasRouteData(profile) && elevationSeries(profile as StageProfile) != null;
  const km = Number(profile?.distance_km);
  const gain = Number(profile?.elevation_gain_m);
  const meta = [
    Number.isFinite(km) && km > 0 ? t("profile.km", { km: formatNumber(Math.round(km)) }) : null,
    Number.isFinite(gain) && gain > 0 ? t("profile.gain", { gain: formatNumber(Math.round(gain)) }) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const arrow = (dir: -1 | 1) => (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => setIndex(dir < 0 ? Math.max(0, safe - 1) : Math.min(total - 1, safe + 1))}
      disabled={dir < 0 ? safe === 0 : safe === total - 1}
      aria-label={dir < 0 ? t("profile.prevStage") : t("profile.nextStage")}
      iconLeft={dir < 0 ? <ChevronLeftIcon size={14} aria-hidden="true" /> : <ChevronRightIcon size={14} aria-hidden="true" />}
    />
  );

  return (
    <section aria-label={t("profile.title")} data-testid="planning-route-profile" className="border-b border-cz-border">
      {/* Etape-linjen (wireframet): pil, etape og dens tal til venstre; prikker, pil og "Skjul profil" til hoejre. */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-3.5 py-2" data-testid="planning-stage-line">
        <div className="flex min-w-0 items-center gap-2">
          {multi && arrow(-1)}
          <b className="font-data text-xs font-semibold tabular-nums text-cz-1">
            {multi ? t("profile.stageOf", { n: safe + 1, total }) : t("profile.oneDay")}
          </b>
          {profile?.profile_type && <TerrainTypeGlyph profileType={profile.profile_type} size={14} />}
          {meta && <span className="hidden font-data text-xs tabular-nums text-cz-3 sm:inline">{meta}</span>}
        </div>
        <div className="flex items-center gap-2">
          {multi && total <= 12 && (
            <div className="hidden gap-1 sm:flex" role="group" aria-label={t("profile.stages")}>
              {profiles.map((p, i) => (
                <button
                  key={p.stage_number ?? i}
                  type="button"
                  onClick={() => setIndex(i)}
                  aria-label={t("profile.showStage", { n: i + 1 })}
                  aria-current={i === safe ? "step" : undefined}
                  className="flex h-6 w-3 items-center justify-center sm:h-4"
                >
                  <span className={`block h-2 w-2 ${i === safe ? "bg-cz-accent-t" : "bg-cz-3/40"}`} />
                </button>
              ))}
            </div>
          )}
          {multi && arrow(1)}
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleHidden}
            aria-expanded={!hidden}
            data-testid="planning-profile-toggle"
            iconLeft={hidden ? <ChevronDownIcon size={14} aria-hidden="true" /> : <ChevronUpIcon size={14} aria-hidden="true" />}
          >
            {hidden ? t("profile.show") : t("profile.hide")}
          </Button>
        </div>
      </div>

      {!hidden && (
        <div className="px-3.5 pb-3.5">
          {loading ? (
            <SkeletonLines lines={3} />
          ) : !profile ? (
            <p className="text-[13px] text-cz-2">{t("profile.unavailable")}</p>
          ) : big ? (
            <BigProfile key={`${raceId}-${safe}`} profile={profile as StageProfile} />
          ) : hasRouteData(profile) ? (
            <>
              <StageProfileCard
                profile={profile}
                stageLabel={multi ? t("profile.stageOf", { n: safe + 1, total }) : t("profile.oneDay")}
                tier="compact"
                asCard={false}
                hasClassifications={hasClassifications}
              />
              <FinaleFacts profile={profile as StageProfile} series={null} climb={sortedClimbs(profile as StageProfile).at(-1) ?? null} />
            </>
          ) : (
            <LegacyStageProfileCard profile={profile} stageLabel={t("profile.stageOf", { n: safe + 1, total })} />
          )}
        </div>
      )}
    </section>
  );
}
