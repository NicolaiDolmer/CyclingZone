// #4581: rene, testbare selector-funktioner udtrukket af RaceDetailPage.jsx som del
// af per-etape-paginering (siden hentede tidligere ALLE etapers ALLE klassementer på
// hvert load - 11.947 rækker/2,43 MB for Giro della Penisola 14/18 etaper). Logikken
// her er UÆNDRET fra den tidligere inline-udgave i RaceDetailPage.jsx — kun adskilt
// så den kan testes uden at mounte hele siden, og genbruges to steder (initial
// preload ved sidens første hentning + on-demand etapeskift).

// Antal SPILLEDE etaper for et etapeløb — samme kilde som backend's "næste etape"
// (adminSimulateRace.js: stageIndex = races.stages_completed, 0-indekseret, skrives
// atomisk sammen med etapens "stage"-resultatrækker). Erstatter den gamle afledning
// fra results.filter(r => r.result_type === "stage") — den krævede at ALLE etapers
// rækker allerede var hentet, hvilket var netop den over-fetch #4581 fjerner.
// Endagsløb har ingen etape-faner (håndteres i en separat render-gren i siden).
export function deriveStageNumbers({ raceType, stagesCompleted }) {
  if (raceType !== "stage_race") return [];
  const n = Math.max(0, Number(stagesCompleted) || 0);
  return Array.from({ length: n }, (_, i) => i + 1);
}

// Hvilken stage_number bærer den "samlede" (Overall/GC) stilling: enten det
// definitive slut-klassement (gc/points/mountain/young/team-rækker, skrevet ved
// sidste etape af et FÆRDIGT løb) eller den løbende stilling (seneste kørte etapes
// dag-typer, mens løbet stadig kører) — begge lever på samme stage_number =
// stages_completed (se raceLiveStandings.js og datamodel-kommentaren øverst i
// RaceDetailPage.jsx). null = løbet er ikke startet endnu (ingen resultater at vise).
export function overallSeedStageNumber({ stagesCompleted }) {
  const n = Number(stagesCompleted) || 0;
  return n > 0 ? n : null;
}

// Den etape et evt. ?stage=N-dybt-link peger på, valideret mod hvor mange etaper der
// faktisk er kørt — afviser fremtidige/ikke-eksisterende etapenumre i stedet for at
// spilde et round-trip på en query der alligevel giver [] tilbage.
export function validateInitialStage(stageParam, { stagesCompleted }) {
  const n = Number(stageParam);
  const completed = Number(stagesCompleted) || 0;
  return Number.isFinite(n) && n > 0 && n <= completed ? n : null;
}

// De(t) etapenummer/-numre der skal preloades ved FØRSTE hentning af løbet: den
// dyb-linkede etape (hvis gyldig) + samlet-fanens seed-etape, dedupliceret (samme
// nummer hentes ikke to gange selvom begge peger på samme etape).
export function stagesToPreload({ initialStage, overallSeedStage }) {
  return [...new Set([initialStage, overallSeedStage].filter((n) => n != null))];
}

// Dagens trøje-bærere (rank 1 pr. dag-type) for ÉN etape — samme filter som
// RaceDetailPage's StageTab brugte inline før udtrækket (JERSEYS.map(...).filter(...)).
// jerseyDefs er JERSEYS-listens elementer ({ dayType, bg, fg, ... }); alle felter
// bevares på outputtet, blot beriget med `holder`.
export function jerseyHoldersForStage(results, stage, jerseyDefs) {
  return (jerseyDefs || [])
    .map((j) => ({
      ...j,
      holder: (results || []).find(
        (r) => r.result_type === j.dayType && (r.stage_number ?? 1) === stage && (r.rank ?? 1) === 1
      ),
    }))
    .filter((j) => j.holder);
}
