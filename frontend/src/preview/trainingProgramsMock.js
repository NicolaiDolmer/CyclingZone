// #4629 · preview-mock for /api/training/programs (Program-fanen, beta 26/9).
//
// Bevidst KUN i installPreviewMock.js og ikke i mockHandlers.js: Playwright-
// fixtures deler mockHandlers, og en ny Program-fane ville flytte de
// eksisterende /training-snapshots. Her er funktionen ON (preview-override af den
// aegte beta-gate), saa ejeren kan se og gennemklikke den paa preview foer
// flaget flyttes. ?programs=off giver dagens Ugeplan-fane til et foer/efter-par.
//
// KATALOGET er en KOPI af backend/lib/trainingPrograms.js (preview kan ikke
// importere backend-kode). Kopien holdes aerlig af en drift-test:
// backend/lib/trainingPrograms.previewDrift.test.js fejler hvis de to afviger.

const SLOTS = 5;
const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const INTENSITY = {
  rest: "rest", recovery: "recovery", technique: "easy", aero: "easy", loebslaere: "easy", endurance: "easy",
  tempo: "normal", vo2max: "hard", vo2max_climb: "hard", vo2max_punch: "hard", threshold: "hard", sprint: "hard",
  cobbled_sectors: "hard", echelon_drills: "hard", attack_repeats: "hard",
};

