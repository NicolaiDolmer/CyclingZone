// "Pro Cycling Manager alternative"-siden (#4067, laast beslutning 5:
// direkte, navngiven sammenligning, kun verificerbare fakta, respektfuld tone).
// Tabellen holder sig til det der faktisk kan efterproeves uden en kilde-note:
// forretningsmodel, platform, single- vs multiplayer, og simulationsform.
// Ingen praecise priser for Pro Cycling Manager er anfoert her (TASTE P11,
// "ingenting opdigtet") - kun det der er sandt for enhver udgave af serien.

import { buttonClass } from "./landing/button-styles";
import { SiteHeader, SiteFooter, Kicker, type NavCopy, type PathPair } from "./site-chrome";

const DISCORD_URL = "https://discord.gg/ykysBrWUyC";
const APP = "https://cyclingzone.org";

// Bevidst uden check/kryds-ikoner paa raekkerne (ejer-krav "respektfuld tone",
// laast beslutning 5): en scorecard-optik med groent/roedt signalerer "vinder/
// taber" paa fakta der bare er forskellige (prismodel, platform), ikke gode
// eller daarlige. Ren tekst side om side er den neutrale form.
export type CompareRow = {
  label: string;
  cz: string;
  pcm: string;
};

export type PcmComparisonCopy = {
  nav: NavCopy;
  kicker: string;
  h1: string;
  intro: string;
  tableCaption: string;
  colCategory: string;
  colCz: string;
  colPcm: string;
  rows: CompareRow[];
  disclaimer: string;
  editorialTitle: string;
  editorialBody: string;
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

export default function PcmComparisonPage({ lang, copy }: { lang: "en" | "da"; copy: PcmComparisonCopy }) {
  return (
    <div className="min-h-screen bg-cz-body text-cz-1">
      <SiteHeader lang={lang} nav={copy.nav} homePaths={HOME} howItWorksPaths={HOW} comparePaths={COMPARE} />

      <main id="main">
        <section className="mx-auto max-w-6xl px-5 pb-4 pt-12 sm:px-8 lg:pt-16">
          <Kicker>{copy.kicker}</Kicker>
          <h1 className="mt-4 max-w-3xl font-display text-4xl leading-[0.98] tracking-tight text-cz-1 sm:text-5xl lg:text-6xl">
            {copy.h1}
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-cz-2 sm:text-lg">{copy.intro}</p>
        </section>

        <section className="border-t border-cz-border">
          <div className="mx-auto max-w-6xl px-5 py-10 sm:px-8 lg:py-14">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse text-left">
                <caption className="mb-4 text-left font-data text-2xs font-semibold uppercase tracking-[0.16em] text-cz-3">
                  {copy.tableCaption}
                </caption>
                <thead>
                  <tr className="border-b border-cz-border">
                    <th scope="col" className="w-1/4 py-3 pr-4 text-xs font-semibold uppercase tracking-wide text-cz-3">
                      {copy.colCategory}
                    </th>
                    <th scope="col" className="w-[38%] py-3 pr-4 text-xs font-semibold uppercase tracking-wide text-cz-1">
                      {copy.colCz}
                    </th>
                    <th scope="col" className="w-[38%] py-3 text-xs font-semibold uppercase tracking-wide text-cz-2">
                      {copy.colPcm}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {copy.rows.map((row) => (
                    <tr key={row.label} className="border-b border-cz-border align-top">
                      <th scope="row" className="py-4 pr-4 text-sm font-semibold text-cz-1">
                        {row.label}
                      </th>
                      <td className="py-4 pr-4 text-sm leading-relaxed text-cz-1">{row.cz}</td>
                      <td className="py-4 text-sm leading-relaxed text-cz-2">{row.pcm}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-6 max-w-2xl text-xs leading-relaxed text-cz-3">{copy.disclaimer}</p>
          </div>
        </section>

        <section className="border-t border-cz-border bg-cz-card/40">
          <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8 lg:py-16">
            <h2 className="max-w-2xl font-display text-4xl leading-none tracking-tight text-cz-1 sm:text-5xl">
              {copy.editorialTitle}
            </h2>
            <p className="mt-5 max-w-2xl text-base leading-relaxed text-cz-2 sm:text-lg">{copy.editorialBody}</p>
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
