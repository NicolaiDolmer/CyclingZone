// Onboarding v2 Slice 4 (v2.19) — celebration-kort på Dashboard når alle 4 trin er
// gennemført. Lukker post-onboarding-cliff'et: før slice 4 forsvandt OnboardingProgressCard
// bare ved completion. Nu får manager en eksplicit "du er klar"-marker + pegning på næste
// fase. Dismiss persisteres i localStorage cz-dashboard-onboarding-completion-dismissed.

import { Link } from "react-router-dom";

const NEXT_LINKS = [
  { to: "/deadline-day", icon: "🔔", label: "Deadline Day", desc: "Følg transfervinduet når det lukker" },
  { to: "/board", icon: "🏛️", label: "Bestyrelse", desc: "Forhandl 1yr/3yr/5yr-planer parallelt" },
  { to: "/help", icon: "📖", label: "Hjælp & regler", desc: "Dyk ned i økonomi, racing og taktik" },
];

export default function OnboardingCompletionCard({ onDismiss }) {
  return (
    <div className="mb-4 px-5 py-4 bg-cz-card border border-cz-success/30 rounded-xl">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <span className="text-2xl flex-shrink-0">🎉</span>
          <div className="min-w-0">
            <p className="text-cz-1 text-base font-semibold">Du er klar — grundforløbet er gennemført</p>
            <p className="text-cz-2 text-xs mt-0.5">
              Alle fire kom-i-gang-trin er afkrydset. Næste fase er at bygge dit hold over flere
              sæsoner — følg Deadline Day, lever på bestyrelsens mål, og kæmp for oprykning.
            </p>
          </div>
        </div>
        <button
          onClick={onDismiss}
          className="text-cz-3 hover:text-cz-1 text-lg leading-none px-1 flex-shrink-0"
          aria-label="Skjul"
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
              <p className="text-cz-1 text-sm font-semibold">{link.label}</p>
            </div>
            <p className="text-cz-3 text-xs">{link.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
