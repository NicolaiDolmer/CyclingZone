import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useConsent } from "../lib/consent.jsx";

// Kategorierne er datadrevne; labels/beskrivelser resolves via i18n (#1170 —
// banneret var 100 % hardcodet dansk og vises for alle nye brugere, også EN).
const CATEGORIES = [
  { key: "necessary", locked: true },
  { key: "analytics" },
  { key: "marketing" },
  { key: "email_marketing" },
];

export default function CookieBanner() {
  const { t, i18n } = useTranslation("banners");
  const { bannerOpen, closeBanner, consent, saveConsent, acceptAll, rejectAll, hasResponded } = useConsent();
  const [mounted, setMounted] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState(() => ({
    analytics: consent.analytics,
    marketing: consent.marketing,
    email_marketing: consent.email_marketing,
  }));

  useEffect(() => {
    if (!bannerOpen) return;
    setDraft({
      analytics: consent.analytics,
      marketing: consent.marketing,
      email_marketing: consent.email_marketing,
    });
    setExpanded(false);
  }, [bannerOpen, consent.analytics, consent.marketing, consent.email_marketing]);

  // Render intet før efter mount: den offentlige landing prerendres (SSR), hvor
  // localStorage-consent er ukendt — et banner i server-HTML ville give et
  // hydration-mismatch for tilbagevendende brugere (de har consent → intet banner).
  // Banneret er en fixed overlay, så det giver ingen CLS når det dukker op et tick
  // efter mount.
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || !bannerOpen) return null;

  // Dual-page-mønster (jf. WaitlistConsentText): EN har sin egen privacy-side.
  const privacyPath = i18n.language?.startsWith("da") ? "/privatlivspolitik" : "/privacy-policy";

  function toggle(key) {
    setDraft(prev => ({ ...prev, [key]: !prev[key] }));
  }

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="cookie-banner-title"
      className="fixed inset-x-0 bottom-0 z-50 px-3 pb-3 sm:px-6 sm:pb-6"
    >
      <div className="mx-auto max-w-3xl bg-cz-card rounded-cz shadow-2xl border border-cz-border p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h2 id="cookie-banner-title" className="text-cz-1 font-bold text-base sm:text-lg">
              {t("consent.title")}
            </h2>
            <p className="text-cz-3 text-sm mt-1">
              {t("consent.intro")}{" "}
              <Link to={privacyPath} className="text-cz-accent-t underline">{t("consent.privacyLink")}</Link>.
            </p>
          </div>
          {hasResponded && (
            <button
              type="button"
              onClick={closeBanner}
              aria-label={t("consent.closeAriaLabel")}
              className="text-cz-3 hover:text-cz-1 text-xl leading-none px-1"
            >
              ×
            </button>
          )}
        </div>

        {expanded && (
          <ul className="space-y-3 mb-4 border-t border-cz-border pt-4">
            {CATEGORIES.map(cat => {
              const value = cat.locked ? true : draft[cat.key];
              return (
                <li key={cat.key} className="flex items-start gap-3">
                  <label className="relative inline-flex items-center cursor-pointer mt-1 shrink-0">
                    <input
                      type="checkbox"
                      checked={value}
                      disabled={cat.locked}
                      onChange={() => !cat.locked && toggle(cat.key)}
                      className="sr-only peer"
                    />
                    <span
                      className={
                        "w-10 h-6 rounded-full transition-colors " +
                        (cat.locked ? "bg-cz-3/40" : value ? "bg-cz-accent-t" : "bg-cz-subtle")
                      }
                    />
                    <span
                      className={
                        "absolute left-0.5 top-0.5 w-5 h-5 bg-white rounded-full transition-transform " +
                        (value ? "translate-x-4" : "")
                      }
                    />
                  </label>
                  <div className="flex-1">
                    <div className="text-cz-1 text-sm font-semibold">
                      {t(`consent.categories.${cat.key}.label`)}
                      {cat.locked && <span className="ms-2 text-cz-3 text-xs font-normal">{t("consent.alwaysOn")}</span>}
                    </div>
                    <div className="text-cz-3 text-xs">{t(`consent.categories.${cat.key}.desc`)}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
          {expanded ? (
            <button
              type="button"
              onClick={() => saveConsent(draft)}
              className="bg-cz-accent-t text-white font-semibold text-sm rounded-lg px-4 py-2 hover:opacity-90"
            >
              {t("consent.save")}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="bg-cz-subtle text-cz-1 font-semibold text-sm rounded-lg px-4 py-2 hover:bg-cz-subtle/70"
            >
              {t("consent.customize")}
            </button>
          )}
          <button
            type="button"
            onClick={rejectAll}
            className="bg-cz-subtle text-cz-1 font-semibold text-sm rounded-lg px-4 py-2 hover:bg-cz-subtle/70"
          >
            {t("consent.rejectAll")}
          </button>
          <button
            type="button"
            onClick={acceptAll}
            className="bg-cz-accent-t text-white font-semibold text-sm rounded-lg px-4 py-2 hover:opacity-90 sm:ms-auto"
          >
            {t("consent.acceptAll")}
          </button>
        </div>
      </div>
    </div>
  );
}
