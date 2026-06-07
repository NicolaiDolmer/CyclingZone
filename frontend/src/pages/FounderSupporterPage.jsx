import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useLanguage } from "../lib/language.jsx";
import FounderSupporterWaitlistForm from "../components/waitlist/FounderSupporterWaitlistForm.jsx";

// Landing page for Founder waitlist (#361, Session B naming locked in #500).
// Public route, no auth. Embedder waitlist-form (#362) som sektion.
// All copy lever i `founder`-namespacet (en/da) og følger appens globale sprog
// via useLanguage() — DA/EN-toggle persisterer i localStorage (#678).
// Pris-variant via ?variant=A|B|C styrer Option B price-test (utm_campaign er
// canonical attribution; ?variant er menneskelig debug-hint).

const VARIANT_LABELS = {
  A: "Premium 29 / Pro Analyst 49 DKK",
  B: "Premium 49 / Pro Analyst 89 DKK",
  C: "Premium 69 / Pro Analyst 119 DKK",
};

const VARIANT_PRICES = {
  A: { supporter: "29", pro: "49" },
  B: { supporter: "49", pro: "89" },
  C: { supporter: "69", pro: "119" },
};

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
        "flex flex-col gap-3 rounded-2xl border p-5 transition-all " +
        (highlighted
          ? "border-cz-accent bg-cz-accent/5 shadow-[0_4px_30px_rgba(232,197,71,0.15)]"
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
  const variantPrices = VARIANT_PRICES[variantKey] || { supporter: "49", pro: "89" };

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

  // Opdater <html lang=...> + <title> + canonical dynamisk for accessibility + SEO.
  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = t("metaTitle");
    let canonical = document.querySelector('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.rel = "canonical";
      document.head.appendChild(canonical);
    }
    canonical.href = "https://cycling-zone.vercel.app/founder-supporter";
  }, [lang, t]);

  // Bevar useMemo så vi ikke regenererer ved hver render; recompute ved sprogskift.
  const tierFreeData = useMemo(() => t("tierFree", { returnObjects: true }), [t, lang]);
  const tierSupporterData = useMemo(() => {
    const base = t("tierSupporter", { returnObjects: true });
    const monthly = Number(variantPrices.supporter);
    const annual = Number.isFinite(monthly) ? monthly * 10 : null;
    return {
      ...base,
      price: variantPrices.supporter,
      altYear: annual != null && base.altYearTemplate
        ? t("tierSupporter.altYearTemplate", { annual })
        : null,
    };
  }, [t, lang, variantPrices.supporter]);
  const tierProData = useMemo(() => ({ ...t("tierPro", { returnObjects: true }), price: variantPrices.pro }), [t, lang, variantPrices.pro]);
  const tierPatronData = useMemo(() => t("tierPatron", { returnObjects: true }), [t, lang]);

  return (
    <div className="min-h-screen bg-cz-body">
      {/* ----- Sticky top-bar ----- */}
      <header className="sticky top-0 z-40 bg-cz-body/90 backdrop-blur-md border-b border-cz-border">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <Link to="/" className="flex items-center gap-2 group">
            <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-cz-accent shadow-[0_0_20px_rgba(232,197,71,0.3)]">
              <span className="text-cz-on-accent font-black text-base">C</span>
            </span>
            <span className="text-cz-1 font-bold text-sm tracking-tight hidden sm:inline">Cycling Zone</span>
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
                className="inline-flex items-center justify-center px-6 py-3 bg-cz-accent text-cz-on-accent font-bold rounded-lg text-sm shadow-[0_4px_20px_rgba(232,197,71,0.3)] hover:brightness-110 transition-all"
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
            <div className="bg-cz-card border-2 border-cz-accent/40 rounded-2xl p-6 sm:p-8 shadow-[0_4px_40px_rgba(232,197,71,0.1)]">
              <h2 className="text-cz-1 text-2xl sm:text-3xl font-bold mb-3 flex items-center gap-2">
                <span className="text-cz-accent">✓</span>
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
              <p className="text-cz-2 text-sm sm:text-base">{t("tiersSub")}</p>
              {variantLabel && (
                <p className="mt-3 inline-flex items-center gap-2 bg-cz-accent/10 border border-cz-accent/30 rounded-lg px-3 py-1.5 text-cz-1 text-xs">
                  <span className="text-cz-3">{t("variantLabel")}</span>
                  <span className="font-semibold">{variantLabel}</span>
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <TierCard tier={tierFreeData} />
              <TierCard tier={tierSupporterData} highlighted />
              <TierCard tier={tierProData} />
              <TierCard tier={tierPatronData} />
            </div>

            <div className="mt-8 max-w-3xl mx-auto bg-cz-subtle border border-cz-border rounded-xl p-5">
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
              <div className="bg-cz-card border border-cz-border rounded-xl p-5">
                <h3 className="text-cz-1 text-base font-semibold mb-3 flex items-center gap-2">
                  <span className="text-emerald-500">✓</span>
                  {t("soldCol")}
                </h3>
                <ul className="flex flex-col gap-2">
                  {t("sold", { returnObjects: true }).map((item, i) => (
                    <li key={i} className="text-cz-2 text-sm flex items-start gap-2">
                      <span className="text-emerald-500 mt-0.5">·</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="bg-cz-card border border-cz-danger/30 rounded-xl p-5">
                <h3 className="text-cz-1 text-base font-semibold mb-3 flex items-center gap-2">
                  <span className="text-cz-danger">✗</span>
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
                <div key={i} className="bg-cz-card border border-cz-border rounded-xl p-4">
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
            <FounderSupporterWaitlistForm priceVariantLabel={variantLabel} lang={lang} />
          </div>
        </section>

        {/* ----- FAQ ----- */}
        <section className="px-4 sm:px-6 py-12 sm:py-16">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-cz-1 text-2xl sm:text-3xl font-bold text-center mb-8">{t("faqTitle")}</h2>
            <div className="bg-cz-card border border-cz-border rounded-2xl px-5 sm:px-6">
              {t("faqItems", { returnObjects: true }).map((item, i) => (
                <FaqItem key={i} idx={i} q={item.q} a={item.a} />
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-cz-border px-4 sm:px-6 py-8">
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-cz-3 text-xs">
          <p>{t("footerSprintRef")}</p>
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
