// #7003: preview-override for etapeplanen (KUN preview-mocken, aldrig prod).
//
// Flaget stage_plan_v1 er off, og motor-revisionen s5_profiles_v3 er slukket, saa
// ingen kan se planen i prod. Ejeren skal kunne se og klikke den paa preview foer
// et flip ("ejeren tester paa preview foer live"): aabn en loebsside med
// `?stagePlan=1`, saa svarer mocken som om planen var slaaet til for loebet.
// Uden parameteren er alt uaendret, saa Playwright-snapshots ikke flytter sig.
//
// Etape 2 i "race-live-1" er koert med en gemt plan og en tidslinje med motorens
// stage_plan_leg-events, saa opsummeringen efter etapen kan ses. Opdigtede
// preview-data (seedData.js' ryttere), ingen spillerdata.

const STORAGE_KEY = "cz-preview-stage-plan";

export function stagePlanPreviewActive() {
  try {
    if (typeof window === "undefined") return false;
    if (new URLSearchParams(window.location.search).get("stagePlan") === "1") {
      window.sessionStorage.setItem(STORAGE_KEY, "1");
      return true;
    }
    return window.sessionStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false; // storage kan vaere blokeret; preview uden override
  }
}

// Etape 2 (kuperet, Colle di Anteprima ved km 121): gemte planer.
const STAGE_2_PLANS = {
  "rider-97": [{ task: "breakaway" }, { task: "ride_for_result", from: { at: "dropped" } }],
  "rider-96": [{ task: "shelter_leader" }, { task: "tempo", from: { at: "kom", kom_index: 0 } }, { task: "ride_in", from: { at: "dropped" } }],
  "rider-95": [{ task: "stay_sheltered" }, { task: "ride_for_result", from: { at: "final_km" } }],
};

/** team-orders-svaret med planen slaaet til og etape 2's gemte planer. */
export function withStagePlanPreview(body) {
  const stage2 = (body.orders ?? []).find((o) => o.stage_number === 2);
  const riders = Object.entries(STAGE_2_PLANS).map(([rider_id, plan]) => ({ rider_id, effort: "normal", try_break: false, leadout: false, plan }));
  return {
    ...body,
    stage_plan_enabled: true,
    orders: [
      ...(body.orders ?? []).filter((o) => o.stage_number !== 2),
      { ...(stage2 ?? { stage_number: 2, breakaway_stance: "neutral", locked_at: null, updated_at: "2026-09-05T09:00:00.000Z" }), riders },
    ],
  };
}

/** Tidslinjen for etape 2 (kun planens skift + et udbrud, nok til opsummeringen). */
export function stagePlanPreviewTimeline() {
  return {
    timeline_version: 2,
    stage_number: 2,
    created_at: "2026-06-24T15:30:00.000Z",
    events: [
      { km: 0, type: "stage_start", params: {} },
      { km: 14, type: "breakaway_formed", params: { group_id: "breakaway-1", rider_ids: ["rider-97"] } },
      { km: 96, type: "stage_plan_leg", params: { rider_id: "rider-96", leg: 2, task: "ride_in", reason: "dropped" } },
      { km: 138, type: "stage_plan_leg", params: { rider_id: "rider-97", leg: 1, task: "ride_for_result", reason: "caught" } },
      { km: 158, type: "stage_plan_leg", params: { rider_id: "rider-95", leg: 1, task: "ride_for_result", reason: "final_km" } },
      { km: 168, type: "finish", params: {} },
    ],
  };
}
