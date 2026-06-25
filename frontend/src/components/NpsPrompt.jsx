import { useState } from "react";
import { useTranslation } from "react-i18next";

// #940 In-app NPS — diskret bund-slide-in (IKKE blokerende modal). Editorial stil:
// ingen emoji/glow/gradient (anti-AI-slop). Genbruger consent-bannerets fixed-bund-
// mønster + cz-tokens. Trin: (1) 0-10-skala, (2) valgfri fritekst → tak.
//
// Komponenten er ren præsentation: visibility, submit, dismiss og done-state styres
// af useNpsPrompt. Den rendrer intet når visible=false.

const SCORES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

export default function NpsPrompt({ visible, done, submitting, onSubmit, onDismiss, onClose }) {
  const { t } = useTranslation("banners");
  const [score, setScore] = useState(null);
  const [reason, setReason] = useState("");

  if (!visible) return null;

  async function handleSubmit() {
    if (score === null) return;
    await onSubmit({ score, reason });
  }

  return (
    <div
      role="region"
      aria-label={t("nps.regionAriaLabel")}
      className="fixed inset-x-0 bottom-0 z-40 px-3 pb-3 sm:px-6 sm:pb-6 pointer-events-none"
    >
      <div className="mx-auto max-w-md bg-cz-card border border-cz-border rounded-cz shadow-2xl p-4 sm:p-5 pointer-events-auto">
        {done ? (
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm text-cz-1">{t("nps.thanks")}</p>
            <button
              type="button"
              onClick={onClose}
              aria-label={t("nps.dismissAriaLabel")}
              className="shrink-0 text-cz-3 hover:text-cz-1 text-lg leading-none px-1"
            >
              ×
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-3 mb-3">
              <p className="text-sm font-semibold text-cz-1">{t("nps.question")}</p>
              <button
                type="button"
                onClick={onDismiss}
                aria-label={t("nps.dismissAriaLabel")}
                className="shrink-0 text-cz-3 hover:text-cz-1 text-lg leading-none px-1"
              >
                ×
              </button>
            </div>

            {/* 0-10-skala — kompakt række af knapper. Endepunkts-labels under. */}
            <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={t("nps.question")}>
              {SCORES.map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={score === n}
                  onClick={() => setScore(n)}
                  className={`w-8 h-8 rounded-md border text-xs font-mono font-semibold transition-colors
                    ${score === n
                      ? "bg-cz-accent text-white border-cz-accent"
                      : "bg-cz-subtle text-cz-2 border-cz-border hover:border-cz-3 hover:text-cz-1"}`}
                >
                  {n}
                </button>
              ))}
            </div>
            <div className="flex justify-between text-[10px] text-cz-3 mt-1 px-0.5">
              <span>{t("nps.scaleLow")}</span>
              <span>{t("nps.scaleHigh")}</span>
            </div>

            {score !== null && (
              <div className="mt-3">
                <label htmlFor="nps-reason" className="block text-xs text-cz-2 mb-1">
                  {t("nps.reasonLabel")}
                </label>
                <textarea
                  id="nps-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={2}
                  maxLength={500}
                  placeholder={t("nps.reasonPlaceholder")}
                  className="w-full bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-sm text-cz-1 focus:outline-none focus:border-cz-accent resize-none"
                />
              </div>
            )}

            <div className="flex items-center gap-2 mt-3">
              <button
                type="button"
                onClick={handleSubmit}
                disabled={score === null || submitting}
                className="bg-cz-accent text-white font-semibold text-sm rounded-lg px-4 py-1.5 hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                {t("nps.submit")}
              </button>
              <button
                type="button"
                onClick={onDismiss}
                className="text-cz-3 hover:text-cz-1 text-sm px-2 py-1.5 transition-colors"
              >
                {t("nps.notNow")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
