import type { Metadata } from "next";
import "../globals.css";

// DA-root-layout. Alle ruter i denne gruppe ligger under /da/ og serveres med
// lang="da" i den statiske HTML. Title-separator "·" (ingen em-dash).
export const metadata: Metadata = {
  metadataBase: new URL("https://cyclingzone.org"),
  title: {
    default: "Cycling Zone · Gratis online cycling manager-spil",
    template: "%s · Cycling Zone",
  },
  description:
    "Byg et hold, byd på ryttere i live-auktioner, sæt din taktik og kør en hel sæson. Et gratis, browser-baseret cycling manager-spil. Aldrig pay-to-win.",
  openGraph: {
    type: "website",
    siteName: "Cycling Zone",
    locale: "da_DK",
    images: [
      {
        url: "https://cyclingzone.org/og-cycling-zone.png",
        width: 1200,
        height: 630,
        alt: "Cycling Zone. Byg dit hold. Kør om kap med hele verden. Et fair cycling manager-MMO.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    images: ["https://cyclingzone.org/og-cycling-zone.png"],
  },
};

const JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://cyclingzone.org/#organization",
      name: "Cycling Zone",
      url: "https://cyclingzone.org",
      logo: "https://cyclingzone.org/brand/icon-512.png",
      sameAs: ["https://discord.gg/ykysBrWUyC"],
    },
    {
      "@type": "WebSite",
      "@id": "https://cyclingzone.org/#website",
      name: "Cycling Zone",
      url: "https://cyclingzone.org",
      publisher: { "@id": "https://cyclingzone.org/#organization" },
    },
  ],
};

export default function DaRootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="da">
      <body>
        <link
          rel="preload"
          href="/fonts/dm-sans-latin-wght-normal.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/fonts/bebas-neue-latin-400-normal.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
        />
        {children}
      </body>
    </html>
  );
}
