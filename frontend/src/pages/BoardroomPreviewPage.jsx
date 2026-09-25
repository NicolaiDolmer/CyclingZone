import { useSearchParams } from "react-router";
import BoardroomPage from "./boardroom/BoardroomPage.jsx";
import fixture from "./boardroom/__fixtures__/boardRoom.json";
import dnaSuggestions from "./boardroom/__fixtures__/dnaSuggestions.json";
import proposedMeetingFixture from "./boardroom/__fixtures__/proposedMeeting.json";

// #4557 — DRAFT-ONLY visuel preview (samme konvention som /ui og
// /ui/season-experience, #1404/#2752): public-reachable, ikke i navigation,
// noindex. Findes udelukkende saa ejeren kan se Boardroom-siden mod mockup'en
// FØR backend-endpointet (/api/board/room) findes. Fjernes naar #4557 flipper
// for rigtigt (fase 2, S-M2c) og ejeren har set den bag kill-switch i produkt.
//
// DEV-only (App.jsx gater import + route bag import.meta.env.DEV, perf-gate-
// fund CI-run 33534726425): denne fil bygges ALDRIG ind i produktions-bundlen.
//
// #4557-rest · `?variant=no-dna` viser mockup-variantens overblik for de hold
// der endnu ikke har valgt klub-DNA (valgkortet oeverst, tillidskortet én plads
// ned). Forslagene kommer normalt fra GET /board/dna-suggestions, som previewen
// ikke kan naa uden en session, saa de seedes via `dnaPreview`.
//
// #5754 · `?variant=proposed-mandate` viser Mandat-fanen/Overblikket mellem
// saesonskiftet og aarsmoedets underskrift (intet aktivt mandat, men
// bestyrelsen HAR et forslag klar). Samme seed-moenster som dnaPreview: den
// rigtige kilde er GET /board/meeting, som previewen ikke kan naa uden en
// session, saa den seedes via `meetingPreview`.
export default function BoardroomPreviewPage() {
  const [searchParams] = useSearchParams();
  const noDna = searchParams.get("variant") === "no-dna";
  const proposedMandate = searchParams.get("variant") === "proposed-mandate";

  return (
    <div className="flex min-h-screen justify-center bg-cz-body px-8 pb-16 pt-7">
      {/* #5472 · Ingen egen max-w her: BoardroomPage baerer selv T1-bredden.
          Preview-wrapperens max-w-4xl skjulte netop at produktionssiden
          manglede den. */}
      <div className="w-full">
        <BoardroomPage
          data={
            noDna ? { ...fixture, team: { dnaKey: null } }
              : proposedMandate ? { ...fixture, mandate: null }
                : fixture
          }
          onReload={() => {}}
          dnaPreview={noDna ? dnaSuggestions : null}
          meetingPreview={proposedMandate ? proposedMeetingFixture : null}
        />
      </div>
    </div>
  );
}
