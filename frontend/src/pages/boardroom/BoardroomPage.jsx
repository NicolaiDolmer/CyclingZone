import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { PageHeader, SectionStack, Button } from "../../components/ui";
import ConfidenceCard from "./ConfidenceCard";
import MandateCard from "./MandateCard";
import VisionCard from "./VisionCard";
import BoardCard from "./BoardCard";
import { fetchBoardMeeting } from "../annualMeeting/meetingApi";

// #4557 (S-M2b) · Boardroom-siden (spec §3.4, mockup docs/design/board-mandate-mockups/Main.dc.html).
// Ren visnings-komponent: hele payloaded fra GET /api/board/room modtages
// som `data`-prop fra BoardroomRoute.jsx (den ejer fetch'et, ét kald, ingen
// dobbelt-hentning). T1: header + 4 stakkede section-cards, ingen faner.
//
// #4570-afstemning (løser tidligere afvigelse 1): backend leverer nu
// `team.dnaKey` — undertitlen matcher mockuppen "{formand}, chair · {DNA-
// label}" ved at genbruge den EKSISTERENDE dna.<key>.label-nøgle (samme
// tekst som DNA-valg-fladen bruger, aldrig forfattet på ny). Mangler
// dnaKey (fx endnu ikke sat), falder undertitlen til "{formand}, chair".
export default function BoardroomPage({ data }) {
  const { t } = useTranslation("board");
  const navigate = useNavigate();
  const chair = (data.board?.members || []).find((m) => m.role === "chair") || null;
  const dnaKey = data.team?.dnaKey || null;
  const dnaLabel = dnaKey ? t(`dna.${dnaKey}.label`, { defaultValue: "" }) : "";

  let subtitle = t("boardroom.header.subtitleNoChair");
  if (chair && dnaLabel) subtitle = t("boardroom.header.subtitle", { chair: chair.name, dna: dnaLabel });
  else if (chair) subtitle = t("boardroom.header.subtitleChairOnly", { chair: chair.name });

  // #4557 (S-M2c) · Gold-CTA'en vises KUN naar aarsmoedet er klart (spec
  // §4.7 punkt: "ellers ingen knap, ikke en deaktiveret") — ét let kald til
  // GET /board/meeting afgoer det, samme kill-switch-sikre moenster som
  // BoardroomRoute's egen flag-tjek.
  const [meetingAvailable, setMeetingAvailable] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetchBoardMeeting().then((res) => {
      if (!cancelled && res?.available) setMeetingAvailable(true);
    });
    return () => { cancelled = true; };
  }, []);

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
      <SectionStack>
        <ConfidenceCard confidence={data.confidence} />
        <MandateCard mandate={data.mandate} />
        <VisionCard vision={data.vision} />
        <BoardCard board={data.board} mandate={data.mandate} minutes={data.minutes || []} />
      </SectionStack>
    </div>
  );
}
