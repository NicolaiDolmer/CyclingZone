// #6570 · loebssidens profil-projektion skal hente elevation_profile (#6594),
// ellers bruger etapeside 2.0 altid syntesen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchStageProfiles, STAGE_PROFILE_BASE_COLUMNS, STAGE_PROFILE_COLUMNS } from "./stageProfilesQuery.ts";
import { elevationSeries, type StageProfile } from "./stagePageV2Model.ts";

type Res = { data: unknown[] | null; error: { code?: string; message?: string } | null };

function fakeClient(respond: (cols: string) => Res) {
  const calls: Array<{ table: string; cols: string; eq: [string, unknown]; order: string }> = [];
  const client = {
    from(table: string) {
      return {
        select(cols: string) {
          return {
            eq(col: string, value: unknown) {
              return {
                order(orderCol: string) {
                  calls.push({ table, cols, eq: [col, value], order: orderCol });
                  return Promise.resolve(respond(cols));
                },
              };
            },
          };
        },
      };
    },
  };
  return { client, calls };
}

const ROW: StageProfile = {
  race_id: "r1", stage_number: 1, profile_type: "hilly", distance_km: 2, elevation_gain_m: 40,
  climbs: [{ name: "Climb A", category: "4", crest_km: 2, length_km: 1, avg_gradient: 4 }],
  sprints: [], sectors: [],
  elevation_profile: { v: 1, step_km: 0.5, h: [100, 100, 110, 120, 140] },
};

test("fetchStageProfiles: projektionen henter elevation_profile, og den rigtige serie bruges", async () => {
  const { client, calls } = fakeClient(() => ({ data: [ROW], error: null }));
  const { data, error } = await fetchStageProfiles(client, "r1");
  assert.equal(error, null);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].table, "race_stage_profiles");
  assert.ok(calls[0].cols.split(",").map((c) => c.trim()).includes("elevation_profile"));
  assert.deepEqual(calls[0].eq, ["race_id", "r1"]);
  assert.equal(calls[0].order, "stage_number");
  const series = elevationSeries((data as StageProfile[])[0]);
  assert.equal(series?.source, "profile");
  assert.deepEqual(series?.hs, [100, 100, 110, 120, 140]);
});

test("fetchStageProfiles: tom kolonne (null) giver syntesen for netop den etape", async () => {
  const { client } = fakeClient(() => ({ data: [{ ...ROW, elevation_profile: null }], error: null }));
  const { data } = await fetchStageProfiles(client, "r1");
  assert.equal(elevationSeries((data as StageProfile[])[0])?.source, "synthetic");
});

test("fetchStageProfiles: kolonnen ikke migreret endnu (42703) → laeses uden serien", async () => {
  const { client, calls } = fakeClient((cols) =>
    cols.includes("elevation_profile")
      ? { data: null, error: { code: "42703", message: "column does not exist" } }
      : { data: [{ ...ROW, elevation_profile: undefined }], error: null });
  const { data, error } = await fetchStageProfiles(client, "r1");
  assert.equal(error, null);
  assert.deepEqual(calls.map((c) => c.cols), [STAGE_PROFILE_COLUMNS, STAGE_PROFILE_BASE_COLUMNS]);
  assert.equal(elevationSeries((data as StageProfile[])[0])?.source, "synthetic");
});

test("fetchStageProfiles: andre fejl proeves ikke igen", async () => {
  const { client, calls } = fakeClient(() => ({ data: null, error: { code: "42501", message: "denied" } }));
  const { error } = await fetchStageProfiles(client, "r1");
  assert.equal(error?.code, "42501");
  assert.equal(calls.length, 1);
});
