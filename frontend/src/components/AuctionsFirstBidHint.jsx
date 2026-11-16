// Onboarding v2 Slice 1b — hjælp til managers der endnu ikke har afgivet et bud.
//
// #8279 (rettelse 3, ejer-go 16/11): var et forklaringskort på ca. 390 px over
// fanerne, så første auktion stod under folden på 390 px (y ≈ 766). PAGE_TEMPLATES
// (#8070): "First-visit tips count as banners too: they live in the onboarding
// tour or in Help, not above the content." Kortet er derfor én linje på 44 px
// (P16) under fanerne, der fører til Hjælps afsnit om auktioner, hvor de samme
// forklaringer står (minimumsbud, auto-forlængelse). Linjen vises stadig kun,
// indtil manageren har budt første gang (#3007-betingelsen i AuctionsPage).
//
// Den anbefalede rytter (#3007) markeres fortsat i listen (recommendedAuctionId).
// i18n: Fase 3b — Refs #412, #3007, #8279.

import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { ChevronRightIcon, InfoIcon } from "./ui";

export default function AuctionsFirstBidHint() {
  const { t } = useTranslation("auctions");
  return (
    <Link
      to="/help?section=auctions"
      className="mb-3 flex min-h-11 items-center gap-2 border-b border-cz-border text-sm text-cz-2 transition-colors hover:text-cz-1"
    >
      <InfoIcon size={16} aria-hidden="true" className="shrink-0 text-cz-3" />
      <span className="min-w-0 flex-1">{t("hint.helpLine")}</span>
      <ChevronRightIcon size={14} aria-hidden="true" className="shrink-0" />
    </Link>
  );
}
