import type { Metadata } from "next";
import PcmComparisonPage, { type PcmComparisonCopy } from "@/components/pcm-comparison-page";

const TITLE = "Cycling Zone vs Pro Cycling Manager: Free Online Alternative";
const DESCRIPTION =
  "How Cycling Zone compares to Pro Cycling Manager: free vs paid, browser vs install, live multiplayer auctions vs single-player career, persistent season vs 3D stage simulation.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: {
    canonical: "/pro-cycling-manager-alternative",
    languages: {
      en: "/pro-cycling-manager-alternative",
      da: "/da/pro-cycling-manager-alternativ",
      "x-default": "/pro-cycling-manager-alternative",
    },
  },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "/pro-cycling-manager-alternative",
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
    title: TITLE,
    description: DESCRIPTION,
    images: ["https://cyclingzone.org/og-cycling-zone.png"],
  },
};

const COPY: PcmComparisonCopy = {
  nav: {
    home: "Home",
    howItWorks: "How it works",
    compare: "vs PCM",
    login: "Log in",
    signup: "Sign up",
    languageLabel: "Language",
    skipToContent: "Skip to content",
  },
  kicker: "Cycling Zone vs Pro Cycling Manager",
  h1: "A free, browser-based alternative to Pro Cycling Manager",
  intro:
    "Pro Cycling Manager (Cyanide) is a well-known name in cycling management games, and it does a lot right. Cycling Zone is built differently: free, in your browser, and around other real managers instead of AI opponents. Here is how the two actually compare.",
  tableCaption: "Comparison table",
  colCategory: "Category",
  colCz: "Cycling Zone",
  colPcm: "Pro Cycling Manager",
  rows: [
    {
      label: "Price",
      cz: "Free to play. No purchase to build a team or compete.",
      pcm: "A paid, one-time purchase per yearly release, typically with optional add-on content.",
    },
    {
      label: "Platform",
      cz: "Runs in a web browser on desktop or mobile. Nothing to install.",
      pcm: "A PC game you install (via Steam), built for desktop play.",
    },
    {
      label: "Multiplayer",
      cz: "Built around live, real-time competition: you bid against other managers for riders in shared auctions and race the same calendar as them.",
      pcm: "Built primarily as a single-player career, managing your own team against AI-controlled opponents.",
    },
    {
      label: "Simulation",
      cz: "A persistent, ongoing season. The world keeps running between your visits, and other managers act at the same time as you.",
      pcm: "Each stage plays out as a 3D real-time simulation you can watch or direct as it happens.",
    },
  ],
  disclaimer:
    "This comparison covers Cycling Zone and the Pro Cycling Manager series (Cyanide) as they are generally known. It does not cover every edition or DLC, and Pro Cycling Manager is the trademark of its own publisher.",
  editorialTitle: "Different games for a different kind of season",
  editorialBody:
    "Neither approach is better on paper, they are built for different things. Pro Cycling Manager gives you a detailed, 3D-simulated race to watch and direct on your own. Cycling Zone gives you a live season shared with real people: the same auctions, the same calendar, the same fairness promise for every manager in it. If you want the second one, it is free to try.",
  ctaKicker: "Try it yourself",
  ctaTitle: "See the difference in your first season",
  ctaBody: "Create your team, join a live auction, and race against real managers, at no cost.",
  ctaPrimary: "Create your team",
  ctaSecondary: "Join the Discord",
  footerTagline: "A browser-based cycling manager.",
  footerPrivacy: "Privacy",
  footerDiscord: "Discord",
};

export default function Page() {
  return <PcmComparisonPage lang="en" copy={COPY} />;
}
