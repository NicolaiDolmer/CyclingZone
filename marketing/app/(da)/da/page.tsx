import type { Metadata } from "next";
import { HOME } from "@/lib/copy";

export const metadata: Metadata = {
  alternates: {
    canonical: "/da",
    languages: { en: "/", da: "/da", "x-default": "/" },
  },
};

const VIDEOGAME_LD = {
  "@context": "https://schema.org",
  "@type": "VideoGame",
  name: "Cycling Zone",
  url: "https://cyclingzone.org",
  description:
    "Fair, browser-baseret cycling manager-MMO. Taktik, langsigtet planlægning og rivalisering mellem managere. Aldrig pay-to-win.",
  genre: "Sports management",
  gamePlatform: "Web browser",
  playMode: "MultiPlayer",
  applicationCategory: "Game",
  inLanguage: ["en", "da"],
  publisher: { "@id": "https://cyclingzone.org/#organization" },
  offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
};

export default function DaHomePage() {
  const t = HOME.da;
  return (
    <main className="page">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(VIDEOGAME_LD) }}
      />
      <section className="hero">
        <h1 className="rise">{t.h1}</h1>
        <p className="hero-sub rise d1">{t.sub}</p>
        <p className="hero-ctas rise d2">
          <a className="btn-gold" href="https://cyclingzone.org/login">
            {t.cta}
          </a>
          <a className="link-quiet" href="https://cyclingzone.org/help">
            {t.ctaSecondary}
          </a>
        </p>
      </section>

      <section className="pillars rise d3" aria-label="Hvad Cycling Zone er">
        {t.pillars.map((p) => (
          <article className="pillar" key={p.num}>
            <span className="pillar-num">{p.num}</span>
            <h2>{p.title}</h2>
            <p>{p.body}</p>
          </article>
        ))}
      </section>

      <section className="facts rise d4" aria-label="Fakta">
        {t.facts.map((f) => (
          <span key={f}>{f}</span>
        ))}
      </section>
    </main>
  );
}
