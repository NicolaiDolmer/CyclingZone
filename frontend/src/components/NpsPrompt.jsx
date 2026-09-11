import { useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "./ui/Button.jsx";
import { XIcon } from "./ui/icons/index.jsx";
// #5159 (B1): et valgt tal og en halvskrevet begrundelse er usendt input.
import { useReloadBlock, RELOAD_BLOCK_REASONS } from "../lib/reloadGate.js";

// #940 In-app NPS — diskret bund-bar (IKKE blokerende modal). Omskrevet i #4997.
//
// Anatomi efter docs/design/PAGE_TEMPLATES.md + TASTE.md: hairline-ramme, 5 px
// radius, INGEN skygge, stroke-ikon i stedet for et ×-tegn (P7), tabulære cifre
// på skalaen (P5) og præcis ÉN guld primær-knap (Send, P3). 0-10-skalaen genbruger
// Segmented-idiomets aktiv-stil (guld TEKST på 10 % guld — guld-sted 3 "aktiv
// fane") i stedet for en udfyldt guld-flade, så baren ikke bruger guld to gange.
//
// Baren er lav som default: spørgsmål + skala står på én linje fra sm og op.
// Fritekst-feltet og Send folder først ud når spilleren har valgt et tal — indtil
// da er der intet at sende, og en tom textarea ville bare gøre baren høj.
//
// Komponenten er ren præsentation: visibility, submit, dismiss og done-state styres
// af useNpsPrompt. Den rendrer intet når visible=false.

const SCORES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

export default function NpsPrompt({ visible, done, submitting, onSubmit, onDismiss, onClose }) {
  const { t } = useTranslation("banners");
  const [score, setScore] = useState(null);
  const [reason, setReason] = useState("");

  // #5159 (B1): har spilleren valgt et tal eller skrevet en begrundelse, ligger
  // svaret KUN her indtil Send er igennem. `done` lukker porten igen — saa er der
  // ikke laengere noget usendt. Hookene kaldes foer det tidlige return
  // (rules-of-hooks).
  useReloadBlock(
    Boolean(visible && !done && (score !== null || reason)),
    RELOAD_BLOCK_REASONS.DIRTY,
  );
  useReloadBlock(Boolean(submitting), RELOAD_BLOCK_REASONS.BUSY);

  if (!visible) return null;

  async function handleSubmit() {
    if (score === null) return;
    await onSubmit({ score, reason });
  }

  return (
    <div
      role="region"
      aria-label={t("nps.regionAriaLabel")}
      className="fixed inset-x-0 bottom-0 z-toast px-3 pb-3 sm:px-4 sm:pb-4 pointer-events-none"
    >
      <div className="mx-auto max-w-3xl bg-cz-card border border-cz-border rounded-cz pointer-events-auto">
        {done ? (
          <div className="flex items-center gap-3 px-3 py-2.5 sm:px-4">
            <p className="flex-1 text-[13px] text-cz-1">{t("nps.thanks")}</p>
            <button
              type="button"
              onClick={onClose}
              aria-label={t("nps.dismissAriaLabel")}
              className="shrink-0 text-cz-3 hover:text-cz-1 transition-colors p-1"
            >
              <XIcon size={14} aria-hidden="true" />
            </button>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:gap-4 sm:px-4">
              <p className="text-[13px] font-medium text-cz-1 leading-snug sm:flex-1 sm:min-w-0">
                {t("nps.question")}
              </p>

              <div className="flex items-start gap-2 sm:shrink-0">
                {/* 0-10 — ét segmenteret bånd (aldrig wrap), endepunkts-labels under.
                    Segmenterne strækker sig over hele bredden på mobil og får en
                    fast 32 px bredde fra sm, så båndet ikke klemmes sammen når
                    spørgsmålet deler linjen med det. */}
                <div className="flex-1 min-w-0 sm:flex-none">
                  <div
                    role="radiogroup"
                    aria-label={t("nps.question")}
                    className="flex overflow-hidden rounded-cz border border-cz-border"
                  >
                    {SCORES.map((n) => {
                      const active = score === n;
                      return (
                        <button
                          key={n}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          onClick={() => setScore(n)}
                          className={`flex-1 sm:flex-none sm:w-8 border-s border-cz-border first:border-s-0 py-1.5 font-mono text-2xs font-semibold tabular-nums transition-colors duration-150 ${
                            active
                              ? "bg-cz-accent/10 text-cz-accent-t"
                              : "bg-cz-card text-cz-2 hover:text-cz-1"
                          }`}
                        >
                          {n}
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-1 flex justify-between text-3xs text-cz-3">
                    <span>{t("nps.scaleLow")}</span>
                    <span>{t("nps.scaleHigh")}</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => onDismiss({ scoreSelected: score !== null })}
                  disabled={submitting}
                  aria-label={t("nps.dismissAriaLabel")}
                  className="shrink-0 text-cz-3 hover:text-cz-1 transition-colors p-1 disabled:opacity-40 disabled:pointer-events-none"
                >
                  <XIcon size={14} aria-hidden="true" />
                </button>
              </div>
            </div>

            {score !== null && (
              <div className="border-t border-cz-border px-3 py-2.5 sm:px-4">
                <label htmlFor="nps-reason" className="sr-only">
                  {t("nps.reasonLabel")}
                </label>
                <textarea
                  id="nps-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={2}
                  maxLength={500}
                  placeholder={t("nps.reasonPlaceholder")}
                  className="w-full resize-none rounded-cz border border-cz-border bg-cz-subtle px-3 py-2 text-[13px] text-cz-1 focus:border-cz-accent focus:outline-none"
                />
                <div className="mt-2 flex items-center gap-2">
                  <Button size="sm" onClick={handleSubmit} loading={submitting}>
                    {t("nps.submit")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={submitting}
                    onClick={() => onDismiss({ scoreSelected: true })}
                  >
                    {t("nps.notNow")}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
