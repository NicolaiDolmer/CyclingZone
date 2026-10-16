// Ét facilitets-kort på Klub-siden, retning D (#6666, ejer-valgt 16/10).
// To varianter:
//  - effectLive === false → stiplet, dæmpet "kommer snart"-kort: navn + én sætning
//    om hvad faciliteten vil give. Ingen trappe, ingen købsknap, ingen staff:
//    spilleren kan ikke betale for en motor der endnu ikke er wired (#1441 Slice 1).
//    Akademiet står her så længe academy_intake_pull_enabled er slukket.
//  - effectLive === true  → navn + status-mærke, effekten NU som ét stort tal med
//    kort undertekst, staff-linjen, niveau-trappen (TierStair) og nederst drift ved
//    næste niveau + opgrader-knap. Kun ÉT kort på siden får den gyldne knap
//    (`primary`, afgjort af KlubPage); resten er neutrale sekundære knapper.
//    Kun live-kort wirer onUpgrade/onOpenStaff, så confirm/staff-modaler kan kun
//    nås for live spor.
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Button, Card } from "../ui/index.js";
import { formatNumber } from "../../lib/intl.js";
import { formatTrackEffect } from "../../lib/facilityDisplay.js";
import { ladderRow } from "../../lib/klubFacilityModel.ts";
import type { Facility } from "../../lib/klubFacilityModel.ts";
import TierStair from "./TierStair.tsx";

const BADGE = "shrink-0 text-3xs uppercase tracking-wide rounded-cz px-[6px] py-[2px]";

interface Props {
  facility: Facility;
  onUpgrade: (track: string) => void;
  onOpenStaff: (track: string) => void;
  busy?: boolean;
  primary?: boolean;
}

export default function FacilityTrackCard({ facility, onUpgrade, onOpenStaff, busy = false, primary = false }: Props) {
  const { t } = useTranslation("klub");
  const { track, tier, upgradePrice, tierUpkeep, effectiveBonus, effectLive } = facility;

  if (!effectLive) {
    return (
      <Card borderClass="border-dashed border-cz-border" className="p-4 sm:p-5 bg-transparent">
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-display text-[20px] leading-none text-cz-2">{t(`tracks.${track}.name`)}</h3>
          <span className={`${BADGE} text-cz-3 border border-cz-border`}>{t("facilities.comingSoon")}</span>
        </div>
        <p className="mt-3 text-xs text-cz-3 leading-relaxed">{t(`tracks.${track}.teaser`)}</p>
      </Card>
    );
  }

  const maxed = upgradePrice == null;
  const nextTier = tier + 1;
  const nextUpkeep = maxed ? null : (ladderRow(facility, nextTier)?.upkeep ?? null);
  // #3489: op til staffSlotsMax (2) samtidige aktive staff pr. rolle. 0 = sporet har
  // ingen chef (akademiet), så staff-linjen udelades.
  const staffList = facility.staffList ?? (facility.staff ? [facility.staff] : []);
  const staffSlotsMax = facility.staffSlotsMax ?? 2;

  // Effekten NU: ét stort tal + kort undertekst. Ikke bygget → byg-opfordringen.
  let headline: string;
  let subline: string;
  if (tier === 0) {
    headline = t("facilities.notBuilt");
    subline = t(`roi.${track}Build`, { defaultValue: "" });
  } else if (track === "academy") {
    headline = t("hero.academy", { count: effectiveBonus });
    subline = t("hero.academySub");
  } else if (track === "scouting") {
    headline = t("hero.scouting");
    subline = t("hero.scoutingSub", { tier });
  } else if (track === "training") {
    headline = formatTrackEffect(track, effectiveBonus);
    subline = t("hero.trainingSub");
  } else {
    headline = formatTrackEffect(track, effectiveBonus);
    subline = t(`tracks.${track}.effect`);
  }

  return (
    <Card className="p-4 sm:p-5 flex flex-col">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-display text-[20px] leading-none">{t(`tracks.${track}.name`)}</h3>
        {tier === 0 ? (
          <span className={`${BADGE} text-cz-2 border border-cz-border`}>{t("facilities.notBuilt")}</span>
        ) : (
          <span className={`${BADGE} text-cz-success bg-cz-success/10`}>{t("badge.active")}</span>
        )}
      </div>

      <div className="mt-3">
        <div className={`font-data font-semibold tabular-nums leading-tight text-cz-1 ${tier === 0 ? "text-[20px]" : "text-[28px]"}`}>
          {headline}
        </div>
        {subline && <p className="mt-[2px] text-xs text-cz-2">{subline}</p>}
        {staffSlotsMax > 0 && (
          <p className="mt-[2px] text-xs text-cz-2">
            {staffList.length > 0 ? (
              <>
                {staffList.map((s, i) => (
                  <span key={s.id}>
                    {i > 0 && ", "}
                    <Link to={`/staff/${s.id}`} className="text-cz-1 hover:text-cz-accent-t underline underline-offset-2">{s.name}</Link>
                    {" "}<span className="font-data tabular-nums">(T{s.tier})</span>
                  </span>
                ))}
                {/* #3489: en fri 2. slot skal kunne fyldes UDEN at fyre den første. */}
                {staffList.length < staffSlotsMax && (
                  <> · <button type="button" onClick={() => onOpenStaff(track)} className="text-cz-accent-t underline underline-offset-2">{t("staff.addAnother")}</button></>
                )}
              </>
            ) : tier === 0 ? (
              <span className="text-cz-3">{t("staff.locked")}</span>
            ) : (
              <button type="button" onClick={() => onOpenStaff(track)} className="text-cz-accent-t underline underline-offset-2">{t("staff.none")}</button>
            )}
          </p>
        )}
      </div>

      <div className="mt-4">
        <TierStair facility={facility} />
      </div>

      <div className="mt-auto pt-4">
        <div className="border-t border-cz-border pt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <p className="text-xs text-cz-2 leading-snug">
            {maxed
              ? t("facilities.upkeepNow", { amount: formatNumber(tierUpkeep) })
              : nextUpkeep != null
                ? t("facilities.upkeepAt", { tier: nextTier, amount: formatNumber(nextUpkeep) })
                : t("facilities.upkeepNow", { amount: formatNumber(tierUpkeep) })}
          </p>
          {maxed ? (
            <span className="text-xs text-cz-3">{t("facilities.maxed")}</span>
          ) : (
            <Button variant={primary ? "primary" : "secondary"} size="sm" loading={busy} onClick={() => onUpgrade(track)}>
              {tier === 0 ? t("facilities.build") : t("facilities.upgrade")} · <span className="font-data tabular-nums">{formatNumber(upgradePrice)}</span>
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
