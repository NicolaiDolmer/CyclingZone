import { Link } from "react-router";
import { useDocumentHead } from "../hooks/useDocumentHead.js";
import { Wordmark } from "../components/Brand.jsx";
import { Section, SectionHeader, SectionStack } from "../components/ui";
import { ChevronLeftIcon } from "../components/ui/icons/index.jsx";

// #2813: Terms of Sale for CZ Pro. EN-udgaven i dual-page-mønsteret — spejler
// TermsPage.jsx (dansk er den primære juridiske tekst). Hold de to filer
// strukturelt identiske ved fremtidige ændringer.
export default function TermsPageEn() {
  useDocumentHead({
    title: "Terms of Sale · Cycling Zone",
    description:
      "Terms of Sale for CZ Pro: price, automatic renewal, cancellation and right of withdrawal.",
    canonical: "https://cyclingzone.org/terms",
    lang: "en",
  });

  return (
    <div className="min-h-screen bg-cz-body py-10 px-4 sm:px-6">
      <div className="max-w-3xl mx-auto">
        <div className="mb-6 flex items-start justify-between gap-3">
          <div>
            <Link to="/" aria-label="Cycling Zone" className="inline-block">
              <Wordmark className="h-4 w-auto mb-3" alt="" />
            </Link>
            <h1 className="text-cz-1 font-display text-4xl tracking-tight leading-none">Terms of Sale</h1>
          </div>
          <div className="flex flex-shrink-0 items-center gap-3 text-sm pt-1">
            <Link to="/handelsbetingelser" className="text-cz-3 hover:text-cz-1">Dansk</Link>
            <Link to="/" className="inline-flex items-center gap-1 text-cz-3 hover:text-cz-1">
              <ChevronLeftIcon size={14} aria-hidden="true" />Back
            </Link>
          </div>
        </div>

        <p className="text-cz-3 text-sm mb-6">
          Last updated: 2 September 2026 · Version 2026-09-02. Applies to purchases of the CZ Pro subscription in the browser game Cycling Zone. The Danish version is the primary legal text.
        </p>

        <SectionStack>
          <Section>
            <SectionHeader title="1. Seller" />
            <div className="text-cz-2 text-sm leading-relaxed">
              <p>
                Cycling Zone is operated by <strong>Dolmer Digital</strong> (Danish CVR 46524861), a sole proprietorship operated by Nicolai Dolmer Mikkelsen. It is the same legal entity as in the{" "}
                <Link to="/privacy-policy" className="text-cz-accent-t underline">privacy policy</Link>.
              </p>
              <p className="mt-2">
                Contact: via the Discord server (the same channel the privacy policy refers to) or an e-mail listed on the{" "}
                <Link to="/help" className="text-cz-accent-t underline">Help page</Link>.
              </p>
            </div>
          </Section>

          <Section>
            <SectionHeader title="2. What you buy" />
            <div className="text-cz-2 text-sm leading-relaxed">
              <p>
                CZ Pro is a voluntary supporter subscription for the browser game Cycling Zone. Pro adds depth, comfort and cosmetic features, never a competitive advantage. The free game remains fully playable and competitive without Pro.
              </p>
            </div>
          </Section>

          <Section>
            <SectionHeader title="3. Price and payment" />
            <div className="text-cz-2 text-sm leading-relaxed">
              <ul className="list-disc pl-5 space-y-1">
                <li>Monthly subscription: EUR 6.49 per month.</li>
                <li>6-month subscription: EUR 34.99 per 6 months.</li>
                <li>Prices are charged in euro when Cycling Zone is played in English, and in Danish kroner when played in Danish. The game&apos;s language decides the currency.</li>
                <li>All prices are the total price you pay, including any applicable VAT. No fees or surcharges are added.</li>
                <li>Payment is handled by our payment provider Alunta. We never store your card details.</li>
              </ul>
            </div>
          </Section>

          <Section>
            <SectionHeader title="4. Automatic renewal" />
            <div className="text-cz-2 text-sm leading-relaxed">
              <p>
                The subscription renews automatically at the end of each period (month or 6 months) at the price applicable at any given time, until you cancel. You receive a receipt by e-mail for every charge. Price changes are announced at least 30 days before they take effect; a price change always gives you the right to cancel before the new price applies.
              </p>
            </div>
          </Section>

          <Section>
            <SectionHeader title="5. Cancellation" />
            <div className="text-cz-2 text-sm leading-relaxed">
              <p>
                You can cancel at any time, effective at the end of the current paid period. There is no lock-in beyond the period. Cancel via &quot;Manage subscription&quot; in your{" "}
                <Link to="/profile" className="text-cz-accent-t underline">account settings</Link>, which opens the self-service portal at our payment provider. You can also always contact us (see §1) and we will cancel manually the same day.
              </p>
              <p className="mt-2">
                Paid periods are not refunded on cancellation, but Pro features remain active until the period ends.
              </p>
            </div>
          </Section>

          <Section>
            <SectionHeader title="6. Right of withdrawal" />
            <div className="text-cz-2 text-sm leading-relaxed">
              <p>
                As an EU consumer you have a 14-day right of withdrawal for online purchases. <strong>Note:</strong> CZ Pro is digital content/a digital service delivered immediately. By purchasing you expressly consent to delivery starting right away, and you acknowledge that the right of withdrawal thereby lapses for the started period.
              </p>
            </div>
          </Section>

          <Section>
            <SectionHeader title="7. Founder status" />
            <div className="text-cz-2 text-sm leading-relaxed">
              <p>
                The first 50 paying subscribers receive permanent Founder status (badge). The Founder badge is kept permanently, even if the subscription later ends. Founder status is cosmetic.
              </p>
            </div>
          </Section>

          <Section>
            <SectionHeader title="8. Beta notice" />
            <div className="text-cz-2 text-sm leading-relaxed">
              <p>
                Cycling Zone is in open beta. Features, including Pro features, may be changed, rebalanced or removed as part of the game&apos;s development. Material degradation of Pro&apos;s content entitles you to cancel per §5. We may shut down the game with at least 30 days&apos; notice; prepaid periods beyond the shutdown date are refunded pro rata.
              </p>
            </div>
          </Section>

          <Section>
            <SectionHeader title="9. Complaints and disputes" />
            <div className="text-cz-2 text-sm leading-relaxed">
              <p>
                Purchases are covered by the ordinary remedies of Danish/EU consumer law. Direct complaints to us first (see §1). You may also complain to the Danish complaint bodies (Nævnenes Hus / Center for Klageløsning), and the EU Commission&apos;s online dispute resolution platform (ODR) is available.
              </p>
            </div>
          </Section>

          <Section>
            <SectionHeader title="10. Privacy" />
            <div className="text-cz-2 text-sm leading-relaxed">
              <p>
                Processing of personal data is described in the{" "}
                <Link to="/privacy-policy" className="text-cz-accent-t underline">privacy policy</Link>.
              </p>
            </div>
          </Section>
        </SectionStack>
      </div>
    </div>
  );
}
