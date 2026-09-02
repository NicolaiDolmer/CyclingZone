// #4557 (S-M2c) · Statefuld preview-mock for aarsmoedet: GET /api/board/room
// (kill-switch-tjek for CTA'en paa Boardroom + tillids-tallet i sidehovedet),
// GET /api/board/meeting, POST /api/board/meeting/focus, POST
// /api/board/meeting/sign. Samme moenster som clubMock.js/plannerMock.js —
// in-memory state, ét modul, routet FØR den generiske /api-blok
// (installPreviewMock.js).
import boardRoomFixture from "../pages/boardroom/__fixtures__/boardRoom.json";

const SEASON_NUMBER = 4;
const ADJUSTMENTS_ALLOWED = 2;

function inDays(n) {
  return new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString();
}

// 4 realistiske maal (60/237 aktive mandater havde 4 i prod-maalingen 2/9),
// snake_case raa-felter direkte fra boardGoals.js's kontrakt (spec §4.8) —
// IKKE de camelCasede felter /board/room bruger. Goal 3 er bevidst binaer
// (no_outstanding_debt): begge options.easier/stretch er null, saa UI'en
// SKAL vise dem deaktiverede med forklaring (#3012-klassen).
function buildGoals() {
  return [
    {
      goalKey: "meeting-stage-wins",
      type: "stage_wins",
      target: 4,
      label: "Mindst 4 etapesejre i sæsonen",
      label_key: null,
      cumulative: false,
      race_scope: null,
      nationality_code: null,
      satisfaction_bonus: 6,
      satisfaction_penalty: 3,
      owner: { archetypeKey: "resultatjaegeren", name: "Jørgen Brandt", initials: "JB" },
      options: {
        easier: { target: 3, label: "Mindst 3 etapesejre i sæsonen", satisfaction_bonus: 3, satisfaction_penalty: 1.5 },
        keep: { target: 4, label: "Mindst 4 etapesejre i sæsonen", satisfaction_bonus: 6, satisfaction_penalty: 3 },
        stretch: { target: 5, label: "Mindst 5 etapesejre i sæsonen", satisfaction_bonus: 9, satisfaction_penalty: 4.5 },
      },
      reactions: {
        easier: { textKey: "archetypes.resultatjaegeren.reactions.meeting_easier.0", textFallback: "", memberName: "Jørgen Brandt" },
        stretch: { textKey: "archetypes.resultatjaegeren.reactions.meeting_stretch.0", textFallback: "", memberName: "Jørgen Brandt" },
      },
    },
    {
      goalKey: "meeting-min-u25",
      type: "min_u25_riders",
      target: 2,
      label: "Min. 2 U25-ryttere på holdet",
      label_key: null,
      cumulative: false,
      race_scope: null,
      nationality_code: null,
      satisfaction_bonus: 5,
      satisfaction_penalty: 2.5,
      owner: { archetypeKey: "ungdomsidealisten", name: "Astrid Holm", initials: "AH" },
      options: {
        easier: { target: 1, label: "Min. 1 U25-rytter på holdet", satisfaction_bonus: 2.5, satisfaction_penalty: 1.25 },
        keep: { target: 2, label: "Min. 2 U25-ryttere på holdet", satisfaction_bonus: 5, satisfaction_penalty: 2.5 },
        stretch: { target: 3, label: "Min. 3 U25-ryttere på holdet", satisfaction_bonus: 9, satisfaction_penalty: 5 },
      },
      reactions: {
        easier: { textKey: "archetypes.ungdomsidealisten.reactions.meeting_easier.0", textFallback: "", memberName: "Astrid Holm" },
        stretch: { textKey: "archetypes.ungdomsidealisten.reactions.meeting_stretch.0", textFallback: "", memberName: "Astrid Holm" },
      },
    },
    {
      goalKey: "meeting-no-debt",
      type: "no_outstanding_debt",
      target: 0,
      label: "Ingen udestående gæld ved sæsonens afslutning",
      label_key: null,
      cumulative: false,
      race_scope: null,
      nationality_code: null,
      satisfaction_bonus: 5,
      satisfaction_penalty: 3,
      owner: { archetypeKey: "sponsoraten", name: "Søren Lindqvist", initials: "SL" },
      options: {
        easier: null,
        keep: { target: 0, label: "Ingen udestående gæld ved sæsonens afslutning", satisfaction_bonus: 5, satisfaction_penalty: 3 },
        stretch: null,
      },
      reactions: { easier: null, stretch: null },
    },
    {
      goalKey: "meeting-top-n",
      type: "top_n_finish",
      target: 40,
      label: "Top 40 i klubranglisten",
      label_key: null,
      cumulative: false,
      race_scope: null,
      nationality_code: null,
      satisfaction_bonus: 5,
      satisfaction_penalty: 3,
      owner: { archetypeKey: "nationalist_purist", name: "Niels Østergaard", initials: "NO" },
      options: {
        easier: { target: 50, label: "Top 50 i klubranglisten", satisfaction_bonus: 2.5, satisfaction_penalty: 1.5 },
        keep: { target: 40, label: "Top 40 i klubranglisten", satisfaction_bonus: 5, satisfaction_penalty: 3 },
        stretch: { target: 30, label: "Top 30 i klubranglisten", satisfaction_bonus: 8, satisfaction_penalty: 4.5 },
      },
      reactions: {
        easier: { textKey: "archetypes.nationalist_purist.reactions.meeting_easier.0", textFallback: "", memberName: "Niels Østergaard" },
        stretch: { textKey: "archetypes.nationalist_purist.reactions.meeting_stretch.0", textFallback: "", memberName: "Niels Østergaard" },
      },
    },
  ];
}

