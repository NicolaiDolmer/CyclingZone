import { Link } from "react-router-dom";
import { useConsent } from "../lib/consent.jsx";
import { useDocumentHead } from "../hooks/useDocumentHead.js";

export default function PrivacyPolicyPageEn() {
  const { openBanner, consent } = useConsent();

  // Per-route head (#1404/#1301). EN-udgaven i dual-page-mønsteret.
  useDocumentHead({
    title: "Privacy policy · Cycling Zone",
    description:
      "How Cycling Zone handles your data: as little as possible, EU-hosted, and you decide what we may measure.",
    canonical: "https://cyclingzone.org/privacy-policy",
    lang: "en",
  });

  return (
    <div className="min-h-screen bg-cz-body py-10 px-4 sm:px-6">
      <div className="max-w-3xl mx-auto bg-cz-card rounded-2xl shadow-lg p-6 sm:p-8">
        <div className="mb-6 flex items-center justify-between gap-3">
          <h1 className="text-cz-1 font-bold text-2xl">Privacy policy</h1>
          <div className="flex items-center gap-3 text-sm">
            <Link to="/privatlivspolitik" className="text-cz-3 hover:text-cz-1">Dansk</Link>
            <Link to="/" className="text-cz-3 hover:text-cz-1">← Back</Link>
          </div>
        </div>

        <p className="text-cz-3 text-sm mb-6">
          Last updated: 4 June 2026. Cycling Zone is an open beta operated by Dolmer Digital (Danish CVR 46524861).
          We process as little data as possible, and you decide what we may measure.
        </p>

        <Section title="Who is the data controller?">
          <p>
            <strong>Dolmer Digital</strong> (Danish CVR 46524861), a sole proprietorship operated by Nicolai Dolmer Mikkelsen. Cycling Zone is a product of Dolmer Digital.
          </p>
          <p className="mt-2">
            Requests regarding your data (access, deletion, portability, objection) can be sent via Discord (preferred) or via an email listed on the{" "}
            <Link to="/help" className="text-cz-accent-t underline">Help page</Link>. We normally respond within a few days, and at the latest within one month per GDPR art. 12.
          </p>
        </Section>

        <Section title="What data do we process?">
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Account:</strong> email, username, chosen team name and manager name (required to log in and play).</li>
            <li><strong>Game data:</strong> your team&apos;s economy, riders, auctions, board status, season results (everything created by playing).</li>
            <li><strong>Optional:</strong> your Discord ID if you add it to receive DM notifications.</li>
            <li><strong>Technical:</strong> IP address in access logs for up to 30 days, used for operations and security.</li>
            <li><strong>Analytics (consent only):</strong> anonymous behavioural data via Microsoft Clarity (e.g. where users click in vain or scroll in frustration) and anonymous traffic/source statistics via Google Analytics (e.g. which page you arrived from). Used only to fix bad UX and understand where players find the game.</li>
            <li><strong>Acquisition source (legitimate interest):</strong> when you create an account we record how you first reached the site (a referring link, any campaign tags in the URL, and the page you landed on) so we can see which channels bring new players. First-party only, no cross-site tracking, and you can object at any time.</li>
          </ul>
        </Section>

        <Section title="Founder Supporter waitlist (non-binding expression of interest)">
          <p className="mb-2">
            If you sign up for our &quot;Founder Supporter&quot; waitlist, we process the following data based on your explicit consent (GDPR art. 6(1)(a)):
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Contact:</strong> email and/or Discord handle (at least one required so we can reach back).</li>
            <li><strong>Intent:</strong> interest level, preferred tier, main reason, valued benefits, perceived fairness red lines (free text).</li>
            <li><strong>Follow-up:</strong> consent to personal follow-up (separate yes/no).</li>
            <li><strong>Attribution:</strong> where you came from (UTM parameter or manual tag, e.g. &quot;discord_launch&quot;).</li>
            <li><strong>Timestamp:</strong> when you gave consent (proof of lawful basis).</li>
          </ul>
          <p className="mt-3">
            <strong>Purpose:</strong> to administer the waitlist, contact you regarding launch, and measure which channels generate real interest.
          </p>
          <p className="mt-2">
            <strong>Retention:</strong> until you ask to be deleted, or after 24 months of inactivity, whichever comes first. You can write to us at any time to be deleted.
          </p>
          <p className="mt-2">
            <strong>Important:</strong> a waitlist sign-up is <em>not</em> a purchase and <em>not</em> binding. No payment is collected before a potential later launch, at which point you must actively accept commercial terms.
          </p>
        </Section>

        <Section title="Third parties (data processors)">
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Supabase (EU, Frankfurt):</strong> database and authentication (data processing agreement in place).</li>
            <li><strong>Vercel:</strong> frontend hosting (EU/US edge). Vercel sees IP addresses in access logs.</li>
            <li><strong>Railway:</strong> backend hosting.</li>
            <li><strong>Microsoft Clarity:</strong> only loaded if you have accepted the &quot;Analytics&quot; category.</li>
            <li><strong>Google Analytics:</strong> only loaded if you have accepted the &quot;Analytics&quot; category. Ad signals are turned off.</li>
            <li><strong>Discord (via Discord Inc.):</strong> only if you voluntarily add your Discord ID, or contact us on Discord. Discord is an independent data controller for any content you send us there.</li>
          </ul>
          <p className="mt-2 text-cz-3 text-xs">
            We do not sell or share your data with third parties for marketing purposes. A link to Discord is not a data transfer, only when you click and write to us yourself.
          </p>
        </Section>

        <Section title="How long do we keep data?">
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Account and game data:</strong> as long as your account is active. If you delete your account, personally identifiable data is removed within 30 days; aggregated game history (e.g. past season results) may be retained in anonymised form.</li>
            <li><strong>Waitlist data:</strong> until you ask to be deleted, or 24 months of inactivity, whichever comes first.</li>
            <li><strong>Access logs (IP):</strong> automatically deleted after 30 days.</li>
            <li><strong>Consent proof (consent timestamp + choices):</strong> for as long as the related data is processed, so we can document lawful basis.</li>
          </ul>
        </Section>

        <Section title="Your GDPR rights">
          You have the right to:
          <ul className="list-disc pl-5 space-y-1 mt-2">
            <li><strong>Access</strong>: to know what data we hold about you.</li>
            <li><strong>Rectification</strong>: to have incorrect data corrected.</li>
            <li><strong>Erasure</strong> (&quot;right to be forgotten&quot;).</li>
            <li><strong>Data portability</strong>: to receive your data in a machine-readable format.</li>
            <li><strong>Object</strong> to processing based on legitimate interest.</li>
            <li><strong>Withdraw consent</strong>: applies going forward and stops collection. Data gathered before withdrawal cannot be removed from anonymous aggregates.</li>
            <li><strong>Complain to the Danish Data Protection Authority</strong>: <a href="https://www.datatilsynet.dk/english" target="_blank" rel="noopener noreferrer" className="text-cz-accent-t underline">datatilsynet.dk/english</a>.</li>
          </ul>
          <div className="mt-3">
            <button
              type="button"
              onClick={openBanner}
              className="bg-cz-accent-t text-white font-semibold text-sm rounded-lg px-4 py-2 hover:opacity-90"
            >
              Change my consent choices
            </button>
          </div>
        </Section>

        <Section title="Cookies and local storage">
          <p>
            We use <em>strictly necessary</em> cookies/localStorage and first-party storage for:
          </p>
          <ul className="list-disc pl-5 space-y-1 mt-2">
            <li><strong>Login session</strong> (Supabase auth): required to keep you logged in.</li>
            <li><strong>Theme choice</strong> (light/dark): stored locally in your browser.</li>
            <li><strong>Consent choices</strong> (<code className="text-xs">cz_consent_v1</code> in localStorage): so we remember your selection and don&apos;t ask again.</li>
          </ul>
          <p className="mt-2">
            These do not require consent under the ePrivacy directive (strictly necessary). <strong>Microsoft Clarity</strong> and <strong>Google Analytics</strong> are only loaded if you have actively accepted the &quot;Analytics&quot; category. You can change your choice on this page at any time.
          </p>
        </Section>

        <Section title="Your current choices">
          <ul className="text-cz-3 text-sm space-y-1">
            <li>Necessary: <strong className="text-cz-1">always on</strong></li>
            <li>Analytics: <strong className="text-cz-1">{consent.analytics ? "accepted" : "denied"}</strong></li>
            <li>Marketing: <strong className="text-cz-1">{consent.marketing ? "accepted" : "denied"}</strong></li>
            <li>Email: <strong className="text-cz-1">{consent.email_marketing ? "accepted" : "denied"}</strong></li>
            {consent.updated_at && <li className="text-xs">Last updated: {new Date(consent.updated_at).toLocaleString("en-GB")}</li>}
          </ul>
        </Section>

        <Section title="Changes to this policy">
          We update this policy when new tools or features are introduced. Major changes are announced in the in-game patch notes; you can always find the latest version here.
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="mb-6 last:mb-0">
      <h2 className="text-cz-1 font-semibold text-base mb-2">{title}</h2>
      <div className="text-cz-2 text-sm leading-relaxed">{children}</div>
    </section>
  );
}
