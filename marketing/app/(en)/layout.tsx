import type { Metadata } from "next";
import "../globals.css";

// EN-root-layout (route-group). DA har sit eget root-layout i app/(da)/ så
// <html lang> er korrekt i den server-leverede HTML for begge sprog.
// Landing-siden bringer selv sin header/footer (1:1-port af #672-designet).
// Title-separator er "·" (em-dash er bandlyst i al copy).
export const metadata: Metadata = {
  metadataBase: new URL("https://cyclingzone.org"),
  title: {
    default: "Cycling Zone · Free Online Cycling Manager Game",
    template: "%s · Cycling Zone",
  },
  description:
    "Build a team, bid on riders in live auctions, set your tactics, and race a full season. A free, browser-based cycling manager game. No pay-to-win.",
  openGraph: {
    type: "website",
    siteName: "Cycling Zone",
    locale: "en_US",
    images: [
      {
        url: "https://cyclingzone.org/og-cycling-zone.png",
        width: 1200,
        height: 630,
        alt: "Cycling Zone. Build your team. Race the world. A fair cycling manager MMO.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    images: ["https://cyclingzone.org/og-cycling-zone.png"],
  },
};

// Samme @ids som frontend/index.html (#1405) så crawlere ser ÉN entitet.
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

export default function EnRootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
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