function buildRequestOptions() {
  const defs = [
    ["lower_results_pressure", false, null],
    ["more_youth_focus", false, null],
    ["more_results_focus", true, "Låst i sæsonens sidste 5 løbsdage."],
    ["ease_identity_requirements", false, null],
  ];
  return defs.map(([type, disabled, reason]) => ({
    type,
    label_key: `requestDefs.${type}.label`,
    description_key: `requestDefs.${type}.description`,
    tradeoff_preview_key: `requestDefs.${type}.tradeoffPreview`,
    label: "",
    description: "",
    tradeoff_preview: "",
    disabled,
    disabled_reason: reason,
    disabled_reason_key: null,
    disabled_reason_params: {},
  }));
}

function buildVisionSlot() {
  return {
    replaces_milestone_id: "m-preview-slot",
    origin: "3yr",
    goal: {
      type: "monument_podium",
      target: 1,
      label: "Podium i et monument",
      label_key: null,
      cumulative: false,
      race_scope: "classics",
      nationality_code: null,
    },
    target_season_number: SEASON_NUMBER + 2,
    milestone_key: "vision-monument-podium-preview",
  };
}

function freshMeetingState() {
  return {
    id: "mandate-preview-meeting",
    seasonNumber: SEASON_NUMBER,
    focus: "youth_development",
    deadlineAt: inDays(5),
    adjustments: { allowed: ADJUSTMENTS_ALLOWED, used: 0 },
    trustTier: "trusted",
    goals: buildGoals(),
    requestUsed: false,
    visionSlot: buildVisionSlot(),
  };
}

let meetingState = freshMeetingState();

function buildMeetingPayload() {
  if (!meetingState) return { available: false };
  return {
    available: true,
    mandate: {
      id: meetingState.id,
      seasonNumber: meetingState.seasonNumber,
      focus: meetingState.focus,
      deadlineAt: meetingState.deadlineAt,
      adjustments: meetingState.adjustments,
      trustTier: meetingState.trustTier,
      goals: meetingState.goals,
    },
    request: { options: meetingState.requestUsed ? [] : buildRequestOptions() },
    visionSlot: meetingState.visionSlot,
  };
}

export function resetBoardMeetingMock() {
  meetingState = freshMeetingState();
}

export function boardMeetingMockRoute(method, pathname, body) {
  if (pathname.endsWith("/api/board/room")) {
    if (method !== "GET") return null;
    return { status: 200, body: boardRoomFixture };
  }

  if (pathname.endsWith("/api/board/meeting/focus")) {
    if (method !== "POST") return null;
    if (!meetingState) return { status: 404, body: { error: "Intet foreslået mandat at ændre fokus på", available: false } };
    meetingState.focus = body?.focus || meetingState.focus;
    meetingState.goals = buildGoals();
    meetingState.adjustments = { allowed: ADJUSTMENTS_ALLOWED, used: 0 };
    return { status: 200, body: buildMeetingPayload() };
  }

  if (pathname.endsWith("/api/board/meeting/sign")) {
    if (method !== "POST") return null;
    if (!meetingState) return { status: 404, body: { error: "Mandat-modellen er ikke aktiv", available: false } };
    const requestType = body?.request?.type || null;
    // Spec §4.3 · et afslag pakkes ALTID som modtilbud — mocken efterligner
    // samme kontrakt (aldrig et rent "rejected") saa "anmodning med
    // modtilbud"-e2e-testen kan verificere UI'en uden en rigtig backend.
    const requestOutcome = requestType
      ? { meeting_outcome: "counter", counter_kind: "tradeoff", request_type: requestType }
      : null;
    const visionSlotOutcome = body?.visionSlot != null
      ? { accepted: Boolean(body.visionSlot.accept) }
      : null;
    meetingState = null; // underskrevet → GET /board/meeting svarer available:false herefter
    return {
      status: 200,
      body: { ...boardRoomFixture, request_outcome: requestOutcome, vision_slot_outcome: visionSlotOutcome },
    };
  }

  if (pathname.endsWith("/api/board/meeting")) {
    if (method !== "GET") return null;
    return { status: 200, body: buildMeetingPayload() };
  }

  return null;
}
