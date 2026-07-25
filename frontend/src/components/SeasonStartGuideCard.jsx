import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Section, SectionHeader,
  TeamIcon, BikeIcon, BriefcaseIcon, StarIcon,
  CheckIcon, ChevronRightIcon, XIcon,
} from "./ui";
import { countDoneItems } from "../lib/seasonStartGuide";

// #2925 — "Season N: get started". Ét kort ved sæsonstart der samler de fire
// beslutninger der ellers ligger spredt på fire sider uden guide.
//
// DESIGN (docs/design/PAGE_TEMPLATES.md): kortet opfinder intet. Det er den
// kanoniske section-card-recipe (`Section`) + T1's række-liste (1px --border
// top-rules, 13px lodret padding) + tælle-linjen fra T2. Ingen guld-primary
// (dashboardet har allerede sin ene), ingen skygger, stroke-ikoner, ingen emoji.
const ITEM_ICONS = {
  squad: TeamIcon,
  training: BikeIcon,
  board: BriefcaseIcon,
  academy: StarIcon,
};

/**
 * @param {object} p
 * @param {number} p.seasonNumber
 * @param {Array<{key:string,to:string,done:boolean|null}>} p.items  fra buildSeasonStartItems
 * @param {() => void} p.onDismiss
 */
export default function SeasonStartGuideCard({ seasonNumber, items = [], onDismiss }) {
  const { t } = useTranslation("dashboard");
  if (!items.length) return null;
  const doneCount = countDoneItems(items);

  return (
    <Section className="mb-4" data-testid="season-start-guide">
      <SectionHeader
        title={t("seasonStart.title", { number: seasonNumber })}
        action={
          <button
            type="button"
            onClick={onDismiss}
            className="shrink-0 leading-none text-cz-3 transition-colors hover:text-cz-1"
            aria-label={t("seasonStart.dismissAria")}
          >
            <XIcon size={16} aria-hidden="true" />
          </button>
        }
      />

      <ul>
        {items.map((item) => {
          const Icon = ITEM_ICONS[item.key] ?? TeamIcon;
          return (
            <li key={item.key}>
              <Link
                to={item.to}
                className="group flex items-start gap-3 border-t border-cz-border py-[13px] first:border-t-0"
              >
                <Icon size={16} className="mt-0.5 shrink-0 text-cz-2" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-[13.5px] font-medium text-cz-1 transition-colors group-hover:text-cz-accent-t">
                      {t(`seasonStart.items.${item.key}.title`)}
                    </span>
                    {/* Kun et BEKRÆFTET udført får markering. done===null (data ikke
                        hentet) vises bevidst uden, så vi aldrig får manageren til at
                        springe en beslutning over på et gæt. */}
                    {item.done === true && (
                      <span className="inline-flex items-center gap-1 text-cz-success">
                        <CheckIcon size={12} aria-hidden="true" />
                        <span className="font-data text-2xs uppercase tracking-[.08em]">
                          {t("seasonStart.done")}
                        </span>
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-[13px] text-cz-2">
                    {t(`seasonStart.items.${item.key}.desc`)}
                  </span>
                </span>
                <ChevronRightIcon
                  size={14}
                  className="mt-1 shrink-0 text-cz-3 transition-colors group-hover:text-cz-accent-t"
                  aria-hidden="true"
                />
              </Link>
            </li>
          );
        })}
      </ul>

      {/* Tælle-linje (T2-recipe): data-font, tabular, --text-3. */}
      <p className="mt-3 border-t border-cz-border pt-3 font-data text-2xs uppercase tracking-[.08em] tabular-nums text-cz-3">
        {t("seasonStart.progress", { done: doneCount, total: items.length })}
      </p>
    </Section>
  );
}
