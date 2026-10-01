// #5944: delte mocks til spec'en og PR-billedet (5944-youth-race-opt-out.*).
//
// U23-siden med tre kommende U23-løb, auto-udtaget af assistenten, og
// GET/PUT /api/youth-race-opt-out med en lille tilstand i hukommelsen: et skift
// til "Train only" fjerner holdets entries (som serveren gør for ulåste løb).
// `available: false` = tabellen findes ikke endnu → kontrollen skjules (= i dag).
import type { Page, Route } from "@playwright/test";
import { json, corsHeaders } from "./fixtures.js";
import { previewYouthSquadsPayload, previewYouthRiderRows } from "../../src/preview/youthSquadsMock.ts";

export const U23_POOL = 901;
export const RACES = [
  { id: "00000000-0000-4000-8000-000000059441", name: "GP Espoirs Liège", stages: 1, at: "2026-10-03T15:00:00+00:00" },
  { id: "00000000-0000-4000-8000-000000059442", name: "Ronde van Vlaanderen U23", stages: 1, at: "2026-10-05T15:00:00+00:00" },
  { id: "00000000-0000-4000-8000-000000059443", name: "Tour de l'Avenir", stages: 3, at: "2026-10-08T15:00:00+00:00" },
];
export const EFFECTIVE_FROM_DAY = 22;

export interface OptOutMockState {
  available: boolean;
  trainOnly: boolean;
  puts: Array<{ squad: string; mode: string }>;
}

function preflight(route: Route): boolean {
  const request = route.request();
  if (request.method() !== "OPTIONS") return false;
  void route.fulfill({ status: 204, headers: corsHeaders(request) });
  return true;
}

function wantsObject(route: Route): boolean {
  return (route.request().headers().accept || "").includes("vnd.pgrst.object");
}

export async function installOptOutMocks(page: Page, state: OptOutMockState) {
  await page.route("**/api/display-flags", (route) => {
    if (preflight(route)) return;
    return json(route, { rider_best_role_display: false, youth_squad_pages: true });
  });
  await page.route("**/api/youth-squads", (route) => {
    if (preflight(route)) return;
    return json(route, previewYouthSquadsPayload());
  });
  await page.route("**/rest/v1/riders*", (route) => {
    if (preflight(route)) return;
    const rows = previewYouthRiderRows(route.request().url());
    return rows ? json(route, rows) : route.fallback();
  });
  await page.route("**/rest/v1/teams*", (route) => {
    if (preflight(route)) return;
    if (!route.request().url().includes("u23_league_division_id")) return route.fallback();
    const row = { id: "team-e2e", league_division_id: 1, u23_league_division_id: U23_POOL, junior_league_division_id: null };
    return json(route, wantsObject(route) ? row : [row]);
  });
  await page.route("**/rest/v1/seasons*", (route) => {
    if (preflight(route)) return;
    const url = route.request().url();
    if (!url.includes("status=eq.active") || !url.includes("select=id&")) return route.fallback();
    return json(route, wantsObject(route) ? { id: "season-e2e" } : [{ id: "season-e2e" }]);
  });
  await page.route("**/rest/v1/races*", (route) => {
    if (preflight(route)) return;
    const url = decodeURIComponent(route.request().url());
    if (!url.includes(`league_division_id=eq.${U23_POOL}`)) return route.fallback();
    return json(route, RACES.map((r) => ({
      id: r.id, name: r.name, race_type: r.stages > 1 ? "stage_race" : "single", stages: r.stages, stages_completed: 0, status: "scheduled",
    })));
  });
  await page.route("**/rest/v1/race_stage_schedule*", (route) => {
    if (preflight(route)) return;
    const url = decodeURIComponent(route.request().url());
    if (!url.includes(RACES[0].id)) return route.fallback();
    return json(route, RACES.map((r) => ({ race_id: r.id, stage_number: 1, scheduled_at: r.at })));
  });
  await page.route("**/rest/v1/race_entries*", (route) => {
    if (preflight(route)) return;
    const url = decodeURIComponent(route.request().url());
    if (!url.includes(RACES[0].id)) return route.fallback();
    if (state.trainOnly) return json(route, []);
    return json(route, RACES.flatMap((r) => Array.from({ length: 6 }, () => ({ race_id: r.id, is_auto_filled: true }))));
  });
  await page.route("**/api/youth-race-opt-out**", (route) => {
    if (preflight(route)) return;
    const request = route.request();
    if (request.method() === "PUT") {
      if (!state.available) return json(route, { error: "opt_out_unavailable" }, 503);
      const squad = new URL(request.url()).pathname.split("/").pop() || "";
      const { mode } = JSON.parse(request.postData() || "{}");
      state.puts.push({ squad, mode });
      state.trainOnly = mode === "train_only";
      return json(route, { squad, trainOnly: state.trainOnly, clearedRaces: state.trainOnly ? RACES.length : 0, effectiveFromDay: EFFECTIVE_FROM_DAY });
    }
    return json(route, {
      available: state.available, squad: "u23", trainOnly: state.available && state.trainOnly,
      effectiveFromDay: state.available ? EFFECTIVE_FROM_DAY : null,
    });
  });
}
