import type { Metadata } from "next";
import HowItWorksPage, { type HowItWorksCopy } from "@/components/how-it-works-page";

// Canonical + hreflang sættes per page, aldrig i root layout (samme regel som
// forsiden, #4067).
const TITLE = "How It Works";
const DESCRIPTION =
  "See exactly how Cycling Zone works: build a roster, bid on riders in live auctions, set race tactics, and race a full season against real managers. Free, browser-based, no download.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: {
    canonical: "/how-it-works",
    languages: { en: "/how-it-works", da: "/da/saadan-fungerer-det", "x-default": "/how-it-works" },
  },
  openGraph: {
    title: `${TITLE} · Cycling Zone`,
    description: DESCRIPTION,
    url: "/how-it-works",
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
    title: `${TITLE} · Cycling Zone`,
    description: DESCRIPTION,
    images: ["https://cyclingzone.org/og-cycling-zone.png"],
  },
};

const COPY: HowItWorksCopy = {
  nav: {
    home: "Home",
    howItWorks: "How it works",
    compare: "vs PCM",
    login: "Log in",
    signup: "Sign up",
    languageLabel: "Language",
    skipToContent: "Skip to content",
  },
  kicker: "How it works",
  h1: "How Cycling Zone works",
  intro:
    "Cycling Zone runs on a live season, not a single race. Here is exactly what you do, from your first roster pick to the last stage of the year.",
  steps: [
    {
      no: "01",
      title: "Build your roster",
      body: "Sign up and put together a team that fits how you want to play. Pick climbers for the mountains, sprinters for the flat stages, and a captain to build your season around. You lead a full roster, not a single star rider.",
    },
    {
      no: "02",
      title: "Bid in live auctions",
      body: "Riders are not assigned to you. You win them, in real-time auctions against other managers who are online at the same time as you. Read the market, time your bid, and stay inside your budget.",
    },
    {
      no: "03",
      title: "Develop your riders",
      body: "Training sharpens the riders you already have, and your youth academy brings up new talent over time. A prospect you sign this season can be next season's leader.",
    },
    {
      no: "04",
      title: "Set your tactics before each race",
      body: "Before the start, you choose your captain, decide who attacks and who saves their legs, and set the plan for the stage. Your tactics change the result, not just your riders' stats.",
    },
    {
      no: "05",
      title: "Race a full season, then build for the next one",
      body: "Follow your team through stage races and one-day races across the calendar. Results move you up or down the divisions, and the season you build continues into the next one.",
    },
  ],
  fairnessKicker: "Same rules for everyone",
  fairnessTitle: "No pay-to-win, at any step above",
  fairnessBody:
    "The game must be fair for everyone. You cannot pay for better riders, faster training, or better results. What decides your season is how you play it.",
  ctaKicker: "Get started",
  ctaTitle: "Ready to build your team?",
  ctaBody: "Create your team and see the next live auction for yourself.",
  ctaPrimary: "Create your team",
  ctaSecondary: "Join the Discord",
  footerTagline: "A browser-based cycling manager.",
  footerPrivacy: "Privacy",
  footerDiscord: "Discord",
};

export default function Page() {
  return <HowItWorksPage lang="en" copy={COPY} />;
}
