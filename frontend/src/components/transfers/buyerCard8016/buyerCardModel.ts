// #8016 variant B (ejer-go 15/11): koebers kort paa en transferliste med auto-pris.
// Ren model uden React, saa valget af segment, fejlene og opsummeringen kan
// proeves med node --test. Ingen regler eller penge-logik er nye her: graensen
// er den samme som i dag (et beloeb paa eller over auto-prisen starter en
// auktion, et beloeb under den er et bud til saelgeren), og auktionens
// beloebs- og laengdegraenser kommer fra autoAccept2176.ts.
import { durationMinutes, validAutoBid } from "../../../lib/autoAccept2176.ts";

export type BuyerMode = "bid" | "auction";

export type ChoiceIssue =
  | { code: "empty" }
  | { code: "bidFromAutoPrice"; price: number }
  | { code: "auctionBelowAutoPrice"; price: number }
  | { code: "auctionAmountInvalid" }
  | { code: "duration" };

export type ChoiceCheck = {
  issue: ChoiceIssue | null;
  // Det andet valg, beloebet hoerer til (tilbydes som et skift med eet tryk).
  switchTo: BuyerMode | null;
};

function isAmount(amount: number | null | undefined): amount is number {
  return typeof amount === "number" && Number.isInteger(amount) && amount > 0;
}

// Hvilket valg et beloeb hoerer til. null = intet gyldigt beloeb endnu.
export function modeForAmount(amount: number | null | undefined, autoPrice: number): BuyerMode | null {
  if (!isAmount(amount)) return null;
  return amount >= autoPrice ? "auction" : "bid";
}

// Startvalget naar kortet aabnes: samme standardbeloeb som i dag (udbudsprisen),
// og segmentet der passer til det. Auto-prisen er altid mindst udbudsprisen.
export function initialChoice(askingPrice: number | null | undefined, autoPrice: number): { mode: BuyerMode; amount: number | null } {
  const amount = isAmount(askingPrice) ? askingPrice : null;
  return { mode: modeForAmount(amount, autoPrice) ?? "bid", amount };
}

// Beloebet nulstilles IKKE ved skift af segment (#8016 punkt 6); det valideres
// mod det valgte segment. Hoerer det til det andet valg, foreslaas skiftet.
export function checkChoice({
  mode,
  amount,
  autoPrice,
  hours,
  minutes,
}: {
  mode: BuyerMode;
  amount: number | null | undefined;
  autoPrice: number;
  hours: string;
  minutes: string;
}): ChoiceCheck {
  if (!isAmount(amount)) return { issue: { code: "empty" }, switchTo: null };
  if (mode === "bid") {
    if (amount >= autoPrice) return { issue: { code: "bidFromAutoPrice", price: autoPrice }, switchTo: "auction" };
    return { issue: null, switchTo: null };
  }
  if (amount < autoPrice) return { issue: { code: "auctionBelowAutoPrice", price: autoPrice }, switchTo: "bid" };
  if (!validAutoBid(amount, autoPrice)) return { issue: { code: "auctionAmountInvalid" }, switchTo: null };
  if (durationMinutes(hours, minutes) === null) return { issue: { code: "duration" }, switchTo: null };
  return { issue: null, switchTo: null };
}

// i18n-noegle (namespace transfers) + parametre for en fejl. Prisen sendes som
// tal; komponenten formaterer den med formatCz.
export function issueMessage(issue: ChoiceIssue): { key: string; price: number | null } {
  switch (issue.code) {
    case "empty":
      return { key: "buyerCard.errorEmpty", price: null };
    case "bidFromAutoPrice":
      return { key: "buyerCard.errorBidFromAuto", price: issue.price };
    case "auctionBelowAutoPrice":
      return { key: "buyerCard.errorAuctionMinimum", price: issue.price };
    case "auctionAmountInvalid":
      return { key: "buyerCard.errorAuctionAmount", price: null };
    case "duration":
      return { key: "buyerCard.errorDuration", price: null };
  }
}

// Laengden som timer + minutter til visning ("2 h 30 min"). null ved ugyldig laengde.
export function lengthParts(hours: string, minutes: string): { hours: number; minutes: number } | null {
  const total = durationMinutes(hours, minutes);
  if (total === null) return null;
  return { hours: Math.floor(total / 60), minutes: total % 60 };
}

// Opsummeringen under feltet: hvad der sker, med beloeb, laengde og bundne penge.
// Kun naar valget er gyldigt; ellers staar fejlen i stedet.
export function summaryFor({
  mode,
  amount,
  hours,
  minutes,
}: {
  mode: BuyerMode;
  amount: number;
  hours: string;
  minutes: string;
}): { key: string; amount: number; length: { hours: number; minutes: number } | null } {
  if (mode === "bid") return { key: "buyerCard.summaryBid", amount, length: null };
  return { key: "buyerCard.summaryAuction", amount, length: lengthParts(hours, minutes) };
}

// Den ene guld-knaps tekst foelger valget.
export function primaryLabelKey(mode: BuyerMode): string {
  return mode === "bid" ? "buyerCard.sendBid" : "buyerCard.startAuction";
}
