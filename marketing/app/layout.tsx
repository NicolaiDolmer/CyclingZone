import type { Metadata } from "next";
import "./globals.css";

// Skelet (#4067 S1): brand-fonte (DM Sans / Inter Tight / Bebas) porteres
// self-hosted fra frontend/ sammen med design-tokens — ingen Google Fonts,
// samme regel som frontend/index.html (#481 PF1).
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

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
