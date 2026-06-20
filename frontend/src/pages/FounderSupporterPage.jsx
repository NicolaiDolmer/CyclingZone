import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useLanguage } from "../lib/language.jsx";
import { useDocumentHead } from "../hooks/useDocumentHead.js";
import FounderSupporterWaitlistForm from "../components/waitlist/FounderSupporterWaitlistForm.jsx";
import { Wordmark, Monogram } from "../components/Brand.jsx";
import { CheckIcon, XIcon } from "../components/ui/icons/index.jsx";
import { formatCurrency, currencyForLocale } from "../lib/intl.js";
import {
  TIER_PRICES_DKK,
  getTierPricesDkk,
  monthlyInCurrency,
  perDayOf,
  annualOf,
} from "../lib/pricing.js";

// Landing page for Founder waitlist (#361, Session B naming locked in #500).
// Public route, no auth. Embedder waitlist-form (#362) som sektion.
// All copy lever i `founder`-namespacet (en/da) og følger appens globale sprog
// via useLanguage() — DA/EN-toggle persisterer i localStorage (#678).
// Pris-variant via ?variant=A|B|C styrer Option B price-test (utm_campaign er
// canonical attribution; ?variant er menneskelig debug-hint).
// Priser kommer fra central konfig i lib/pricing.js (#1104): DA viser DKK,
// EN viser EUR (fast dokumenteret kurs) + "pr. dag"-omregning ved siden af
// den faktiske månedspris.

// Debug/attribution-labels afledt af konfigen. Bevarer det historiske
// DKK-format så gemte waitlist-rækker forbliver sammenlignelige.
const VARIANT_LABELS = Object.fromEntries(
  Object.entries(TIER_PRICES_DKK).map(([key, p]) => [
    key,
    `Premium ${p.supporter} / Pro Analyst ${p.pro} DKK`,
  ])
);

