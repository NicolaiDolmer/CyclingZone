// #1369 · Forsiden v2. Struktur og al tekst er ejer-godkendt på #1369 (14-15/10):
// top med Mit hold → løbseksempel før/efter → holdudvikling → kom i gang →
// gratis/CZ Pro → mennesket bag → FAQ → afslutning → footer.
//
// Designplan (TASTE.md + BRAND_BRIEF; marketing-fladen er light/"chalk"):
//   - Ét display-element: Bebas kun på H1. Sektionsoverskrifter er Inter Tight
//     (stram, 600-700), brødtekst DM Sans, tal tabulære.
//   - Billedsproget er spillet selv: ægte, beskårne udsnit fra et rigtigt hold og
//     en rigtig etape (Bad At Names, Vuelta al Alto Aragón etape 6, taget 15/10),
//     vist i spillets lyse tema (ejer 15/10: lys side = lyse billeder). Ingen mock, intet
//     redigeret, ingen stock, ingen gradienter, ingen skygger (hairline + 5 px).
//   - Guld er rationeret: kun "Create your team" (top, kom i gang, afslutning;
//     aldrig to på samme skærm). Ingen guld-tal, ingen bjælker.
//   - Discord (ejer 20/10): sekundær knap ved siden af guld-knappen i toppen og en
//     rigtig knap i "Made by one person". Aldrig guld.
//   - Mobil: tekst og knap før billedet; telefon-udsnit (taget ved 520 px, så
//     spillets tidsgab ikke skæres af) via <picture>, desktop-udsnit fra 768 px.
//   - Kun links der virker uden konto (app-siderne help/rules/pro kræver login).

import { makeT, type Dict } from "@/lib/t";
import { buttonClass } from "./button-styles";
import { AppLink } from "@/components/app-link";
import { PlusIcon } from "@/components/icons";

const DISCORD_URL = "https://discord.gg/ykysBrWUyC";
const APP = "https://cyclingzone.org";

type Lang = "en" | "da";
type Row = { title: string; body: string };
type FaqEntry = { q: string; a: string };

const PATHS = {
  home: { en: "/", da: "/da" },
  how: { en: "/how-it-works", da: "/da/saadan-fungerer-det" },
  compare: { en: "/pro-cycling-manager-alternative", da: "/da/pro-cycling-manager-alternativ" },
  terms: { en: `${APP}/terms`, da: `${APP}/handelsbetingelser` },
  privacy: { en: `${APP}/privacy-policy`, da: `${APP}/privatlivspolitik` },
} as const;

// Billedernes egne mål (2x-udsnit), så browseren reserverer pladsen (ingen CLS).
// Hvert sprog har sine egne billeder, så /da viser spillet på dansk.
const SHOTS = {
  en: {
    team: { d: ["/landing/team-desktop.webp", 1735, 1222], m: ["/landing/team-mobile.webp", 1040, 1240] },
    plan: { d: ["/landing/plan-desktop.webp", 1965, 905], m: ["/landing/plan-mobile.webp", 1022, 1000] },
    result: { d: ["/landing/result-desktop.webp", 1400, 1071], m: ["/landing/result-mobile.webp", 976, 1445] },
  },
  da: {
    team: { d: ["/landing/team-desktop-da.webp", 1735, 1222], m: ["/landing/team-mobile-da.webp", 1040, 1240] },
    plan: { d: ["/landing/plan-desktop-da.webp", 1965, 905], m: ["/landing/plan-mobile-da.webp", 1022, 1000] },
    result: { d: ["/landing/result-desktop-da.webp", 1400, 1071], m: ["/landing/result-mobile-da.webp", 976, 1445] },
  },
} as const;

function Shot({
  lang,
  shot,
  alt,
  caption,
  eager = false,
  captionClassName = "",
}: {
  lang: Lang;
  shot: keyof (typeof SHOTS)["en"];
  alt: string;
  caption: string;
  eager?: boolean;
  captionClassName?: string;
}) {
  const { d, m } = SHOTS[lang][shot];
  return (
    <figure className="m-0 min-w-0">
      <div className="overflow-hidden rounded-cz border border-cz-border bg-cz-card">
        <picture>
          <source media="(min-width: 768px)" srcSet={d[0]} width={d[1]} height={d[2]} />
          <img
            src={m[0]}
            width={m[1]}
            height={m[2]}
            alt={alt}
            loading={eager ? "eager" : "lazy"}
            fetchPriority={eager ? "high" : "auto"}
            decoding="async"
            className="block h-auto w-full"
          />
        </picture>
      </div>
      <figcaption className={`mt-3 text-sm text-cz-3 ${captionClassName}`}>{caption}</figcaption>
    </figure>
  );
}

