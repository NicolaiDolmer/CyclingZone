// Projektionen bag et sponsortilbud (#4265 — flyttet ordret ud af
// SponsorOfferModal.jsx da Next season-fanen på Sponsors-siden overtog flowet).
//
// Nye tilbud (#2948) bærer FROSNE andele (guaranteedFraction / raceDayShare), så
// raten pr. etape kan projiceres mod det etapetal holdet faktisk kommer til at
// køre. Legacy-payloads uden andele viser blot den lagrede rate.
//
// Reglerne er uændrede fra modalen og må ikke drive:
//   · `certain` = garanteret base + hele etape-puljen. Underskriftsbonussen er
//     en ENGANGSbetaling ved aktivering og har sin egen linje — den blev læst
//     som løbende indtægt da den var blandet ind (#4416).
//   · `upside` = resultatloft + sæsonmål, holdt UDE af `certain` så tilbuddet
//     aldrig lover penge der kræver sejre.
function toAmount(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * @param {object} offer  ét element fra GET /api/sponsor/offers → offers[]
 * @param {number|null} stageCount  etapetal for den division der projiceres mod
 * @returns {{rate:number, raceDayPool:number|null, certain:number|null, signing:number, upside:number}}
 */
export function projectOffer(offer, stageCount) {
  const clauses = offer?.clauses || [];
  const signing = toAmount(clauses.find((c) => c?.type === "signing")?.amount);
  const fraction = Number(offer?.guaranteedFraction);
  const share = Number(offer?.raceDayShare);
  const stages = Number(stageCount);

  if (!(fraction > 0) || !Number.isFinite(share) || !(stages > 0)) {
    return { rate: toAmount(offer?.perRaceDayRate), raceDayPool: null, certain: null, signing, upside: 0 };
  }

  const target = Math.round(toAmount(offer?.guaranteedBase) / fraction);
  const raceDayPool = Math.round(target * share);
  const cap = toAmount(clauses.find((c) => c?.type === "results_cap")?.amount);
  const objective = toAmount(clauses.find((c) => c?.type === "season_objective")?.amount);

  return {
    rate: Math.round(raceDayPool / stages),
    raceDayPool,
    certain: toAmount(offer?.guaranteedBase) + raceDayPool,
    signing,
    upside: cap + objective,
  };
}
