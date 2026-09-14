import { useState, type ChangeEvent, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import Modal from "./ui/Modal.jsx";
import Field from "./ui/Field.jsx";
import Textarea from "./ui/Textarea.jsx";
import Button from "./ui/Button.jsx";
import { authHeaders } from "../lib/supabase";
import { validateTradeReport, TRADE_REPORT_MESSAGE_MAX_LENGTH, TRADE_REPORT_MESSAGE_MIN_LENGTH } from "../lib/tradeReport";

const API = import.meta.env.VITE_API_URL;

type ReportResult = "sent" | "alreadyReported" | null;

interface ReportTradeDialogProps {
  open: boolean;
  onClose?: () => void;
  transferType?: string | null;
  transferId?: string | null;
}

// #4346 — "Report for review" på den enkelte gennemførte handel
// (TeamTransferHistoryTab). Samme dialog-form som FeedbackModal.jsx (#2602):
// et lille fritekst-felt, sendt til samme player_feedback-kanal. Tone (#3139):
// "rapportér til gennemsyn", ALDRIG en anklage — ingen rød/advarende farver,
// ingen "mistænkelig"-ordvalg i copy.
export default function ReportTradeDialog({ open, onClose, transferType, transferId }: ReportTradeDialogProps) {
  const { t } = useTranslation("transfers");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReportResult>(null);

  function handleClose() {
    if (submitting) return;
    // Synkron reset (CodeRabbit-fund, ret 14/9): Modal.jsx har INGEN
    // luk-animation (returnerer null øjeblikkeligt når open bliver false), så
    // der er intet "animations-vindue" at vente ud. TeamTransferHistoryTab
    // holder ReportTradeDialog monteret på tværs af åbn/luk (kun Modal-
    // indholdet af- og genmonteres) — en forsinket reset kunne derfor nå at
    // rydde en NY dialogs state, hvis spilleren lukker og genåbner inden for
    // 200ms. FeedbackModal.jsx har samme mønster (og samme latente bug); ude
    // af scope for denne PR, flagget som opfølgning.
    setMessage("");
    setError(null);
    setResult(null);
    onClose?.();
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const validationError = validateTradeReport({ message });
    if (validationError) {
      setError(t(validationError, { min: TRADE_REPORT_MESSAGE_MIN_LENGTH, max: TRADE_REPORT_MESSAGE_MAX_LENGTH }));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const headers = await authHeaders();
      if (!headers || !API || !transferType || !transferId) {
        setError(t("report.error"));
        return;
      }
      const res = await fetch(`${API}/api/transfers/${transferType}/${transferId}/report`, {
        method: "POST",
        headers,
        body: JSON.stringify({ message: message.trim() }),
      });
      if (res.status === 429) {
        setError(t("report.rateLimited"));
        return;
      }
      if (!res.ok) {
        setError(t("report.error"));
        return;
      }
      const data = await res.json();
      setResult(data?.alreadyReported ? "alreadyReported" : "sent");
    } catch {
      setError(t("report.error"));
    } finally {
      setSubmitting(false);
    }
  }

  const remaining = TRADE_REPORT_MESSAGE_MAX_LENGTH - message.length;

  return (
    <Modal
      open={open}
      onClose={handleClose}
      size="md"
      closeLabel={t("report.close")}
      title={t("report.title")}
      description={t("report.subtitle")}
      footer={undefined}
      ariaLabelledby={undefined}
    >
      {result ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-cz-1">{result === "alreadyReported" ? t("report.alreadyDone") : t("report.done")}</p>
          <Button type="button" variant="primary" onClick={handleClose}>
            {t("report.closeAction")}
          </Button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field
            label={t("report.messageLabel")}
            htmlFor="report-trade-message"
            helper={t("report.messageHelper", { count: remaining })}
            error={undefined}
          >
            <Textarea
              id="report-trade-message"
              rows={4}
              value={message}
              disabled={submitting}
              maxLength={TRADE_REPORT_MESSAGE_MAX_LENGTH}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setMessage(e.target.value)}
              placeholder={t("report.messagePlaceholder")}
            />
          </Field>

          {error && <p className="text-xs text-cz-danger">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={handleClose} disabled={submitting}>
              {t("report.cancel")}
            </Button>
            <Button type="submit" variant="primary" size="sm" loading={submitting} disabled={submitting}>
              {t("report.confirm")}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