function LanguageToggle({ lang, label }: { lang: Lang; label: string }) {
  return (
    <div className="inline-flex items-center rounded-cz border border-cz-border p-0.5" role="group" aria-label={label}>
      {(["en", "da"] as const).map((lng) => (
        <a
          key={lng}
          href={PATHS.home[lng]}
          hrefLang={lng}
          aria-current={lang === lng ? "page" : undefined}
          className={
            "inline-flex min-h-9 min-w-10 items-center justify-center rounded-[3px] px-2.5 font-data text-xs font-semibold transition-colors " +
            (lang === lng ? "bg-cz-1 text-cz-body" : "text-cz-2 hover:text-cz-1")
          }
        >
          {lng.toUpperCase()}
        </a>
      ))}
    </div>
  );
}

// Produktnavnet "CZ Pro" må aldrig deles over to linjer.
const keep = (s: string) => s.replace(/CZ Pro/g, "CZ Pro");

function SectionTitle({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="m-0 max-w-[22ch] font-data text-[28px] font-bold leading-[1.1] tracking-[-0.01em] text-balance text-cz-1 sm:text-[36px]">
      {typeof children === "string" ? keep(children) : children}
    </h2>
  );
}

function FaqItem({ q, a }: FaqEntry) {
  return (
    <details className="group border-t border-cz-border">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-6 py-4 [&::-webkit-details-marker]:hidden">
        <span className="text-base font-semibold text-cz-1">{q}</span>
        <PlusIcon className="h-5 w-5 shrink-0 text-cz-2 transition-transform duration-200 group-open:rotate-45 motion-reduce:transition-none" aria-hidden="true" />
      </summary>
      <p className="m-0 max-w-[62ch] pb-5 text-base leading-relaxed text-cz-2">{a}</p>
    </details>
  );
}

