import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Modal, Button } from "../ui";
import { formatNumber } from "../../lib/intl";
import { statColor } from "../../lib/statColor.js";
import ConfirmModal from "./ConfirmModal";

// Staff-panel (modal) for ét spor: nuværende staff (Release + fratrædelse) +
// kandidat-liste (Hire). Loader kandidater via loadCandidates(role) on open.
// Fejl mappes til klub-namespace-nøgler med failed som defaultValue-fallback.
export default function StaffPanel({ open, track, facility, onClose, loadCandidates, onHire, onFire }) {
  const { t } = useTranslation("klub");
  const { t: tStaff } = useTranslation("staff");
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [confirmingFire, setConfirmingFire] = useState(false);
  const staff = facility?.staff;

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
    setBusy(true); setError(null);
    const r = await onFire(track);
    if (!r.ok) setError(t(`errors.${r.error}`, { defaultValue: t("errors.failed") }));
    setBusy(false);
    setConfirmingFire(false);
  };

  return (
    <Modal open={open} onClose={onClose} title={`${t("sections.staff")} · ${track ? t(`tracks.${track}.name`) : ""}`}>
      <p className="text-[11px] text-cz-3 mb-3">{t("staff.billNote")} · {t("staff.tierGate")}</p>
      {error && <p className="text-[12px] text-cz-danger mb-3" role="alert">{error}</p>}
      {staff ? (
        <div className="rounded-cz border border-cz-accent/60 bg-cz-card px-[14px] py-[12px] mb-3 flex justify-between items-center">
          <div>
            <div className="text-[14px] font-medium"><Link to={`/staff/${staff.id}`} onClick={onClose} className="text-cz-1 hover:text-cz-accent-t underline underline-offset-2">{staff.name}</Link> <span className="text-[11px] text-cz-2 font-normal">· {track ? t(`roles.${track}`) : ""} · T{staff.tier}</span></div>
            <div className="text-[11px] text-cz-2 mt-[3px]">{t("staff.hired")} · {t("staff.salary", { amount: formatNumber(staff.salary) })}</div>
          </div>
          <div className="text-right">
            <Button variant="secondary" size="sm" loading={busy} onClick={() => setConfirmingFire(true)}>{t("staff.release")}</Button>
            <div className="text-[10.5px] text-cz-2 mt-[5px]">{t("staff.severance", { amount: formatNumber(Math.round(staff.salary * 0.5)) })}</div>
          </div>
        </div>
      ) : null}
      {staff ? (
        // Én chef pr. rolle (backend 409 ved besat) → skjul kandidater, vis fyr-først-note.
        <p className="text-[11px] text-cz-3">{t("staff.occupied")}</p>
      ) : (
        <>
          <div className="text-[10px] uppercase tracking-[1.4px] text-cz-2 mb-2">{t("staff.candidates")}</div>
          {loading ? (
            <p className="text-[12px] text-cz-3">…</p>
          ) : (
            <div className="flex flex-col gap-[6px]">
              {candidates.map((c) => (
                <div key={c.name} className="rounded-cz border border-cz-border bg-cz-card px-[14px] py-[9px] flex justify-between items-center gap-3">
                  <div className="text-[13px] min-w-0">
                    <span className="truncate">{c.name}</span>
                    <span className="text-[11px] text-cz-2"> · {t("staff.candidate", { tier: c.tier, amount: formatNumber(c.salary) })}{c.topSpecialization && <> · {tStaff(`axes.${c.topSpecialization}`)}</>}</span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="font-mono tabular-nums font-bold text-[14px]" style={{ color: statColor(c.overall) }}>{c.overall}</span>
                    <Button variant="secondary" size="sm" loading={busy} onClick={() => doHire(c.name)}>{t("staff.hire")}</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {staff && (
        <ConfirmModal
          open={confirmingFire}
          title={t("confirm.fireTitle", { name: staff.name })}
          lines={[
            { label: t("confirm.cost"), value: formatNumber(Math.round(staff.salary * 0.5)) },
          ]}
          note={t("confirm.severanceNote")}
          confirmLabel={t("staff.release")}
          busy={busy}
          onConfirm={doFire}
          onClose={() => setConfirmingFire(false)}
        />
      )}
    </Modal>
  );
}
