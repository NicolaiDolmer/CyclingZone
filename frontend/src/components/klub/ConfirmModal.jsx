import { useTranslation } from "react-i18next";
import { Modal, Button } from "../ui";

// Genbrugelig bekræftelses-dialog før penge-bindende handlinger (køb/opgradering,
// fyring). Editorial: cz-tokens, ingen rounded-2xl/glow/emoji. `lines` er små
// omkostnings-rækker ({label, value}) vist som en let tabel; tal i font-data.
// Bygger på den delte Modal (footer = primær bekræft + sekundær annullér).
// #2718-sweep: `error` er tilføjet fordi et fejlet køb tidligere lukkede dialogen
// uden et ord — spilleren så gold blive stående og troede knappen var død.
export default function ConfirmModal({ open, title, lines = [], note, confirmLabel, onConfirm, onClose, busy, error = null }) {
  const { t } = useTranslation("klub");
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>
            {t("confirm.cancel")}
          </Button>
          <Button variant="primary" size="sm" loading={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {lines.length > 0 && (
        <dl className="flex flex-col gap-[6px]">
          {lines.map((line) => (
            <div key={line.label} className="flex items-baseline justify-between gap-4 border-b border-cz-border pb-[6px] last:border-0 last:pb-0">
              <dt className="text-xs text-cz-2">{line.label}</dt>
              <dd className="font-data text-[13px] text-cz-1">{line.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {note && <p className="mt-3 text-2xs text-cz-3">{note}</p>}
      {error && (
        <p role="alert" className="mt-3 rounded-cz border border-cz-danger/30 bg-cz-danger-bg px-3 py-2 text-xs text-cz-danger">
          {error}
        </p>
      )}
    </Modal>
  );
}
