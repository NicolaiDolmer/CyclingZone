import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

// #1569: ikon-emoji erstattet af editorial accent-markør (anti-AI-slop). Bemærk:
// OnboardingModal renderes ikke længere på dashboardet (#1140-konsolidering), men
// filen beholdes ren for evt. genbrug.
const CARDS = [
  { id: "market", link: "/riders" },
  { id: "auctions", link: "/auctions" },
  { id: "board", link: "/board" },
];

export default function OnboardingModal({ onClose }) {
  const { t } = useTranslation("auth");

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-start sm:items-center justify-center bg-black/60 p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-cz-card rounded-cz shadow-2xl max-w-lg w-full p-6 my-auto relative"
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label={t("onboardingModal.closeAria")}
          className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center rounded-full
            text-cz-3 hover:text-cz-1 hover:bg-cz-subtle transition-colors text-xl leading-none"
        >
          ×
        </button>

        <div className="mb-5 pr-8">
          <p className="text-cz-accent-t font-bold text-sm mb-0.5">{t("onboardingModal.eyebrow")}</p>
          <h2 className="text-cz-1 font-bold text-xl leading-tight">{t("onboardingModal.title")}</h2>
          <p className="text-cz-3 text-sm mt-1">{t("onboardingModal.subtitle")}</p>
        </div>

        <div className="grid gap-3 mb-5">
          {CARDS.map(card => (
            <div key={card.id} className="flex items-start gap-3 bg-cz-subtle border border-cz-border rounded-cz p-4">
              <span className="w-1 h-8 bg-cz-accent rounded-full flex-shrink-0 mt-0.5" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-cz-1 font-semibold text-sm">{t(`onboardingModal.cards.${card.id}.title`)}</p>
                <p className="text-cz-2 text-xs mt-0.5 mb-2 leading-relaxed">{t(`onboardingModal.cards.${card.id}.desc`)}</p>
                <Link to={card.link} onClick={onClose} className="text-cz-accent-t text-xs hover:underline font-medium">
                  {t(`onboardingModal.cards.${card.id}.cta`)}
                </Link>
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between pt-4 border-t border-cz-border">
          <Link
            to="/help"
            onClick={onClose}
            className="text-cz-3 text-xs hover:text-cz-accent-t transition-colors font-medium"
          >
            {t("onboardingModal.help")}
          </Link>
          <button
            onClick={onClose}
            className="px-5 py-2 bg-cz-accent hover:brightness-110 text-white font-bold rounded-lg text-sm transition-colors"
          >
            {t("onboardingModal.dismiss")}
          </button>
        </div>
      </div>
    </div>
  );
}
