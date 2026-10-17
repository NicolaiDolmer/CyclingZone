// backend/lib/contractOfferEligibility.js
// #6638 · Kan en anden manager tilbyde rytteren en kontrakt (signere ham som fri agent)?
//
// HVAD SPILLEREN SÅ. Rytterprofilen viste "Contract: Season 3" midt i saeson 4. Det
// laeses som "kontrakten er udloebet, rytteren er fri", men rytteren staar stadig
// paa sit hold, saa den eneste vej er et transfertilbud til ejeren. Fri-agent-vejen
// (auktion/signering) aabner foerst, naar rytteren faktisk er frigivet.
//
// RODAARSAG (backend). contract_end_season = sidste AKTIVE saeson for kontrakten
// (contractSeed.computeContractEndSeason). Frigivelsen sker KUN ved saesonskiftet
// (contractExpiryRelease.js, `<=`-forespoergsel, selv-helende ved naeste skift). En
// rytter der blev sprunget over ved et skift (#5864: ungdom/akademi foer #6309, og de
// "brugte" ryttere der bevidst blev udskudt til naeste skift) staar derfor en hel
// saeson med en udloebet kontrakt. Det er ejer-besluttet (#5864/#6309: frigives ved
// naeste skift), saa fladen skal sige det, ikke vise et saesonnummer der ligner fri.
//
// Ren funktion (ingen I/O), delt med frontend paa samme maade som contractSeed.js.
// Saeson-NUMMER, aldrig referenceaar: kalderen udleder det (seasons.number paa
// backend, seasonNumberFromReferenceYear(useActiveSeasonYear()) paa frontend).

export const CONTRACT_STATE = Object.freeze({
  /** Ingen hold: fri agent. Et efterladt contract_end_season paa en fri agent ignoreres. */
  FREE_AGENT: "free_agent",
  /** Paa et hold uden kendt udloebssaeson (fx akademi uden kontraktfelter). */
  NO_END: "no_end",
  /** Kontrakten loeber ud over den aktive saeson. */
  RUNNING: "running",
  /** Sidste saeson: udloeber ved det kommende skifte, medmindre den forlaenges. */
  FINAL_SEASON: "final_season",
  /** Udloebet, men endnu ikke frigivet: frigives ved det kommende skifte. */
  EXPIRED_AWAITING_RELEASE: "expired_awaiting_release",
});

function toFiniteNumber(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Er en EJET rytters kontrakt udloebet (end < aktiv saeson) men endnu ikke frigivet?
 * Til flader der kun viser egne ryttere (truppen) og derfor ikke har team_id i haanden.
 * Strengt `<`: end === aktiv er sidste saeson, ikke udloebet.
 */
export function isContractAwaitingRelease(contractEndSeason, activeSeasonNumber) {
  const end = toFiniteNumber(contractEndSeason);
  const active = toFiniteNumber(activeSeasonNumber);
  return end != null && active != null && end < active;
}

/**
 * Kontrakt-tilstanden for en rytter set fra den aktive saeson.
 *
 * Ukendt aktiv saeson (null/NaN) giver RUNNING for en ejet rytter med udloebssaeson:
 * uden et sammenligningspunkt maa fladen ikke paastaa at kontrakten er udloebet.
 *
 * @param {object} args
 * @param {string|null} args.teamId             riders.team_id
 * @param {number|null} args.contractEndSeason  riders.contract_end_season
 * @param {number|null} args.activeSeasonNumber seasons.number for den aktive saeson
 * @returns {string} en af CONTRACT_STATE
 */
export function riderContractState({ teamId = null, contractEndSeason = null, activeSeasonNumber = null } = {}) {
  if (!teamId) return CONTRACT_STATE.FREE_AGENT;
  const end = toFiniteNumber(contractEndSeason);
  if (end == null) return CONTRACT_STATE.NO_END;
  if (isContractAwaitingRelease(end, activeSeasonNumber)) return CONTRACT_STATE.EXPIRED_AWAITING_RELEASE;
  if (end === toFiniteNumber(activeSeasonNumber)) return CONTRACT_STATE.FINAL_SEASON;
  return CONTRACT_STATE.RUNNING;
}

/**
 * Kan en manager tilbyde rytteren en kontrakt direkte (fri-agent-vejen), og hvis ikke,
 * hvornaar bliver han fri?
 *
 *   canSignAsFreeAgent    kun en fri agent (intet hold) der ikke er pensioneret.
 *   awaitingRelease       udloebet, men stadig paa holdet: kun et transfertilbud til ejeren
 *                         er muligt indtil skiftet (ejeren kan ogsaa naa at forlaenge,
 *                         computeContractExtension forankrer i max(end, current)).
 *   freeAgentAfterSeason  saesonnummeret han frigives EFTER (= den aktive saeson) for en
 *                         udloebet-men-ikke-frigivet kontrakt; null ellers.
 *
 * @returns {{state: string, canSignAsFreeAgent: boolean, awaitingRelease: boolean, freeAgentAfterSeason: number|null}}
 */
export function contractOfferEligibility({
  teamId = null,
  contractEndSeason = null,
  activeSeasonNumber = null,
  isRetired = false,
} = {}) {
  const state = riderContractState({ teamId, contractEndSeason, activeSeasonNumber });
  const awaitingRelease = state === CONTRACT_STATE.EXPIRED_AWAITING_RELEASE;
  return {
    state,
    canSignAsFreeAgent: state === CONTRACT_STATE.FREE_AGENT && !isRetired,
    awaitingRelease,
    freeAgentAfterSeason: awaitingRelease ? toFiniteNumber(activeSeasonNumber) : null,
  };
}
