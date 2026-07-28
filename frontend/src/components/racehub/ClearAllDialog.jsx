// Race Hub — #3061: "Clear all"-konsekvens-dialog. Erstatter det tavse window.confirm der
// lod to rigtige Division 2-hold melde sig fra hele sæsonen uden at vide det (prod-hændelse
// 27/7). Navngiver PRÆCIST hvilke løb der rammes + hvert løbs ægte starttidspunkt (server-
// leveret via GET /api/races/distribution/clear-preview) — ikke en kalenderdato.
// Vises KUN når mindst ét kommende løb rammes (shouldShowClearAllDialog i raceHubLogic.js);
// kaldestedet (RaceHubBoard) står for det, så en tom pulje/allerede-kørt sæson aldrig popper
// en tom dialog op (må ikke blive støj man klikker forbi).
// Knap-hierarki fra den ejer-godkendte mockup: "Keep my squad" er gold primary (den sikre
// vej er den fremhævede), "Clear anyway" er danger-outline sekundær — samme rækkefølge
// (sekundær/venstre, primary/højre) som board'ets egen Discard/Save-bar.
import { useTranslation } from "react-i18next";
import Modal from "../ui/Modal.jsx";
import Button from "../ui/Button.jsx";
import { ClockIcon } from "../ui/icons/index.jsx";
import { formatStartsIn } from "../../lib/raceHubLogic.js";

export default function ClearAllDialog({ open, races = [], now, busy, onKeep, onClearAnyway }) {
  const { t } = useTranslation("races");
  return (
    <Modal
      open={open}
      onClose={onKeep}
      title={t("racehub.clearAllDialog.title")}
      description={t("racehub.clearAllDialog.body", { count: races.length })}
      closeLabel={t("racehub.dismiss")}
      footer={
        <>
          <Button type="button" variant="danger" onClick={onClearAnyway} disabled={busy}>
            {t("racehub.clearAllDialog.clearAnyway")}
          </Button>
          <Button type="button" variant="primary" onClick={onKeep} disabled={busy} autoFocus>
            {t("racehub.clearAllDialog.keepSquad")}
          </Button>
        </>
      }
    >
      <ul className="border border-cz-border rounded-cz divide-y divide-cz-border">
        {races.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
            <span className="text-cz-1">{r.name}</span>
            <span className="flex items-center gap-1 text-xs text-cz-3 tabular-nums whitespace-nowrap">
              <ClockIcon size={12} aria-hidden="true" />
              {t("racehub.clearAllDialog.startsIn", { time: formatStartsIn(r.startAt - now) })}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-cz-2">{t("racehub.clearAllDialog.reassurance")}</p>
    </Modal>
  );
}
