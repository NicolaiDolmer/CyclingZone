import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "../ui";
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
//
// #2849 bølge 6: renderer nu som en RÆKKE (border-b, ingen egen Card/radius) —
// forælderen (KlubPage) wrapper listen i én kanonisk Section, så to indlejrede
// card-rammer undgås (jf. docs/design/PAGE_TEMPLATES.md's row-list-opskrift).
export default function FacilityTrackCard({ facility, onUpgrade, onOpenStaff, busy }) {
  const { t } = useTranslation("klub");
  const { track, tier, upgradePrice, tierUpkeep, staff, effectiveBonus, effectLive, nextTierBonus } = facility;
  const isCommercial = track === "commercial";

  if (!effectLive) {
    return (
      <div className={`py-[13px] border-b border-cz-border last:border-0 flex items-center justify-between gap-3 ${isCommercial ? "border-l-2 border-l-cz-warning pl-2" : ""}`}>
        <div className="min-w-0">
          <span className="font-display text-[15px] leading-none">{t(`tracks.${track}.name`)}</span>
          <span className="text-xs text-cz-2"> · {t(`tracks.${track}.soon`)}</span>
        </div>
        <span className={`shrink-0 text-3xs uppercase tracking-wide rounded-cz px-[7px] py-[2px] ${isCommercial ? "text-cz-warning bg-cz-warning/10" : "text-cz-accent-t bg-cz-accent/10"}`}>
          {t("facilities.comingSoon")}
        </span>
      </div>
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

  // #2311 (Slice 2): tier-preview af NÆSTE niveau før køb, så afkastet er synligt
  // ved beslutningen — ikke først efter. nextTierBonus === null ved max tier (ingen
  // "undefined"-preview). Genbruger track-specifik ROI-copy hvis den findes
  // (`roi.<track>Next`), ellers en generisk "Next: Level N -> +X%"-linje.
  const nextTierValue = maxed ? null : formatTrackEffect(track, nextTierBonus).replace(/^\+/, "");
  const nextTierText = maxed
    ? ""
    : (t(`roi.${track}Next`, { tier: nextTier, value: nextTierValue, defaultValue: "" }) ||
       t("nextTier.generic", { tier: nextTier, value: formatTrackEffect(track, nextTierBonus) }));

  return (
    <div className="py-[13px] border-b border-cz-border last:border-0 grid grid-cols-[1fr_auto] gap-[14px] items-center">
      <div>
        <div className="flex items-baseline gap-[10px]">
          <span className="font-display text-[17px] leading-none">{t(`tracks.${track}.name`)}</span>
          <span className="text-2xs text-cz-accent-t">
            {tier === 0 ? t("facilities.notBuilt") : t("facilities.tier", { tier, max: 5 })}
          </span>
          <span className="text-3xs uppercase tracking-wide text-cz-success bg-cz-success/10 rounded-cz px-[6px] py-[2px]">
            {t("effect.live")}
          </span>
        </div>
        <div className="my-[6px]"><TierLadder tier={tier} /></div>
        <div className="text-2xs text-cz-2">
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
          <span className="text-xs text-cz-3">{t("facilities.maxed")}</span>
        ) : (
          <Button variant="primary" size="sm" loading={busy} onClick={() => onUpgrade(track)}>
            {(tier === 0 ? t("facilities.buildTier", { tier: nextTier }) : t("facilities.upgradeTo", { tier: nextTier }))} · <span className="font-data">{formatNumber(upgradePrice)}</span>
          </Button>
        )}
        {!maxed && nextTierText && (
          <div className="text-3xs text-cz-accent-t mt-[4px] max-w-[220px] ms-auto">{nextTierText}</div>
        )}
        <div className="text-3xs text-cz-2 mt-[2px]">{t("facilities.upkeep", { amount: formatNumber(tierUpkeep) })}</div>
      </div>
    </div>
  );
}
