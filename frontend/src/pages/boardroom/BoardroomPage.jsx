import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router";
import { PageHeader, SectionStack, Button, Tabs, TabList, Tab, TabPanel } from "../../components/ui";
import ConfidenceCard from "./ConfidenceCard";
import MandateCard from "./MandateCard";
import MandateSummaryCard from "./MandateSummaryCard";
import OverviewSummaryRows from "./OverviewSummaryRows";
import DnaChoiceCard from "./DnaChoiceCard";
import VisionCard from "./VisionCard";
import BoardCard from "./BoardCard";
import { fetchBoardMeeting } from "../annualMeeting/meetingApi";
import { fetchDnaSuggestions, postDnaChoice } from "../../components/board/dnaApi.js";
import { resolveApiError } from "../../lib/apiError";

// #4557 (S-M2b) · Boardroom-siden (spec §3.4, mockup docs/design/board-mandate-
// mockups/Main.dc.html).
//
// #4557-rest (ejer-go 6/9 paa docs/design/mockups-boardroom-additions-2026-09-06/
// boardroom-tabs.html) · OVERBLIK FOERST + FANER UD. Siden var en stak paa fire
// kort man scrollede ned igennem; ejer-reglen i PAGE_TEMPLATES §Fold-disciplin
// ("enhver side er overblik foerst + faner ud", gentaget 6/9) gav den denne form:
//
//   PageHeader + underline-faner  ?tab=overview|mandate|vision|board
//   · Overview (default) — tillidskortet, mandatet som resumé med bonus-striben,
//     og vision + bestyrelse som to resumé-linjer. Ét skaermbillede paa 1280x900.
//   · Mandate — hele mandatkortet med ejere, kvitteringer og tilbuddet i fuld.
//   · Vision  — milepael-tidslinjen.
//   · Board   — medlemmer med stemme, referat-feed og klub-DNA-linjen.
//
// Ren visnings-komponent for sidens EGNE data: hele payloaded fra
// GET /api/board/room modtages som `data`-prop fra BoardroomRoute.jsx (den ejer
// fetch'et). De to tilbudte HANDLINGER paa siden (bonustilbud, klub-DNA) rammer
// de eksisterende POST-ruter og beder ruten hente payloaden igen via `onReload`.
//
// #4570-afstemning (løser tidligere afvigelse 1): backend leverer nu
// `team.dnaKey` — undertitlen matcher mockuppen "{formand}, chair · {DNA-
// label}" ved at genbruge den EKSISTERENDE dna.<key>.label-nøgle (samme
// tekst som DNA-valg-fladen bruger, aldrig forfattet på ny). Mangler
// dnaKey (fx endnu ikke sat), falder undertitlen til "{formand}, chair".

const TABS = ["overview", "mandate", "vision", "board"];

