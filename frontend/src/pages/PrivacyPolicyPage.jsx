import { Link } from "react-router";
import { useTranslation, Trans } from "react-i18next";
import { useConsent } from "../lib/consent.jsx";
import { formatDateTime } from "../lib/intl";
import { useDocumentHead } from "../hooks/useDocumentHead.js";
import { Wordmark } from "../components/Brand.jsx";
import { Section, SectionHeader, SectionStack, PageLoader } from "../components/ui";
import { ChevronLeftIcon } from "../components/ui/icons/index.jsx";

// #4733/#413: dual-page-mønsteret (PrivacyPolicyPage.jsx + PrivacyPolicyPageEn.jsx)
// er merget til ÉN komponent der rendrer fra namespacet `privacy` (lazy via
// HttpBackend, se INLINE_EXEMPT i scripts/i18n-check-namespace-inline.mjs).
// Sprog vælges pr. route via `forceLang`-prop (App.jsx) — IKKE
// i18n.changeLanguage, som ville skifte hele app'ens globale sprog. `t` er
// bundet fast til `forceLang` via useTranslation-optionen `lng` (react-i18next
// binder t via i18n.getFixedT(lng, ...) uafhængigt af det globale sprog).
//
// Document-head-metadata (titel/beskrivelse/canonical) er BEVIDST ikke en del
// af privacy.json: de skal foreligge med det samme uden at vente på
// namespace-fetchen, så <title> aldrig kortvarigt viser en rå i18n-nøgle.
const HEAD_META = {
  da: {
    title: "Privatlivspolitik · Cycling Zone",
    description:
      "Sådan behandler Cycling Zone dine data: så lidt som muligt, EU-hostet og du bestemmer selv hvad vi må måle.",
    canonical: "https://cyclingzone.org/privatlivspolitik",
  },
  en: {
    title: "Privacy policy · Cycling Zone",
    description:
      "How Cycling Zone handles your data: as little as possible, EU-hosted, and you decide what we may measure.",
    canonical: "https://cyclingzone.org/privacy-policy",
  },
};

const OTHER_LANG_PATH = { da: "/privacy-policy", en: "/privatlivspolitik" };

// Trans-tag-komponenter delt af hele privacy.json — juridisk tekst har brug for
// inline <bold>/<em>/<code> plus ét navngivet link (samme mønster som
// board:bonusOffer.body / pro:termsAccept).
const STATIC_TRANS_COMPONENTS = {
  bold: <strong />,
  em: <em />,
  code: <code className="text-xs" />,
  helpLink: <Link to="/help" className="text-cz-accent-t underline" />,
};

function TransList({ t, transComponents, i18nKey, className }) {
  const items = t(i18nKey, { returnObjects: true });
  if (!Array.isArray(items)) return null;
  return (
    <ul className={className}>
      {items.map((_, i) => (
        <li key={i}>
          <Trans t={t} i18nKey={`${i18nKey}.${i}`} components={transComponents} />
        </li>
      ))}
    </ul>
  );
}