export const PREVIEW_TRAINING_PROGRAMS = [
  {"key":"sprinter","name":{"en":"Sprinter","da":"Sprinter"},"tagline":{"en":"Sprint twice a week with easy days in between, so the finish stays fast.","da":"Sprint to gange om ugen med rolige dage imellem, så afslutningen forbliver hurtig."},"targetTypes":["sprinter"],"audience":null,"days":{"mon":"sprint","tue":"endurance","wed":"echelon_drills","thu":"recovery","fri":"sprint","sat":"endurance","sun":"rest"}},
  {"key":"hill_climber","name":{"en":"Hill climber","da":"Bakkerytter"},"tagline":{"en":"Climbing intervals three times a week for riders who win uphill.","da":"Klatreintervaller tre gange om ugen til ryttere der vinder op ad bakke."},"targetTypes":["climber"],"audience":null,"days":{"mon":"vo2max","tue":"vo2max_climb","wed":"recovery","thu":"vo2max","fri":"vo2max_climb","sat":"endurance","sun":"rest"}},
  {"key":"cobbles_rider","name":{"en":"Cobbles rider","da":"Brostensrytter"},"tagline":{"en":"Three technique days, two long rides and one hard day on the cobbles.","da":"Tre teknikdage, to lange ture og én hård dag på brostenene."},"targetTypes":["brostensrytter"],"audience":null,"days":{"mon":"technique","tue":"endurance","wed":"technique","thu":"endurance","fri":"technique","sat":"cobbled_sectors","sun":"rest"}},
  {"key":"gc_rider","name":{"en":"GC rider","da":"GC-rytter"},"tagline":{"en":"Intervals, threshold and climbing for riders who have to last three weeks.","da":"Intervaller, tærskel og klatring til ryttere der skal holde i tre uger."},"targetTypes":["gc"],"audience":null,"days":{"mon":"vo2max","tue":"threshold","wed":"vo2max_climb","thu":"recovery","fri":"vo2max","sat":"endurance","sun":"rest"}},
  {"key":"all_rounder","name":{"en":"All-rounder","da":"Rouleur"},"tagline":{"en":"Tempo, aero and crosswind work for the rider who does a bit of everything.","da":"Tempo, aero og sidevind til rytteren der kan lidt af det hele."},"targetTypes":["rouleur"],"audience":null,"days":{"mon":"tempo","tue":"aero","wed":"echelon_drills","thu":"threshold","fri":"recovery","sat":"endurance","sun":"rest"}},
  {"key":"puncheur","name":{"en":"Puncheur","da":"Puncheur"},"tagline":{"en":"Short, hard efforts for steep finishes and late attacks.","da":"Korte, hårde tag til stejle afslutninger og sene angreb."},"targetTypes":["puncheur"],"audience":null,"days":{"mon":"vo2max_punch","tue":"attack_repeats","wed":"recovery","thu":"vo2max","fri":"attack_repeats","sat":"endurance","sun":"rest"}},
  {"key":"breakaway","name":{"en":"Breakaway rider","da":"Baroudeur"},"tagline":{"en":"Threshold, race craft and attacks for riders who go early.","da":"Tærskel, løbslære og angreb til ryttere der kører tidligt væk."},"targetTypes":["baroudeur"],"audience":null,"days":{"mon":"threshold","tue":"loebslaere","wed":"endurance","thu":"attack_repeats","fri":"recovery","sat":"tempo","sun":"rest"}},
  {"key":"classics","name":{"en":"Classics rider","da":"Klassikerrytter"},"tagline":{"en":"Cobbles, crosswinds and punch for the one-day races in spring.","da":"Brosten, sidevind og punch til forårets endagsløb."},"targetTypes":["brostensrytter","puncheur"],"audience":null,"days":{"mon":"cobbled_sectors","tue":"endurance","wed":"echelon_drills","thu":"recovery","fri":"vo2max_punch","sat":"tempo","sun":"rest"}},
  {"key":"time_trial","name":{"en":"Time triallist","da":"TT-specialist"},"tagline":{"en":"Threshold and aero position for the race against the clock.","da":"Tærskel og aerostilling til løbet mod uret."},"targetTypes":["tt"],"audience":null,"days":{"mon":"threshold","tue":"aero","wed":"recovery","thu":"threshold","fri":"endurance","sat":"echelon_drills","sun":"rest"}},
  {"key":"build_base","name":{"en":"Build base","da":"Byg base"},"tagline":{"en":"Long, easy volume that builds the foundation for everything else.","da":"Lange, rolige kilometer der bygger fundamentet til alt det andet."},"targetTypes":[],"audience":"all","days":{"mon":"endurance","tue":"technique","wed":"endurance","thu":"recovery","fri":"endurance","sat":"tempo","sun":"rest"}},
  {"key":"recovery_week","name":{"en":"Recovery week","da":"Restitutionsuge"},"tagline":{"en":"A light week that brings fatigue down before the next block.","da":"En let uge der får trætheden ned før næste blok."},"targetTypes":[],"audience":"all","days":{"mon":"recovery","tue":"recovery","wed":"technique","thu":"recovery","fri":"rest","sat":"recovery","sun":"rest"}},
  {"key":"technical_focus","name":{"en":"Technical focus","da":"Teknisk fokus"},"tagline":{"en":"Technique, aero and race craft, light on the legs.","da":"Teknik, aero og løbslære, let for benene."},"targetTypes":[],"audience":"allYouth","days":{"mon":"technique","tue":"aero","wed":"loebslaere","thu":"technique","fri":"recovery","sat":"endurance","sun":"rest"}},
  {"key":"balanced_week","name":{"en":"Balanced week","da":"Afbalanceret uge"},"tagline":{"en":"A bit of everything: endurance, technique, tempo and one interval day.","da":"Lidt af det hele: udholdenhed, teknik, tempo og én intervaldag."},"targetTypes":[],"audience":"all","days":{"mon":"endurance","tue":"technique","wed":"tempo","thu":"recovery","fri":"vo2max","sat":"endurance","sun":"rest"}},
  {"key":"hard_block","name":{"en":"Hard block","da":"Hård blok"},"tagline":{"en":"A demanding week of intervals and threshold for riders in good shape.","da":"En krævende uge med intervaller og tærskel til ryttere i god form."},"targetTypes":[],"audience":"experienced","days":{"mon":"vo2max","tue":"threshold","wed":"recovery","thu":"vo2max","fri":"recovery","sat":"tempo","sun":"rest"}},
  {"key":"active_recovery","name":{"en":"Active recovery block","da":"Aktiv restitutionsblok"},"tagline":{"en":"Mostly recovery rides with a few light days to keep the legs moving.","da":"Mest restitution med et par lette dage, så benene bliver ved med at køre."},"targetTypes":[],"audience":"all","days":{"mon":"recovery","tue":"endurance","wed":"recovery","thu":"technique","fri":"recovery","sat":"endurance","sun":"rest"}},
  {"key":"youth_development","name":{"en":"Youth development","da":"Ungdomsopbygning"},"tagline":{"en":"Skills and endurance first, no hard days.","da":"Færdigheder og udholdenhed først, ingen hårde dage."},"targetTypes":[],"audience":"youth","days":{"mon":"technique","tue":"endurance","wed":"aero","thu":"endurance","fri":"loebslaere","sat":"tempo","sun":"rest"}},
  {"key":"peak_week","name":{"en":"Peak week","da":"Topformuge"},"tagline":{"en":"Sharpen with intervals, then rest before the goal race.","da":"Skærp med intervaller, og hvil så før målløbet."},"targetTypes":[],"audience":"all","days":{"mon":"vo2max","tue":"recovery","wed":"threshold","thu":"recovery","fri":"rest","sat":"tempo","sun":"rest"}},
  {"key":"every_other_day","name":{"en":"Every other day","da":"Hver anden dag"},"tagline":{"en":"Hard and easy days in turn, so every hard day starts fresh.","da":"Hårde og lette dage på skift, så hver hård dag starter frisk."},"targetTypes":[],"audience":"all","days":{"mon":"vo2max","tue":"recovery","wed":"threshold","thu":"recovery","fri":"vo2max","sat":"endurance","sun":"rest"}},
  {"key":"race_rest","name":{"en":"Race rest","da":"Løbshvile"},"tagline":{"en":"Mostly rest for riders with many race days in their legs.","da":"Mest hvile til ryttere med mange løbsdage i benene."},"targetTypes":[],"audience":"manyRaceDays","days":{"mon":"rest","tue":"recovery","wed":"vo2max","thu":"rest","fri":"endurance","sat":"rest","sun":"recovery"}},
  {"key":"six_and_one","name":{"en":"Six and one","da":"Seks-og-én"},"tagline":{"en":"Six training days and one rest day for young talents with few races.","da":"Seks træningsdage og én hviledag til unge talenter med få løb."},"targetTypes":[],"audience":"youngStars","days":{"mon":"vo2max","tue":"threshold","wed":"vo2max","thu":"tempo","fri":"vo2max","sat":"endurance","sun":"rest"}},
  {"key":"veteran_maintenance","name":{"en":"Veteran maintenance","da":"Veteranvedligehold"},"tagline":{"en":"More rest and steady work to keep an older rider going.","da":"Mere hvile og jævnt arbejde, så en ældre rytter holder niveauet."},"targetTypes":[],"audience":"veterans","days":{"mon":"rest","tue":"endurance","wed":"threshold","thu":"recovery","fri":"endurance","sat":"rest","sun":"recovery"}},
  {"key":"youth_push","name":{"en":"Youth push","da":"Ungdomsfremdrift"},"tagline":{"en":"Intervals and sprint for juniors, U23 riders and the academy.","da":"Intervaller og sprint til juniorer, U23-ryttere og akademiet."},"targetTypes":[],"audience":"youthSquads","days":{"mon":"vo2max","tue":"sprint","wed":"vo2max","thu":"recovery","fri":"vo2max","sat":"threshold","sun":"rest"}},
];

