// #2806 · De to konkrete Pro-fordele paa /pro (design-go 13/10): saesonhistorik
// og gemte filtre, hver i sin fane med et tydeligt maerket eksempel. Founder og
// stoette er supplerende og staar under planvalget, ikke her.
//
// Eksemplerne er opdigtede (lib/pro/proSampleData.ts) og staar under et
// "Example data"-maerke i kortets hoved plus en linje i selve fanen, saa ingen
// tror det er deres egen rytter. Historik-eksemplet tegnes af de samme
// komponenter som den rigtige Udvikling-fane (AbilityHistoryRows.tsx).

import type { ComponentType, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Section as SectionBase, SectionHeader as SectionHeaderBase,
  Tabs as TabsBase, TabList as TabListBase, Tab as TabBase, TabPanel as TabPanelBase,
} from "../ui/index.js";
import { abilitySeries } from "../../lib/proAbilityHistory.js";
import { MAX_SAVED_FILTERS } from "../../lib/savedRiderFilters.js";
import { PRO_SAMPLE_ABILITIES, PRO_SAMPLE_SEASONS, PRO_SAMPLE_FILTER_KEYS } from "../../lib/pro/proSampleData.ts";
import type { ProBenefit } from "../../lib/pro/proAccess.ts";
import { AbilityRow, SeasonAxis, type HistoryPoint } from "./AbilityHistoryRows.tsx";

interface BoxProps { className?: string; children?: ReactNode }
interface SectionHeaderProps { title: ReactNode; meta?: ReactNode; className?: string }
interface TabsProps { value: string; onChange: (value: string) => void; className?: string; children?: ReactNode }
interface TabListProps { label: string; className?: string; children?: ReactNode }
interface TabProps { value: string; className?: string; children?: ReactNode }

const Section = SectionBase as unknown as ComponentType<BoxProps>;
const SectionHeader = SectionHeaderBase as unknown as ComponentType<SectionHeaderProps>;
const Tabs = TabsBase as unknown as ComponentType<TabsProps>;
const TabList = TabListBase as unknown as ComponentType<TabListProps>;
const Tab = TabBase as unknown as ComponentType<TabProps>;
const TabPanel = TabPanelBase as unknown as ComponentType<TabProps>;

const SAMPLE_CEILING = 99;

interface Props {
  benefit: ProBenefit;
  onBenefitChange: (benefit: ProBenefit) => void;
}

export default function ProBenefitsSection({ benefit, onBenefitChange }: Props) {
  const { t } = useTranslation("pro");

  return (
    <Section>
      <SectionHeader title={t("benefits.title")} meta={t("benefits.exampleLabel")} />
      <Tabs value={benefit} onChange={(v) => onBenefitChange(v as ProBenefit)}>
        <TabList label={t("benefits.title")}>
          <Tab value="history">{t("benefits.history.tab")}</Tab>
          <Tab value="filters">{t("benefits.filters.tab")}</Tab>
        </TabList>

        <TabPanel value="history" className="pt-4">
          <h3 className="text-sm font-semibold text-cz-1">{t("benefits.history.headline")}</h3>
          <p className="mt-1 text-sm text-cz-2">{t("benefits.history.body")}</p>
          <p className="mt-3 font-data text-3xs font-bold uppercase tracking-[.08em] text-cz-3">
            {t("benefits.history.sampleCaption")}
          </p>
          <div role="img" aria-label={t("benefits.history.sampleAria")} className="mt-1 max-w-md">
            {PRO_SAMPLE_ABILITIES.map((key) => (
              <AbilityRow
                key={key}
                abilityKey={key}
                ceiling={SAMPLE_CEILING}
                points={abilitySeries(PRO_SAMPLE_SEASONS, key) as HistoryPoint[]}
              />
            ))}
            <SeasonAxis seasons={PRO_SAMPLE_SEASONS} nowLabel={t("riderHistory.now")} />
          </div>
        </TabPanel>

        <TabPanel value="filters" className="pt-4">
          <h3 className="text-sm font-semibold text-cz-1">{t("benefits.filters.headline")}</h3>
          <p className="mt-1 text-sm text-cz-2">{t("benefits.filters.body", { max: MAX_SAVED_FILTERS })}</p>
          <p className="mt-3 font-data text-3xs font-bold uppercase tracking-[.08em] text-cz-3">
            {t("benefits.filters.sampleCaption")}
          </p>
          <ul className="mt-2 flex flex-wrap gap-2" aria-label={t("benefits.filters.sampleCaption")}>
            {PRO_SAMPLE_FILTER_KEYS.map((key) => (
              <li
                key={key}
                className="inline-flex min-h-8 items-center rounded-cz border border-cz-border bg-cz-card px-2.5 text-xs font-medium text-cz-2"
              >
                {t(`benefits.filters.examples.${key}`)}
              </li>
            ))}
          </ul>
        </TabPanel>
      </Tabs>
    </Section>
  );
}
