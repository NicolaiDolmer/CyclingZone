import { useTranslation } from "react-i18next";
import { PageHeader, SectionStack } from "../../components/ui";
import ConfidenceCard from "./ConfidenceCard";
import MandateCard from "./MandateCard";
import VisionCard from "./VisionCard";
import BoardCard from "./BoardCard";

// #4557 (S-M2b) · Boardroom-siden (spec §3.4, mockup docs/design/board-mandate-mockups/Main.dc.html).
// Ren visnings-komponent: hele payloaded fra GET /api/board/room modtages
// som `data`-prop fra BoardroomRoute.jsx (den ejer fetch'et, ét kald, ingen
// dobbelt-hentning). T1: header + 4 stakkede section-cards, ingen faner.
//
// Mockup-afvigelse (rapportér til ejeren): undertitlen i Main.dc.html er
// "{formand}, chair · {DNA-label}" — /api/board/room-kontrakten (som givet
// til denne slice) baerer intet DNA-label-felt noget sted i payloaded, saa
// DNA-fragmentet er UDELADT her ("{formand}, chair" alene) i stedet for at
// gaette et felt der ikke findes. Backend-kontrakten boer udvides med et
// dna-label-felt (fx paa `board`) hvis undertitlen skal matche mockuppen 1:1.
export default function BoardroomPage({ data }) {
  const { t } = useTranslation("board");
  const chair = (data.board?.members || []).find((m) => m.role === "chair") || null;

  return (
    <div>
      <PageHeader
        title={t("boardroom.header.title")}
        subtitle={chair ? t("boardroom.header.subtitle", { chair: chair.name }) : t("boardroom.header.subtitleNoChair")}
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
