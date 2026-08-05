// #2752/#2361 — real data-shaping for the season recap experience (SeasonRecapHero.jsx
// on /seasons + SeasonWrapNudgeCard.jsx on the dashboard). Ingen fetch, ingen React:
// disse funktioner tager rækker SeasonEndPage.jsx/DashboardPage.jsx allerede har hentet
// og afgør movement + highlights. seasonRecapCopy.js (samme mappe) ejer TONE/TEKST-
// nøgler ud fra movement; DENNE fil ejer DATAEN movement/highlights bygges af — samme
// adskillelse som seasonHonours.js (data) vs. dets forbrugere (tekst i komponenten).

/**
 * Op-/nedrykning som FAKTISK skete for et hold: sammenligner den division holdet
 * SLUTTEDE en given sæson i med den division holdet spiller i NÆSTE sæson.
 * Bruger PRÆCIS samme retning som teamPalmares.js's buildSeasonHistory (lavere
 * divisionsnummer = op, division 1 er toppen) og samme tre værdier som
 * seasonRecapCopy.js's movementTone/movementLabelKey forventer.
 *
 * @param {number|null|undefined} finishedDivision  division holdet sluttede DENNE sæson i
 * @param {number|null|undefined} nextDivision       division holdet har/får NÆSTE sæson
 * @returns {"promoted"|"relegated"|"maintained"|null}  null = ukendt (mangler data)
 */
export function computeSeasonMovement(finishedDivision, nextDivision) {
  if (finishedDivision == null || nextDivision == null) return null;
  if (nextDivision < finishedDivision) return "promoted";
  if (nextDivision > finishedDivision) return "relegated";
  return "maintained";
}

/**
 * Hvilken division skal bruges som "næste sæson"-reference for et hold, når man
 * kigger på en AFSLUTTET sæsons recap? Foretrækker en RIGTIG season_standings-
 * række for efterfølgersæsonen (findes så snart transitionen har kørt, FØR
 * noget løb er kørt — verificeret mod prod: season_standings seedes for den nye
 * sæson med det samme). Falder KUN tilbage til holdets nuværende teams.division
 * hvis efterfølgersæsonen er den AKTIVE sæson (så vi ved nutids-divisionen
 * reelt stammer fra netop denne overgang, ikke en senere sæson).
 *
 * @param {object} p
 * @param {number|null} [p.nextSeasonStandingDivision]  season_standings.division for
 *   holdet i efterfølgersæsonen, hvis rækken findes
 * @param {string|null} [p.nextSeasonStatus]  status for efterfølgersæsonen ("active"/
 *   "completed"/"upcoming"), eller null hvis efterfølgersæsonen slet ikke findes endnu
 * @param {number|null} [p.currentTeamDivision]  teams.division lige nu
 * @returns {number|null}
 */
export function resolveNextDivision({
  nextSeasonStandingDivision = null,
  nextSeasonStatus = null,
  currentTeamDivision = null,
} = {}) {
  if (nextSeasonStandingDivision != null) return nextSeasonStandingDivision;
  if (nextSeasonStatus === "active" && currentTeamDivision != null) return currentTeamDivision;
  return null;
}

/**
 * Sæson-recap-highlights for ÉT hold — bygget UDELUKKENDE af data SeasonEndPage
 * allerede henter til andre formål (sæson-vinderne, standings, transaktioner),
 * ingen nye tunge kald. Rækkefølge matcher draft-mock'en (#2752 PR #3283):
 * præmie → transfer → etapekonge. Maks 3 punkter (samme loft som mock'en) — en
 * 4. highlight ville aldrig blive vist alligevel (SeasonRecapHero renderer alle
 * den får, men designet er tre kort-linjer, ikke en scrollende liste).
 *
 * Ingen af de tre punkter er GARANTERET til stede — et midterfelt-hold uden
 * salg og uden division-føring i hverken præmie eller etaper får en tom liste,
 * præcis som "held position"-scenariet i preview-mock'en.
 *
 * @param {object} p
 * @param {string} p.myTeamId
 * @param {Array<{team_id:string}>} p.divisionStandings  KUN min egen division, denne sæson
 * @param {Record<string, number>} p.prizeByTeam  team_id -> sæson-præmie (allerede aggregeret)
 * @param {{amount:number, description?:string}|null} [p.myBiggestSale]  min STØRSTE transfer_in
 * @param {{riderId:string, name:string, wins:number}|null} [p.myStageKing]  min bedste
 *   etapevinder blandt sæsonens top-5 (findes ved at joine stage_kings mod riders.team_id)
 * @returns {Array<{kind:"prizeLeader"|"biggestSale"|"stageKing", amount?:number, wins?:number, name?:string}>}
 */
export function pickRecapHighlights({
  myTeamId,
  divisionStandings = [],
  prizeByTeam = {},
  myBiggestSale = null,
  myStageKing = null,
} = {}) {
  const highlights = [];

  // Division-scoped (ikke sæson-bred) — de fleste hold vil ALDRIG lede hele
  // sæsonen i præmie, men et hold der leder sin EGEN division er stadig en
  // ægte bedrift og gør highlighten relevant for langt flere hold.
  const divisionTop = (divisionStandings || []).reduce((top, s) => {
    const amount = prizeByTeam[s.team_id] || 0;
    return !top || amount > top.amount ? { teamId: s.team_id, amount } : top;
  }, null);
  if (divisionTop && divisionTop.teamId === myTeamId && divisionTop.amount > 0) {
    highlights.push({ kind: "prizeLeader", amount: divisionTop.amount });
  }

  if (myBiggestSale?.amount > 0) {
    highlights.push({ kind: "biggestSale", amount: myBiggestSale.amount, name: myBiggestSale.description });
  }

  if (myStageKing?.wins > 0) {
    highlights.push({ kind: "stageKing", wins: myStageKing.wins, name: myStageKing.name });
  }

  return highlights.slice(0, 3);
}
