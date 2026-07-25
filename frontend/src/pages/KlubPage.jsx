import { useState } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState, ErrorState, PageLoader, Button, Section, SectionHeader } from "../components/ui";
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
//
// #2849 bølge 6: migreret til T1 (max-w-4xl, ingen egen side-padding — Layout
// leverer den globale gutter). Det editoriale sidehoved (font-display Bebas
// 38px + border-b-bånd) er ejer-godkendt og bevaret uændret; facilitets-listen
// er nu en kanonisk Section+SectionHeader, og en manglende load-fejltilstand
// (facs.error) er lukket med ErrorState + retry.
export default function KlubPage() {
  const { t } = useTranslation("klub");
  const facs = useFacilities();
  const [staffTrack, setStaffTrack] = useState(null);
  const [busyTrack, setBusyTrack] = useState(null);
  const [pendingUpgrade, setPendingUpgrade] = useState(null);

  if (facs.loading) return <PageLoader />;

  if (facs.error) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-end border-b-[1.5px] border-cz-1 pb-[10px] mb-4">
          <div>
            <h1 className="font-display text-[38px] leading-none">{t("page.title")}</h1>
            <p className="text-xs text-cz-2 mt-[2px]">{t("page.subtitle")}</p>
          </div>
        </div>
        <ErrorState
          title={t("error.load.title", { defaultValue: "Couldn't load the club" })}
          description={t("error.load.description", { defaultValue: "Nothing was lost — your facilities and staff are safe. Try again." })}
          action={
            <Button size="sm" variant="secondary" onClick={facs.refresh}>
              {t("error.load.retry", { defaultValue: "Try again" })}
            </Button>
          }
        />
      </div>
    );
  }

  if (!facs.enabled) return <EmptyState title={t("empty.title")} description={t("empty.description")} />;

  const byTrack = Object.fromEntries(facs.facilities.map((f) => [f.track, f]));
  const ordered = TRACK_ORDER.map((tr) => byTrack[tr]).filter(Boolean);
  // Live faciliteter først (købbare), derefter "Coming soon"-teasers; TRACK_ORDER
  // bevares inden for hver gruppe (#1441 Slice 1).
  const groupedFacilities = [
    ...ordered.filter((f) => f.effectLive),
    ...ordered.filter((f) => !f.effectLive),
  ];
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
    <div className="max-w-4xl mx-auto">
      <div className="flex justify-between items-end border-b-[1.5px] border-cz-1 pb-[10px] mb-4">
        <div>
          <h1 className="font-display text-[38px] leading-none">{t("page.title")}</h1>
          <p className="text-xs text-cz-2 mt-[2px]">{t("page.subtitle")}</p>
        </div>
      </div>

      <p className="text-[13px] text-cz-2 leading-relaxed mb-4 max-w-[56ch]">{t("page.intro")}</p>

      <Section>
        <SectionHeader title={t("sections.facilities")} meta={t("effect.note")} />
        <div className="flex flex-col">
          {groupedFacilities.map((f) => (
            <FacilityTrackCard
              key={f.track}
              facility={f}
              busy={busyTrack === f.track}
              onUpgrade={setPendingUpgrade}
              onOpenStaff={setStaffTrack}
            />
          ))}
        </div>
      </Section>

      {facs.seasonCost && (
        <div className="mt-4 text-xs text-cz-2 leading-relaxed border-t border-cz-border pt-3">
          {t("cost.seasonLine", {
            upkeep: formatNumber(facs.seasonCost.totalUpkeep),
            payroll: formatNumber(facs.seasonCost.totalPayroll),
            total: formatNumber(facs.seasonCost.totalUpkeep + facs.seasonCost.totalPayroll),
          })}
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
