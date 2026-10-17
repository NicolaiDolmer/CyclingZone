import type { Metadata } from "next";
import LandingPage from "@/components/landing/landing-page";
import da from "@/locales/da/landing.json";

export const metadata: Metadata = {
  // #1369: titel og beskrivelse fra SEO-reviewet 15/10 (absolut titel, ingen template).
  title: { absolute: da.meta.title },
  description: da.meta.description,
  alternates: {
    canonical: "/da",
    languages: { en: "/", da: "/da", "x-default": "/" },
  },
  // openGraph er ikke deep-merged på tværs af segmenter i Next (kendt
  // gotcha): url skal derfor sættes sammen med de felter der ellers ville
  // gå tabt fra layout.tsx's openGraph (verificeret med next build + curl).
  openGraph: {
    type: "website",
    siteName: "Cycling Zone",
    locale: "da_DK",
    url: "/da",
    title: da.meta.title,
    description: da.meta.description,
    images: [
      {
        url: "https://cyclingzone.org/og-cycling-zone.png",
        width: 1200,
        height: 630,
        alt: da.meta.ogAlt,
      },
    ],
  },
};

const VIDEOGAME_LD = {
  "@context": "https://schema.org",
  "@type": "VideoGame",
  name: "Cycling Zone",
  // #1369 SEO-review 15/10: den danske side peger på sin egen adresse, ikke EN-forsiden.
  url: "https://cyclingzone.org/da",
  inLanguage: "da",
  description: da.meta.description,
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
  publisher: { "@id": "https://cyclingzone.org/#organization" },
};

// #1369: FAQPage med præcis den synlige FAQ-tekst.
const FAQ_LD = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  inLanguage: "da",
  mainEntity: da.faq.items.map((item) => ({
    "@type": "Question",
    name: item.q,
    acceptedAnswer: { "@type": "Answer", text: item.a },
  })),
};

export default function DaHomePage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(VIDEOGAME_LD) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(FAQ_LD) }}
      />
      <LandingPage lang="da" dict={da} />
    </>
  );
}
