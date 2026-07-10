import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Card, Button } from "../ui";
import { formatNumber } from "../../lib/intl";
import { formatTrackEffect } from "../../lib/facilityDisplay";
import TierLadder from "./TierLadder";

// Én facilitet-række med to varianter (#1441 Slice 1):
//  - effectLive === false → kompakt LÅST teaser: navn + "hvad den vil gøre" +
//    "Coming soon"-pill. Ingen tier-ladder/købsknap/staff — spilleren kan ikke
//    betale for en motor der endnu ikke er wired. Commercial får warning-tone
//    (langsigtet sink), øvrige accent-tone.
//  - effectLive === true  → fuldt kort med ROI-tekst i klartekst (oversætter
//    "+1.5%" → "Your riders train 1.5% faster every day"), tier-ladder,
//    build/upgrade-knap + drift. Kun live-kort wirer onUpgrade/onOpenStaff, så
//    confirm/staff-modaler kan kun nås for live spor.
export default function FacilityTrackCard({ facility, onUpgrade, onOpenStaff, busy }) {
  const { t } = useTranslation("klub");
  const { track, tier, upgradePrice, tierUpkeep, staff, effectiveBonus, effectLive } = facility;
  const isCommercial = track === "commercial";

  if (!effectLive) {
    return (
      <Card className={`px-[14px] py-[10px] flex items-center justify-between gap-3 ${isCommercial ? "border-l-2 border-l-cz-warning rounded-l-none" : ""}`}>
        <div className="min-w-0">
          <span className="font-display text-[15px] leading-none">{t(`tracks.${track}.name`)}</span>
          <span className="text-[12px] text-cz-2"> · {t(`tracks.${track}.soon`)}</span>
        </div>
        <span className={`shrink-0 text-[10px] uppercase tracking-wide rounded-[3px] px-[7px] py-[2px] ${isCommercial ? "text-cz-warning bg-cz-warning/10" : "text-cz-accent-t bg-cz-accent/10"}`}>
          {t("facilities.comingSoon")}
        </span>
      </Card>
    );
  }

  const maxed = upgradePrice == null;
  const nextTier = tier + 1;
  // ROI i klartekst. Ved tier 0 er effektiveBonus = 0 → build-prompt i stedet for
  // "+0.0%". Fallback til den rå effekt-linje hvis en live track mangler ROI-copy
  // (Slice 1 definerer kun training; øvrige tilføjes når deres motor lander).
  const roiValue = formatTrackEffect(track, effectiveBonus).replace(/^\+/, "");
  const roiText = tier === 0
    ? t(`roi.${track}Build`, { defaultValue: "" })
    : t(`roi.${track}`, { value: roiValue, defaultValue: "" });

  return (
    <Card className="px-[14px] py-[12px] grid grid-cols-[1fr_auto] gap-[14px] items-center">
      <div>
        <div className="flex items-baseline gap-[10px]">
          <span className="font-display text-[17px] leading-none">{t(`tracks.${track}.name`)}</span>
          <span className="text-[11px] text-cz-accent-t">
            {tier === 0 ? t("facilities.notBuilt") : t("facilities.tier", { tier, max: 5 })}
          </span>
          <span className="text-[9.5px] uppercase tracking-wide text-cz-success bg-cz-success/10 rounded-[3px] px-[6px] py-[2px]">
            {t("effect.live")}
          </span>
        </div>
        <div className="my-[6px]"><TierLadder tier={tier} /></div>
        <div className="text-[11px] text-cz-2">
          {roiText
            ? <span className="text-cz-1">{roiText}</span>
            : <>{t("effect.label")} <span className="font-data text-cz-1">{formatTrackEffect(track, effectiveBonus)}</span> {t(`tracks.${track}.effect`)}</>}
          {" · "}
          {staff
            ? <>Staff <Link to={`/staff/${staff.id}`} className="text-cz-1 hover:text-cz-accent-t underline underline-offset-2">{staff.name}</Link> (T{staff.tier})</>
            : tier === 0
              ? <span className="text-cz-3">{t("staff.locked")}</span>
              : <button type="button" onClick={() => onOpenStaff(track)} className="text-cz-accent-t underline underline-offset-2">{t("staff.none")}</button>}
        </div>
      </div>
      <div className="text-right">
        {maxed ? (
          <span className="text-[12px] text-cz-3">{t("facilities.maxed")}</span>
        ) : (
          <Button variant="primary" size="sm" loading={busy} onClick={() => onUpgrade(track)}>
            {(tier === 0 ? t("facilities.buildTier", { tier: nextTier }) : t("facilities.upgradeTo", { tier: nextTier }))} · <span className="font-data">{formatNumber(upgradePrice)}</span>
          </Button>
        )}
        <div className="text-[10.5px] text-cz-2 mt-[2px]">{t("facilities.upkeep", { amount: formatNumber(tierUpkeep) })}</div>
      </div>
    </Card>
  );
}
