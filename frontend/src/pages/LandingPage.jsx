import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useLanguage } from "../lib/language.jsx";
import { useDocumentHead, useJsonLd } from "../hooks/useDocumentHead.js";
import { Wordmark } from "../components/Brand.jsx";
import { buttonClass } from "../components/ui/buttonStyles.js";
import RaceSignature from "../components/landing/RaceSignature.jsx";
import LaunchWaitlistForm from "../components/landing/LaunchWaitlistForm.jsx";
import {
  TeamIcon,
  CoinIcon,
  StarIcon,
  FlagIcon,
  CalendarIcon,
  CheckIcon,
  PlusIcon,
} from "../components/ui/icons/index.jsx";

// Offentlig landing page for kold TdF-trafik (#672). Vises på bart domæne for
// ikke-loggede-ind; loggede-ind ryger til /dashboard (route-logik i App.jsx).
// Retning låst i docs/superpowers/specs/2026-06-14-landing-page-brand-direction-design.md:
// editorial-clean + cykel-data-signatur, 0 AI-slop, Discord primært / email sekundært.
// Al copy i `landing`-namespacet (en + da). Founder-stemme-strenge (hero.title, hero.subtitle,
// discord.body) er kladde til ejer-finpudsning.

const DISCORD_URL = "https://discord.gg/ykysBrWUyC";

const HOW_ICONS = [TeamIcon, CoinIcon, StarIcon, FlagIcon, CalendarIcon];

function DiscordGlyph({ size = 18, className = "" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M20.317 4.369A19.79 19.79 0 0 0 15.432 3c-.21.375-.444.882-.608 1.283a18.27 18.27 0 0 0-5.487 0A12.6 12.6 0 0 0 8.717 3 19.74 19.74 0 0 0 3.83 4.37C.728 8.94-.114 13.396.3 17.79a19.9 19.9 0 0 0 6.06 3.03c.488-.66.922-1.36 1.296-2.096a12.9 12.9 0 0 1-2.04-.97c.17-.124.338-.254.5-.388a14.2 14.2 0 0 0 12.168 0c.163.135.33.265.5.388-.65.382-1.336.708-2.043.97.375.736.808 1.436 1.296 2.095a19.85 19.85 0 0 0 6.064-3.03c.485-5.09-.83-9.51-3.487-13.42ZM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.42 0-1.334.955-2.42 2.157-2.42 1.21 0 2.176 1.095 2.157 2.42 0 1.335-.955 2.42-2.157 2.42Zm7.975 0c-1.183 0-2.157-1.085-2.157-2.42 0-1.334.955-2.42 2.157-2.42 1.21 0 2.176 1.095 2.157 2.42 0 1.335-.946 2.42-2.157 2.42Z" />
    </svg>
  );
}

function LanguageToggle() {
  const { language, setLanguage } = useLanguage();
  const { t } = useTranslation("landing");
  return (
    <div
      className="inline-flex items-center rounded-cz border border-cz-border p-0.5"
      role="group"
      aria-label={t("nav.languageLabel")}
    >
      {["en", "da"].map((lng) => (
        <button
          key={lng}
          type="button"
          onClick={() => setLanguage(lng)}
          aria-pressed={language === lng}
          className={
            "rounded-[3px] px-2.5 py-1 font-data text-[11px] font-semibold uppercase tracking-wider transition-colors " +
            (language === lng ? "bg-cz-accent text-cz-on-accent" : "text-cz-2 hover:text-cz-1")
          }
        >
          {lng}
        </button>
      ))}
    </div>
  );
}

function Kicker({ children }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="h-px w-6 bg-cz-accent-t" aria-hidden="true" />
      <span className="font-data text-[11px] font-semibold uppercase tracking-[0.22em] text-cz-3">{children}</span>
    </div>
  );
}

function FaqItem({ q, a, defaultOpen }) {
  return (
    <details open={defaultOpen} className="group border-b border-cz-border last:border-b-0">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4">
        <span className="text-[15px] font-medium text-cz-1">{q}</span>
        <PlusIcon
          className="w-5 h-5 flex-shrink-0 text-cz-accent-t transition-transform duration-200 group-open:rotate-45"
          aria-hidden="true"
        />
      </summary>
      <p className="max-w-2xl pb-4 text-sm leading-relaxed text-cz-2">{a}</p>
    </details>
  );
}

