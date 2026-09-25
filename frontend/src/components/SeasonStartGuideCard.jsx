import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import {
  Section, SectionHeader,
  TeamIcon, BikeIcon, BriefcaseIcon, StarIcon,
  CheckIcon, ChevronRightIcon, XIcon,
} from "./ui";
import { countDoneItems, resolveBoardStartItem } from "../lib/seasonStartGuide.js";
// #5755 — mandat-launch D: bestyrelses-punktet skal linke til /board/meeting
// og vise "Sign your mandate" naar board_mandate_model_enabled er aktivt for
// viewer. Kortet henter selv (best-effort, samme fail-safe konvention som
// featureStage.ts/meetingApi.js) i stedet for at kræve nye props fra
// DashboardPage.jsx — se seasonStartGuide.js::resolveBoardStartItem.
import { loadFeatureFlagStages } from "../lib/featureStage.ts";
import { fetchBoardMeeting } from "../pages/annualMeeting/meetingApi.js";

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

  // #5755 — flag-stadie + /board/meeting, hentet én gang pr. mount. Fejler
  // ét af kaldene (eller flaget er off), forbliver `enabled: false` — punktet
  // falder tilbage til legacy-copy'en/legacy-`done` uændret (fail-safe, se
  // resolveBoardStartItem).
  const [boardMandate, setBoardMandate] = useState({ enabled: false, loaded: false, meeting: null });

  useEffect(() => {
    let cancelled = false;
    loadFeatureFlagStages().then((stages) => {
      if (cancelled) return;
      const stage = stages.board_mandate_model_enabled;
      if (stage !== "beta" && stage !== "on") return; // off/ukendt → legacy uændret
      setBoardMandate((s) => ({ ...s, enabled: true }));
      fetchBoardMeeting().then((meeting) => {
        // CodeRabbit-fund (#5755, ÉN CLI-runde): fetchBoardMeeting() returnerer
        // `null` ved manglende session/netværksfejl. Sætter vi `loaded: true`
        // her alligevel, læser resolveBoardStartItem det som "underskrevet"
        // (meetingAvailable: null → done: true) — et FALSK grønt flueben.
        // `loaded` skal derfor kun blive true ved et ægte payload.
        if (!cancelled && meeting != null) setBoardMandate({ enabled: true, loaded: true, meeting });
      });
    });
    return () => { cancelled = true; };
  }, []);

  if (!items.length) return null;

  // Kun bestyrelses-punktet overstyres; de tre andre punkter er uændrede.
  const effectiveItems = items.map((item) => {
    if (item.key !== "board") return item;
    const resolved = resolveBoardStartItem({
      mandateEnabled: boardMandate.enabled,
      meetingAvailable: boardMandate.meeting?.available ?? null,
      meetingLoaded: boardMandate.loaded,
    });
    return resolved ? { ...item, to: resolved.to, done: resolved.done } : item;
  });
  const doneCount = countDoneItems(effectiveItems);

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
        {effectiveItems.map((item) => {
          const Icon = ITEM_ICONS[item.key] ?? TeamIcon;
          // #5755 — legacy-copy'en (items.boardLegacy) bruges KUN for
          // bestyrelses-punktet mens mandatet ikke er aktivt for viewer;
          // ellers den nye 'Sign your mandate'-copy (items.board).
          const copyKey = item.key === "board" && !boardMandate.enabled ? "boardLegacy" : item.key;
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
                      {t(`seasonStart.items.${copyKey}.title`)}
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
                    {t(`seasonStart.items.${copyKey}.desc`)}
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
        {t("seasonStart.progress", { done: doneCount, total: effectiveItems.length })}
      </p>
    </Section>
  );
}
