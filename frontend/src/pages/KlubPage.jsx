import { useState } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState, PageLoader } from "../components/ui";
import { formatNumber } from "../lib/intl";
import { useFacilities } from "../lib/useFacilities";
import { TRACK_ORDER } from "../lib/facilityDisplay";
import FacilityTrackCard from "../components/klub/FacilityTrackCard";
import StaffPanel from "../components/klub/StaffPanel";
import ConfirmModal from "../components/klub/ConfirmModal";

// Klub-fladen (#1441 A3): orkestrerer useFacilities-hooken + sub-komponenterne.
// Gater på API'ets `enabled` (403 facilities_disabled → tom-state) så nav + side
// deler samme flag-kilde. Faciliteterne vises i fast TRACK_ORDER; staff redigeres
// i en modal (StaffPanel). Data-drevet: siden viser blot hvad API returnerer.
export default function KlubPage() {
  const { t } = useTranslation("klub");
  const facs = useFacilities();
  const [staffTrack, setStaffTrack] = useState(null);
  const [busyTrack, setBusyTrack] = useState(null);
  const [pendingUpgrade, setPendingUpgrade] = useState(null);

  if (facs.loading) return <PageLoader />;
  if (!facs.enabled) return <EmptyState title={t("empty.title")} description={t("empty.description")} />;

  const byTrack = Object.fromEntries(facs.facilities.map((f) => [f.track, f]));
  const ordered = TRACK_ORDER.map((tr) => byTrack[tr]).filter(Boolean);
  const staffFacility = staffTrack ? byTrack[staffTrack] : null;
  const pendingFacility = pendingUpgrade ? byTrack[pendingUpgrade] : null;

  // Køb/opgradering binder gold nu → åbn bekræftelses-dialog i stedet for at
  // købe direkte fra kortet (ejer-feedback #1441 A3).
  const confirmUpgrade = async () => {
    const track = pendingUpgrade;
    setBusyTrack(track);
    await facs.upgrade(track);
    setBusyTrack(null);
    setPendingUpgrade(null);
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <div className="flex justify-between items-end border-b-[1.5px] border-cz-1 pb-[10px] mb-4">
        <div>
          <h1 className="font-display text-[38px] leading-none">{t("page.title")}</h1>
          <p className="text-[12px] text-cz-2 mt-[2px]">{t("page.subtitle")}</p>
        </div>
      </div>

      <div className="flex justify-between items-center mb-2">
        <span className="font-display text-[20px]">{t("sections.facilities")}</span>
        <span className="text-[10px] uppercase tracking-[1.4px] text-cz-2">{t("effect.note")}</span>
      </div>

      <div className="flex flex-col gap-2">
        {ordered.map((f) => (
          <FacilityTrackCard
            key={f.track}
            facility={f}
            busy={busyTrack === f.track}
            onUpgrade={setPendingUpgrade}
            onOpenStaff={setStaffTrack}
          />
        ))}
      </div>

      {facs.seasonCost && (
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 text-[12px] border-t border-cz-border pt-3">
          <span className="text-cz-2">{t("cost.upkeep")}: <span className="font-mono text-cz-1">{formatNumber(facs.seasonCost.totalUpkeep)}</span></span>
          <span className="text-cz-2">{t("cost.payroll")}: <span className="font-mono text-cz-1">{formatNumber(facs.seasonCost.totalPayroll)}</span></span>
          <span className="text-cz-2 ms-auto">{t("cost.balance")}: <span className="font-mono text-cz-1">{formatNumber(facs.seasonCost.balance)}</span></span>
        </div>
      )}

      <StaffPanel
        open={!!staffTrack}
        track={staffTrack}
        facility={staffFacility}
        onClose={() => setStaffTrack(null)}
        loadCandidates={facs.loadCandidates}
        onHire={facs.hire}
        onFire={facs.fire}
      />

      <ConfirmModal
        open={!!pendingUpgrade}
        title={t(pendingFacility?.tier === 0 ? "confirm.buildTitle" : "confirm.upgradeTitle")}
        lines={
          pendingFacility
            ? [
                { label: t("confirm.newTier"), value: `T${pendingFacility.tier} → T${pendingFacility.tier + 1}` },
                { label: t("confirm.cost"), value: formatNumber(pendingFacility.upgradePrice) },
              ]
            : []
        }
        note={t("confirm.deductNote")}
        confirmLabel={t("confirm.confirm")}
        busy={busyTrack === pendingUpgrade}
        onConfirm={confirmUpgrade}
        onClose={() => setPendingUpgrade(null)}
      />
    </div>
  );
}
