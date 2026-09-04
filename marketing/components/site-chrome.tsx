// Delt header/footer til de NYE informations-sider (how-it-works,
// pro-cycling-manager-alternative, #4067 S1 forts.). Forsiden (landing-page.tsx)
// er en owner-godkendt 1:1-port og beholder sit eget indlejrede header/footer
// uaendret for at holde nul visuel risiko paa den side; disse komponenter deler
// samme byggeklodser (Wordmark, LanguageToggle, buttonClass) saa resten af
// sitet ser ud som ét system. Sprogskifteren peger paa den FAKTISKE
// oversatte side (ikke bare "/da"), saa hreflang og synligt link stemmer overens.

import { buttonClass } from "./landing/button-styles";

const APP = "https://cyclingzone.org";

export function Wordmark({ className = "h-7 sm:h-8" }: { className?: string }) {
  return (
    <img
      src="/brand/wordmark-onlight.svg"
      alt="Cycling Zone"
      className={`${className} block`}
      draggable="false"
    />
  );
}

type Lang = "en" | "da";

export function LanguageToggle({
  lang,
  label,
  hrefEn,
  hrefDa,
}: {
  lang: Lang;
  label: string;
  hrefEn: string;
  hrefDa: string;
}) {
  const hrefs: Record<Lang, string> = { en: hrefEn, da: hrefDa };
  return (
    <div className="inline-flex items-center rounded-cz border border-cz-border p-0.5" role="group" aria-label={label}>
      {(["en", "da"] as const).map((lng) => (
        <a
          key={lng}
          href={hrefs[lng]}
          aria-current={lang === lng ? "page" : undefined}
          className={
            "rounded-[3px] px-2.5 py-1 font-data text-2xs font-semibold uppercase tracking-wider transition-colors " +
            (lang === lng ? "bg-cz-accent text-cz-on-accent" : "text-cz-2 hover:text-cz-1")
          }
        >
          {lng}
        </a>
      ))}
    </div>
  );
}

export function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="h-px w-6 bg-cz-accent-t" aria-hidden="true" />
      <span className="font-data text-2xs font-semibold uppercase tracking-[0.22em] text-cz-3">{children}</span>
    </div>
  );
}

export type NavCopy = {
  home: string;
  howItWorks: string;
  compare: string;
  login: string;
  signup: string;
  languageLabel: string;
  skipToContent: string;
};

export type PathPair = { en: string; da: string };

function navHref(lang: Lang, pair: PathPair) {
  return pair[lang];
}

export function SiteHeader({
  lang,
  nav,
  homePaths,
  howItWorksPaths,
  comparePaths,
}: {
  lang: Lang;
  nav: NavCopy;
  homePaths: PathPair;
  howItWorksPaths: PathPair;
  comparePaths: PathPair;
}) {
  const navLinks: Array<{ label: string; paths: PathPair }> = [
    { label: nav.home, paths: homePaths },
    { label: nav.howItWorks, paths: howItWorksPaths },
    { label: nav.compare, paths: comparePaths },
  ];

  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-toast focus:rounded-cz focus:bg-cz-card focus:px-3 focus:py-2 focus:text-sm"
      >
        {nav.skipToContent}
      </a>
      <header className="sticky top-0 z-sticky border-b border-cz-border bg-cz-body">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3.5 sm:px-8">
          <a href={navHref(lang, homePaths)} className="shrink-0">
            <Wordmark />
          </a>
          <nav className="hidden items-center gap-6 md:flex" aria-label={nav.home}>
            {navLinks.map((link) => (
              <a
                key={link.label}
                href={navHref(lang, link.paths)}
                className="font-data text-2xs font-semibold uppercase tracking-[0.1em] text-cz-2 hover:text-cz-1"
              >
                {link.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-1.5 sm:gap-3">
            <div className="hidden sm:flex">
              <LanguageToggle
                lang={lang}
                label={nav.languageLabel}
                hrefEn={homePaths.en === "/" ? "/" : homePaths.en}
                hrefDa={homePaths.da}
              />
            </div>
            <a href={`${APP}/login`} className={`${buttonClass({ variant: "ghost", size: "sm" })} whitespace-nowrap`}>
              {nav.login}
            </a>
            <a
              href={`${APP}/login?mode=signup`}
              className={`${buttonClass({ variant: "secondary", size: "sm" })} whitespace-nowrap`}
            >
              {nav.signup}
            </a>
          </div>
        </div>
      </header>
    </>
  );
}

export function SiteFooter({
  lang,
  tagline,
  privacyLabel,
  discordLabel,
  languageLabel,
  homePaths,
}: {
  lang: Lang;
  tagline: string;
  privacyLabel: string;
  discordLabel: string;
  languageLabel: string;
  homePaths: PathPair;
}) {
  const privacyHref = `${APP}${lang === "en" ? "/privacy-policy" : "/privatlivspolitik"}`;
  return (
    <footer className="border-t border-cz-border">
      <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-4 px-5 py-8 sm:flex-row sm:items-center sm:px-8">
        <div className="flex items-center gap-3">
          <Wordmark className="h-4" />
          <span className="text-xs text-cz-3">{tagline}</span>
        </div>
        <nav className="flex flex-wrap items-center gap-4 text-sm sm:gap-5">
          <LanguageToggle lang={lang} label={languageLabel} hrefEn={homePaths.en} hrefDa={homePaths.da} />
          <a href={privacyHref} className="text-cz-2 hover:text-cz-1">
            {privacyLabel}
          </a>
          <a href="https://discord.gg/ykysBrWUyC" target="_blank" rel="noopener noreferrer" className="text-cz-2 hover:text-cz-1">
            {discordLabel}
          </a>
        </nav>
      </div>
    </footer>
  );
}
