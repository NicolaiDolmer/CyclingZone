import type { Metadata } from "next";
import PcmComparisonPage, { type PcmComparisonCopy } from "@/components/pcm-comparison-page";

const TITLE = "Cycling Zone vs Pro Cycling Manager: Gratis alternativ";
const DESCRIPTION =
  "Sådan sammenlignes Cycling Zone med Pro Cycling Manager: gratis vs betalt, browser vs installation, live multiplayer-auktioner vs single-player karriere, vedvarende sæson vs 3D-etapesimulation.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: {
    canonical: "/da/pro-cycling-manager-alternativ",
    languages: {
      en: "/pro-cycling-manager-alternative",
      da: "/da/pro-cycling-manager-alternativ",
      "x-default": "/pro-cycling-manager-alternative",
    },
  },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "/da/pro-cycling-manager-alternativ",
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
    title: TITLE,
    description: DESCRIPTION,
    images: ["https://cyclingzone.org/og-cycling-zone.png"],
  },
};

const COPY: PcmComparisonCopy = {
  nav: {
    home: "Forside",
    howItWorks: "Sådan virker det",
    compare: "vs PCM",
    login: "Log ind",
    signup: "Opret bruger",
    languageLabel: "Sprog",
    skipToContent: "Spring til indhold",
  },
  kicker: "Cycling Zone vs Pro Cycling Manager",
  h1: "Et gratis alternativ til Pro Cycling Manager, direkte i browseren",
  intro:
    "Pro Cycling Manager (Cyanide) er et velkendt navn inden for cykel-managerspil, og det gør meget rigtigt. Cycling Zone er bygget anderledes: gratis, i din browser, og bygget omkring andre rigtige managere i stedet for AI-modstandere. Her er hvordan de to faktisk adskiller sig.",
  tableCaption: "Sammenligningstabel",
  colCategory: "Kategori",
  colCz: "Cycling Zone",
  colPcm: "Pro Cycling Manager",
  rows: [
    {
      label: "Pris",
      cz: "Gratis at spille. Intet køb for at bygge et hold eller konkurrere.",
      pcm: "Et betalt engangskøb pr. årlig udgivelse, typisk med valgfrit ekstra indhold.",
    },
    {
      label: "Platform",
      cz: "Kører i en webbrowser på computer eller mobil. Intet at installere.",
      pcm: "Et pc-spil du installerer (via Steam), bygget til computeren.",
    },
    {
      label: "Multiplayer",
      cz: "Bygget omkring live, realtids-konkurrence: du byder mod andre managere om ryttere i fælles auktioner og kører den samme kalender som dem.",
      pcm: "Bygget primært som en single-player-karriere, hvor du styrer dit eget hold mod AI-styrede modstandere.",
    },
    {
      label: "Simulation",
      cz: "En vedvarende, løbende sæson. Verden kører videre mellem dine besøg, og andre managere handler samtidig med dig.",
      pcm: "Hver etape udspiller sig som en 3D-realtidssimulation, du kan se eller styre mens den sker.",
    },
  ],
  disclaimer:
    "Sammenligningen dækker Cycling Zone og Pro Cycling Manager-serien (Cyanide) som den generelt er kendt. Den dækker ikke hver udgave eller hvert DLC, og Pro Cycling Manager er varemærke tilhørende sin egen udgiver.",
  editorialTitle: "Forskellige spil til en forskellig slags sæson",
  editorialBody:
    "Ingen af tilgangene er bedre på papiret, de er bygget til to forskellige ting. Pro Cycling Manager giver dig et detaljeret, 3D-simuleret løb du kan se og styre på egen hånd. Cycling Zone giver dig en levende sæson delt med rigtige mennesker: de samme auktioner, den samme kalender, det samme fairness-løfte for hver manager i den. Hvis det sidste lyder som dig, er det gratis at prøve.",
  ctaKicker: "Prøv det selv",
  ctaTitle: "Se forskellen i din første sæson",
  ctaBody: "Opret dit hold, vær med i en live-auktion, og konkurrér mod rigtige managere, uden at betale noget.",
  ctaPrimary: "Opret dit hold",
  ctaSecondary: "Kom med på Discord",
  footerTagline: "Et managerspil i browseren.",
  footerPrivacy: "Privatliv",
  footerDiscord: "Discord",
};

export default function Page() {
  return <PcmComparisonPage lang="da" copy={COPY} />;
}