export default function PrivacyPolicyPage({ forceLang = "da" }) {
  const { openBanner, consent } = useConsent();
  // Namespace lazy-loaded via HttpBackend (#3697, INLINE_EXEMPT) — `ready`
  // gater render bag PageLoader så rå nøgler aldrig rammer first paint (samme
  // in-page-mønster som RulesPage/HelpPage). `lng` er sat FAST pr. route, så
  // /privacy-policy altid rendrer engelsk uanset app'ens globale sprog.
  const { t, ready } = useTranslation("privacy", { lng: forceLang });

  const meta = HEAD_META[forceLang] || HEAD_META.da;
  // Per-route head (#1404/#1301).
  useDocumentHead({
    title: meta.title,
    description: meta.description,
    canonical: meta.canonical,
    lang: forceLang,
  });

  if (!ready) return <PageLoader />;

  const transComponents = {
    ...STATIC_TRANS_COMPONENTS,
    datatilsynetLink: (
      <a
        href={t("sections.rights.complaintUrl")}
        target="_blank"
        rel="noopener noreferrer"
        className="text-cz-accent-t underline"
      />
    ),
  };

  // #413: DA-siden formaterede altid via formatDateTime (følger app'ens
  // globale i18n-sprog); EN-siden formaterede altid hardkodet en-GB. Den
  // adfærd er bevidst bevaret bit-for-bit pr. route i merget.
  const lastUpdated =
    forceLang === "en"
      ? consent.updated_at
        ? new Date(consent.updated_at).toLocaleString("en-GB")
        : ""
      : formatDateTime(consent.updated_at);

  return (
    <div className="min-h-screen bg-cz-body py-10 px-4 sm:px-6">
      <div className="max-w-3xl mx-auto">
        <div className="mb-6 flex items-start justify-between gap-3">
          <div>
            <Link to="/" aria-label="Cycling Zone" className="inline-block">
              <Wordmark className="h-4 w-auto mb-3" alt="" />
            </Link>
            <h1 className="text-cz-1 font-display text-4xl tracking-tight leading-none">{t("page.title")}</h1>
          </div>
          <div className="flex flex-shrink-0 items-center gap-3 text-sm pt-1">
            <Link to={OTHER_LANG_PATH[forceLang]} className="text-cz-3 hover:text-cz-1">{t("page.langSwitchLabel")}</Link>
            <Link to="/" className="inline-flex items-center gap-1 text-cz-3 hover:text-cz-1">
              <ChevronLeftIcon size={14} aria-hidden="true" />{t("page.back")}
            </Link>
          </div>
        </div>

        <p className="text-cz-3 text-sm mb-6">{t("page.intro")}</p>

        <SectionStack>
          <Section>
            <SectionHeader title={t("sections.controller.heading")} />
            <div className="text-cz-2 text-sm leading-relaxed">
              <p><Trans t={t} i18nKey="sections.controller.paragraph1" components={transComponents} /></p>
              <p className="mt-2"><Trans t={t} i18nKey="sections.controller.paragraph2" components={transComponents} /></p>
            </div>
          </Section>

          <Section>
            <SectionHeader title={t("sections.dataTypes.heading")} />
            <div className="text-cz-2 text-sm leading-relaxed">
              <TransList t={t} transComponents={transComponents} i18nKey="sections.dataTypes.items" className="list-disc pl-5 space-y-1" />
            </div>
          </Section>

          <Section>
            <SectionHeader title={t("sections.founderWaitlist.heading")} />
            <div className="text-cz-2 text-sm leading-relaxed">
              <p className="mb-2">{t("sections.founderWaitlist.intro")}</p>
              <TransList t={t} transComponents={transComponents} i18nKey="sections.founderWaitlist.items" className="list-disc pl-5 space-y-1" />
              <p className="mt-3"><Trans t={t} i18nKey="sections.founderWaitlist.purpose" components={transComponents} /></p>
              <p className="mt-2"><Trans t={t} i18nKey="sections.founderWaitlist.retention" components={transComponents} /></p>
              <p className="mt-2"><Trans t={t} i18nKey="sections.founderWaitlist.important" components={transComponents} /></p>
            </div>
          </Section>

          <Section>
            <SectionHeader title={t("sections.thirdParties.heading")} />
            <div className="text-cz-2 text-sm leading-relaxed">
              <TransList t={t} transComponents={transComponents} i18nKey="sections.thirdParties.items" className="list-disc pl-5 space-y-1" />
              <p className="mt-2 text-cz-3 text-xs">{t("sections.thirdParties.footnote")}</p>
            </div>
          </Section>

          <Section>
            <SectionHeader title={t("sections.retention.heading")} />
            <div className="text-cz-2 text-sm leading-relaxed">
              <TransList t={t} transComponents={transComponents} i18nKey="sections.retention.items" className="list-disc pl-5 space-y-1" />
            </div>
          </Section>

          <Section>
            <SectionHeader title={t("sections.rights.heading")} />
            <div className="text-cz-2 text-sm leading-relaxed">
              {t("sections.rights.intro")}
              <ul className="list-disc pl-5 space-y-1 mt-2">
                {t("sections.rights.items", { returnObjects: true }).map((_, i) => (
                  <li key={i}><Trans t={t} i18nKey={`sections.rights.items.${i}`} components={transComponents} /></li>
                ))}
                <li><Trans t={t} i18nKey="sections.rights.complaint" components={transComponents} /></li>
              </ul>
              <div className="mt-3">
                <button
                  type="button"
                  onClick={openBanner}
                  className="bg-cz-accent text-cz-on-accent font-semibold text-sm rounded-cz px-4 py-2 hover:brightness-110 transition-all"
                >
                  {t("sections.rights.consentButton")}
                </button>
              </div>
            </div>
          </Section>

          <Section>
            <SectionHeader title={t("sections.cookies.heading")} />
            <div className="text-cz-2 text-sm leading-relaxed">
              <p><Trans t={t} i18nKey="sections.cookies.intro" components={transComponents} /></p>
              <TransList t={t} transComponents={transComponents} i18nKey="sections.cookies.items" className="list-disc pl-5 space-y-1 mt-2" />
              <p className="mt-2"><Trans t={t} i18nKey="sections.cookies.outro" components={transComponents} /></p>
            </div>
          </Section>

          <Section>
            <SectionHeader title={t("sections.currentChoices.heading")} />
            <ul className="text-cz-3 text-sm space-y-1">
              <li>{t("sections.currentChoices.necessary")}: <strong className="text-cz-1">{t("sections.currentChoices.alwaysOn")}</strong></li>
              <li>{t("sections.currentChoices.analytics")}: <strong className="text-cz-1">{consent.analytics ? t("sections.currentChoices.accepted") : t("sections.currentChoices.denied")}</strong></li>
              <li>{t("sections.currentChoices.marketing")}: <strong className="text-cz-1">{consent.marketing ? t("sections.currentChoices.accepted") : t("sections.currentChoices.denied")}</strong></li>
              <li>{t("sections.currentChoices.email")}: <strong className="text-cz-1">{consent.email_marketing ? t("sections.currentChoices.accepted") : t("sections.currentChoices.denied")}</strong></li>
              {consent.updated_at && <li className="text-xs">{t("sections.currentChoices.lastUpdated", { date: lastUpdated })}</li>}
            </ul>
          </Section>

          <Section>
            <SectionHeader title={t("sections.changes.heading")} />
            <div className="text-cz-2 text-sm leading-relaxed">{t("sections.changes.paragraph")}</div>
          </Section>
        </SectionStack>
      </div>
    </div>
  );
}
