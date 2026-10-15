import type { Page } from "@playwright/test";
import { installNetworkMocks, stabilizePage, login, json } from "./fixtures.js";
export const id = (n: number) => "65140000-0000-4000-8000-" + String(n).padStart(12, "0");
export const seasons = Array.from({ length: 12 }, (_, i) => ({
  id: id(100 + i),
  number: i + 1,
  status: i === 3 ? "active" : i < 3 ? "completed" : "planned",
}));
export const races = [
  {
    id: id(1),
    name: "Vuelta Ibérica",
    race_type: "stage_race",
    race_class: "GiroVuelta",
    stages: 3,
    stages_completed: 0,
    status: "scheduled",
    season_id: id(103),
    league_division_id: 2,
    pool_race_id: id(200),
    edition_year: 2026,
    squad: "senior",
  },
  {
    id: id(2),
    name: "Tour de l'Hexagone",
    race_type: "stage_race",
    race_class: "TourFrance",
    stages: 3,
    stages_completed: 1,
    status: "scheduled",
    season_id: id(103),
    league_division_id: 2,
    pool_race_id: id(201),
    edition_year: 2026,
    squad: "senior",
  },
  {
    id: id(3),
    name: "L'Enfer du Nord",
    race_type: "single",
    race_class: "Monuments",
    stages: 1,
    stages_completed: 0,
    status: "scheduled",
    season_id: id(103),
    league_division_id: null,
    pool_race_id: id(202),
    edition_year: 2026,
    squad: "senior",
  },
  {
    id: id(4),
    name: "Giro della Penisola",
    race_type: "stage_race",
    race_class: "GiroVuelta",
    stages: 3,
    stages_completed: 3,
    status: "completed",
    season_id: id(103),
    league_division_id: 2,
    pool_race_id: id(203),
    edition_year: 2026,
    squad: "senior",
  },
  {
    id: id(5),
    name: "L'Enfer du Nord",
    race_type: "single",
    race_class: "Monuments",
    stages: 1,
    stages_completed: 1,
    status: "completed",
    season_id: id(102),
    league_division_id: null,
    pool_race_id: id(299),
    edition_year: 2026,
    squad: "senior",
  },
];
const extraNames = [
  "Westkust Klassieker",
  "Tour du Léman",
  "Ronde van Noord-Frankrijk",
  "Tour de la Vistule",
  "Tour de Haute-Savoie",
  "Classica d'Autunno",
];
extraNames.forEach((name, i) =>
  races.push({
    ...races[0],
    id: id(10 + i),
    name,
    race_type: i === 0 || i === 5 ? "single" : "stage_race",
    race_class: "OtherWorldTourA",
    stages: i === 0 || i === 5 ? 1 : 6,
  })
);
export const schedules = races.flatMap((r) =>
  Array.from({ length: r.stages }, (_, i) => ({
    race_id: r.id,
    stage_number: i + 1,
    scheduled_at:
      "2026-10-" +
      (r.status === "completed" ? "10" : "17") +
      "T" +
      String(10 + i * 2).padStart(2, "0") +
      ":00:00Z",
    game_day: 91 + i,
  }))
);
export const profiles = races.flatMap((r) =>
  Array.from({ length: r.stages }, (_, i) => ({
    id: id(300 + i),
    race_id: r.id,
    stage_number: i + 1,
    distance_km: r.race_type === "single" ? 255 : 170 + i * 10,
    profile_type: "flat",
    elevation_gain_m: 450,
    elevation_profile: null,
    sectors: [{ start_km: 115, length_km: 1.3 }],
    climbs: [],
  }))
);
export const results = races
  .filter((r) => r.status === "completed")
  .map((r) => ({
    id: id(400),
    race_id: r.id,
    stage_number: r.stages,
    result_type: r.race_type === "single" ? "stage" : "gc",
    rank: 1,
    rider_id: id(401),
    rider_name: "Rytter 1",
    team_id: id(402),
    team_name: "Hold 1",
    points_earned: 0,
  }));
function filter(url: URL, rows: Record<string, unknown>[]) {
  let result = rows;
  for (const key of ["id", "race_id", "season_id", "name", "race_type", "rank"]) {
    const value = url.searchParams.get(key);
    if (value?.startsWith("eq.")) result = result.filter((r) => String(r[key]) === value.slice(3));
    if (value?.startsWith("in.(")) {
      const ids = value.slice(4, -1).split(",");
      result = result.filter((r) => ids.includes(String(r[key])));
    }
  }
  const limit = Number(url.searchParams.get("limit") ?? 1000),
    offset = Number(url.searchParams.get("offset") ?? 0);
  return result.slice(offset, offset + limit);
}
export async function prepareLibrary(
  page: Page,
  options: { fail?: boolean; delaySeason?: number } = {}
) {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await page.route("**/rest/v1/seasons**", (r) => json(r, seasons));
  await page.route("**/rest/v1/league_divisions**", (r) =>
    json(r, [
      { id: 2, tier: 2, pool_index: 0, label: "Pulje 1", retired_at: null },
      { id: 3, tier: 3, pool_index: 0, label: "Pulje 1", retired_at: "2026-10-01" },
    ])
  );
  await page.route("**/rest/v1/races**", async (r) => {
    const url = new URL(r.request().url());
    if (options.fail) return json(r, { message: "fixture read failed" }, 503);
    if (
      options.delaySeason &&
      url.searchParams.get("season_id") === "eq." + id(100 + options.delaySeason - 1)
    )
      await new Promise((resolve) => setTimeout(resolve, 250));
    return json(r, filter(url, races));
  });
  await page.route("**/rest/v1/race_stage_schedule**", (r) =>
    json(r, filter(new URL(r.request().url()), schedules))
  );
  await page.route("**/rest/v1/race_stage_profiles**", (r) =>
    json(r, filter(new URL(r.request().url()), profiles))
  );
  await page.route("**/rest/v1/race_results**", (r) =>
    json(r, filter(new URL(r.request().url()), results))
  );
  await login(page);
}
