// #5519 — kontakten for U23 team- og Junior team-SIDERNE (roadbook-loeftet
// "U23 team and junior team become real squads").
//
// ON  = to nye Klubhus-menupunkter efter My Team (U23 team, Junior team), hver
//       med sin egen trup-side (T2, faner Squad · Calendar · Results ·
//       Standings · Development). Akademiets "Youth squads / Coming soon"-kort
//       forsvinder (artboard 3a, docs/design/youth-tiers/HANDOFF.md pkt. 1+10).
// OFF = praecis den visning der staar i prod i dag: ingen nye menupunkter,
//       Coming soon-kortet bliver staaende, og GET /api/youth-squads svarer 409.
//
// Rent visning + ét laese-endpoint: ingen skrive-sti, ingen motor og ingen
// backend-beregning aendrer adfaerd paa flaget. Truppernes indhold kommer fra
// riders.squad via effectiveSquad (squads.js), uanset flaget.
//
// Fail-safe: manglende/ukendt vaerdi eller fejl → false (featureStage.js), dvs.
// dagens visning. Stadie `beta` = kun beta-testere/admin ser siderne.

import { readFlagStage, evaluateFlagStage } from "./featureStage.js";

export const YOUTH_SQUAD_PAGES_FLAG_KEY = "youth_squad_pages";

export async function isYouthSquadPagesEnabled(supabase, opts = {}) {
  return evaluateFlagStage(await readFlagStage(supabase, YOUTH_SQUAD_PAGES_FLAG_KEY), opts);
}
