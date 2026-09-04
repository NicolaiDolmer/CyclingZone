// "How it works"-siden (#4067 S1 forts.). Ny informationsside, ingen SPA-
// tilsvarighed, saa copy holdes i et lokalt TS-objekt pr. sprog (page.tsx)
// i stedet for landing.json/makeT-lagets dot-path-opslag, som findes fordi
// landing-copyen deles med frontend-SPA'en. Fakta genbruger kun det der
// allerede staar i den godkendte landing (roster, live-auktioner, akademi,
// taktik, divisioner) - intet nyt er opdigtet (TASTE P11).

import { buttonClass } from "./landing/button-styles";
import { SiteHeader, SiteFooter, Kicker, type NavCopy, type PathPair } from "./site-chrome";
import { TeamIcon, CoinIcon, StarIcon, FlagIcon, CalendarIcon } from "./icons";

const DISCORD_URL = "https://discord.gg/ykysBrWUyC";
const APP = "https://cyclingzone.org";

const STEP_ICONS = [TeamIcon, CoinIcon, StarIcon, FlagIcon, CalendarIcon];

export type HowItWorksCopy = {
  nav: NavCopy;
  kicker: string;
  h1: string;
  intro: string;
  steps: Array<{ no: string; title: string; body: string }>;
  fairnessKicker: string;
  fairnessTitle: string;
  fairnessBody: string;
  ctaKicker: string;
  ctaTitle: string;
  ctaBody: string;
  ctaPrimary: string;
  ctaSecondary: string;
  footerTagline: string;
  footerPrivacy: string;
  footerDiscord: string;
};

const HOME: PathPair = { en: "/", da: "/da" };
const HOW: PathPair = { en: "/how-it-works", da: "/da/saadan-fungerer-det" };
const COMPARE: PathPair = { en: "/pro-cycling-manager-alternative", da: "/da/pro-cycling-manager-alternativ" };

export default function HowItWorksPage({ lang, copy }: { lang: "en" | "da"; copy: HowItWorksCopy }) {
  return (
    <div className="min-h-screen bg-cz-body text-cz-1">
      <SiteHeader lang={lang} nav={copy.nav} homePaths={HOME} howItWorksPaths={HOW} comparePaths={COMPARE} />

      <main id="main">
        <section className="mx-auto max-w-6xl px-5 pb-4 pt-12 sm:px-8 lg:pt-16">
          <Kicker>{copy.kicker}</Kicker>
          <h1 className="mt-4 max-w-3xl font-display text-5xl leading-[0.95] tracking-tight text-cz-1 sm:text-6xl">
            {copy.h1}
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-cz-2 sm:text-lg">{copy.intro}</p>
        </section>

        <section className="border-t border-cz-border">
          <div className="mx-auto max-w-6xl px-5 py-12 sm:px-8 lg:py-16">
            <div className="border-t border-cz-border">
              {copy.steps.map((step, i) => {
                const Icon = STEP_ICONS[i] ?? TeamIcon;
                return (
                  <div
                    key={step.no}
                    className="grid grid-cols-[auto_1fr] items-start gap-x-5 gap-y-1 border-b border-cz-border py-7 sm:grid-cols-[5rem_auto_1fr] sm:gap-x-8"
                  >
                    <span className="font-display text-4xl leading-none text-cz-3 sm:text-5xl">{step.no}</span>
                    <span className="row-span-2 hidden h-11 w-11 items-center justify-center border border-cz-border text-cz-accent-t sm:flex">
                      <Icon size={20} />
                    </span>
                    <div>
                      <h2 className="text-lg font-semibold text-cz-1">{step.title}</h2>
                      <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-cz-2">{step.body}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="border-t border-cz-border bg-cz-card/40">
          <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8 lg:py-16">
            <Kicker>{copy.fairnessKicker}</Kicker>
            <h2 className="mt-4 max-w-2xl font-display text-4xl leading-none tracking-tight text-cz-1 sm:text-5xl">
              {copy.fairnessTitle}
            </h2>
            <p className="mt-5 max-w-2xl border-l-2 border-cz-accent pl-4 text-base leading-relaxed text-cz-1 sm:text-lg">
              {copy.fairnessBody}
            </p>
          </div>
        </section>

        <section className="border-t border-cz-border">
          <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8 lg:py-16">
            <Kicker>{copy.ctaKicker}</Kicker>
            <h2 className="mt-4 font-display text-4xl leading-none tracking-tight text-cz-1 sm:text-5xl">
              {copy.ctaTitle}
            </h2>
            <p className="mt-5 max-w-md text-base leading-relaxed text-cz-2">{copy.ctaBody}</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <a href={`${APP}/login?mode=signup`} className={buttonClass({ variant: "primary", size: "lg" })}>
                {copy.ctaPrimary}
              </a>
              <a
                href={DISCORD_URL}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClass({ variant: "secondary", size: "lg" })}
              >
                {copy.ctaSecondary}
              </a>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter
        lang={lang}
        tagline={copy.footerTagline}
        privacyLabel={copy.footerPrivacy}
        discordLabel={copy.footerDiscord}
        languageLabel={copy.nav.languageLabel}
        homePaths={HOME}
      />
    </div>
  );
}
