// #3373 — hvilken etape skal en række i dashboardets "Seneste resultater"
// deep-linke til?
//
// Modulet viser ét afsluttet løb pr. række med den vinder backend valgte
// (GET /api/dashboard/recent-results: `winner = gc-vinderen ELLER, hvis
// gc-rækken mangler, den seneste etapevinder`). Underteksten fortæller hvilken
// af de to det er ("Samlet vinder" / "Vinder" / "Vinder af etape N"), så linket
// skal pege på præcis dét, rækken påstår:
//
//   gc-vinder (etapeløb eller endagsløb) → /races/:id          (samlet-fanen)
//   etapevinder på et etapeløb           → /races/:id?stage=N  (etape-fanen)
//
// Samme kontrakt som rytterprofilens resultat-rækker (#2526, RiderResultsTab):
// etape-rækker bærer ?stage=N, samlet-rækker gør ikke.
//
// Bevidst konservativ: kun ægte etapeløb får ?stage=N. Et endagsløb HAR ingen
// etape-faner (RaceDetailPage.isStageRace kræver race_type="stage_race"), så et
// stage-nummer dér ville være støj i URL'en uden effekt på siden. Ugyldige
// etapenumre er i øvrigt harmløse: løbssiden validerer ?stage mod de etaper der
// faktisk har resultater og falder tilbage til "samlet" — men et link skal være
// rigtigt, ikke bare ikke-dødt.
//
// Returnerer et etapenummer, eller undefined når rækken hører til samlet-fanen.
// RaceLink springer stage-parameteren over ved null/undefined.
export function recentResultStage(race) {
  if (!race || race.race_type !== "stage_race") return undefined;
  const winner = race.winner;
  if (!winner || winner.result_type !== "stage") return undefined;
  const stage = Number(winner.stage_number);
  return Number.isInteger(stage) && stage > 0 ? stage : undefined;
}
