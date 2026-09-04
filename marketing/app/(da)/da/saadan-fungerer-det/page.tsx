import type { Metadata } from "next";
import HowItWorksPage, { type HowItWorksCopy } from "@/components/how-it-works-page";

const TITLE = "Sådan fungerer det";
const DESCRIPTION =
  "Se præcis hvordan Cycling Zone fungerer: byg en trup, byd på ryttere i live-auktioner, læg taktik og kør en hel sæson mod rigtige managere. Gratis, i browseren, ingen installation.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: {
    canonical: "/da/saadan-fungerer-det",
    languages: { en: "/how-it-works", da: "/da/saadan-fungerer-det", "x-default": "/how-it-works" },
  },
  openGraph: {
    title: `${TITLE} · Cycling Zone`,
    description: DESCRIPTION,
    url: "/da/saadan-fungerer-det",
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
    title: `${TITLE} · Cycling Zone`,
    description: DESCRIPTION,
    images: ["https://cyclingzone.org/og-cycling-zone.png"],
  },
};

const COPY: HowItWorksCopy = {
  nav: {
    home: "Forside",
    howItWorks: "Sådan virker det",
    compare: "vs PCM",
    login: "Log ind",
    signup: "Opret bruger",
    languageLabel: "Sprog",
    skipToContent: "Spring til indhold",
  },
  kicker: "Sådan fungerer det",
  h1: "Sådan fungerer Cycling Zone",
  intro:
    "Cycling Zone kører på en levende sæson, ikke et enkelt løb. Her er præcis hvad du gør, fra dit første valg til trup til sæsonens sidste etape.",
  steps: [
    {
      no: "01",
      title: "Byg din trup",
      body: "Opret dig og sæt et hold sammen der passer den måde du vil spille på. Vælg klatrere til bjergene, spurtere til det flade, og en kaptajn at bygge sæsonen omkring. Du leder en hel trup, ikke én enkelt stjerne.",
    },
    {
      no: "02",
      title: "Byd i live-auktioner",
      body: "Ryttere bliver ikke tildelt dig. Du vinder dem, i realtids-auktioner mod andre managere der er online samtidig med dig. Læs markedet, tim dit bud, og hold dig inden for budgettet.",
    },
    {
      no: "03",
      title: "Udvikl dine ryttere",
      body: "Træning skærper de ryttere du allerede har, og dit ungdomsakademi henter nye talenter op over tid. Et talent du henter ind i denne sæson kan blive næste sæsons anfører.",
    },
    {
      no: "04",
      title: "Læg din taktik før hvert løb",
      body: "Før start vælger du kaptajn, bestemmer hvem der angriber og hvem der gemmer benene, og lægger planen for etapen. Din taktik ændrer resultatet, ikke kun rytternes tal.",
    },
    {
      no: "05",
      title: "Kør en hel sæson, og byg videre til den næste",
      body: "Følg dit hold gennem etapeløb og endagsløb hele kalenderen igennem. Resultaterne flytter dig op eller ned gennem divisionerne, og den sæson du bygger, fortsætter ind i den næste.",
    },
  ],
  fairnessKicker: "Samme regler for alle",
  fairnessTitle: "Ingen pay-to-win, noget sted i loopet",
  fairnessBody:
    "Spillet skal være lige for alle. Du kan ikke betale dig til bedre ryttere, hurtigere træning eller bedre resultater. Det der afgør din sæson, er hvordan du spiller den.",
  ctaKicker: "Kom i gang",
  ctaTitle: "Klar til at bygge dit hold?",
  ctaBody: "Opret dit hold og se den næste live-auktion selv.",
  ctaPrimary: "Opret dit hold",
  ctaSecondary: "Kom med på Discord",
  footerTagline: "Et managerspil i browseren.",
  footerPrivacy: "Privatliv",
  footerDiscord: "Discord",
};

export default function Page() {
  return <HowItWorksPage lang="da" copy={COPY} />;
}
