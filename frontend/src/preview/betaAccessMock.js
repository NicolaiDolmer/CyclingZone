// #5259 · Statefuld preview-mock for beta-adgang (samme princip som
// clubMock/plannerMock): POST/PATCH muterer en in-memory tilstand, GET spejler
// den. Så et screenshot-par kan tages på ægte klik i stedet for to statiske
// payloads, og ejeren kan klikke fladen igennem på et preview uden prod-data.
//
// Bag VITE_PREVIEW_MOCK-guarden i main.jsx ⇒ prod tree-shaker hele preview/
// -mappen væk. Denne fil rører ALDRIG den ægte gate: den efterligner kun
// svarene fra /api/me/beta-access* og /api/admin/beta-* + /api/admin/feature-flags.

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "content-range": "0-0/1" },
  });
}

// Spillerens egen tilstand. "none" er startpunktet — det er den tilstand de
// fleste spillere møder, og den der har knappen ind i programmet.
let playerState = { is_beta_tester: false, request_status: null, requested_at: null, state: "none" };

let pendingRequests = [
  {
    user_id: "00000000-0000-4000-8000-000000000042",
    username: "kasper",
    email: "kasper@example.com",
    requested_at: "2026-09-17T19:20:00.000Z",
  },
];

const members = [
  { user_id: "00000000-0000-4000-8000-000000000007", username: "rita", email: "rita@example.com" },
];

// Et udsnit af stadie-kataloget, nok til at vise alle tre tilstande og et
// boolean-flag. Den kanoniske liste bor i backend/lib/stageFlagCatalog.js.
let flags = [
  { key: "board_mandate_model_enabled", area: "board", label: "Bestyrelse — mandat-modellen", stage: "beta", raw_value: "beta", boolean_only: false, configured: true, unknown_value: false },
  { key: "academy_enabled", area: "academy", label: "Akademi", stage: "on", raw_value: "on", boolean_only: false, configured: true, unknown_value: false },
  { key: "academy_intake_pull_enabled", area: "academy", label: "Akademi — træk af nye talenter", stage: "off", raw_value: "off", boolean_only: false, configured: true, unknown_value: false },
  { key: "daily_training_enabled", area: "training", label: "Daglig træning", stage: "on", raw_value: true, boolean_only: true, configured: true, unknown_value: false },
  { key: "training_score_visible", area: "training", label: "Træningsscore 1-99 (visning)", stage: "off", raw_value: "false", boolean_only: false, configured: true, unknown_value: true },
  { key: "peak_planner_enabled", area: "training", label: "Form-planlægger", stage: "beta", raw_value: "beta", boolean_only: false, configured: true, unknown_value: false },
  { key: "race_engine_v4", area: "race-engine", label: "Løbsmotor v4", stage: "off", raw_value: null, boolean_only: false, configured: false, unknown_value: false },
  { key: "stage_scheduler_enabled", area: "race-engine", label: "Etape-skemalægger", stage: "on", raw_value: "on", boolean_only: false, configured: true, unknown_value: false },
];

function readBody(init) {
  try { return init?.body ? JSON.parse(init.body) : {}; } catch { return {}; }
}

export function betaAccessMockRoute(url, method, init) {
  if (/\/api\/me\/beta-access$/.test(url) && method === "GET") return json(playerState);

  if (/\/api\/me\/beta-access\/request$/.test(url) && method === "POST") {
    playerState = {
      is_beta_tester: false,
      request_status: "pending",
      requested_at: new Date().toISOString(),
      state: "pending",
    };
    return json({ ok: true, ...playerState });
  }

  if (/\/api\/me\/beta-access\/withdraw$/.test(url) && method === "POST") {
    playerState = { is_beta_tester: false, request_status: "withdrawn", requested_at: null, state: "none" };
    return json({ ok: true, ...playerState });
  }

  if (/\/api\/admin\/beta-access$/.test(url) && method === "GET") {
    return json({ table_ready: true, pending: pendingRequests, members });
  }

  // Kontakten pr. bruger. Selve bruger-RÆKKEN kommer fra supabase-mocken i
  // mockHandlers.js og spejler IKKE dette kald, så mærket i tabellen skifter
  // ikke i preview. Ansøgnings-flowet nedenfor er det der kan klikkes igennem;
  // toggle-knappen svarer bare korrekt i stedet for at falde i den generiske
  // { ok: true } (CodeRabbit).
  if (/\/api\/admin\/users\/[^/]+\/beta$/.test(url) && method === "PATCH") {
    const wanted = readBody(init).is_beta_tester;
    if (typeof wanted !== "boolean") {
      return json({ error: "is_beta_tester must be true or false", errorCode: "beta_invalid_payload" }, 400);
    }
    return json({ success: true, is_beta_tester: wanted, username: "preview" });
  }

  const decide = url.match(/\/api\/admin\/beta-requests\/([^/]+)\/decide$/);
  if (decide && method === "POST") {
    pendingRequests = pendingRequests.filter(r => r.user_id !== decide[1]);
    return json({ ok: true, notified: true });
  }

  if (/\/api\/admin\/feature-flags$/.test(url) && method === "GET") {
    return json({ flags });
  }

  const flagPatch = url.match(/\/api\/admin\/feature-flags\/([^/?]+)$/);
  if (flagPatch && method === "PATCH") {
    const key = flagPatch[1];
    const stage = readBody(init).stage;
    if (!["off", "beta", "on"].includes(stage)) {
      return json({ error: "stage must be off, beta or on", errorCode: "flag_invalid_stage" }, 400);
    }
    flags = flags.map(f => (f.key === key ? { ...f, stage, raw_value: stage, unknown_value: false } : f));
    return json({ ok: true, key, stage });
  }

  return null;
}

/** Kun til screenshots: sæt spillerens tilstand direkte fra konsollen. */
export function setPreviewBetaState(next) {
  playerState = { ...playerState, ...next };
}
