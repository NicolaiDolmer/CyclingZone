import type { Metadata } from "next";
import SiteHeader from "@/components/site-header";
import SiteFooter from "@/components/site-footer";
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
    "Cycling Zone: fair, browser-baseret cycling manager-MMO. Taktik, langsigtet planlægning og rivalisering mellem managere. Aldrig pay-to-win.",
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
        <div className="accent-rule" aria-hidden="true" />
        <SiteHeader lang="da" />
        {children}
        <SiteFooter lang="da" />
      </body>
    </html>
  );
}
