// #7947 runde 2: et-tryks-valg pr. rytter. Ren model, ingen React.
//
// Ejeren 16/11: valget skal foeles lige saa nemt som den gamle flade. Den
// gamle flade havde hurtigknapper (Hvile, Aktiv restitution, rytterens egen
// traening), hvor serveren beholdt rytterens traening hen over en hviledag,
// saa vejen tilbage var et tryk. Runde 2 bygger paa samme ide.
//
// Intet skema aendres. Planen er stadig (focus, intensity) som i dag, og hvert
// et-tryks-valg oversaettes til et (indsats, traening)-par fra effortModel og
// derfra til samme par som i dag. Aktiv restitution bor under Hvile (ejervalg
// 16/11), saa modellen bruger altid recoveryHome "rest".

import {
  RECOVERY_SESSION,
  choiceFromPlan,
  effortForSession,
  isValidChoice,
  planFromChoice,
  type Choice,
  type Effort,
  type Plan,
} from "../effortModel.ts";

export const HOME = { recoveryHome: "rest" as const };

// De valg en raekke kan tilbyde med et tryk. "own" er rytterens egen traening.
export type Quick = "rest" | "active" | "easy" | "normal" | "hard" | "own";

// Den traening en indsats giver med et tryk, naar rytteren ikke selv har en paa
// den indsats. Let og Mellem har hver en oplagt standard; Haard har ingen
// faelles standard, saa den kommer fra rytteren (eller assistenten).
const EASY_DEFAULT = "endurance";
const NORMAL_DEFAULT = "tempo";

// Rytterens egen traening: den gemte session, ogsaa naar dagen er hvile (den
// gamle regel: fokus bliver staaende i planen, saa man kan vende tilbage).
// Aktiv restitution og en tom plan har ingen egen traening; saa bruges
// reserven (typisk assistentens haarde forslag for rytteren).
export function ownTraining(plan: Plan, fallback: string): string {
  const focus = plan?.focus ?? null;
  if (!focus) return fallback;
  if (focus === "restitution" || plan?.intensity === "recovery") return fallback;
  return effortForSession(focus) ? focus : fallback;
}

export function choiceForQuick(q: Quick, plan: Plan, fallback: string): Choice {
  const own = ownTraining(plan, fallback);
  const ownEffort = effortForSession(own);
  switch (q) {
    case "rest":
      return { effort: "rest", session: null };
    case "active":
      return { effort: "rest", session: RECOVERY_SESSION };
    case "easy":
      return { effort: "easy", session: ownEffort === "easy" ? own : EASY_DEFAULT };
    case "normal":
      return { effort: "normal", session: NORMAL_DEFAULT };
    case "hard":
      return { effort: "hard", session: ownEffort === "hard" ? own : fallback };
    case "own":
      return { effort: ownEffort, session: own };
  }
}

// Et tryk -> den plan der gemmes. Hvile beholder rytterens traening i planen,
// praecis som i dag, saa naeste tryk paa hans traening er en vej tilbage.
export function planForQuick(q: Quick, plan: Plan, fallback: string) {
  const choice = choiceForQuick(q, plan, fallback);
  const own = ownTraining(plan, fallback);
  return planFromChoice(choice.effort as Effort, choice.session, { keepFocus: own });
}

// Er et-tryks-valget et gyldigt par for serveren? (Bruges af testen.)
export function quickIsValid(q: Quick, plan: Plan, fallback: string): boolean {
  const c = choiceForQuick(q, plan, fallback);
  return isValidChoice(c.effort, c.session, HOME);
}

// Hvilken indsats er trykket ind for en gemt plan.
export function effortOf(plan: Plan): Effort | null {
  return choiceFromPlan(plan, HOME).effort;
}

export function isActiveRecovery(plan: Plan): boolean {
  return choiceFromPlan(plan, HOME).session === RECOVERY_SESSION;
}

// Den traening raekken viser for en gemt plan (null paa fuld hvile).
export function sessionOf(plan: Plan): string | null {
  return choiceFromPlan(plan, HOME).session;
}
