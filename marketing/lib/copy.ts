// Al copy for marketing-fladen. EN først, DA under (player-facing-reglen).
// Ingen em-dash, ingen opfundne tal. Endelig tone låses i tone-sessionen (S2);
// alle fairness-linjer genbruger den ejer-godkendte og:description-formulering.

export type Lang = "en" | "da";

export const NAV = {
  en: {
    help: "Help",
    roadmap: "Roadmap",
    login: "Log in",
    cta: "Play free",
    langSwitch: "Dansk",
    langSwitchHref: "/da",
  },
  da: {
    help: "Hjælp",
    roadmap: "Roadmap",
    login: "Log ind",
    cta: "Spil gratis",
    langSwitch: "English",
    langSwitchHref: "/",
  },
} as const;

export const HOME = {
  en: {
    h1: "The free online cycling manager",
    sub: "Build your team, bid on riders in live auctions and race a full season against real managers, straight in your browser. No pay-to-win, ever.",
    cta: "Play free",
    ctaSecondary: "How it works",
    pillars: [
      {
        num: "01",
        title: "Live rider auctions",
        body: "Every rider changes hands at auction. Read the market, time your bids and build a squad your rivals did not see coming.",
      },
      {
        num: "02",
        title: "A living season",
        body: "Races run on a real calendar, day after day. Set tactics, pick your line-up and follow the season unfold with everyone else.",
      },
      {
        num: "03",
        title: "Fair by design",
        body: "Premium never buys stronger riders or competitive advantages. The best manager wins, not the biggest wallet.",
      },
    ],
    facts: ["Open beta", "Since May 2026", "No download", "English + Dansk"],
  },
  da: {
    h1: "Den gratis online cycling manager",
    sub: "Byg dit hold, byd på ryttere i live-auktioner og kør en hel sæson mod rigtige managere, direkte i browseren. Aldrig pay-to-win.",
    cta: "Spil gratis",
    ctaSecondary: "Sådan fungerer det",
    pillars: [
      {
        num: "01",
        title: "Live rytter-auktioner",
        body: "Alle ryttere skifter hænder på auktion. Læs markedet, tim dine bud og byg en trup dine rivaler ikke så komme.",
      },
      {
        num: "02",
        title: "En levende sæson",
        body: "Løbene kører efter en rigtig kalender, dag efter dag. Sæt taktikken, vælg din opstilling og følg sæsonen folde sig ud sammen med alle andre.",
      },
      {
        num: "03",
        title: "Fair i sin kerne",
        body: "Premium køber aldrig stærkere ryttere eller konkurrencefordele. Den bedste manager vinder, ikke den største pengepung.",
      },
    ],
    facts: ["Åben beta", "Siden maj 2026", "Ingen download", "English + Dansk"],
  },
} as const;

export const FOOTER = {
  en: {
    links: [
      { label: "Help", href: "https://cyclingzone.org/help" },
      { label: "Rules", href: "https://cyclingzone.org/rules" },
      { label: "Roadmap", href: "https://cyclingzone.org/roadmap" },
      { label: "Patch notes", href: "https://cyclingzone.org/patch-notes" },
      { label: "Discord", href: "https://discord.gg/ykysBrWUyC" },
      { label: "Privacy", href: "https://cyclingzone.org/privacy-policy" },
      { label: "Terms", href: "https://cyclingzone.org/terms" },
    ],
    note: "© 2026 Cycling Zone",
  },
  da: {
    links: [
      { label: "Hjælp", href: "https://cyclingzone.org/help" },
      { label: "Regler", href: "https://cyclingzone.org/rules" },
      { label: "Roadmap", href: "https://cyclingzone.org/roadmap" },
      { label: "Patch notes", href: "https://cyclingzone.org/patch-notes" },
      { label: "Discord", href: "https://discord.gg/ykysBrWUyC" },
      { label: "Privatlivspolitik", href: "https://cyclingzone.org/privatlivspolitik" },
      { label: "Handelsbetingelser", href: "https://cyclingzone.org/handelsbetingelser" },
    ],
    note: "© 2026 Cycling Zone",
  },
} as const;