// `dnaPreview` er DEV-PREVIEW-ONLY (BoardroomPreviewPage.jsx, /ui/boardroom):
// den seeder DNA-tilstanden med en fixture, saa ejeren kan se mockup-varianten
// "hold uden DNA" uden en session. I produktion er den altid undefined, og
// tilstanden kommer udelukkende fra GET /board/dna-suggestions.
export default function BoardroomPage({ data, onReload, dnaPreview = null }) {
  const { t } = useTranslation("board");
  const navigate = useNavigate();
  const chair = (data.board?.members || []).find((m) => m.role === "chair") || null;
  const dnaKey = data.team?.dnaKey || null;
  const dnaLabel = dnaKey ? t(`dna.${dnaKey}.label`, { defaultValue: "" }) : "";

  let subtitle = t("boardroom.header.subtitleNoChair");
  if (chair && dnaLabel) subtitle = t("boardroom.header.subtitle", { chair: chair.name, dna: dnaLabel });
  else if (chair) subtitle = t("boardroom.header.subtitleChairOnly", { chair: chair.name });

  // Fanen ligger i URL'en (samme moenster som FinancePage #986), saa et dyb-link
  // og browserens tilbage-knap lander paa den rigtige fane.
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const activeTab = TABS.includes(requestedTab) ? requestedTab : "overview";
  const setTab = useCallback((tab) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("tab", tab);
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // #4557 (S-M2c) · Gold-CTA'en vises KUN naar aarsmoedet er klart (spec
  // §4.7 punkt: "ellers ingen knap, ikke en deaktiveret") — ét let kald til
  // GET /board/meeting afgoer det, samme kill-switch-sikre moenster som
  // BoardroomRoute's egen flag-tjek. Det er sidens ENESTE guld-knap; alt andet
  // paa siden (accept af bonustilbud, valg af DNA) er secondary/quiet.
  const [meetingAvailable, setMeetingAvailable] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetchBoardMeeting().then((res) => {
      if (!cancelled && res?.available) setMeetingAvailable(true);
    });
    return () => { cancelled = true; };
  }, []);

  // ---- klub-DNA (BOARD_RULES §8) ----
  // Payloaden siger OM holdet har et DNA (`team.dnaKey`); forslagene og
  // "maa jeg stadig skifte" bor paa den eksisterende GET /board/dna-suggestions.
  const [dnaState, setDnaState] = useState(dnaPreview);
  const [dnaBusy, setDnaBusy] = useState(false);
  const [dnaError, setDnaError] = useState("");
  const [dnaPanelOpen, setDnaPanelOpen] = useState(false);

  const loadDna = useCallback(async () => {
    if (dnaPreview) return;
    const res = await fetchDnaSuggestions();
    setDnaState(res);
  }, [dnaPreview]);
  useEffect(() => { loadDna(); }, [loadDna]);

  async function chooseDna(key) {
    if (dnaBusy) return;
    setDnaBusy(true);
    setDnaError("");
    const { ok, data: body } = await postDnaChoice(key);
    if (!ok) {
      setDnaError(resolveApiError(body || {}, t, t("dna.errorFallback")));
      setDnaBusy(false);
      return;
    }
    setDnaPanelOpen(false);
    await Promise.all([loadDna(), onReload?.()]);
    setDnaBusy(false);
  }

  const hasDna = Boolean(dnaKey);
  const dnaSuggestions = dnaState?.suggestions || [];
  const canRechoose = Boolean(dnaState?.can_rechoose);
  // Holdet mangler DNA og bestyrelsen HAR forslag -> valgkortet tager
  // overblikkets øverste plads (mockup-varianten "team without DNA").
  const showDnaChoice = !hasDna && dnaSuggestions.length > 0;

  return (
    <div>
      <PageHeader
        title={t("boardroom.header.title")}
        subtitle={subtitle}
        actions={meetingAvailable ? (
          <Button variant="primary" size="sm" onClick={() => navigate("/board/meeting")}>
            {t("boardroom.header.enterMeetingCta")}
          </Button>
        ) : null}
      />

      <Tabs value={activeTab} onChange={setTab}>
        <TabList label={t("boardroom.tabs.aria")} className="mb-4">
          <Tab value="overview">{t("boardroom.tabs.overview")}</Tab>
          <Tab value="mandate">{t("boardroom.tabs.mandate")}</Tab>
          <Tab value="vision">{t("boardroom.tabs.vision")}</Tab>
          <Tab value="board">{t("boardroom.tabs.board")}</Tab>
        </TabList>

        <TabPanel value="overview">
          <SectionStack>
            {showDnaChoice && (
              <DnaChoiceCard
                suggestions={dnaSuggestions}
                busy={dnaBusy}
                error={dnaError}
                onChoose={chooseDna}
              />
            )}
            <ConfidenceCard confidence={data.confidence} lastMovement={(data.minutes || [])[0] || null} />
            <MandateSummaryCard
              mandate={data.mandate}
              bonusOffer={data.bonusOffer}
              onOpenMandate={() => setTab("mandate")}
              onReload={onReload}
            />
          </SectionStack>
          <OverviewSummaryRows
            vision={data.vision}
            board={data.board}
            onOpenVision={() => setTab("vision")}
            onOpenBoard={() => setTab("board")}
          />
        </TabPanel>

        <TabPanel value="mandate">
          <MandateCard mandate={data.mandate} bonusOffer={data.bonusOffer} onReload={onReload} />
        </TabPanel>

        <TabPanel value="vision">
          <VisionCard vision={data.vision} />
        </TabPanel>

        <TabPanel value="board">
          <SectionStack>
            <BoardCard
              board={data.board}
              mandate={data.mandate}
              minutes={data.minutes || []}
              dna={{ hasDna, canRechoose }}
              onChangeDna={() => setDnaPanelOpen((open) => !open)}
            />
            {hasDna && canRechoose && dnaPanelOpen && dnaSuggestions.length > 0 && (
              <DnaChoiceCard
                suggestions={dnaSuggestions}
                currentKey={dnaKey}
                busy={dnaBusy}
                error={dnaError}
                onChoose={chooseDna}
                headingKey="dna.rechoose.heading"
                introKey="dna.rechoose.intro"
                chooseLabelKey="dna.switch"
              />
            )}
          </SectionStack>
        </TabPanel>
      </Tabs>
    </div>
  );
}
