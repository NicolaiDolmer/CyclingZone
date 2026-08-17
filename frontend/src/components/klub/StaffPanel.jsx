import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Modal, Button } from "../ui";
import { formatNumber } from "../../lib/intl";
import { statColor } from "../../lib/statColor.js";
import ConfirmModal from "./ConfirmModal";

// Staff-panel (modal) for ét spor: nuværende staff (op til facility.staffSlotsMax,
// #3489) + kandidat-liste (Hire). Loader kandidater via loadCandidates(role) on open.
// Fejl mappes til klub-namespace-nøgler med failed som defaultValue-fallback.
//
// #3489/#3658: kandidaterne vises nu ALTID, uanset om rollen har aktiv(e) staff —
// spilleren skal ikke længere fyre for at SE alternativerne (Discord-feedback
// 12/8). Hire-knappen er kun deaktiveret når ALLE slots er besat (staffSlotsUsed
// >= staffSlotsMax); ellers lander en ny ansættelse i den frie slot.
export default function StaffPanel({ open, track, facility, onClose, loadCandidates, onHire, onFire }) {
  const { t } = useTranslation("klub");
  const { t: tStaff } = useTranslation("staff");
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [firingStaff, setFiringStaff] = useState(null); // { id, name, salary } | null
  const staffList = facility?.staffList ?? [];
  const slotsMax = facility?.staffSlotsMax ?? 2;
  const slotsFull = staffList.length >= slotsMax;

  useEffect(() => {
    if (!open || !track) return;
    let alive = true;
    setLoading(true); setError(null);
    loadCandidates(track).then((r) => {
      if (!alive) return;
      if (r.ok) setCandidates(r.candidates);
      else setError(t(`errors.${r.error}`, { defaultValue: t("errors.failed") }));
      setLoading(false);
    });
    return () => { alive = false; };
  }, [open, track, loadCandidates, t]);

  const doHire = async (name) => {
    setBusy(true); setError(null);
    const r = await onHire(track, name);
    if (!r.ok) setError(t(`errors.${r.error}`, { defaultValue: t("errors.failed") }));
    setBusy(false);
  };
  const doFire = async () => {
    if (!firingStaff) return;
    setBusy(true); setError(null);
    const r = await onFire(track, firingStaff.id);
    if (!r.ok) setError(t(`errors.${r.error}`, { defaultValue: t("errors.failed") }));
    setBusy(false);
    setFiringStaff(null);
  };

  return (
    <Modal open={open} onClose={onClose} title={`${t("sections.staff")} · ${track ? t(`tracks.${track}.name`) : ""}`}>
      <p className="text-2xs text-cz-3 mb-3">{t("staff.billNote")} · {t("staff.tierGate")}</p>
      {error && <p className="text-xs text-cz-danger mb-3" role="alert">{error}</p>}

      {staffList.length > 0 && (
        <div className="flex flex-col gap-[8px] mb-3">
          {staffList.map((staff) => (
            <div key={staff.id} className="rounded-cz border border-cz-accent/60 bg-cz-card px-[14px] py-[12px] flex justify-between items-center">
              <div>
                <div className="text-sm font-medium"><Link to={`/staff/${staff.id}`} onClick={onClose} className="text-cz-1 hover:text-cz-accent-t underline underline-offset-2">{staff.name}</Link> <span className="text-2xs text-cz-2 font-normal">· {track ? t(`roles.${track}`) : ""} · T{staff.tier}</span></div>
                <div className="text-2xs text-cz-2 mt-[3px]">{t("staff.hired")} · {t("staff.salary", { amount: formatNumber(staff.salary) })}</div>
              </div>
              <div className="text-right">
                <Button variant="secondary" size="sm" loading={busy} onClick={() => setFiringStaff(staff)}>{t("staff.release")}</Button>
                <div className="text-3xs text-cz-2 mt-[5px]">{t("staff.severance", { amount: formatNumber(Math.round(staff.salary * 0.5)) })}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="text-3xs uppercase tracking-[1.4px] text-cz-2 mb-2">{t("staff.candidates")}</div>
      {slotsFull && <p className="text-2xs text-cz-3 mb-2">{t("staff.slotsFull")}</p>}
      {loading ? (
        <p className="text-xs text-cz-3">…</p>
      ) : (
        <div className="flex flex-col gap-[6px]">
          {candidates.map((c) => (
            <div key={c.name} className="rounded-cz border border-cz-border bg-cz-card px-[14px] py-[9px] flex justify-between items-center gap-3">
              <div className="text-[13px] min-w-0">
                <span className="truncate">{c.name}</span>
                <span className="text-2xs text-cz-2"> · {t("staff.candidate", { tier: c.tier, amount: formatNumber(c.salary) })}{c.topSpecialization && <> · {tStaff(`axes.${c.topSpecialization}`)}</>}</span>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {/* #2890: staffRating, ikke rating — staff-overall (tier-bånd 28-90) er en
                    anden fordeling end rytter-overallRating (median 48 vs. 21). */}
                <span className="font-data tabular-nums font-bold text-sm" style={{ color: statColor(c.overall, { scale: "staffRating" }) }}>{c.overall}</span>
                <Button variant="secondary" size="sm" loading={busy} disabled={slotsFull} onClick={() => doHire(c.name)}>{t("staff.hire")}</Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {firingStaff && (
        <ConfirmModal
          open={!!firingStaff}
          title={t("confirm.fireTitle", { name: firingStaff.name })}
          lines={[
            { label: t("confirm.cost"), value: formatNumber(Math.round(firingStaff.salary * 0.5)) },
          ]}
          note={t("confirm.severanceNote")}
          confirmLabel={t("staff.release")}
          busy={busy}
          onConfirm={doFire}
          onClose={() => setFiringStaff(null)}
        />
      )}
    </Modal>
  );
}
