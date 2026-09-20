// Flag for traeningssidens NYE mobil-visning (#3643). Moenster kopieret fra
// trainingScoreFlag.js / trainingTickRaceDayFlag.js.
//
// ON  = telefonen (<=640px) tegner mockup 2: tabel med dagens loebsdage som
//       kolonner + rytterens fulde kort under tabellen.
// OFF = telefonen tegner PRAECIS den mobil-visning der stod paa main foer
//       #3643: desktop-rosterets D-047-gren (#5124) med chip-bytter,
//       MOBILE_SCROLLER og "Fuld tabel".
//
// Desktop er UBEROERT af flaget i begge stadier — gaten ligger inde i den
// `isMobile`-gren der allerede fandtes.
//
// EJER-BESLUTNING 19/9 (ordret): "Jeg vil have det kun live for beta testere i
// starten, saadan at vi kan snakke om det og tilpasse, hvor vi derefter goer
// den bedre og bedre loebende". Derfor er startstadiet `beta`, ikke `off`:
// migrationen (database/2026-09-19-3643-training-mobile-table-flag.sql)
// opretter raekken med "beta", saa beta-testere ser den nye flade fra dag ét,
// mens alle andre ser dagens visning uaendret.
//
// Beta-status laeses SERVER-SIDE (isViewerBetaTester i routes/api.js, som slaar
// users.is_beta_tester op) og aldrig fra klienten — svaret er en bar boolean.
//
// Fail-safe: manglende/ukendt vaerdi eller fejl → false (featureStage.js), dvs.
// den gamle visning. Et fejlet flag-opslag maa aldrig vise en halv ny flade.

import { readFlagStage, evaluateFlagStage } from "./featureStage.js";

export const TRAINING_MOBILE_TABLE_FLAG_KEY = "training_mobile_table";

export async function isTrainingMobileTableEnabled(supabase, opts = {}) {
  return evaluateFlagStage(await readFlagStage(supabase, TRAINING_MOBILE_TABLE_FLAG_KEY), opts);
}
