import { useTranslation } from "react-i18next";
import { pickDocumentaryText } from "../lib/seasonDocumentaryData";
import {
  Section, SectionHeader, Button, ErrorState, SkeletonLines,
  BookOpenIcon,
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
// #season-recap-polish (18/8, ejer-godkendt mockup) — det delbare kort
// (canvas-eksport, seasonDocumentaryExport.js) er STADIG det samme kort, men
// download-knappen der byggede/hentede det er FLYTTET til SeasonRecapHero.jsx
// (siden's ene gold-CTA-krav, docs/design/PAGE_TEMPLATES.md). Denne sektion
// beholder narrativet + kilde-chippen (LLM-poleret vs. deterministisk) nedenfor.

export default function SeasonDocumentary({
  status = "loading",
  data = null,
  onRetry,
  seasonNumber,
}) {
  const { t, i18n } = useTranslation("seasonEnd");

  const lang = i18n.language?.startsWith("da") ? "da" : "en";
  const picked = pickDocumentaryText(data, lang);
  const hasText = (picked?.paragraphs?.length || 0) > 0;

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
        <div className="mt-5 border-t border-cz-border pt-4">
          <span className="text-3xs uppercase tracking-[.1em] text-cz-3">
            {picked.source === "llm" ? t("documentary.sourceLlm") : t("documentary.sourceDeterministic")}
          </span>
        </div>
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
