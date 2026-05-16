import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import FounderSupporterWaitlistForm from "../components/waitlist/FounderSupporterWaitlistForm.jsx";

// Standalone preview-side til waitlist-formen (#362). Public route — ingen auth required.
//
// Landing page (#361) bygger eventuelt en richer page med tier-pris-varianter,
// social proof, feature-highlights osv. Indtil da fungerer denne side som:
//   - Preview til form-feltvalidering
//   - Faktisk capture-endpoint for Discord-share / dev-feedback
//
// Pris-variant detection: `?variant=A|B|C` mapper til human-label så survey-takeren
// kan se hvilken pris de blev vist (Option B fra #362-design: utm_campaign er
// canonical attribution, ?variant er debug-hint).

const VARIANT_LABELS = {
  A: "Supporter 29 / Pro 49 DKK",
  B: "Supporter 49 / Pro 89 DKK",
  C: "Supporter 69 / Pro 119 DKK",
};

export default function FounderSupporterPage() {
  const [searchParams] = useSearchParams();
  const variantLabel = useMemo(() => {
    const v = (searchParams.get("variant") || "").toUpperCase();
    return VARIANT_LABELS[v] || null;
  }, [searchParams]);

  return (
    <div className="min-h-screen bg-cz-body py-8 px-4 sm:py-12 sm:px-6">
      <div className="max-w-2xl mx-auto">
        <header className="mb-8 text-center">
          <Link to="/" className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-cz-accent shadow-[0_0_30px_rgba(232,197,71,0.3)]">
            <span className="text-cz-on-accent font-black text-xl">C</span>
          </Link>
          <h1 className="text-cz-1 text-3xl sm:text-4xl font-bold mt-5 tracking-tight">
            Bliv Founder Supporter
          </h1>
          <p className="text-cz-2 text-sm sm:text-base mt-3 max-w-lg mx-auto">
            Vi tester om der er nok cyklister der vil støtte Cycling Zone økonomisk.
            Tilmeld dig waitlisten — det er ikke bindende, men hjælper os afgøre om
            betalte features overhovedet skal lanceres.
          </p>
          <div className="mt-4 flex items-center justify-center gap-4 text-cz-3 text-xs">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-cz-accent" />
              30-dages validation-sprint
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-cz-accent" />
              GDPR-compliant
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-cz-accent" />
              Ikke-bindende
            </span>
          </div>
        </header>

        <FounderSupporterWaitlistForm priceVariantLabel={variantLabel} />

        <footer className="mt-8 text-center">
          <Link to="/login" className="text-cz-3 text-xs hover:text-cz-1 transition-colors">
            ← Tilbage til Cycling Zone
          </Link>
        </footer>
      </div>
    </div>
  );
}
