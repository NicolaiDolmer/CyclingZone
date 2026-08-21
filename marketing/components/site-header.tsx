import { NAV, type Lang } from "@/lib/copy";

// NB: sprogskifteren peger på modpartens FORSIDE. Når flere sider findes,
// erstattes den af en path-bevidst helper (noteret i #4067).
export default function SiteHeader({ lang }: { lang: Lang }) {
  const t = NAV[lang];
  return (
    <header className="site-header">
      <a className="wordmark" href={lang === "da" ? "/da" : "/"}>
        Cycling Zone
      </a>
      <nav className="site-nav" aria-label={lang === "da" ? "Hovedmenu" : "Main"}>
        <a href="https://cyclingzone.org/help">{t.help}</a>
        <a href="https://cyclingzone.org/roadmap">{t.roadmap}</a>
        <a href={t.langSwitchHref} lang={lang === "da" ? "en" : "da"}>
          {t.langSwitch}
        </a>
        <a href="https://cyclingzone.org/login">{t.login}</a>
        {/* Hairline-outline, ikke guld: hero-CTA'en er viewets ene gold primary. */}
        <a className="btn-outline" href="https://cyclingzone.org/login">
          {t.cta}
        </a>
      </nav>
    </header>
  );
}
