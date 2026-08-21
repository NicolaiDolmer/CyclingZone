import type { Metadata } from "next";
import "../globals.css";

// DA-root-layout — alle ruter i denne gruppe ligger under /da/ og serveres
// med lang="da" i den statiske HTML (ikke-JS-crawlere ser korrekt sprog).
export const metadata: Metadata = {
  metadataBase: new URL("https://cyclingzone.org"),
  title: {
    default: "Cycling Zone — Gratis online cycling manager-spil",
    template: "%s — Cycling Zone",
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
        {children}
      </body>
    </html>
  );
}
