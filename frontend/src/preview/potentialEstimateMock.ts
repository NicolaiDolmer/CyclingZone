// #7686 · Preview af Udvikling 2.0 tal + ord, uden at backendens trin 4 skal være
// tændt. ?potentialEstimate=on slår visningen til (huskes i localStorage, samme
// mønster som ?youthSquads), =off slår den fra. Standard er off, så Playwright-
// fixtures og snapshots er uændrede. ?potentialState=unsure|fair|sure|learning|unscouted
// viser den tilstand på alle ryttere, =mix går tilbage til blandingen.
//
// Svarene følger kontrakten: tændt = `potentialView`, og lo/hi/prog/ceil/loft og
// prognosen er fjernet, så et preview ikke kan se rigtigt ud på gamle felter.
// Alle tal er opdigtede illustrationer.
// #8523: egne ryttere får desuden den samlede prognose (prognosisView), og den
// gamle kurve mod skønnet (estimateLine) er væk som i backend.

import type { Certainty, PotentialView, PotentialViewShown, PrognosisView } from "../lib/potentialEstimateDisplay";
import { RIDERS, TEST_TEAM } from "./seedData.js";
import { PREVIEW_YOUTH_RIDERS } from "./youthSquadsMock.ts";

type SeedEstimate = { level?: number; role?: string | null; now?: number | null };
type SeedReport = { maxLevel: number; scout?: unknown; primaryKey?: string; types?: { key: string; now: number; progLo: number; progHi: number }[] };
type SeedProjection = { level: number; maxLevel: number; own: boolean; now: number; primaryKey: string };

const KEY = "cz_mock_potential_estimate";
const STATE_KEY = "cz_mock_potential_state";

