// Onboarding v2 Slice 4 (v2.19) — celebration-kort på Dashboard når alle 4 trin er
// gennemført. Lukker post-onboarding-cliff'et: før slice 4 forsvandt OnboardingProgressCard
// bare ved completion. Nu får manager en eksplicit "du er klar"-marker + pegning på næste
// fase. Dismiss persisteres i localStorage cz-dashboard-onboarding-completion-dismissed.

import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

const NEXT_LINKS = [
  { to: "/deadline-day", icon: "🔔", key: "deadlineDay" },
  { to: "/board", icon: "🏛️", key: "board" },
  { to: "/help", icon: "📖", key: "help" },
];

export default function OnboardingCompletionCard({ onDismiss }) {
  const { t } = useTranslation("dashboard");

  return (
    <div className="mb-4 px-5 py-4 bg-cz-card border border-cz-success/30 rounded-cz">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <span className="text-2xl flex-shrink-0">🎉</span>
          <div className="min-w-0">
            <p className="text-cz-1 text-base font-semibold">{t("onboardingComplete.title")}</p>
            <p className="text-cz-2 text-xs mt-0.5">{t("onboardingComplete.body")}</p>
          </div>
        </div>
        <button
          onClick={onDismiss}
          className="text-cz-3 hover:text-cz-1 text-lg leading-none px-1 flex-shrink-0"
          aria-label={t("onboardingComplete.dismissAria")}
        >
          ×
        </button>
      </div>

      <div className="grid sm:grid-cols-3 gap-2">
        {NEXT_LINKS.map(link => (
          <Link
            key={link.to}
            to={link.to}
            className="bg-cz-subtle border border-cz-border rounded-lg p-3 hover:border-cz-accent/40 transition-all"
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="text-base">{link.icon}</span>
              <p className="text-cz-1 text-sm font-semibold">{t(`onboardingComplete.nextLinks.${link.key}.label`)}</p>
            </div>
            <p className="text-cz-3 text-xs">{t(`onboardingComplete.nextLinks.${link.key}.desc`)}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
