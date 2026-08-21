import type { Metadata } from "next";
import "../globals.css";

// EN-root-layout (route-group). DA har sit eget root-layout i app/(da)/ så
// <html lang> er korrekt i den server-leverede HTML for begge sprog.
export const metadata: Metadata = {
  metadataBase: new URL("https://cyclingzone.org"),
  title: {
    default: "Cycling Zone — Free Online Cycling Manager Game",
    template: "%s — Cycling Zone",
  },
  description:
    "Cycling Zone: fair, browser-based cycling manager MMO. Tactics, long-term planning and community rivalry. No pay-to-win, ever.",
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
        {children}
      </body>
    </html>
  );
}
