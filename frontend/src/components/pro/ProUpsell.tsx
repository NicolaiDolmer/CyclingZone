// #2806 · Kort, venlig opsalgsflade for en Pro-funktion (design-go 13/10).
//
// To former, samme anatomi: en kort saetning om hvad funktionen goer + EN
// sekundaer knap til den fane paa /pro der viser netop den fordel. Aldrig guld
// (sidens ene gold primary tilhoerer siden, ikke opsalget), aldrig modal, og
// ingen salgsprompt i indbakken eller foerste udtagelse.
//
// - ProUpsellSection: kort i Udvikling-fanen paa rytterprofilen.
// - ProUpsellInline: raekke under filterlinjen i rytterdatabasen.

import type { ComponentType, ReactNode } from "react";
import { Link } from "react-router";
import { Section as SectionBase, SectionHeader as SectionHeaderBase } from "../ui/index.js";
import { buttonClass } from "../ui/buttonStyles.js";
import { proBenefitPath, type ProBenefit } from "../../lib/pro/proAccess.ts";

interface SectionHeaderProps { title: ReactNode; as?: string; className?: string }
const Section = SectionBase as unknown as ComponentType<{ className?: string; children?: ReactNode }>;
const SectionHeader = SectionHeaderBase as unknown as ComponentType<SectionHeaderProps>;

const CTA_CLASS = buttonClass({ variant: "secondary", size: "sm" });

interface UpsellProps {
  benefit: ProBenefit;
  body: string;
  cta: string;
}

export function ProUpsellSection({ benefit, title, body, cta }: UpsellProps & { title: string }) {
  return (
    <Section>
      <SectionHeader as="h3" title={title} className="mb-2" />
      <p className="text-sm text-cz-2 mb-3">{body}</p>
      <Link to={proBenefitPath(benefit)} className={CTA_CLASS}>{cta}</Link>
    </Section>
  );
}

export function ProUpsellInline({ benefit, body, cta }: UpsellProps) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3 flex-wrap rounded-cz border border-cz-border bg-cz-card px-3 py-2">
      <span className="text-xs text-cz-2">{body}</span>
      <Link to={proBenefitPath(benefit)} className={CTA_CLASS}>{cta}</Link>
    </div>
  );
}
