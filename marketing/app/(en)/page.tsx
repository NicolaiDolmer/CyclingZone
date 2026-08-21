import type { Metadata } from "next";
import { HOME } from "@/lib/copy";

// Canonical + hreflang sættes ALTID per page, aldrig i root layout (SPA-buggen).
export const metadata: Metadata = {
  alternates: {
    canonical: "/",
    languages: { en: "/", da: "/da", "x-default": "/" },
  },
};

const VIDEOGAME_LD = {
  "@context": "https://schema.org",
  "@type": "VideoGame",
  name: "Cycling Zone",
  url: "https://cyclingzone.org",
  description:
    "Fair, browser-based cycling manager MMO. Tactics, long-term planning and community rivalry. No pay-to-win, ever.",
  genre: "Sports management",
  gamePlatform: "Web browser",
  playMode: "MultiPlayer",
  applicationCategory: "Game",
  inLanguage: ["en", "da"],
  publisher: { "@id": "https://cyclingzone.org/#organization" },
  offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
};

export default function HomePage() {
  const t = HOME.en;
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

      <section className="pillars rise d3" aria-label="What Cycling Zone is">
        {t.pillars.map((p) => (
          <article className="pillar" key={p.num}>
            <span className="pillar-num">{p.num}</span>
            <h2>{p.title}</h2>
            <p>{p.body}</p>
          </article>
        ))}
      </section>

      <section className="facts rise d4" aria-label="Facts">
        {t.facts.map((f) => (
          <span key={f}>{f}</span>
        ))}
      </section>
    </main>
  );
}
