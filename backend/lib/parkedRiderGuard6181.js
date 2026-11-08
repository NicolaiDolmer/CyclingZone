// #6181 (pengelås PR 1): værn mod at handle med en solgt, ventende rytter.
//
// En rytter er "parkeret", når han er solgt, men holdskiftet venter (fx fordi han
// kører et etapeløb hos sælgeren). Så står team_id stadig på sælgeren, mens
// pending_team_id peger på køberen, der allerede har betalt.
//
// Uden værn kunne sælgeren i det vindue fyre rytteren eller sælge ham igen, og
// køberen ville miste både pengene og rytteren. Reglen er derfor enkel: en
// parkeret rytter kan hverken fyres, sættes til salg eller modtage tilbud, før
// holdskiftet er gennemført.
//
// Funktionerne er rene og returnerer null, når handlingen er tilladt, ellers
// { status, body } klar til res.status(status).json(body). Teksterne findes også
// i frontend/public/locales/{en,da}/errors.json under api.<errorCode>.

export function isRiderParked(rider) {
  return rider?.pending_team_id != null;
}

// POST /riders/:id/release (og release-quote): sælgeren må ikke fyre en rytter,
// køberen allerede har betalt for.
export function getParkedRiderReleaseIssue(rider) {
  if (!isRiderParked(rider)) return null;
  return {
    status: 409,
    body: {
      error: "This rider is sold and waiting to join the new team, so you can't release the rider",
      errorCode: "rider_pending_transfer_release",
    },
  };
}

// POST /transfers og begge tilbudsruter: en solgt rytter kan ikke sælges igen.
export function getParkedRiderTradeIssue(rider) {
  if (!isRiderParked(rider)) return null;
  return {
    status: 409,
    body: {
      error: "This rider is already sold and waiting to join the new team, so the rider can't be sold again",
      errorCode: "rider_pending_transfer_trade",
    },
  };
}