export function previewTrainingProgramsEnabled() {
  try {
    const param = new URLSearchParams(window.location.search).get("programs");
    if (param === "on") localStorage.setItem("cz_mock_programs", "1");
    if (param === "off") localStorage.setItem("cz_mock_programs", "0");
    return localStorage.getItem("cz_mock_programs") !== "0";
  } catch {
    return true;
  }
}

// Loebsdags-kolonnerne paa preview: ?raceDays=5 viser gitteret med 5 loebsdage
// (som naar training_tick_per_race_day er on). Default = dagens ene kolonne.
export function previewDayCloseOverride() {
  try {
    const param = new URLSearchParams(window.location.search).get("raceDays");
    if (param === "5") localStorage.setItem("cz_mock_race_days", "5");
    if (param === "1") localStorage.setItem("cz_mock_race_days", "1");
    if (localStorage.getItem("cz_mock_race_days") !== "5") return null;
    return { open: false, reason: "before_window", gameDays: [10, 11, 12, 13, 14], opensAtHour: 20 };
  } catch {
    return null;
  }
}

const assigned = {};

function copyOf(program) {
  return Object.fromEntries(WEEKDAYS.map((w) => [w, { session: program.days[w], intensity: INTENSITY[program.days[w]] }]));
}

// Statefuld: tildeling/celle-rettelse muterer seedTraining.riderWeekPlans, saa
// /api/training/me viser planen bagefter (samme kilde som i prod).
export function trainingProgramsMockRoute(method, pathname, body, seedTraining) {
  if (!/^\/api\/training\/programs(\/|$)/.test(pathname)) return null;
  if (!previewTrainingProgramsEnabled()) {
    return method === "GET" ? { status: 200, body: { enabled: false } } : { status: 404, body: { error: "not_found" } };
  }
  seedTraining.riderWeekPlans ??= {};
  const riderIds = Object.keys(seedTraining.condition ?? {});
  if (method === "GET" && /\/programs\/?$/.test(pathname)) {
    return { status: 200, body: { enabled: true, slots: SLOTS, catalog: PREVIEW_TRAINING_PROGRAMS, assigned: { ...assigned } } };
  }
  if (method === "POST" && pathname.endsWith("/apply")) {
    const program = PREVIEW_TRAINING_PROGRAMS.find((p) => p.key === body?.programKey);
    if (!program) return { status: 400, body: { error: "invalid_program" } };
    const targets = body?.target === "squad" ? riderIds : riderIds.filter((id) => id === body?.target);
    for (const id of targets) {
      seedTraining.riderWeekPlans[id] = copyOf(program);
      assigned[id] = program.key;
    }
    return { status: 200, body: { ok: true, applied: targets.length, programKey: program.key } };
  }
  if (method === "PUT" && pathname.endsWith("/cell")) {
    const days = seedTraining.riderWeekPlans[body?.riderId];
    if (!days?.[body?.weekday]?.session) return { status: 409, body: { error: "no_program" } };
    const entry = { ...days[body.weekday] };
    if (body.slotIndex == null) {
      entry.session = body.session;
      entry.intensity = INTENSITY[body.session];
    } else {
      const slots = Array.from({ length: SLOTS }, (_, i) => entry.slots?.[i] ?? null);
      slots[body.slotIndex] = body.session;
      entry.slots = slots;
    }
    if (entry.slots) {
      entry.slots = entry.slots.map((s) => (s === entry.session ? null : s));
      if (entry.slots.every((s) => s == null)) delete entry.slots;
    }
    seedTraining.riderWeekPlans[body.riderId] = { ...days, [body.weekday]: entry };
    return { status: 200, body: { ok: true, riderId: body.riderId, days: seedTraining.riderWeekPlans[body.riderId] } };
  }
  return null;
}
