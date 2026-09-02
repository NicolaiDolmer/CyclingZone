import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, Button, DownloadIcon, FlagIcon, ChevronRightIcon } from "./ui";
import RaceLink from "./RaceLink";
import useHeroAgonyMoment from "../hooks/useHeroAgonyMoment.js";
import { heroAgonyCopyFor, heroAgonyHeadlineFor, heroAgonyEyebrowKeyFor } from "../lib/heroAgonyCopy.js";
import { exportHeroAgonyPng, downloadBlob } from "../lib/heroAgonyExport.js";

// Hero & Agony (#3397, epic #3395 bølge 1) — DIT holds seneste personlige
// etape-moment-kort. SELVSTÆNDIG komponentfil, selv-hentende (kun teamId/
// teamName som props) med vilje: en parallel agent (#3398) rører muligvis
// SAMME DashboardPage.jsx samtidig, og orkestratoren skal kunne merge begge
// uden konflikt — DashboardPage-diffen for dette kort er derfor 1
// import-linje + 1 render-linje (se PR-body for det eksakte diff).
//
// Renderer INTET (ikke engang et tomt-state-kort) mens data hentes eller hvis
// holdet endnu ikke har et etaperesultat — MyLatestResultCard ejer allerede
// "du har ikke kørt løb endnu"-beskeden på dashboardet; to næsten-identiske
// tomme kort ville være støj, ikke hjælp.
function slugify(text) {
  return String(text || "race")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "") // fjern diakritiske tegn (æ/ø/å-venlig fil-slug)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "race";
}

export default function HeroAgonyCard({ teamId, teamName }) {
  const { t } = useTranslation("dashboard");
  const { loading, moment, race, stageNumber } = useHeroAgonyMoment(teamId, teamName);
  const [exporting, setExporting] = useState(false);

  if (loading || !moment) return null;

  const copy = heroAgonyCopyFor(moment);
  if (!copy) return null; // ukendt/fremtidig moment-kind — degradér ærligt, aldrig en tom boks

  const headline = heroAgonyHeadlineFor(moment);
  const eyebrowKey = heroAgonyEyebrowKeyFor(moment);
  const subline = t(`dashboard:cards.heroAgony.moments.${copy.key}`, copy.params);
  const eyebrow = t(`dashboard:cards.heroAgony.eyebrow.${eyebrowKey}`);
  const metaText = race?.race_type === "stage_race"
    ? t("dashboard:cards.heroAgony.meta", { race: race?.name || "—", stage: stageNumber })
    : t("dashboard:cards.heroAgony.metaOneDay", { race: race?.name || "—" });

  async function handleExport() {
    if (exporting) return;
    setExporting(true);
    try {
      const blob = await exportHeroAgonyPng({ eyebrow, headline, subline, meta: metaText });
      const prefix = t("dashboard:cards.heroAgony.exportedFilenamePrefix");
      downloadBlob(blob, `${prefix}-${slugify(race?.name)}-stage-${stageNumber ?? 1}.png`);
    } catch (e) {
      console.error("Hero & Agony PNG export failed:", e?.message || e);
    } finally {
      setExporting(false);
    }
  }

  return (
    <Card className="p-5 mb-4">
      <div className="flex items-center justify-between gap-x-3 gap-y-1 mb-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <FlagIcon size={14} className="text-cz-3 flex-shrink-0" aria-hidden="true" />
          <h2 className="font-semibold text-cz-1 text-sm">{t("dashboard:cards.heroAgony.title")}</h2>
          <span className="font-data text-3xs uppercase tracking-[.1em] text-cz-3">{eyebrow}</span>
        </div>
        {race?.id && (
          <RaceLink id={race.id} stage={stageNumber} state={{ from: "dashboard" }}
            className="inline-flex items-center gap-0.5 text-xs text-cz-accent-t hover:underline flex-shrink-0">
            {t("dashboard:cards.heroAgony.linkFull")}
            <ChevronRightIcon size={13} aria-hidden="true" />
          </RaceLink>
        )}
      </div>

      <p className="font-display text-3xl leading-[.92] text-cz-1 break-words">{headline}</p>
      <p className="text-cz-2 text-sm leading-relaxed mt-2">{subline}</p>
      <p className="font-data text-2xs uppercase tracking-[.08em] text-cz-3 mt-3">{metaText}</p>

      <div className="mt-4 pt-3.5 border-t border-cz-border flex justify-end">
        <Button variant="secondary" size="sm" onClick={handleExport} loading={exporting}
          iconLeft={!exporting ? <DownloadIcon size={14} aria-hidden="true" /> : null}>
          {t("dashboard:cards.heroAgony.exportCta")}
        </Button>
      </div>
    </Card>
  );
}