// Prisformatering: hele beløb uden decimaler ("49 kr."), brudte beløb med
// 2 decimaler ("€6.57") — gælder både måneds- og pr-dag-beløb.
function formatPriceIn(currency, amount) {
  return formatCurrency(amount, currency, {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

function LanguageToggle({ language, onChange, label }) {
  return (
    <div className="inline-flex items-center gap-1 bg-cz-subtle border border-cz-border rounded-lg p-0.5" role="group" aria-label={label}>
      <button
        type="button"
        onClick={() => onChange("da")}
        aria-pressed={language === "da"}
        className={
          "px-3 py-1 text-xs font-semibold rounded-md transition-all " +
          (language === "da" ? "bg-cz-accent text-cz-on-accent" : "text-cz-2 hover:text-cz-1")
        }
      >
        DA
      </button>
      <button
        type="button"
        onClick={() => onChange("en")}
        aria-pressed={language === "en"}
        className={
          "px-3 py-1 text-xs font-semibold rounded-md transition-all " +
          (language === "en" ? "bg-cz-accent text-cz-on-accent" : "text-cz-2 hover:text-cz-1")
        }
      >
        EN
      </button>
    </div>
  );
}

function TierCard({ tier, highlighted = false }) {
  return (
    <div
      className={
        "flex flex-col gap-3 rounded-cz border p-5 transition-all " +
        (highlighted
          ? "border-cz-accent bg-cz-accent/5"
          : "border-cz-border bg-cz-card")
      }
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-cz-1 text-lg font-bold">{tier.name}</h3>
        <div className="text-right">
          <div className="text-cz-1 text-xl font-bold">
            {tier.price}
            {tier.priceSuffix && (
              <span className="text-cz-3 text-xs font-normal ms-1">{tier.priceSuffix}</span>
            )}
          </div>
          {tier.perDay && <div className="text-cz-3 text-[11px]">{tier.perDay}</div>}
          {tier.altYear && <div className="text-cz-3 text-[11px]">{tier.altYear}</div>}
        </div>
      </div>
      <p className="text-cz-3 text-xs uppercase tracking-wider">{tier.tagline}</p>
      <ul className="flex flex-col gap-1.5 text-cz-2 text-sm">
        {tier.bullets.map((b, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className="mt-1 w-1 h-1 rounded-full bg-cz-accent flex-shrink-0" />
            <span>{b}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FaqItem({ q, a, idx }) {
  const [open, setOpen] = useState(idx === 0);
  return (
    <details
      open={open}
      onToggle={(e) => setOpen(e.target.open)}
      className="group border-b border-cz-border last:border-b-0"
    >
      <summary className="flex items-center justify-between gap-3 py-4 cursor-pointer list-none">
        <span className="text-cz-1 text-sm sm:text-base font-medium">{q}</span>
        <span
          className={
            "text-cz-accent text-lg transition-transform duration-200 " +
            (open ? "rotate-45" : "")
          }
          aria-hidden="true"
        >
          +
        </span>
      </summary>
      <p className="text-cz-2 text-sm pb-4 pr-8 leading-relaxed">{a}</p>
    </details>
  );
}

export default function FounderSupporterPage() {
  const { t, i18n } = useTranslation("founder");
  const { language, setLanguage } = useLanguage();
  const [searchParams, setSearchParams] = useSearchParams();

  const lang = i18n.language?.startsWith("da") ? "da" : "en";

  const variantKey = (searchParams.get("variant") || "").toUpperCase();
  const variantLabel = VARIANT_LABELS[variantKey] || null;
  const tierPricesDkk = getTierPricesDkk(variantKey);
  // Visningsvaluta (#1104): da → DKK, en → EUR (fast kurs i pricing.js).
  const currency = currencyForLocale(lang);

  const langParam = (searchParams.get("lang") || "").toLowerCase();

  // Delte links med ?lang=en|da tvinger sproget (eksplicit besøgsintention),
  // ellers følges appens globale sprog (EN-first detection).
  useEffect(() => {
    if ((langParam === "en" || langParam === "da") && langParam !== language) {
      setLanguage(langParam);
    }
  }, [langParam, language, setLanguage]);

  // Sync sprogvalg → URL så delte links bevarer sproget.
  function handleLangChange(next) {
    setLanguage(next);
    const params = new URLSearchParams(searchParams);
    if (next === "da") params.delete("lang");
    else params.set("lang", next);
    setSearchParams(params, { replace: true });
  }

  // Per-route head: <html lang> + <title> + description + canonical (#1404/#1301).
  // Tidligere satte denne side canonical uden at gendanne den ved unmount, så en
  // hook-løs rute kunne arve /founder-supporter-canonical; useDocumentHead's
  // cleanup gendanner nu den oprindelige state. Description manglede også før.
  useDocumentHead({
    title: t("metaTitle"),
    description: t("metaDescription"),
    canonical: "https://cyclingzone.org/founder-supporter",
    lang,
  });

  // Bevar useMemo så vi ikke regenererer ved hver render; recompute ved
  // sprogskift (t + currency skifter sammen med lang) og variantskift
  // (tierPricesDkk).
  const tiers = useMemo(() => {
    const buildTier = (base, dkkMonthly, { withAnnual = false } = {}) => {
      const monthly = monthlyInCurrency(dkkMonthly, currency);
      const perDay = monthly > 0 ? perDayOf(monthly) : null;
      const annual = withAnnual ? annualOf(monthly) : null;
      return {
        ...base,
        price: formatPriceIn(currency, monthly),
        perDay:
          perDay != null
            ? t("perDayApprox", { price: formatPriceIn(currency, perDay) })
            : null,
        altYear:
          annual != null && base.altYearTemplate
            ? t("tierSupporter.altYearTemplate", { annual: formatPriceIn(currency, annual) })
            : null,
      };
    };
    return {
      free: buildTier(t("tierFree", { returnObjects: true }), tierPricesDkk.free),
      supporter: buildTier(t("tierSupporter", { returnObjects: true }), tierPricesDkk.supporter, { withAnnual: true }),
      pro: buildTier(t("tierPro", { returnObjects: true }), tierPricesDkk.pro),
      patron: buildTier(t("tierPatron", { returnObjects: true }), tierPricesDkk.patron),
    };
  }, [t, currency, tierPricesDkk]);

  // Premium-prispunkter (A/B/C) til tiersSub-copy, i visningsvalutaen.
  const supporterPricePoints = useMemo(
    () =>
      ["A", "B", "C"]
        .map((key) => formatPriceIn(currency, monthlyInCurrency(TIER_PRICES_DKK[key].supporter, currency)))
        .join(" / "),
    [currency]
  );

  return (
    <div className="min-h-screen bg-cz-body">
      {/* ----- Sticky top-bar ----- */}
      <header className="sticky top-0 z-40 bg-cz-body border-b border-cz-border">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <Link to="/" aria-label="Cycling Zone" className="flex items-center gap-2.5 group">
            {/* #481: locked monogram + theme-aware outlined wordmark (with twin lines). */}
            <Monogram className="w-9 h-9" />
            <Wordmark className="h-5 w-auto hidden sm:block" alt="" />
          </Link>
          <LanguageToggle language={lang} onChange={handleLangChange} label={t("languageLabel")} />
        </div>
      </header>

      <main>
        {/* ----- Hero ----- */}
        <section className="px-4 sm:px-6 pt-12 sm:pt-20 pb-12 sm:pb-16">
          <div className="max-w-4xl mx-auto text-center">
            <p className="text-cz-accent text-xs font-bold uppercase tracking-[0.2em] mb-4">
              {t("heroEyebrow")}
            </p>
            <h1 className="text-cz-1 text-3xl sm:text-5xl lg:text-6xl font-black tracking-tight leading-[1.1]">
              {t("heroHeadline")}
            </h1>
            <p className="text-cz-2 text-base sm:text-lg mt-6 max-w-2xl mx-auto leading-relaxed">
              {t("heroSub")}
              <strong className="text-cz-1">{t("heroSubStrong")}</strong>
            </p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <a
                href="#waitlist"
                className="inline-flex items-center justify-center px-6 py-3 bg-cz-accent text-cz-on-accent font-bold rounded-lg text-sm hover:brightness-110 transition-all"
              >
                {t("ctaPrimary")}
              </a>
              <a
                href="#promise"
                className="inline-flex items-center justify-center px-6 py-3 border border-cz-border text-cz-1 font-medium rounded-lg text-sm hover:bg-cz-subtle transition-all"
              >
                {t("ctaSecondary")}
              </a>
            </div>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-cz-2 text-xs">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-cz-accent" />
                {t("badgeBeta")}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-cz-accent" />
                {t("badgeFair")}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-cz-accent" />
                {t("badgeGdpr")}
              </span>
            </div>
          </div>
        </section>

        {/* ----- Fair Premium Promise ----- */}
        <section id="promise" className="px-4 sm:px-6 py-12 sm:py-16 bg-cz-subtle/40 border-y border-cz-border">
          <div className="max-w-3xl mx-auto">
            <div className="bg-cz-card border-2 border-cz-accent/40 rounded-cz p-6 sm:p-8">
              <h2 className="text-cz-1 text-2xl sm:text-3xl font-bold mb-3 flex items-center gap-2">
                <CheckIcon className="w-6 h-6 text-cz-success flex-shrink-0" />
                {t("promiseTitle")}
              </h2>
              <p className="text-cz-1 text-base sm:text-lg leading-relaxed">{t("promiseBody")}</p>
              <p className="text-cz-3 text-xs mt-4 italic">{t("promiseFootnote")}</p>
            </div>
          </div>
        </section>

        {/* ----- Tier comparison ----- */}
        <section className="px-4 sm:px-6 py-12 sm:py-16">
          <div className="max-w-6xl mx-auto">
            <div className="max-w-2xl mx-auto text-center mb-10">
              <h2 className="text-cz-1 text-2xl sm:text-3xl font-bold mb-3">{t("tiersTitle")}</h2>
              <p className="text-cz-2 text-sm sm:text-base">{t("tiersSub", { prices: supporterPricePoints })}</p>
              {variantLabel && (
                <p className="mt-3 inline-flex items-center gap-2 bg-cz-accent/10 border border-cz-accent/30 rounded-lg px-3 py-1.5 text-cz-1 text-xs">
                  <span className="text-cz-3">{t("variantLabel")}</span>
                  <span className="font-semibold">{variantLabel}</span>
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <TierCard tier={tiers.free} />
              <TierCard tier={tiers.supporter} highlighted />
              <TierCard tier={tiers.pro} />
              <TierCard tier={tiers.patron} />
            </div>

            <div className="mt-8 max-w-3xl mx-auto bg-cz-subtle border border-cz-border rounded-cz p-5">
              <h3 className="text-cz-1 text-base font-semibold mb-2 flex items-center gap-2">
                <span className="text-cz-accent">★</span>
                {t("founderNoteTitle")}
              </h3>
              <p className="text-cz-2 text-sm leading-relaxed">{t("founderNoteBody")}</p>
            </div>
          </div>
        </section>

        {/* ----- What may / may not be sold ----- */}
        <section className="px-4 sm:px-6 py-12 sm:py-16 bg-cz-subtle/40 border-y border-cz-border">
          <div className="max-w-4xl mx-auto">
            <div className="text-center mb-8">
              <h2 className="text-cz-1 text-2xl sm:text-3xl font-bold mb-2">{t("fairnessTitle")}</h2>
              <p className="text-cz-2 text-sm sm:text-base">{t("fairnessSub")}</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-cz-card border border-cz-border rounded-cz p-5">
                <h3 className="text-cz-1 text-base font-semibold mb-3 flex items-center gap-2">
                  <CheckIcon className="w-4 h-4 text-cz-success flex-shrink-0" />
                  {t("soldCol")}
                </h3>
                <ul className="flex flex-col gap-2">
                  {t("sold", { returnObjects: true }).map((item, i) => (
                    <li key={i} className="text-cz-2 text-sm flex items-start gap-2">
                      <span className="text-cz-success mt-0.5">·</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="bg-cz-card border border-cz-danger/30 rounded-cz p-5">
                <h3 className="text-cz-1 text-base font-semibold mb-3 flex items-center gap-2">
                  <XIcon className="w-4 h-4 text-cz-danger flex-shrink-0" />
                  {t("notSoldCol")}
                </h3>
                <ul className="flex flex-col gap-2">
                  {t("notSold", { returnObjects: true }).map((item, i) => (
                    <li key={i} className="text-cz-2 text-sm flex items-start gap-2">
                      <span className="text-cz-danger mt-0.5">·</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* ----- Founder waitlist benefits ----- */}
        <section className="px-4 sm:px-6 py-12 sm:py-16">
          <div className="max-w-4xl mx-auto">
            <div className="text-center mb-10">
              <h2 className="text-cz-1 text-2xl sm:text-3xl font-bold mb-3">{t("benefitsTitle")}</h2>
              <p className="text-cz-2 text-sm sm:text-base max-w-2xl mx-auto">{t("benefitsBody")}</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {t("benefitsList", { returnObjects: true }).map((b, i) => (
                <div key={i} className="bg-cz-card border border-cz-border rounded-cz p-4">
                  <h3 className="text-cz-1 text-sm font-semibold mb-1">{b.title}</h3>
                  <p className="text-cz-3 text-xs leading-relaxed">{b.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ----- Waitlist form ----- */}
        <section id="waitlist" className="px-4 sm:px-6 py-12 sm:py-16 bg-cz-subtle/40 border-y border-cz-border scroll-mt-16">
          <div className="max-w-2xl mx-auto">
            <div className="text-center mb-8">
              <h2 className="text-cz-1 text-2xl sm:text-3xl font-bold mb-3">{t("formSectionTitle")}</h2>
              <p className="text-cz-2 text-sm sm:text-base">{t("formSectionSub")}</p>
            </div>
            <FounderSupporterWaitlistForm priceVariantLabel={variantLabel} />
          </div>
        </section>

        {/* ----- FAQ ----- */}
        <section className="px-4 sm:px-6 py-12 sm:py-16">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-cz-1 text-2xl sm:text-3xl font-bold text-center mb-8">{t("faqTitle")}</h2>
            <div className="bg-cz-card border border-cz-border rounded-cz px-5 sm:px-6">
              {t("faqItems", { returnObjects: true }).map((item, i) => (
                <FaqItem key={i} idx={i} q={item.q} a={item.a} />
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-cz-border px-4 sm:px-6 py-8">
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-center gap-4 text-cz-3 text-xs">
          <div className="flex items-center gap-4">
            <Link to={lang === "en" ? "/privacy-policy" : "/privatlivspolitik"} className="hover:text-cz-1 transition-colors">
              {t("footerPrivacy")}
            </Link>
            <Link to="/" className="hover:text-cz-1 transition-colors">
              {t("footerBack")}
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
