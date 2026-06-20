import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { formatNumber } from "../lib/intl";
import { TrophyIcon } from "./ui";

// Restrained, on-brand celebration (#1588 WP3). The old version rained 32
// animate-bounce particles in 5 off-palette colours (pink/violet/blue): a
// party-popper that broke the refined/restrained brand DNA. Replaced with a
// quiet reveal: a single TrophyIcon in a gold ring, a Bebas display title, and
// the amount in Inter Tight tabular, on the shared flat overlay tokens (no
// rainbow, no bounce, no coloured glow). API (show/onClose/title/subtitle/
// amount/icon) is unchanged so the three call sites need no edits.
export function ConfettiModal({ show, onClose, title, subtitle, amount, icon }) {
  const { t } = useTranslation("common");

  useEffect(() => {
    if (!show) return;
    // Auto-close after 4 seconds (unchanged behaviour).
    const timer = setTimeout(onClose, 4000);
    return () => clearTimeout(timer);
  }, [show, onClose]);

  if (!show) return null;

  return (
    <div
      className="fixed inset-0 z-modal flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="cz-overlay-backdrop absolute inset-0 bg-black/60" aria-hidden="true" />

      <div
        className="cz-overlay-panel relative z-10 w-full max-w-sm rounded-cz border border-cz-border
          bg-cz-card p-8 text-center shadow-overlay"
      >
        <div className="mb-4 flex justify-center" aria-hidden="true">
          <span className="inline-flex h-16 w-16 items-center justify-center rounded-cz-pill border border-cz-accent/40 bg-cz-accent/10 text-cz-accent-t">
            {icon ?? <TrophyIcon size={32} />}
          </span>
        </div>
        <h2 className="text-cz-1 font-display text-3xl tracking-tight leading-none">{title}</h2>
        {subtitle && <p className="text-cz-2 text-sm mt-2">{subtitle}</p>}
        {amount > 0 && (
          <p className="text-cz-accent-t font-data font-bold text-2xl tabular-nums mt-4">
            {formatNumber(amount)} CZ$
          </p>
        )}
        <p className="text-cz-3 text-xs mt-5">{t("actions.clickToClose")}</p>
      </div>
    </div>
  );
}
