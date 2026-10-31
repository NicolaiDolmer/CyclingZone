// "Dagens beslutning" - ren model bag kortet oeverst paa Today-fanen (#6110 S26).
//
// Ingen ny motor og intet nyt endpoint: forslagene afledes af data siden allerede
// har (condition pr. rytter fra /api/training/me, dagens loeb). Et forslag er
// "ryttere der er traette OG har en haard dag planlagt, saa skaderisikoen er
// oppe". Forslaget er altid aktiv restitution, aldrig Hvile: Hvile tager en
// rytter ud af loebsudtagelsen (hvile-faelden, ASSISTANT_RULES §11.3).
// "Use" skriver via den samme hurtig-skift-sti som rosterets egne knapper.

// Samme graense som risiko-badgen paa rytterens raekke i TrainingPage.jsx
// (highRisk), saa kortet og raekken aldrig er uenige om hvem der er i fare.
export const DECISION_RISK_FROM = 0.05;
export const MAX_DECISION_SUGGESTIONS = 3;

export type DecisionCondition = {
  fatigue?: number | null;
  risk?: number | null;
};

export type DecisionSuggestion = {
  riderId: string;
  // Hvad "Use" saetter dagen til. Kun aktiv restitution (se toppen).
  dayType: "recovery";
  fatigue: number;
};

export type DecisionInput = {
  riderIds: readonly string[];
  condition: (riderId: string) => DecisionCondition | null | undefined;
  // Loeb slaar traening: en rytter der koerer loeb i dag faar intet forslag.
  isRacing: (riderId: string) => boolean;
  // En skadet rytter har allerede sin egen status; intet forslag.
  isInjured: (riderId: string) => boolean;
  // Dagen er allerede hvile/restitution: forslaget er opfyldt.
  isEasyDay: (riderId: string) => boolean;
};

// Traetteste foerst, hoejst tre. Samme input giver altid samme raekkefoelge
// (tie-break paa id), saa kortet ikke hopper mellem to renders.
export function buildDailyDecision(input: DecisionInput): DecisionSuggestion[] {
  return buildAllDecisions(input).slice(0, MAX_DECISION_SUGGESTIONS);
}

// Alle forslag (ingen loft), traetteste foerst. Holdtabellens Assistent-kolonne
// (#6110 S26, retning B) viser et forslag pr. rytter; kortet viser kun de foerste.
export function buildAllDecisions(input: DecisionInput): DecisionSuggestion[] {
  const out: DecisionSuggestion[] = [];
  for (const riderId of input.riderIds) {
    if (input.isRacing(riderId) || input.isInjured(riderId) || input.isEasyDay(riderId)) continue;
    const cond = input.condition(riderId);
    if (cond?.risk == null || cond?.fatigue == null) continue;
    const risk = Number(cond.risk);
    const fatigue = Number(cond.fatigue);
    if (!Number.isFinite(risk) || !Number.isFinite(fatigue) || risk < DECISION_RISK_FROM) continue;
    out.push({ riderId, dayType: "recovery", fatigue });
  }
  out.sort((a, b) => b.fatigue - a.fatigue || (a.riderId < b.riderId ? -1 : 1));
  return out;
}
