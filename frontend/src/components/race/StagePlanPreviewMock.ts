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
  // #7706: et mislykket forsoeg og et led der ikke blev naaet, saa alle markeringer kan ses.
  "rider-1": [{ task: "breakaway" }, { task: "attack", from: { at: "final_km" } }, { task: "ride_in", from: { at: "dropped" } }],
};

/** team-orders-svaret med planen slaaet til og etape 2's gemte planer. */
type OrderRow = { stage_number: number } & Record<string, unknown>;

// #7855: troejejagten paa preview (`?stagePlan=1&jerseyHunt=1`). Kontakten er slukket i prod;
// ejeren skal kunne se opgaverne foer et "koer". Uden parameteren er alt som foer.
const JERSEY_HUNT_STORAGE_KEY = "cz-preview-jersey-hunt";
export function jerseyHuntPreviewActive() {
  try {
    if (typeof window === "undefined") return false;
    if (new URLSearchParams(window.location.search).get("jerseyHunt") === "1") {
      window.sessionStorage.setItem(JERSEY_HUNT_STORAGE_KEY, "1");
      return true;
    }
    return window.sessionStorage.getItem(JERSEY_HUNT_STORAGE_KEY) === "1";
  } catch {
    return false; // storage kan vaere blokeret; preview uden override
  }
}
/** #7855: `?jerseyHunt=off` overlever at siden rydder sin URL (samme greb som de to andre). */
function jerseyHuntPreviewSavedOff() {
  try {
    if (typeof window === "undefined") return false;
    if (new URLSearchParams(window.location.search).get("jerseyHunt") === "off") window.sessionStorage.setItem("cz-preview-jersey-hunt-off", "1");
    return window.sessionStorage.getItem("cz-preview-jersey-hunt-off") === "1";
  } catch {
    return false; // storage kan vaere blokeret; preview uden override
  }
}
// Etape 3 (den aabne, spurt ved km 80, stigning ved km 130): en hjaelper henter point frem til stigningen.
const STAGE_3_HUNT_PLANS = {
  "rider-96": [{ task: "hunt_points" }, { task: "shelter_leader", from: { at: "kom", kom_index: 0 } }],
};

export function withStagePlanPreview<T extends { orders?: OrderRow[] }>(body: T): T & { stage_plan_enabled: true } {
  const stage2 = (body.orders ?? []).find((o: OrderRow) => o.stage_number === 2);
  const riders = Object.entries(STAGE_2_PLANS).map(([rider_id, plan]) => ({ rider_id, effort: "normal", try_break: false, leadout: false, plan }));
  const on = jerseyHuntPreviewActive();
  // `?jerseyHunt=off`: planen er gemt, men kontakten er slukket igen (boardet viser planen uden jagt).
  const savedOff = jerseyHuntPreviewSavedOff();
  const hunt = on || savedOff;
  const stage3 = (body.orders ?? []).find((o: OrderRow) => o.stage_number === 3);
  const huntRiders = Object.entries(STAGE_3_HUNT_PLANS).map(([rider_id, plan]) => ({ rider_id, effort: "protect", try_break: false, leadout: false, plan }));
  return {
    ...body,
    stage_plan_enabled: true,
    ...(on && !savedOff ? { jersey_hunt_7855: true } : {}),
    orders: [
      ...(body.orders ?? []).filter((o: OrderRow) => o.stage_number !== 2 && !(hunt && o.stage_number === 3)),
      { ...(stage2 ?? { stage_number: 2, breakaway_stance: "neutral", locked_at: null, updated_at: "2026-09-05T09:00:00.000Z" }), riders },
      ...(hunt ? [{ ...(stage3 ?? { stage_number: 3, breakaway_stance: "neutral", locked_at: null, updated_at: "2026-09-05T09:00:00.000Z" }), riders: [...(((stage3?.riders as unknown[]) ?? []).filter((r) => !(String((r as Record<string, unknown>).rider_id) in STAGE_3_HUNT_PLANS))), ...huntRiders] }] : []),
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
      { km: 0, type: "stage_start", params: { field_count: 40 } },
      { km: 14, type: "breakaway_formed", params: { group_id: "breakaway-1", rider_ids: ["rider-97"] } },
      { km: 14, type: "gap_update", params: { group_id: "breakaway-1", gap_seconds: 60 } },
      { km: 30, type: "stage_plan_leg", params: { rider_id: "rider-1", leg: 2, task: "ride_in", reason: "missed_break" } },
      // #7706: samme form som motoren: faldet staar paa skiftets km, og udbruddet gaar op i feltet.
      { km: 96, type: "peloton_splits", params: { cause: "climb_deficit", group_id: "gruppetto-1", rider_ids: ["rider-96"], gap_seconds: 58, source_group_id: "peloton-0" } },
      { km: 96, type: "stage_plan_leg", params: { rider_id: "rider-96", leg: 2, task: "ride_in", reason: "dropped" } },
      { km: 138, type: "group_merged", params: { group_id: "breakaway-1", rider_ids: ["rider-97"], into_group_id: "peloton-0" } },
      { km: 138, type: "stage_plan_leg", params: { rider_id: "rider-97", leg: 1, task: "ride_for_result", reason: "caught" } },
      { km: 158, type: "stage_plan_leg", params: { rider_id: "rider-95", leg: 1, task: "ride_for_result", reason: "final_km" } },
      { km: 168, type: "finish", params: { top: [{ gap: 0, rank: 4, rider_id: "rider-95" }, { gap: 0, rank: 7, rider_id: "rider-97" }, { gap: 12, rank: 9, rider_id: "rider-1" }, { gap: 95, rank: 10, rider_id: "rider-96" }] } },
    ],
  };
}
