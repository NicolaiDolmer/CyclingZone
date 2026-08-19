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
 * #3341-ish shared helper (season recap polish) — computeSeasonMovement +
 * resolveNextDivision, ét kald. SeasonEndPage.jsx brugte allerede den robuste
 * resolveNextDivision-sti (rigtig season_standings-række for næste sæson,
 * kun fallback til teams.division), mens DashboardPage.jsx's dashboard-nudge
 * kaldte computeSeasonMovement direkte med team.division — to stier til
 * "samme" tal der kunne drifte fra hinanden. Denne funktion er den ENE sti,
 * så begge overflader deler nøjagtig samme logik.
 *
 * @param {object} p
 * @param {number|null|undefined} p.finishedDivision  division holdet SLUTTEDE sæsonen i
 * @param {number|null} [p.nextSeasonStandingDivision]
 * @param {string|null} [p.nextSeasonStatus]
 * @param {number|null} [p.currentTeamDivision]
 * @returns {"promoted"|"relegated"|"maintained"|null}
 */
export function resolveSeasonMovement({
  finishedDivision,
  nextSeasonStandingDivision = null,
  nextSeasonStatus = null,
  currentTeamDivision = null,
} = {}) {
  const nextDivision = resolveNextDivision({ nextSeasonStandingDivision, nextSeasonStatus, currentTeamDivision });
  return computeSeasonMovement(finishedDivision, nextDivision);
}

/**
 * Sæson-recap-highlights for ÉT hold — bygget UDELUKKENDE af data SeasonEndPage
 * allerede henter til andre formål (sæson-vinderne, standings, transaktioner,
 * og nu også #3402's dokumentar-facts), ingen nye tunge kald. Maks 3 punkter.
 *
 * #season-recap-polish (18/8, ejer-godkendt mockup): "0 highlights er
 * normaltilfældet" var IKKE godt nok — et midterfelt-hold fik en tom liste.
 * Rækkefølgen er nu en GARANTI-kæde, ikke bare tre uafhængige tjek: de tre
 * oprindelige (præmie → salg → etapekonge, division-/sæson-brede tal) prøves
 * først; hvis det ikke fylder 3 pladser, falder vi tilbage til holdets EGEN
 * dokumentar-facts (samme rå tal #3402-kortet allerede bruger) i fast
 * rækkefølge: bedste løbsdag (vendepunkt) → bedste enkeltresultat → tætteste
 * rival. Disse tre er UDEN division-/sæson-førerskabs-betingelse (facts er
 * allerede "MIT holds bedste", ikke "bedst i divisionen"), så de fylder
 * pladserne ud for langt de fleste hold — en 4. fallback (rival) er der
 * bevidst ikke, for et hold helt alene i sin division har reelt intet der
 * matcher "tætteste rival".
 *
 * @param {object} p
 * @param {string} p.myTeamId
 * @param {Array<{team_id:string}>} p.divisionStandings  KUN min egen division, denne sæson
 * @param {Record<string, number>} p.prizeByTeam  team_id -> sæson-præmie (allerede aggregeret)
 * @param {{amount:number, description?:string}|null} [p.myBiggestSale]  min STØRSTE transfer_in
 * @param {{riderId:string, name:string, wins:number}|null} [p.myStageKing]  min bedste
 *   etapevinder blandt sæsonens top-5 (findes ved at joine stage_kings mod riders.team_id)
 * @param {object|null} [p.documentaryFacts]  get_season_documentary_facts()-outputtet
 *   (samme nøgler som #3402's season_documentaries.facts: bestRaceDay/biggestResult/
 *   rival/myStanding) — kan ankomme SENERE end de øvrige args (egen async fetch,
 *   samme isolations-mønster som SeasonEndPage's loadDocumentary), derfor et
 *   selvstændigt, valgfrit argument i stedet for forudsat til stede.
 * @returns {Array<{kind:"prizeLeader"|"biggestSale"|"stageKing"|"turningPoint"|"biggestResult"|"rival",
 *   amount?:number, wins?:number, name?:string, points?:number, race?:string, rider?:string,
 *   team?:string, gap?:number, ahead?:boolean}>}
 */
export function pickRecapHighlights({
  myTeamId,
  divisionStandings = [],
  prizeByTeam = {},
  myBiggestSale = null,
  myStageKing = null,
  documentaryFacts = null,
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

  if (highlights.length < 3 && documentaryFacts) {
    const standingPoints = documentaryFacts.myStanding?.total_points ?? null;

    const bestRaceDay = documentaryFacts.bestRaceDay;
    if (highlights.length < 3 && bestRaceDay?.race_name && bestRaceDay?.total_points != null) {
      highlights.push({ kind: "turningPoint", points: bestRaceDay.total_points, race: bestRaceDay.race_name });
    }

    const biggestResult = documentaryFacts.biggestResult;
    if (highlights.length < 3 && biggestResult?.rider_name && biggestResult?.race_name) {
      highlights.push({ kind: "biggestResult", rider: biggestResult.rider_name, race: biggestResult.race_name });
    }

    const rival = documentaryFacts.rival;
    if (highlights.length < 3 && rival?.team_name && rival?.gap != null) {
      const ahead = standingPoints != null && standingPoints > rival.total_points;
      highlights.push({ kind: "rival", team: rival.team_name, gap: rival.gap, ahead });
    }
  }

  return highlights.slice(0, 3);
}