export default function LandingPage({ lang, dict }: { lang: Lang; dict: Dict }) {
  const t = makeT(dict);
  const rows = t.raw<Row[]>("develop.rows") ?? [];
  const steps = t.raw<Row[]>("start.steps") ?? [];
  const faq = t.raw<FaqEntry[]>("faq.items") ?? [];
  const person = t.raw<string[]>("person.paragraphs") ?? [];
  const signup = `${APP}/login?mode=signup`;
  const wrap = "mx-auto w-full max-w-6xl px-4 sm:px-8";
  const section = "border-t border-cz-border py-16 sm:py-24";
  const link = "inline-block py-2 font-semibold text-cz-1 underline decoration-cz-3 underline-offset-4 hover:decoration-cz-1";

  return (
    <div className="min-h-screen bg-cz-body text-cz-1">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-toast focus:rounded-cz focus:bg-cz-card focus:px-3 focus:py-2 focus:text-sm"
      >
        {t("nav.skipToContent")}
      </a>

      <header className="border-b border-cz-border">
        <div className={`${wrap} flex items-center justify-between gap-4 py-3.5`}>
          <a href={PATHS.home[lang]} className="shrink-0">
            <img src="/brand/wordmark-onlight.svg" alt="Cycling Zone" className="block h-8 sm:h-9" draggable="false" />
          </a>
          <div className="flex items-center gap-2 sm:gap-3">
            <LanguageToggle lang={lang} label={t("nav.languageLabel")} />
            <AppLink href={`${APP}/login`} className={`${buttonClass({ variant: "ghost", size: "md" })} whitespace-nowrap`}>
              {t("nav.login")}
            </AppLink>
          </div>
        </div>
      </header>

      <main id="main">
        {/* 1 · Top */}
        <section className={`${wrap} grid items-center gap-10 pb-16 pt-10 sm:pt-16 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-14 lg:pb-24 lg:pt-20`}>
          <div className="min-w-0">
            <p className="m-0 font-data text-[15px] font-medium text-cz-2">{t("hero.intro")}</p>
            <h1 className="m-0 mt-3 font-display text-[52px] leading-[0.92] tracking-[0.005em] text-balance text-cz-1 sm:text-[68px] lg:text-[84px]">
              {t("hero.title")}
            </h1>
            <p className="m-0 mt-5 max-w-[40ch] text-lg leading-relaxed text-cz-2">{t("hero.body")}</p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <AppLink href={signup} className={buttonClass({ variant: "primary", size: "lg" })}>
                {t("hero.cta")}
              </AppLink>
              <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer" className={buttonClass({ variant: "secondary", size: "lg" })}>
                {t("hero.ctaDiscord")}
              </a>
            </div>
            <p className="m-0 mt-4 text-sm text-cz-3">{keep(t("hero.micro"))}</p>
          </div>
          <Shot lang={lang} shot="team" alt={t("hero.imageAlt")} caption={t("hero.caption")} eager />
        </section>

        {/* 2 · Løbseksempel */}
        <section className={section} aria-labelledby="race">
          <div className={wrap}>
            <SectionTitle id="race">{t("race.title")}</SectionTitle>
            <p className="m-0 mt-4 max-w-[58ch] text-lg leading-relaxed text-cz-2">{t("race.body")}</p>
            <p className="m-0 mt-6 font-data text-xl font-semibold text-cz-1">{t("race.scenario")}</p>
            <div className="mt-10 flex flex-col gap-10">
              <Shot lang={lang} shot="plan" alt={t("race.beforeAlt")} caption={t("race.beforeCaption")} />
              {/* Efter-billedet forskudt til højre; på desktop står billedteksten i
                  feltet ud for det, så løbet læses fra plan (oven for) til resultat. */}
              <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_54%] lg:gap-10">
                <p className="m-0 hidden max-w-[24ch] pt-6 font-data text-xl font-semibold leading-snug text-cz-1 lg:block" aria-hidden="true">
                  {t("race.afterCaption")}
                </p>
                <Shot lang={lang} shot="result" alt={t("race.afterAlt")} caption={t("race.afterCaption")} captionClassName="lg:sr-only" />
              </div>
            </div>
          </div>
        </section>

        {/* 3 · Holdudvikling */}
        <section className={section}>
          <div className={wrap}>
            <SectionTitle>{t("develop.title")}</SectionTitle>
            <dl className="m-0 mt-10">
              {rows.map((row) => (
                <div key={row.title} className="grid gap-2 border-t border-cz-border py-6 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:gap-10">
                  <dt className="font-data text-lg font-semibold text-cz-1">{row.title}</dt>
                  <dd className="m-0 max-w-[58ch] text-base leading-relaxed text-cz-2">{row.body}</dd>
                </div>
              ))}
            </dl>
            <p className="m-0 mt-6 border-t border-cz-border pt-6">
              <a href={PATHS.how[lang]} className={link}>
                {t("develop.link")}
              </a>
            </p>
          </div>
        </section>

        {/* 4 · Kom i gang (en ægte rækkefølge, derfor tal) */}
        <section className={section}>
          <div className={wrap}>
            <SectionTitle>{t("start.title")}</SectionTitle>
            <ol className="m-0 mt-10 grid list-none gap-0 p-0 md:grid-cols-3 md:gap-10">
              {steps.map((step, i) => (
                <li key={step.title} className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-3 border-t border-cz-border py-6 md:block">
                  <span className="font-data text-[28px] font-semibold leading-none tabular-nums text-cz-3 md:block" aria-hidden="true">
                    {i + 1}
                  </span>
                  <div className="md:mt-5">
                    <h3 className="m-0 font-data text-lg font-semibold text-cz-1">{step.title}</h3>
                    <p className="m-0 mt-2 max-w-[40ch] text-base leading-relaxed text-cz-2">{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
            <div className="mt-8">
              <AppLink href={signup} className={buttonClass({ variant: "primary", size: "lg" })}>
                {t("start.cta")}
              </AppLink>
            </div>
          </div>
        </section>

        {/* 5 · Gratis og CZ Pro */}
        <section className={section}>
          <div className={`${wrap} grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] md:gap-10`}>
            <SectionTitle>{t("pro.title")}</SectionTitle>
            <div className="max-w-[58ch]">
              <p className="m-0 text-lg leading-relaxed text-cz-2">{keep(t("pro.body"))}</p>
              <p className="m-0 mt-5 text-lg font-semibold leading-relaxed text-cz-1">{t("pro.fairness")}</p>
            </div>
          </div>
        </section>

        {/* 6 · Mennesket bag */}
        <section className={section}>
          <div className={`${wrap} grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] md:gap-10`}>
            <SectionTitle>{t("person.title")}</SectionTitle>
            <div className="max-w-[62ch]">
              {person.map((p) => (
                <p key={p.slice(0, 24)} className="m-0 mb-5 text-lg leading-relaxed text-cz-2 last:mb-0">
                  {p}
                </p>
              ))}
              <p className="m-0 mt-6">
                <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer" className={buttonClass({ variant: "secondary", size: "lg" })}>
                  {t("person.link")}
                </a>
              </p>
            </div>
          </div>
        </section>

        {/* 7 · FAQ */}
        <section className={section}>
          <div className={`${wrap} grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] md:gap-10`}>
            <SectionTitle>{t("faq.title")}</SectionTitle>
            <div className="border-b border-cz-border">
              {faq.map((item) => (
                <FaqItem key={item.q} q={item.q} a={item.a} />
              ))}
            </div>
          </div>
        </section>

        {/* Afslutning */}
        <section className="border-t border-cz-border py-20 sm:py-28">
          <div className={wrap}>
            <SectionTitle>{t("closing.title")}</SectionTitle>
            <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3">
              <AppLink href={signup} className={buttonClass({ variant: "primary", size: "lg" })}>
                {t("closing.cta")}
              </AppLink>
              <span className="text-sm text-cz-3">{keep(t("closing.micro"))}</span>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-cz-border">
        <div className={`${wrap} grid grid-cols-2 gap-x-6 gap-y-10 py-12 lg:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))]`}>
          <div className="col-span-2 lg:col-span-1">
            <img src="/brand/wordmark-onlight.svg" alt="Cycling Zone" className="block h-6" draggable="false" />
            <p className="m-0 mt-3 text-sm text-cz-2">{t("footerV2.tagline")}</p>
            <p className="m-0 mt-6 text-sm text-cz-3">{t("footerV2.madeBy")}</p>
          </div>
          <nav aria-label={t("footerV2.game")}>
            <h2 className="m-0 font-data text-sm font-semibold text-cz-1">{t("footerV2.game")}</h2>
            <ul className="m-0 mt-2 grid list-none gap-0.5 p-0 text-sm">
              <li><a href={PATHS.how[lang]} className="inline-block py-1.5 text-cz-2 hover:text-cz-1">{t("footer.explore.howItWorks")}</a></li>
              <li><a href={PATHS.compare[lang]} className="inline-block py-1.5 text-cz-2 hover:text-cz-1">{t("footer.explore.compare")}</a></li>
              <li><AppLink href={`${APP}/login`} className="inline-block py-1.5 text-cz-2 hover:text-cz-1">{t("nav.login")}</AppLink></li>
            </ul>
          </nav>
          <nav aria-label={t("footerV2.community")}>
            <h2 className="m-0 font-data text-sm font-semibold text-cz-1">{t("footerV2.community")}</h2>
            <ul className="m-0 mt-2 grid list-none gap-0.5 p-0 text-sm">
              <li><a href={DISCORD_URL} target="_blank" rel="noopener noreferrer" className="inline-block py-1.5 text-cz-2 hover:text-cz-1">{t("footer.discord")}</a></li>
            </ul>
          </nav>
          <nav aria-label={t("footerV2.legal")}>
            <h2 className="m-0 font-data text-sm font-semibold text-cz-1">{t("footerV2.legal")}</h2>
            <ul className="m-0 mt-2 grid list-none gap-0.5 p-0 text-sm">
              <li><a href={PATHS.terms[lang]} className="inline-block py-1.5 text-cz-2 hover:text-cz-1">{t("footer.explore.terms")}</a></li>
              <li><a href={PATHS.privacy[lang]} className="inline-block py-1.5 text-cz-2 hover:text-cz-1">{t("footer.explore.privacy")}</a></li>
            </ul>
          </nav>
        </div>
        <div className={`${wrap} flex items-center justify-between gap-4 border-t border-cz-border py-6`}>
          <span className="text-xs text-cz-3">© Cycling Zone</span>
          <LanguageToggle lang={lang} label={t("nav.languageLabel")} />
        </div>
      </footer>
    </div>
  );
}
