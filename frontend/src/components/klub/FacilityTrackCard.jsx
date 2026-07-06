import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Card, Button } from "../ui";
import { formatNumber } from "../../lib/intl";
import { formatTrackEffect } from "../../lib/facilityDisplay";
import TierLadder from "./TierLadder";

// Én facilitet-række: venstre = navn + tier-ladder + effekt + staff-linje;
// højre = upgrade-knap + drift.
// Kommerciel får venstre accent-border + ærligt "pure sink"-tag (Q2). Max tier
// (upgradePrice=null) → "Fully upgraded" i stedet for knap.
export default function FacilityTrackCard({ facility, onUpgrade, onOpenStaff, busy }) {
  const { t } = useTranslation("klub");
  const { track, tier, upgradePrice, tierUpkeep, staff, effectiveBonus, effectLive } = facility;
  const isCommercial = track === "commercial";
  const maxed = upgradePrice == null;
  const nextTier = tier + 1;

  return (
    <Card className={`px-[14px] py-[12px] grid grid-cols-[1fr_auto] gap-[14px] items-center ${isCommercial ? "border-l-2 border-l-cz-warning rounded-l-none" : ""}`}>
      <div>
        <div className="flex items-baseline gap-[10px]">
          <span className="font-display text-[17px] leading-none">{t(`tracks.${track}.name`)}</span>
          <span className="text-[11px] text-cz-accent-t">
            {tier === 0 ? t("facilities.notBuilt") : t("facilities.tier", { tier, max: 5 })}
          </span>
          {isCommercial && (
            <span className="text-[9.5px] uppercase tracking-wide text-cz-warning bg-cz-warning/10 rounded-[3px] px-[6px] py-[2px]">
              {t("commercial.sinkTag")}
            </span>
          )}
        </div>
        <div className="my-[6px]"><TierLadder tier={tier} /></div>
        <div className="text-[11px] text-cz-2">
          {t("effect.label")} <span className="font-data text-cz-1">{formatTrackEffect(track, effectiveBonus)}</span> {t(`tracks.${track}.effect`)}
          <span className="text-cz-3"> · {effectLive ? t("effect.live") : t("effect.target")}</span>
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
          <>
            <Button variant="primary" size="sm" loading={busy} onClick={() => onUpgrade(track)}>
              {(tier === 0 ? t("facilities.buildTier", { tier: nextTier }) : t("facilities.upgradeTo", { tier: nextTier }))} · <span className="font-data">{formatNumber(upgradePrice)}</span>
            </Button>
          </>
        )}
        <div className="text-[10.5px] text-cz-2 mt-[2px]">{t("facilities.upkeep", { amount: formatNumber(tierUpkeep) })}</div>
      </div>
    </Card>
  );
}
