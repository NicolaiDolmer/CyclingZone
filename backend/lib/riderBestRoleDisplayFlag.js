// #5435 (D-049, model A) — kontakten for rating-VISNINGEN i klienten.
//
// ON  = ratingen på kort, tabeller, auktioner og rytterprofil er "bedste rolle
//       nu" med rollenavnet ved siden af ("54 Climber"), og type-badget hedder
//       "Natural role". Loft-tallene er ude af hero og scouting-fane (ejer 21/9).
// OFF = præcis den visning der står i prod i dag: rating = egen rolle.
//
// EJER-BESLUTNING 22/9: visningen tændes i SAMME deploy som værdiskiftet
// (#5443/#5497), ikke før. Migrationen opretter derfor rækken med "off", og
// flaget må først flyttes når værdikørslen lander. Stadie `beta` kan bruges til
// at se visningen i prod som beta-tester før flippet.
//
// Rent visning: ingen backend-beregning læser flaget. riders.best_role/
// best_role_rating caches uanset flaget (riderValueRefresh.js, #5487).
//
// Fail-safe: manglende/ukendt værdi eller fejl → false (featureStage.js), dvs.
// dagens visning.

import { readFlagStage, evaluateFlagStage } from "./featureStage.js";

export const RIDER_BEST_ROLE_DISPLAY_FLAG_KEY = "rider_best_role_display";

export async function isRiderBestRoleDisplayEnabled(supabase, opts = {}) {
  return evaluateFlagStage(await readFlagStage(supabase, RIDER_BEST_ROLE_DISPLAY_FLAG_KEY), opts);
}
