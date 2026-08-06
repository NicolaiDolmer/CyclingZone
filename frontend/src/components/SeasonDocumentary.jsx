import { useState } from "react";
import { useTranslation } from "react-i18next";
import { formatNumber } from "../lib/intl";
import { pickDocumentaryText, buildDocumentaryCardStats } from "../lib/seasonDocumentaryData";
import { exportSeasonDocumentaryPng, downloadBlob } from "../lib/seasonDocumentaryExport";
import {
  Section, SectionHeader, Button, ErrorState, SkeletonLines,
  BookOpenIcon, DownloadIcon,
} from "./ui";

// #3402 — Sæsondokumentaren: narrativ årbog pr. hold, oven på #2752-recappen.
// Additiv sektion — erstatter IKKE SeasonRecapHero/SeasonHonours, står under
// dem på siden. Samme "chrome renderer altid, kun body swapper" canonical-
// state-mønster som SeasonHonours.jsx (loading/failed/empty/indhold), fordi
// samme sæson-cutover-scenarie gælder her: ~150 managere rammer /seasons
// samtidig, og en manglende/fejlende dokumentar må aldrig kunne tage resten
// af siden med sig ned.
//
// TEKSTVALG: `data` er en RÅ season_documentaries-række (generateret ÉN gang
// af backend/lib/seasonDocumentarySweep.js, alle læser samme tekst — issue-
// AC'en om caching/idempotens). pickDocumentaryText() vælger LLM-poleret
// tekst hvis den findes for spillerens sprog, ellers den deterministiske
// kladde — ALTID til stede (v1-fallback-kravet). LLM-laget følger brugerens
// sprog (issue-AC "LLM-laget følger brugerens sprog"); den deterministiske
// grammatik findes allerede på begge sprog i selve rækken.
//
// DELBART KORT: canvas-eksport (seasonDocumentaryExport.js, samme mønster som
// #3397's Hero & Agony-kort) bygget af row.facts — de SAMME rå tal teksten
// selv er bygget af, så kortet aldrig kan sige noget andet end afsnittene.

export default function SeasonDocumentary({
  status = "loading",
  data = null,
  onRetry,
  seasonNumber,
  teamName,
}) {
  const { t, i18n } = useTranslation("seasonEnd");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(false);

  const lang = i18n.language?.startsWith("da") ? "da" : "en";
  const picked = pickDocumentaryText(data, lang);
  const hasText = (picked?.paragraphs?.length || 0) > 0;

  const handleExport = async () => {
    if (!data?.facts) return;
    setExporting(true);
    setExportError(false);
    try {
      const stats = buildDocumentaryCardStats(data.facts, formatNumber, t);
      const blob = await exportSeasonDocumentaryPng({
        eyebrow: t("documentary.card.eyebrow", { number: seasonNumber }),
        teamName: teamName || "—",
        stats,
      });
      downloadBlob(blob, `cycling-zone-season-${seasonNumber ?? "x"}-documentary.png`);
    } catch (e) {
      console.error("SeasonDocumentary: PNG export failed", e);
      setExportError(true);
    } finally {
      setExporting(false);
    }
  };

  let body;
  if (status === "loading") {
    body = <SkeletonLines lines={4} />;
  } else if (status === "failed") {
    body = (
      <ErrorState
        title={t("documentary.error")}
        action={
          onRetry && (
            <Button variant="secondary" size="sm" onClick={onRetry}>
              {t("retry")}
            </Button>
          )
        }
      />
    );
  } else if (!hasText) {
    // Ingen crash, ingen forvirrende fejl — bare intet at vise (fx en meget
    // ny sæson uden nogen kvalificerende data endnu). Sektionen udelades
    // helt af forælderen normalt, men en tom kladde er teknisk mulig hvis
    // grammatikken en dag ændres til at kunne returnere 0 afsnit.
    body = null;
  } else {
    body = (
      <>
        <div className="flex flex-col gap-3">
          {picked.paragraphs.map((p, i) => (
            <p key={i} className="text-[14px] leading-relaxed text-cz-2">
              {p}
            </p>
          ))}
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-cz-border pt-4">
          <span className="text-3xs uppercase tracking-[.1em] text-cz-3">
            {picked.source === "llm" ? t("documentary.sourceLlm") : t("documentary.sourceDeterministic")}
          </span>
          <Button
            variant="primary"
            size="sm"
            onClick={handleExport}
            disabled={exporting || !data?.facts}
            iconLeft={<DownloadIcon size={14} aria-hidden="true" />}
          >
            {exporting ? t("documentary.exporting") : t("documentary.export")}
          </Button>
        </div>
        {exportError && (
          <p className="mt-2 text-right text-xs text-cz-danger">{t("documentary.exportError")}</p>
        )}
      </>
    );
  }

  if (status === "ready" && !hasText) return null;

  return (
    <Section borderClass="border-cz-border border-t-2 border-t-cz-accent">
      <SectionHeader
        title={t("documentary.heading")}
        meta={t("documentary.metaFinal", { number: seasonNumber })}
      />
      <div className="mb-3 flex items-center gap-1.5">
        <BookOpenIcon size={15} className="flex-shrink-0 text-cz-accent" aria-hidden="true" />
        <span className="font-data text-3xs font-semibold uppercase tracking-[.1em] text-cz-3">
          {t("documentary.eyebrow")}
        </span>
      </div>
      {body}
    </Section>
  );
}
