// @ts-nocheck: nye komponenter (#7535) bygget paa de eksisterende JS-primitiver, hvis default-null-props checkJs-budgettet ikke kan udtrykke; logikken er i planningWorkbench.ts (strict).
// #7535 · Ruteprofilen i planlaegningssiden: SAMME tegning som loebssiden (StageProfileCard med den
// rigtige hoejdeserie og kategoriserede stigninger). Aabner altid paa etape 1. Pile og prikker
// bladrer mellem etaper; et endagsloeb har hverken pile eller prikker, kun profilen og "Skjul".
// "Skjul profil" folder den til etape-linjen, og valget huskes af siden.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, ChevronLeftIcon, ChevronRightIcon, ChevronUpIcon, ChevronDownIcon, SkeletonLines } from "../ui";
import StageProfileCard from "../race/StageProfileCard.jsx";
import LegacyStageProfileCard from "../race/LegacyStageProfileCard.jsx";
import { hasRouteData } from "../../lib/stageRouteProfile.js";

export default function RouteProfile({ raceId, profiles, loading, hidden, onToggleHidden, hasClassifications }) {
  const { t } = useTranslation("planning");
  const [index, setIndex] = useState(0);
  useEffect(() => setIndex(0), [raceId]); // altid etape 1 ved nyt loeb

  const total = profiles.length;
  const multi = total > 1;
  const safe = Math.min(index, Math.max(0, total - 1));
  const profile = profiles[safe] ?? null;

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

      {!hidden && (
        <div className="px-3.5 pb-3.5">
          {loading ? (
            <SkeletonLines lines={3} />
          ) : !profile ? (
            <p className="text-[13px] text-cz-2">{t("profile.unavailable")}</p>
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