export function previewPotentialEstimateEnabled(): boolean {
  try {
    const param = new URLSearchParams(window.location.search).get("potentialEstimate");
    if (param === "on") localStorage.setItem(KEY, "1");
    if (param === "off") localStorage.setItem(KEY, "0");
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

// Læses ved indlæsning, så parameteren virker på enhver side, også en der straks
// omdirigerer og derfor aldrig når at spørge mocken.
previewPotentialEstimateEnabled();

function forcedState(): string | null {
  try {
    const param = new URLSearchParams(window.location.search).get("potentialState");
    if (param === "mix") localStorage.removeItem(STATE_KEY);
    else if (param) localStorage.setItem(STATE_KEY, param);
    return localStorage.getItem(STATE_KEY);
  } catch {
    return null;
  }
}
forcedState();

const shown = (value: number, certainty: Certainty): PotentialViewShown => ({
  hidden: false, value, certainty, previousValue: null, previousCertainty: null, changedAt: null,
});

const LEARNING: PotentialView = { hidden: true, reason: "learning", trainings: 3, trainingsNeeded: 5 };
const UNSCOUTED: PotentialView = { hidden: true, reason: "unscouted" };
const AI_TEAM: PotentialView = { hidden: true, reason: "aiTeam" };

// Fast rækkefølge, så hver tabel viser alle fire tilstande uden at ramme samme
// rytter forskelligt fra flade til flade (H5: samme tal overalt).
const STATES: PotentialView[] = [shown(74, "unsure"), shown(61, "fair"), shown(68, "sure"), LEARNING, UNSCOUTED];

const FIXED: Record<string, PotentialViewShown> = {
  "rider-1": shown(46, "sure"),
  "rider-2": shown(58, "unsure"),
  // #8543: akademiets tre kandidater viser alle tre sikkerhedsord.
  "prospect-1": shown(58, "unsure"),
  "prospect-2": shown(52, "fair"),
  "prospect-3": shown(46, "sure"),
};

const FORCED: Record<string, PotentialView> = {
  unsure: shown(58, "unsure"),
  fair: shown(52, "fair"),
  sure: shown(46, "sure"),
  learning: LEARNING,
  unscouted: UNSCOUTED,
  aiTeam: AI_TEAM,
};

function hash(id: string): number {
  let sum = 0;
  for (const char of String(id)) sum = (sum * 31 + char.charCodeAt(0)) % 9973;
  return sum;
}

function viewFor(id: string): PotentialView {
  return FORCED[forcedState() ?? ""] ?? FIXED[id] ?? STATES[hash(id) % STATES.length];
}

// #8544: U23- og juniorrytterne er ogsaa egne ryttere, saa trup-listen viser prognosen.
const OWN_IDS = new Set([
  ...(RIDERS as Array<{ id: string; team_id?: string | null }>)
    .filter((rider) => rider.team_id === TEST_TEAM.id).map((rider) => rider.id),
  ...(PREVIEW_YOUTH_RIDERS as Array<{ id: string }>).map((rider) => rider.id),
]);

// Opdigtet prognose: lidt under skønnet, så tallet ikke ligner skønnet selv.
function prognosisFor(view: PotentialView): PrognosisView {
  return view.hidden ? { hidden: true, reason: "noEstimate" } : { hidden: false, value: Math.max(0, view.value - 4) };
}

export function previewEstimate(id: string, seed?: SeedEstimate) {
  const view = viewFor(id);
  return {
    level: view.hidden ? 0 : seed?.level || 1,
    role: seed?.role ?? null,
    now: seed?.now ?? null,
    potentialView: view,
    ...(OWN_IDS.has(id) ? { prognosisView: prognosisFor(view) } : {}),
  };
}

// GET /academy/me: truppen er altid egne ryttere og får skøn + prognose; den gamle
// kendskabsmodel (prognosis) fjernes som i backend.
export function previewAcademy<T extends {
  roster?: Array<Record<string, unknown> & { id: string }>;
  intake?: Array<Record<string, unknown> & { riderId: string }>;
}>(academy: T): T {
  return {
    ...academy,
    // #8543: kandidaterne får tal + ord, og intervallet og stjerne-skønnet er væk som i backend.
    intake: (academy.intake ?? []).map((item) => ({
      ...item, is_serious: false, potentialEstimate: null, potentialBand: null, potentialView: viewFor(item.riderId),
    })),
    roster: (academy.roster ?? []).map((rider) => {
      // Egne talenter er aldrig uscoutede: uden skøn læres de stadig.
      const raw = viewFor(rider.id);
      const view = raw.hidden && raw.reason !== "learning" ? LEARNING : raw;
      const { prognosis: _legacy, ...rest } = rider;
      return { ...rest, potentialView: view, prognosisView: prognosisFor(view) };
    }),
  };
}

export function previewReport(id: string, seed: SeedReport, own: boolean) {
  const view = viewFor(id);
  // #6110: prognosen pr. ryttertype står under skønnet igen, for egne og scoutede ryttere.
  // Kun nu-rating og prognose-bånd, som serveren sender; loft og alias er ikke med.
  const types = !view.hidden && seed.types?.length
    ? seed.types.map(({ key, now, progLo, progHi }) => ({ key, now, progLo, progHi }))
    : null;
  return {
    ...(types ? { primaryKey: seed.primaryKey ?? null, types } : {}),
    level: view.hidden ? 0 : own ? seed.maxLevel : 1,
    maxLevel: seed.maxLevel,
    own,
    looks: view.hidden ? 0 : 1,
    scout: seed.scout,
    potentialView: view,
    ...(own ? { prognosisView: prognosisFor(view) } : {}),
  };
}

export function previewProjection(id: string, seed: SeedProjection) {
  const view = viewFor(id);
  const prognosis = seed.own ? { prognosisView: prognosisFor(view) } : {};
  if (view.hidden) {
    return { level: 0, maxLevel: seed.maxLevel, own: seed.own, potentialView: view, ...prognosis };
  }
  return {
    level: seed.level,
    maxLevel: seed.maxLevel,
    own: seed.own,
    now: seed.now,
    primaryKey: seed.primaryKey,
    potentialView: view,
    ...prognosis,
  };
}