export default function LandingPage() {
  const { t, i18n } = useTranslation("landing");
  const lang = i18n.language?.startsWith("da") ? "da" : "en";

  // Klient-side SEO (#1404/#1301): per-route titel + meta description + canonical
  // + <html lang> for den indekserbare /-rute. Canonical defaulter til
  // origin + pathname; her er pathname "/", så det rammer cyclingzone.org/.
  useDocumentHead({
    title: t("meta.title"),
    description: t("meta.description"),
    lang,
  });

  // #1405: VideoGame JSON-LD injiceres KUN på forsiden (Organization + WebSite
  // ligger statisk i index.html). offers.price 0 = free-to-play / open beta.
  useJsonLd("videogame", {
    "@context": "https://schema.org",
    "@type": "VideoGame",
    name: "Cycling Zone",
    url: "https://cyclingzone.org/",
    description: t("meta.description"),
    genre: "Sports/Manager",
    gamePlatform: "Web browser",
    applicationCategory: "GameApplication",
    operatingSystem: "Any (web browser)",
    offers: {
      "@type": "Offer",
      price: 0,
      priceCurrency: "EUR",
      availability: "https://schema.org/InStock",
    },
  });

  const howRows = t("how.rows", { returnObjects: true });
  const diffCards = t("different.cards", { returnObjects: true });
  const faqItems = t("faq.items", { returnObjects: true });

  return (
    <div className="min-h-screen bg-cz-body text-cz-1">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-toast focus:rounded-cz focus:bg-cz-card focus:px-3 focus:py-2 focus:text-sm"
      >
        {t("nav.skipToContent")}
      </a>

      {/* ───────── Top-bar ───────── */}
      <header className="sticky top-0 z-sticky border-b border-cz-border bg-cz-body">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3.5 sm:px-8">
          <Wordmark className="h-7 sm:h-8" />
          <div className="flex items-center gap-1.5 sm:gap-3">
            <div className="hidden sm:flex">
              <LanguageToggle />
            </div>
            <Link to="/login" className={`${buttonClass({ variant: "ghost", size: "sm" })} whitespace-nowrap`}>
              {t("nav.login")}
            </Link>
            <Link to="/login?mode=signup" className={`${buttonClass({ variant: "secondary", size: "sm" })} whitespace-nowrap`}>
              {t("nav.signup")}
            </Link>
          </div>
        </div>
      </header>

      <main id="main">
        {/* ───────── Hero ───────── */}
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-5 pb-16 pt-12 sm:px-8 lg:grid-cols-[1.05fr_0.95fr] lg:gap-14 lg:pb-24 lg:pt-20">
          <div>
            <span className="inline-flex cursor-default select-none items-center gap-2 border border-cz-border bg-cz-card px-3 py-1 font-data text-[11px] font-semibold uppercase tracking-[0.16em] text-cz-2">
              <span className="h-1.5 w-1.5 rounded-full bg-cz-accent" aria-hidden="true" />
              {t("hero.badge")}
            </span>

            <h1 className="mt-6 font-display text-5xl leading-[0.92] tracking-tight text-cz-1 sm:text-6xl lg:text-7xl">
              {t("hero.title")}
            </h1>

            <p className="mt-5 max-w-xl text-base leading-relaxed text-cz-2 sm:text-lg">{t("hero.subtitle")}</p>

            {/* #1570: spillet er live og tager imod spillere nu → "Opret dit hold"
                er den primære hero-handling. Discord demoteres til sekundær, og
                launch-mailen bliver et diskret link, så en kold besøgende der vil
                spille NU ikke dirigeres ud i en venteliste/community-tragt. */}
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link
                to="/login?mode=signup"
                className={buttonClass({ variant: "primary", size: "lg" })}
              >
                {t("hero.ctaPlay")}
              </Link>
              <a
                href={DISCORD_URL}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClass({ variant: "secondary", size: "lg" })}
              >
                <DiscordGlyph size={18} />
                {t("hero.ctaDiscord")}
              </a>
            </div>
            <p className="mt-3 text-sm">
              <a
                href="#waitlist"
                className="font-medium text-cz-2 underline-offset-2 hover:text-cz-1 hover:underline"
              >
                {t("hero.ctaEmail")}
              </a>
            </p>

            <ul className="mt-7 flex flex-wrap gap-x-5 gap-y-2">
              {["hero.trustFree", "hero.trustNoCard", "hero.trustBrowser"].map((key) => (
                <li key={key} className="flex items-center gap-1.5 text-xs font-medium text-cz-2">
                  <CheckIcon size={14} className="text-cz-accent-t" />
                  {t(key)}
                </li>
              ))}
            </ul>
          </div>

          <div className="lg:pl-4">
            <RaceSignature />
          </div>
        </section>

        {/* ───────── How you play ───────── */}
        <section className="border-t border-cz-border bg-cz-card/40">
          <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 lg:py-20">
            <Kicker>{t("how.kicker")}</Kicker>
            <h2 className="mt-4 max-w-2xl font-display text-4xl leading-none tracking-tight text-cz-1 sm:text-5xl">
              {t("how.title")}
            </h2>

            <div className="mt-10 border-t border-cz-border">
              {(Array.isArray(howRows) ? howRows : []).map((row, i) => {
                const Icon = HOW_ICONS[i] ?? TeamIcon;
                return (
                  <div
                    key={row.no}
                    className="grid grid-cols-[auto_1fr] items-start gap-x-5 gap-y-1 border-b border-cz-border py-7 sm:grid-cols-[5rem_auto_1fr] sm:gap-x-8"
                  >
                    <span className="font-display text-4xl leading-none text-cz-3 sm:text-5xl">{row.no}</span>
                    <span className="row-span-2 hidden h-11 w-11 items-center justify-center border border-cz-border text-cz-accent-t sm:flex">
                      <Icon size={20} />
                    </span>
                    <div>
                      <h3 className="text-lg font-semibold text-cz-1">{row.title}</h3>
                      <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-cz-2">{row.body}</p>
                      <p className="mt-2 font-data text-[11px] uppercase tracking-[0.16em] text-cz-3">{row.data}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ───────── Not your usual manager game ───────── */}
        <section className="border-t border-cz-border">
          <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 lg:py-20">
            <Kicker>{t("different.kicker")}</Kicker>
            <h2 className="mt-4 max-w-3xl font-display text-4xl leading-none tracking-tight text-cz-1 sm:text-5xl">
              {t("different.title")}
            </h2>
            <p className="mt-5 max-w-2xl border-l-2 border-cz-accent pl-4 text-base leading-relaxed text-cz-1 sm:text-lg">
              {t("different.fairness")}
            </p>

            <div className="mt-10 grid gap-px border border-cz-border bg-cz-border sm:grid-cols-3">
              {(Array.isArray(diffCards) ? diffCards : []).map((card) => (
                <div key={card.title} className="bg-cz-body p-6">
                  <h3 className="font-display text-2xl tracking-wide text-cz-1">{card.title}</h3>
                  <p className="mt-2.5 text-sm leading-relaxed text-cz-2">{card.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ───────── Discord (primær) ───────── */}
        <section id="discord" className="border-t border-cz-border bg-cz-card/40">
          <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 lg:py-20">
            <div className="flex flex-col items-start gap-8 lg:flex-row lg:items-center lg:justify-between">
              <div className="max-w-2xl">
                <Kicker>{t("discord.kicker")}</Kicker>
                <h2 className="mt-4 font-display text-4xl leading-none tracking-tight text-cz-1 sm:text-5xl">
                  {t("discord.title")}
                </h2>
                <p className="mt-5 text-base leading-relaxed text-cz-2 sm:text-lg">{t("discord.body")}</p>
              </div>
              <a
                href={DISCORD_URL}
                target="_blank"
                rel="noopener noreferrer"
                className={`${buttonClass({ variant: "primary", size: "lg" })} shrink-0`}
              >
                <DiscordGlyph size={18} />
                {t("discord.cta")}
              </a>
            </div>
          </div>
        </section>

        {/* ───────── Email (sekundær) ───────── */}
        <section id="waitlist" className="border-t border-cz-border">
          <div className="mx-auto grid max-w-6xl gap-10 px-5 py-16 sm:px-8 lg:grid-cols-2 lg:gap-16 lg:py-20">
            <div>
              <Kicker>{t("waitlist.kicker")}</Kicker>
              <h2 className="mt-4 font-display text-4xl leading-none tracking-tight text-cz-1 sm:text-5xl">
                {t("waitlist.title")}
              </h2>
              <p className="mt-5 max-w-md text-base leading-relaxed text-cz-2">{t("waitlist.body")}</p>
            </div>
            <div className="lg:pt-2">
              <LaunchWaitlistForm />
            </div>
          </div>
        </section>

        {/* ───────── FAQ ───────── */}
        <section className="border-t border-cz-border bg-cz-card/40">
          <div className="mx-auto max-w-3xl px-5 py-16 sm:px-8 lg:py-20">
            <Kicker>{t("faq.kicker")}</Kicker>
            <h2 className="mt-4 font-display text-4xl leading-none tracking-tight text-cz-1 sm:text-5xl">
              {t("faq.title")}
            </h2>
            <div className="mt-8">
              {(Array.isArray(faqItems) ? faqItems : []).map((item, i) => (
                <FaqItem key={item.q} q={item.q} a={item.a} defaultOpen={i === 0} />
              ))}
            </div>
          </div>
        </section>
      </main>

      {/* ───────── Footer ───────── */}
      <footer className="border-t border-cz-border">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-4 px-5 py-8 sm:flex-row sm:items-center sm:px-8">
          <div className="flex items-center gap-3">
            <Wordmark className="h-4" />
            <span className="text-xs text-cz-3">{t("footer.tagline")}</span>
          </div>
          <nav className="flex flex-wrap items-center gap-4 text-sm sm:gap-5">
            <LanguageToggle />
            <a href={t("waitlist.privacyPath")} className="text-cz-2 hover:text-cz-1">{t("footer.privacy")}</a>
            <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer" className="text-cz-2 hover:text-cz-1">
              {t("footer.discord")}
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
