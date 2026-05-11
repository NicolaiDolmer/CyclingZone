import { useState } from "react";
import { Link } from "react-router-dom";
import { useConsent } from "../lib/consent.jsx";

const CATEGORIES = [
  {
    key: "necessary",
    label: "Nødvendige",
    desc: "Login, session og dine kontoindstillinger. Spillet virker ikke uden.",
    locked: true,
  },
  {
    key: "analytics",
    label: "Analyse",
    desc: "Vi måler anonymt hvilke knapper der frustrerer brugere (fx via Microsoft Clarity), så vi kan rette dårlig UX.",
  },
  {
    key: "marketing",
    label: "Marketing",
    desc: "Bruges ikke i dag. Hvis vi senere viser annoncer eller remarketer, sker det kun hvis du siger ja her.",
  },
  {
    key: "email_marketing",
    label: "E-mail",
    desc: "Sjældne nyhedsmails om store sæsonopdateringer eller events. Transaktionelle mails (auktion vundet osv.) afhænger ikke af dette valg.",
  },
];

export default function CookieBanner() {
  const { bannerOpen, closeBanner, consent, saveConsent, acceptAll, rejectAll, hasResponded } = useConsent();
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState(() => ({
    analytics: consent.analytics,
    marketing: consent.marketing,
    email_marketing: consent.email_marketing,
  }));

  if (!bannerOpen) return null;

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
      <div className="mx-auto max-w-3xl bg-cz-card rounded-2xl shadow-2xl border border-cz-border p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h2 id="cookie-banner-title" className="text-cz-1 font-bold text-base sm:text-lg">
              Vi bruger data til at gøre spillet bedre
            </h2>
            <p className="text-cz-3 text-sm mt-1">
              Du bestemmer hvad vi må måle. Du kan altid skifte valg i din profil under &quot;Privatliv&quot;.{" "}
              <Link to="/privatlivspolitik" className="text-cz-accent-t underline">Læs privatlivspolitikken</Link>.
            </p>
          </div>
          {hasResponded && (
            <button
              type="button"
              onClick={closeBanner}
              aria-label="Luk uden at ændre"
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
                    <div className="text-cz-1 text-sm font-semibold">{cat.label}{cat.locked && <span className="ml-2 text-cz-3 text-xs font-normal">(altid på)</span>}</div>
                    <div className="text-cz-3 text-xs">{cat.desc}</div>
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
              Gem mine valg
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="bg-cz-subtle text-cz-1 font-semibold text-sm rounded-lg px-4 py-2 hover:bg-cz-subtle/70"
            >
              Tilpas
            </button>
          )}
          <button
            type="button"
            onClick={rejectAll}
            className="bg-cz-subtle text-cz-1 font-semibold text-sm rounded-lg px-4 py-2 hover:bg-cz-subtle/70"
          >
            Kun nødvendige
          </button>
          <button
            type="button"
            onClick={acceptAll}
            className="bg-cz-accent-t text-white font-semibold text-sm rounded-lg px-4 py-2 hover:opacity-90 sm:ml-auto"
          >
            Accepter alle
          </button>
        </div>
      </div>
    </div>
  );
}
