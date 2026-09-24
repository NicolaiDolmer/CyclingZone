// #5519: preview-data til U23 team- og Junior team-siderne.
//
// Bevidst et EGET modul og ikke en del af det delte RIDERS-seed: RIDERS bruges af
// næsten alle Playwright-snapshots (My Team, rytterdatabasen, auktioner), og fem
// ungdomsryttere dér ville flytte dem alle. Her serveres de kun når nogen beder
// om dem: GET /api/youth-squads og rytter-opslaget med præcis deres id'er.
//
// Alderen passer til truppen i seedets sæson 1 (referenceår 2026): U23 er født
// 2004-2007 (19-22 år), Junior 2008-2010 (16-18 år). Navnene er opdigtede
// eksempel-data, som resten af preview-seedet.
import { TEST_TEAM } from "./seedData.js";

type Abilities = Record<string, number>;

function abilities(base: number, peaks: Abilities): Abilities {
  const keys = [
    "climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch", "endurance",
    "recovery", "durability", "descending", "cobblestone", "positioning", "aggression", "tactics",
  ];
  const out: Abilities = {};
  for (const k of keys) out[k] = base;
  return { ...out, ...peaks };
}

function youthRider(
  id: string, firstname: string, lastname: string, birthdate: string, nation: string,
  squad: "u23" | "junior", primary: string, secondary: string | null,
  value: number, salary: number, ab: Abilities,
) {
  return {
    id, firstname, lastname, birthdate, nationality_code: nation,
    team_id: TEST_TEAM.id, is_academy: true, squad, is_retired: false, is_u25: true,
    base_value: value, market_value: value, prize_earnings_bonus: 0, current_production_value: Math.round(value * 0.4),
    salary, contract_length: 2, contract_end_season: 3, popularity: 12,
    primary_type: primary, secondary_type: secondary,
    rider_derived_abilities: ab,
    rider_condition: null,
  };
}

export const PREVIEW_YOUTH_RIDERS = [
  youthRider("youth-u23-1", "Emil", "Vestergaard", "2005-05-02", "dk", "u23", "climber", "gc", 240000, 14000,
    abilities(11, { climbing: 19, recovery: 16, endurance: 15 })),
  youthRider("youth-u23-2", "Noah", "Brandt", "2006-08-19", "de", "u23", "rouleur", "tt", 195000, 12500,
    abilities(10, { time_trial: 17, tempo: 16, flat: 15 })),
  youthRider("youth-u23-3", "Mateo", "Ferrer", "2004-01-27", "es", "u23", "puncheur", null, 210000, 13000,
    abilities(10, { punch: 18, acceleration: 15 })),
  youthRider("youth-jun-1", "Oskar", "Lind", "2009-03-11", "se", "junior", "sprinter", null, 120000, 8000,
    abilities(7, { sprint: 13, acceleration: 12 })),
  youthRider("youth-jun-2", "Théo", "Garnier", "2008-10-05", "fr", "junior", "climber", null, 135000, 8500,
    abilities(7, { climbing: 14, recovery: 11 })),
];

// #5631: samme tal som backend.SQUAD_CAPS (u23: 12, junior: 10) — mock'en kan
// ikke importere backend/lib/squads.js (andet workspace), så tallene er
// bevidst gentaget her, ikke afledt.
const PREVIEW_SQUAD_CAPS = { u23: 12, junior: 10 };

export function previewYouthSquadsPayload() {
  const idsFor = (squad: string) => PREVIEW_YOUTH_RIDERS.filter((r) => r.squad === squad).map((r) => r.id);
  return {
    seasonNumber: 1,
    squads: { u23: { riderIds: idsFor("u23") }, junior: { riderIds: idsFor("junior") } },
    caps: PREVIEW_SQUAD_CAPS,
  };
}

/**
 * Rytter-rækkerne til et `riders?id=in.(…)`-opslag, eller null hvis opslaget
 * ikke KUN gælder preview-ungdomsrytterne (så falder det videre til det delte
 * seed, og ingen anden side ser dem).
 */
export function previewYouthRiderRows(requestUrl: string) {
  if (!/\/rest\/v1\/riders/.test(requestUrl)) return null;
  const idIn = decodeURIComponent(requestUrl).match(/[?&]id=in\.\(([^)]*)\)/);
  if (!idIn) return null;
  const ids = idIn[1].split(",").map((s) => s.trim().replace(/^"|"$/g, "")).filter(Boolean);
  if (ids.length === 0 || !ids.every((id) => id.startsWith("youth-"))) return null;
  const wanted = new Set(ids);
  return PREVIEW_YOUTH_RIDERS.filter((r) => wanted.has(r.id));
}
