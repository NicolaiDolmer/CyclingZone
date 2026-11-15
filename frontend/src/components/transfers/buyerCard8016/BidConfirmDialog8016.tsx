import { useTranslation } from "react-i18next";
import Modal from "../../ui/Modal.jsx";
import Button from "../../ui/Button.jsx";
import { AlertTriangleIcon } from "../../ui/icons/index.jsx";
import { formatCz } from "../../../lib/marketValues.js";
import { RETIREMENT_GUARANTEED_AGE, RETIREMENT_WINDOW_START_AGE } from "../../../lib/riderAge.js";
import { useReloadBlock, RELOAD_BLOCK_REASONS } from "../../../lib/reloadGate.js";
import ConfirmRows from "./ConfirmRows.tsx";

// #8016: bekraeftelsen af et bud paa listen. Samme raekker som auktionens
// bekraeftelse (AutoAcceptAuctionDialog), saa det altid staar, at det er et bud.
// Pensions-advarslen fra den gamle bekraeftelse (BidConfirmModal, #2700) foelger med.
export default function BidConfirmDialog8016({
  riderName,
  amount,
  retirementTier,
  busy,
  onCancel,
  onConfirm,
}: {
  riderName: string;
  amount: number;
  retirementTier: string | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation(["transfers", "auctions"]);
  // #5159 (B1), som i BidConfirmModal: en aaben bekraeftelse venter paa spillerens
  // svar, saa et release-drevet reload maa ikke lukke den (heller ikke under afsendelsen).
  useReloadBlock(true, RELOAD_BLOCK_REASONS.DIALOG);
  const dismiss = () => {
    if (!busy) onCancel();
  };
  return (
    <Modal
      open
      title={undefined}
      description={undefined}
      footer={undefined}
      onClose={dismiss}
      closeLabel={t("transfers:buyerCard.back")}
      ariaLabelledby="buyer-bid-confirm-title"
    >
      <div className="space-y-4" data-testid="buyer-bid-confirm">
        <h2 id="buyer-bid-confirm-title" className="font-heading text-xl font-bold">
          {t("transfers:buyerCard.confirmTitleBid")}
        </h2>
        <p className="text-sm font-semibold text-cz-1">{riderName}</p>
        <ConfirmRows
          testId="buyer-bid-confirm-rows"
          rows={[
            { key: "kind", label: t("transfers:buyerCard.rowKind"), value: <strong>{t("transfers:buyerCard.kindBid")}</strong> },
            { key: "amount", label: t("transfers:buyerCard.rowAmount"), value: formatCz(amount), numeric: true },
            { key: "tied", label: t("transfers:buyerCard.rowTied"), value: t("transfers:buyerCard.tiedBid") },
          ]}
        />
        {retirementTier && (
          <p role="alert" className="flex items-start gap-2 rounded-cz border border-cz-warning/30 bg-cz-warning-bg/40 px-3 py-2 text-xs text-cz-warning">
            <AlertTriangleIcon size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>
              {t(`auctions:modal.retirementWarning.${retirementTier}`, {
                windowStart: RETIREMENT_WINDOW_START_AGE,
                guaranteedAge: RETIREMENT_GUARANTEED_AGE,
              })}
            </span>
          </p>
        )}
        <div className="flex justify-end gap-2 border-t border-cz-border pt-4">
          <Button type="button" variant="secondary" disabled={busy} onClick={dismiss}>
            {t("transfers:buyerCard.back")}
          </Button>
          <Button type="button" variant="primary" disabled={busy} loading={busy} onClick={onConfirm}>
            {t("transfers:buyerCard.sendBid")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
