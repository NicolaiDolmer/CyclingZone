import type { Metadata } from "next";
import LandingPage from "@/components/landing/landing-page";
import da from "@/locales/da/landing.json";

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
  url: "https://cyclingzone.org/",
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

export default function DaHomePage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(VIDEOGAME_LD) }}
      />
      <LandingPage lang="da" dict={da} />
    </>
  );
}
