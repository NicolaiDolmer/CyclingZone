// #7535 · Ruteprofilen i planlaegningssiden: SAMME tegning som loebssiden (StageProfileCard med den
// rigtige hoejdeserie og kategoriserede stigninger). Aabner altid paa etape 1. Pile og prikker
// bladrer mellem etaper; et endagsloeb har hverken pile eller prikker, kun profilen og "Skjul".
// "Skjul profil" folder den til etape-linjen, og valget huskes af siden.
// "Vis fuld profil" (ejer 14/11) folder loebssidens fulde profil ud: etape-fanens StageProfileV2 med
// hoejdeakse, navngivne stigninger og stigningsprocent-farver. Samme komponent, ingen ny tegning.
import { useEffect, useMemo, useState } from "react";
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
  hasRouteData,
} from "./primitives.ts";
import StageProfileV2, { GradientLegend } from "../race/stagePageV2/StageProfileV2.tsx";
import { elevationSeries, sortedClimbs, type StageProfile } from "../race/stagePageV2/stagePageV2Model.ts";
import { formatNumber } from "../../lib/intl.js";

interface StageProfileRow {
  stage_number?: number | null;
  profile_type?: string | null;
  [key: string]: unknown;
}

/** Loebssidens fulde profil for én etape (etape-fanens tegning), med den sidste stigning valgt som dér. */
function FullProfile({ profile }: { profile: StageProfile }) {
  const { t } = useTranslation("races");
  const series = useMemo(() => elevationSeries(profile), [profile]);
  const climbs = useMemo(() => sortedClimbs(profile), [profile]);
  const [selectedClimb, setSelectedClimb] = useState(() => Math.max(0, climbs.length - 1));
  useEffect(() => setSelectedClimb(Math.max(0, climbs.length - 1)), [climbs]);
  if (!series) return null;
  const stats = t("stagePageV2.profile.stats", {
    km: formatNumber(Math.round(Number(profile.distance_km) || 0)),
    gain: formatNumber(Math.round(Number(profile.elevation_gain_m) || 0)),
    climbs: climbs.length,
  });
  return (
    <div data-testid="planning-full-profile">
      <p className="m-0 mb-2 font-data text-xs tabular-nums text-cz-3">{stats}</p>
      <StageProfileV2
        profile={profile}
        series={series}
        climbs={climbs}
        selectedClimb={Math.min(selectedClimb, Math.max(0, climbs.length - 1))}
        onSelectClimb={setSelectedClimb}
      />
      <div className="mt-3">
        <GradientLegend />
      </div>
    </div>
  );
}

export default function RouteProfile({
  raceId,
  profiles,
  loading,
  hidden,
  onToggleHidden,
  full = false,
  onToggleFull,
  hasClassifications,
}: {
  raceId: string;
  profiles: StageProfileRow[];
  loading: boolean;
  hidden: boolean;
  onToggleHidden: () => void;
  /** Loebssidens fulde profil i stedet for det kompakte kort. */
  full?: boolean;
  onToggleFull?: () => void;
  hasClassifications: boolean;
}) {
  const { t } = useTranslation("planning");
  const [index, setIndex] = useState(0);
  useEffect(() => setIndex(0), [raceId]); // altid etape 1 ved nyt loeb

  const total = profiles.length;
  const multi = total > 1;
  const safe = Math.min(index, Math.max(0, total - 1));
  const profile = profiles[safe] ?? null;
  // Den fulde profil kraever en hoejdeserie (som paa loebssiden); uden den er knappen vaek.
  const canFull = !!profile && hasRouteData(profile) && elevationSeries(profile as StageProfile) != null;
  const showFull = full && canFull;

  return (
    <section aria-label={t("profile.title")} data-testid="planning-route-profile" className="border-b border-cz-border">
      <div className="flex flex-wrap items-center justify-between gap-2.5 px-3.5 py-2.5">
        <div className="flex items-center gap-2.5">
          {multi && (
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setIndex(Math.max(0, safe - 1))}
                disabled={safe === 0}
                aria-label={t("profile.prevStage")}
                iconLeft={<ChevronLeftIcon size={14} aria-hidden="true" />}
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setIndex(Math.min(total - 1, safe + 1))}
                disabled={safe === total - 1}
                aria-label={t("profile.nextStage")}
                iconLeft={<ChevronRightIcon size={14} aria-hidden="true" />}
              />
            </>
          )}
          <b className="font-data text-xs font-semibold tabular-nums text-cz-1">
            {multi ? t("profile.stageOf", { n: safe + 1, total }) : t("profile.oneDay")}
          </b>
          {multi && total <= 12 && (
            <div className="flex gap-1" role="group" aria-label={t("profile.stages")}>
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
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {!hidden && canFull && onToggleFull && (
            <Button variant="ghost" size="sm" onClick={onToggleFull} aria-expanded={full} data-testid="planning-full-profile-toggle">
              {full ? t("profile.hideFull") : t("profile.showFull")}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleHidden}
            aria-expanded={!hidden}
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
          ) : showFull ? (
            <FullProfile key={`${raceId}-${safe}`} profile={profile as StageProfile} />
          ) : hasRouteData(profile) ? (
            <StageProfileCard
              profile={profile}
              stageLabel={multi ? t("profile.stageOf", { n: safe + 1, total }) : t("profile.oneDay")}
              tier="compact"
              asCard={false}
              hasClassifications={hasClassifications}
            />
          ) : (
            <LegacyStageProfileCard profile={profile} stageLabel={t("profile.stageOf", { n: safe + 1, total })} />
          )}
        </div>
      )}
    </section>
  );
}
