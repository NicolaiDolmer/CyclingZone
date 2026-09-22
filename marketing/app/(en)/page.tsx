import type { Metadata } from "next";
import LandingPage from "@/components/landing/landing-page";
import en from "@/locales/en/landing.json";

// Canonical + hreflang sættes ALTID per page, aldrig i root layout (SPA-buggen).
export const metadata: Metadata = {
  alternates: {
    canonical: "/",
    languages: { en: "/", da: "/da", "x-default": "/" },
  },
  // openGraph er ikke deep-merged på tværs af segmenter i Next (kendt
  // gotcha): url skal derfor sættes sammen med de felter der ellers ville
  // gå tabt fra layout.tsx's openGraph (verificeret med next build + curl).
  openGraph: {
    type: "website",
    siteName: "Cycling Zone",
    locale: "en_US",
    url: "/",
    images: [
      {
        url: "https://cyclingzone.org/og-cycling-zone.png",
        width: 1200,
        height: 630,
        alt: "Cycling Zone. Build your team. Race the world. A fair cycling manager MMO.",
      },
    ],
  },
};

// Samme VideoGame-LD som frontendens useJsonLd("videogame") (#1405).
const VIDEOGAME_LD = {
  "@context": "https://schema.org",
  "@type": "VideoGame",
  name: "Cycling Zone",
  url: "https://cyclingzone.org/",
  description: en.meta.description,
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

export default function HomePage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(VIDEOGAME_LD) }}
      />
      <LandingPage lang="en" dict={en} />
    </>
  );
}
