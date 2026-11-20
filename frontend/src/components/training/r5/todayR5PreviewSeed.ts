// #7947 · Preview (?trainingR5=1): et fuldt hold paa I dag-fanen R5, til billeder og ejerens
// egen klik-rundtur foer taending. Kun preview-mockens seed aendres; prod roeres ikke, og uden
// parameteren (eller med ?trainingR5=0) er seedet praecis som foer (Playwright-fixtures urort).
// Navne, tal og loeb er preview-fiktion.
import { RIDERS, SEED_TRAINING, TEST_TEAM } from "../../../preview/seedData.js";

type Seed = Record<string, unknown> & {
  todayRun?: unknown;
  plans?: Record<string, unknown>;
  condition?: Record<string, unknown>;
  smartDefaultFocus?: Record<string, string>;
  riderWeekPlans?: Record<string, unknown>;
  racingToday?: Record<string, unknown>;
  decisionCard?: boolean;
  fatigueDays70?: Record<string, number>;
};

function previewOn(): boolean {
  try {
    const param = new URLSearchParams(window.location.search).get("trainingR5");
    if (param === "1" || param === "on") return true;
    if (param === "0" || param === "off") return false;
    return localStorage.getItem("cz_mock_training_r5") === "1";
  } catch {
    return false;
  }
}

const EXTRA = [
  { id: "rider-r5-1", firstname: "Lukas", lastname: "Brandt", nationality_code: "de", birthdate: "1999-03-02", primary_type: "climber", secondary_type: "gc", squad: null, contract_end_season: 6 },
  { id: "rider-r5-2", firstname: "Tomás", lastname: "Ferreira", nationality_code: "pt", birthdate: "2001-07-19", primary_type: "rouleur", secondary_type: "tt", squad: null, contract_end_season: 5 },
  { id: "rider-r5-3", firstname: "Pieter", lastname: "Claes", nationality_code: "be", birthdate: "1997-11-08", primary_type: "brostensrytter", secondary_type: "rouleur", squad: null, contract_end_season: 4 },
  { id: "rider-r5-4", firstname: "Marco", lastname: "Bellini", nationality_code: "it", birthdate: "2000-01-27", primary_type: "puncheur", secondary_type: "baroudeur", squad: null, contract_end_season: 6 },
  { id: "rider-r5-5", firstname: "Jonas", lastname: "Lind", nationality_code: "se", birthdate: "2005-05-14", primary_type: "tt", secondary_type: "rouleur", squad: "u23", contract_end_season: 6 },
  { id: "rider-r5-6", firstname: "Oscar", lastname: "Reyes", nationality_code: "co", birthdate: "1998-09-30", primary_type: "gc", secondary_type: "climber", squad: null, contract_end_season: 6 },
  { id: "rider-r5-7", firstname: "Kenji", lastname: "Mori", nationality_code: "jp", birthdate: "2003-12-03", primary_type: "sprinter", secondary_type: "puncheur", squad: null, contract_end_season: 5 },
  { id: "rider-r5-8", firstname: "Emil", lastname: "Holm", nationality_code: "dk", birthdate: "2008-02-21", primary_type: "rouleur", secondary_type: "baroudeur", squad: "junior", contract_end_season: 6, is_academy: true },
];

const WEEK = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const INTENSITY: Record<string, string> = { rest: "rest", recovery: "recovery", endurance: "easy", technique: "easy", tempo: "normal" };
const week = (days: Record<string, string>) =>
  Object.fromEntries(WEEK.map((w) => [w, { session: days[w], intensity: INTENSITY[days[w]] ?? "hard" }]));
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

export function seedTodayR5Preview(): void {
  if (!previewOn()) return;
  const riders = RIDERS as unknown as Array<Record<string, unknown>>;
  if (riders.some((r) => r.id === "rider-r5-1")) return;
  for (const r of EXTRA) riders.push({ is_academy: false, ...r, team_id: TEST_TEAM.id, team: { id: TEST_TEAM.id, name: TEST_TEAM.name } });
  const seed = SEED_TRAINING as unknown as Seed;
  seed.todayRun = null; // dagen er ikke traenet endnu, saa valgene kan ses aabne
  seed.plans = {
    ...(seed.plans ?? {}),
    "rider-r5-3": { focus: "cobbled_sectors", intensity: "hard" },
    "rider-r5-5": { focus: "aero", intensity: "rest" },
    "rider-r5-7": { focus: "tempo", intensity: "normal" },
    "rider-r5-8": { focus: "technique", intensity: "easy" },
  };
  seed.condition = {
    ...(seed.condition ?? {}),
    "rider-r5-1": { form: 71, fatigue: 48, risk: 0.02, injured_until: null },
    "rider-r5-2": { form: 64, fatigue: 52, risk: 0.03, injured_until: null },
    "rider-r5-3": { form: 58, fatigue: 74, risk: 0.08, injured_until: null },
    "rider-r5-4": { form: 66, fatigue: 34, risk: 0.02, injured_until: null },
    "rider-r5-5": { form: 69, fatigue: 29, risk: 0.01, injured_until: null },
    "rider-r5-6": { form: 62, fatigue: 71, risk: 0.04, injured_until: null },
    "rider-r5-7": { form: 60, fatigue: 41, risk: 0.02, injured_until: inDays(3), injury_race_days_left: 2 },
    "rider-r5-8": { form: 55, fatigue: 22, risk: 0.01, injured_until: null },
  };
  seed.smartDefaultFocus = { ...(seed.smartDefaultFocus ?? {}), "rider-r5-1": "vo2max_climb", "rider-r5-2": "threshold", "rider-r5-4": "vo2max_punch", "rider-r5-6": "threshold" };
  seed.riderWeekPlans = {
    ...(seed.riderWeekPlans ?? {}),
    "rider-r5-1": week({ mon: "vo2max", tue: "vo2max_climb", wed: "recovery", thu: "vo2max", fri: "vo2max_climb", sat: "endurance", sun: "rest" }),
    "rider-r5-6": week({ mon: "vo2max", tue: "threshold", wed: "vo2max_climb", thu: "recovery", fri: "vo2max", sat: "endurance", sun: "rest" }),
  };
  seed.racingToday = { "rider-r5-2": { race: "Ronde van Preview" }, "rider-r5-4": { race: "Ronde van Preview" } };
  seed.decisionCard = true;
  seed.fatigueDays70 = { "rider-r5-3": 2, "rider-r5-6": 1 };
}

seedTodayR5Preview();
