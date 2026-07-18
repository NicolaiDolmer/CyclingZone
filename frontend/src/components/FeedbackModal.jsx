import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import Modal from "./ui/Modal.jsx";
import Field from "./ui/Field.jsx";
import Textarea from "./ui/Textarea.jsx";
import Button from "./ui/Button.jsx";
import { getSession } from "../lib/supabase";
import { FEEDBACK_CATEGORIES, FEEDBACK_MESSAGE_MAX_LENGTH, validateFeedback, captureContext } from "../lib/feedbackForm.js";

const API = import.meta.env.VITE_API_URL;

async function authHeaders() {
  const { data } = await getSession();
  const token = data?.session?.access_token;
  return token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : null;
}

// #2602: in-game feedback/bug-report/idea-modal — de eneste veje ind for spillere
// uden Discord. Åbnes fra samme sted som Help i sidebar/bottom-nav (Layout.jsx),
// aldrig som en flydende knap oven på spilfladen. Genbruger Modal-primitiven
// (samme mønster som SponsorOfferModal) + Field/Textarea/Button.
export default function FeedbackModal({ open, onClose }) {
  const { t } = useTranslation("feedback");
  const location = useLocation();
  const [category, setCategory] = useState("feedback");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(false);

  function handleClose() {
    if (submitting) return;
    onClose?.();
    // Reset after the close animation window so a re-open never flashes stale state.
    setTimeout(() => {
      setCategory("feedback");
      setMessage("");
      setError(null);
      setSent(false);
    }, 200);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const validationError = validateFeedback({ category, message });
    if (validationError) {
      setError(t(validationError));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const headers = await authHeaders();
      if (!headers || !API) {
        setError(t("error.generic"));
        return;
      }
      const context = captureContext({
        pathname: location.pathname,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
      });
      const res = await fetch(`${API}/api/feedback`, {
        method: "POST",
        headers,
        body: JSON.stringify({ category, message: message.trim(), ...context }),
      });
      if (res.status === 429) {
        setError(t("error.rateLimited"));
        return;
      }
      if (!res.ok) {
        setError(t("error.generic"));
        return;
      }
      setSent(true);
    } catch {
      setError(t("error.generic"));
    } finally {
      setSubmitting(false);
    }
  }

  const remaining = FEEDBACK_MESSAGE_MAX_LENGTH - message.length;

  return (
    <Modal
      open={open}
      onClose={handleClose}
      size="md"
      closeLabel={t("close")}
      ariaLabelledby="feedback-modal-title"
    >
      <div className="mb-4">
        <h2 id="feedback-modal-title" className="font-display text-2xl leading-none tracking-[.01em] text-cz-1">
          {t("title")}
        </h2>
        <p className="mt-1.5 text-sm text-cz-2">{t("subtitle")}</p>
      </div>

      {sent ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-cz-1">{t("sent.text")}</p>
          <Button type="button" variant="primary" onClick={handleClose}>
            {t("sent.close")}
          </Button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field label={t("field.category")}>
            <div role="group" aria-label={t("field.category")} className="inline-flex rounded border border-cz-border overflow-hidden">
              {FEEDBACK_CATEGORIES.map((key) => (
                <button
                  key={key}
                  type="button"
                  disabled={submitting}
                  onClick={() => setCategory(key)}
                  aria-pressed={category === key}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                    category === key ? "bg-cz-accent text-cz-on-accent" : "text-cz-2 hover:bg-cz-subtle"
                  }`}
                >
                  {t(`category.${key}`)}
                </button>
              ))}
            </div>
          </Field>

          <Field label={t("field.message")} htmlFor="feedback-message" helper={t("field.messageHelper", { count: remaining })}>
            <Textarea
              id="feedback-message"
              rows={5}
              value={message}
              disabled={submitting}
              maxLength={FEEDBACK_MESSAGE_MAX_LENGTH}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={t(`category.${category}Placeholder`)}
            />
          </Field>

          {error && <p className="text-xs text-cz-danger">{error}</p>}

          <Button type="submit" variant="primary" loading={submitting} disabled={submitting}>
            {t("submit")}
          </Button>
        </form>
      )}
    </Modal>
  );
}
