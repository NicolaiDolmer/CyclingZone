import test from "node:test";
import assert from "node:assert/strict";
import {
  kmToX, xToKm, buildFilmTimeline, eventsPlayedUpTo, describeEvent, climbMarkerHeight, altitudeAtKm,
  collectRiderIds,
} from "./stageTimelineFilm.js";
import { buildProfileSeries } from "./stageRouteProfile.js";
import {
  MOUNTAIN_TIMELINE, BREAKAWAY_WIN_TIMELINE, MOUNTAIN_STAGE_PROFILE, BUNCH_SPRINT_STAGE_PROFILE,
  riderNameByIdFixture,
} from "./stageTimelineFixtures.js";

// ── scrubber-tidsmapning (km ⇄ pixel) ──────────────────────────────────────

test("kmToX: 0 km → 0px, distanceKm → fuld plot-bredde", () => {
  assert.equal(kmToX(0, 168, 900), 0);
  assert.equal(kmToX(168, 168, 900), 900);
  assert.equal(kmToX(84, 168, 900), 450);
});

test("kmToX: clamper km uden for [0, distanceKm]", () => {
  assert.equal(kmToX(-10, 168, 900), 0);
  assert.equal(kmToX(200, 168, 900), 900);
});

test("kmToX: distanceKm=0 degraderer til 0 i stedet for NaN/Infinity", () => {
  assert.equal(kmToX(10, 0, 900), 0);
});

test("xToKm er den nøjagtige inverse af kmToX over hele intervallet", () => {
  const distanceKm = 174;
  const width = 900;
  for (const km of [0, 12.5, 60, 87, 173.9, 174]) {
    const x = kmToX(km, distanceKm, width);
    assert.ok(Math.abs(xToKm(x, distanceKm, width) - km) < 1e-9);
  }
});

test("xToKm clamper x uden for [0, plotWidth]", () => {
  assert.equal(xToKm(-50, 168, 900), 0);
  assert.equal(xToKm(2000, 168, 900), 168);
});

// ── buildFilmTimeline ────────────────────────────────────────────────────

test("buildFilmTimeline udelukker gap_update fra feedEvents men bevarer dem i gapCurve", () => {
  const built = buildFilmTimeline(MOUNTAIN_TIMELINE);
  assert.ok(built.feedEvents.every((e) => e.type !== "gap_update"));
  assert.ok(built.gapCurve.length > 0);
  assert.ok(built.gapCurve.every((p) => typeof p.km === "number" && typeof p.gapSeconds === "number"));
});

test("buildFilmTimeline finder catchKm fra breakaway_caught-eventet", () => {
  const built = buildFilmTimeline(MOUNTAIN_TIMELINE);
  assert.equal(built.catchKm, 146);
});

test("buildFilmTimeline: catchKm er null når udbruddet overlever (ingen catch-event)", () => {
  const built = buildFilmTimeline(BREAKAWAY_WIN_TIMELINE);
  assert.equal(built.catchKm, null);
});

test("buildFilmTimeline: gap-kurvens slutpunkt matcher konsistensregel 2 (caught → 0 ved catchKm)", () => {
  const built = buildFilmTimeline(MOUNTAIN_TIMELINE);
  const lastBeforeOrAtCatch = built.gapCurve.filter((p) => p.km <= built.catchKm).pop();
  assert.equal(lastBeforeOrAtCatch.gapSeconds, 0);
});

test("buildFilmTimeline udleder climbMarkers med km + kategori for scrubberens trekanter", () => {
  const built = buildFilmTimeline(MOUNTAIN_TIMELINE);
  assert.equal(built.climbMarkers.length, 2);
  assert.deepEqual(built.climbMarkers.map((c) => c.category), ["1", "HC"]);
});

test("climbMarkerHeight: HC højere end kat. 4, ukendt kategori degraderer til default", () => {
  assert.ok(climbMarkerHeight("HC") > climbMarkerHeight("4"));
  assert.equal(climbMarkerHeight(undefined), climbMarkerHeight("4"));
});

// ── eventsPlayedUpTo ─────────────────────────────────────────────────────

test("eventsPlayedUpTo: km 0 giver kun stage_start, nyeste øverst", () => {
  const built = buildFilmTimeline(MOUNTAIN_TIMELINE);
  const played = eventsPlayedUpTo(built.feedEvents, 0);
  assert.equal(played.length, 1);
  assert.equal(played[0].type, "stage_start");
});

test("eventsPlayedUpTo: ved målstregen er ALLE feed-events afspillet, seneste først", () => {
  const built = buildFilmTimeline(MOUNTAIN_TIMELINE);
  const played = eventsPlayedUpTo(built.feedEvents, built.distanceKm);
  assert.equal(played.length, built.feedEvents.length);
  assert.equal(played[0].type, "finish");
  for (let i = 1; i < played.length; i++) assert.ok(played[i].km <= played[i - 1].km);
});

test("eventsPlayedUpTo er monoton: flere afspillede events ved højere scrub-km, aldrig færre", () => {
  const built = buildFilmTimeline(MOUNTAIN_TIMELINE);
  let prevCount = 0;
  for (const km of [0, 20, 60, 100, 150, built.distanceKm]) {
    const count = eventsPlayedUpTo(built.feedEvents, km).length;
    assert.ok(count >= prevCount);
    prevCount = count;
  }
});

// ── describeEvent (broadcast-tekst-nøgler) ──────────────────────────────

test("describeEvent: ukendt event-type returnerer null (feedet springer linjen over)", () => {
  assert.equal(describeEvent({ type: "weather_shift", params: {} }), null);
  assert.equal(describeEvent(null), null);
});

test("describeEvent: finish bruger vind-type-specifik nøgle når kendt", () => {
  const finishEvent = MOUNTAIN_TIMELINE.events.find((e) => e.type === "finish");
  const d = describeEvent(finishEvent, { riderNameById: riderNameByIdFixture() });
  assert.equal(d.key, "finish_solo_win");
  assert.equal(d.params.rider, "Ada Pedersen");
});

test("describeEvent: gc_change slår begge rytternavne op fra riderNameById", () => {
  const gcEvent = BREAKAWAY_WIN_TIMELINE.events.find((e) => e.type === "gc_change");
  const d = describeEvent(gcEvent, { riderNameById: riderNameByIdFixture() });
  assert.equal(d.key, "gc_change");
  assert.equal(d.params.rider, "Sofie Lund");
  assert.equal(d.params.previousLeader, "Ada Pedersen");
});

// #4026: rå id'er må ALDRIG lække til fladen (Race Centre viste rytter-UUID'er).
// Enkeltrytter-events uden opslag skippes (null) — samme ærlig-degraderings-regel
// som ukendte event-typer; feedet viser forrige linje i stedet.
test("describeEvent: manglende rytter-opslag skipper linjen (null) — aldrig det rå id", () => {
  const d = describeEvent({ type: "finale_attack", params: { rider_id: "ghost-rider" } }, { riderNameById: new Map() });
  assert.equal(d, null);
});

test("describeEvent: gruppe-event viser kun de opløselige navne; count følger den synlige liste", () => {
  const map = new Map([["rider-2", "Mikkel Hansen"]]);
  const d = describeEvent(
    { type: "breakaway_formed", params: { rider_ids: ["rider-2", "ghost-a", "ghost-b"] } },
    { riderNameById: map },
  );
  assert.equal(d.params.riders, "Mikkel Hansen");
  assert.equal(d.params.count, 1, "count skal matche de VISTE navne (flertalsbøjning i locale-teksten)");
  assert.ok(!d.params.riders.includes("ghost"), "uopløste id'er må ikke optræde");
});

test("describeEvent: gruppe-event hvor INGEN navne kan opløses → null (ingen tom linje)", () => {
  const d = describeEvent(
    { type: "breakaway_formed", params: { rider_ids: ["ghost-a", "ghost-b"] } },
    { riderNameById: new Map() },
  );
  assert.equal(d, null);
});

test("describeEvent: gc_change med uopløselig tidligere leder skippes (halve sætninger er værre end ingen)", () => {
  const map = new Map([["rider-1", "Ada Pedersen"]]);
  const d = describeEvent(
    { type: "gc_change", params: { new_leader_id: "rider-1", previous_leader_id: "ghost" } },
    { riderNameById: map },
  );
  assert.equal(d, null);
});

test("describeEvent: breakaway_formed samler flere rytternavne kommasepareret", () => {
  const event = MOUNTAIN_TIMELINE.events.find((e) => e.type === "breakaway_formed");
  const d = describeEvent(event, { riderNameById: riderNameByIdFixture() });
  assert.equal(d.params.riders, "Mikkel Hansen, Sofie Lund");
  assert.equal(d.params.count, 2);
});

// ── collectRiderIds (#4026: batch-navnehentning før describeEvent) ────────────

test("collectRiderIds: dækker alle param-former describeEvent læser (rider_ids/rider_id/top/gc-ledere)", () => {
  const ids = collectRiderIds([
    { type: "breakaway_formed", params: { rider_ids: ["a", "b"] } },
    { type: "finale_attack", params: { rider_id: "c" } },
    { type: "kom_passage", params: { name: "Col", top: [{ rider_id: "d" }] } },
    { type: "gc_change", params: { new_leader_id: "e", previous_leader_id: "f" } },
    { type: "finish", params: { top: [{ rider_id: "a" }] } }, // dublet → én gang
    { type: "stage_start", params: { field_count: 120 } },     // ingen ryttere
  ]);
  assert.deepEqual([...ids].sort(), ["a", "b", "c", "d", "e", "f"]);
});

test("collectRiderIds: tom/manglende input degraderer til tom liste", () => {
  assert.deepEqual(collectRiderIds(null), []);
  assert.deepEqual(collectRiderIds([]), []);
  assert.deepEqual(collectRiderIds([{ type: "x" }]), []);
});

// Forward-guard (#4026): HELE fixture-tidslinjens feed kan navngives af
// collectRiderIds+map alene — dvs. describeEvent refererer aldrig et rider-id
// som collectRiderIds ikke opsamler (de to skal holdes i sync ved nye events).
test("collectRiderIds ∪ navnemap dækker alle describeEvent-linjer i fixtures (ingen skips med fuldt map)", () => {
  for (const timeline of [MOUNTAIN_TIMELINE, BREAKAWAY_WIN_TIMELINE]) {
    const described = timeline.events
      .filter((e) => e.type !== "gap_update")
      .map((e) => describeEvent(e, { riderNameById: riderNameByIdFixture() }));
    const skipped = described.filter((d) => d === null).length;
    assert.equal(skipped, 0, "fuldt navnemap → ingen skippede linjer");
  }
});

// ── altitudeAtKm (ejer-fix 17/8: events forankres PÅ den ægte rute-silhuet) ──

test("altitudeAtKm: km 0 og km distance_km rammer seriens første/sidste sample", () => {
  const series = buildProfileSeries(MOUNTAIN_STAGE_PROFILE);
  assert.equal(altitudeAtKm(series, 0), series.ys[0]);
  assert.equal(altitudeAtKm(series, series.xs[series.xs.length - 1]), series.ys[series.ys.length - 1]);
});

test("altitudeAtKm: km uden for [0, distance_km] clamper i stedet for at ekstrapolere", () => {
  const series = buildProfileSeries(MOUNTAIN_STAGE_PROFILE);
  assert.equal(altitudeAtKm(series, -20), series.ys[0]);
  assert.equal(altitudeAtKm(series, 999), series.ys[series.ys.length - 1]);
});

test("altitudeAtKm: en stignings crest_km rammer nær seriens lokale maksimum omkring den km (ikke en tilfældig lav værdi)", () => {
  const series = buildProfileSeries(MOUNTAIN_STAGE_PROFILE);
  const [climb] = MOUNTAIN_STAGE_PROFILE.climbs;
  const atCrest = altitudeAtKm(series, climb.crest_km);
  const nearby = series.ys.filter((_, i) => Math.abs(series.xs[i] - climb.crest_km) <= 4);
  assert.ok(atCrest >= Math.max(...nearby) - 1, "crest-højden bør være omkring det lokale maksimum, ikke en dalhøjde");
});

test("altitudeAtKm: interpolerer mellem to samplepunkter (ikke bare nærmeste nabo)", () => {
  const series = buildProfileSeries(MOUNTAIN_STAGE_PROFILE);
  const midKm = (series.xs[10] + series.xs[11]) / 2;
  const mid = altitudeAtKm(series, midKm);
  const lo = Math.min(series.ys[10], series.ys[11]);
  const hi = Math.max(series.ys[10], series.ys[11]);
  assert.ok(mid >= lo - 1e-6 && mid <= hi + 1e-6);
});

test("altitudeAtKm: en flad etape uden stigninger giver stadig en gyldig (ikke-syntetisk-bjergrig) serie", () => {
  const series = buildProfileSeries(BUNCH_SPRINT_STAGE_PROFILE);
  assert.equal(series.climbs.length, 0);
  const mid = altitudeAtKm(series, BUNCH_SPRINT_STAGE_PROFILE.distance_km / 2);
  assert.ok(Number.isFinite(mid));
});

test("altitudeAtKm: manglende/tom serie degraderer til null, ikke et kast", () => {
  assert.equal(altitudeAtKm(null, 50), null);
  assert.equal(altitudeAtKm({ xs: [], ys: [] }, 50), null);
});

// ── #4373: tekst-laget skal vælge tidskørsels-nøgler ───────────────────────
// "The story of the stage" hentede sin linje herfra — finish med win_type
// "sprint_win" blev til "{rider} wins the bunch sprint" på en prolog.
test("#4373 describeEvent: finish med itt_win/ttt_win får sin egen nøgle", () => {
  const names = new Map([["r1", "Lei Lin"]]);
  const finish = (winType) => describeEvent(
    { type: "finish", km: 12, params: { top: [{ rider_id: "r1", rank: 1 }], win_type: winType } },
    { riderNameById: names },
  );
  assert.equal(finish("itt_win").key, "finish_itt_win");
  assert.equal(finish("ttt_win").key, "finish_ttt_win");
  assert.equal(finish("sprint_win").key, "finish_sprint_win");
});

test("#4373 describeEvent: stage_start og favorite_crack tilpasser sig disciplinen", () => {
  const names = new Map([["r1", "Lei Lin"]]);
  const start = (profileType) => describeEvent(
    { type: "stage_start", km: 0, params: { field_count: 90, distance_km: 12, profile_type: profileType } },
    { riderNameById: names },
  );
  assert.equal(start("itt").key, "stage_start_itt");
  assert.equal(start("ttt").key, "stage_start_ttt");
  assert.equal(start("flat").key, "stage_start");
  assert.equal(start(null).key, "stage_start");

  const crack = (discipline) => describeEvent(
    { type: "favorite_crack", km: 9, params: { rider_id: "r1", reason: "jour_sans", ...(discipline ? { discipline } : {}) } },
    { riderNameById: names },
  );
  assert.equal(crack("time_trial").key, "favorite_crack_tt");
  assert.equal(crack(null).key, "favorite_crack");
});

test("#4373: alle nye event-nøgler findes i BEGGE locale-filer", async () => {
  const { readFileSync } = await import("node:fs");
  const { dirname, join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const localesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "public", "locales");
  const newKeys = ["finish_itt_win", "finish_ttt_win", "stage_start_itt", "stage_start_ttt", "favorite_crack_tt"];
  for (const lang of ["en", "da"]) {
    const doc = JSON.parse(readFileSync(join(localesDir, lang, "races.json"), "utf8"));
    for (const key of newKeys) {
      assert.ok(doc.detail.film.event[key], `${lang}: mangler detail.film.event.${key}`);
    }
  }
});

// ── #2944: incident-trappen → fire udfald i spillerens sprog ────────────────

const INCIDENT_LADDER_KEYS = [
  "incident_crash_time_loss",
  "incident_crash_hard",
  "incident_crash_abandon",
  "incident_mechanical",
  "incident_mechanical_helper",
  "incident_protected",
];

test("#2944: describeEvent vælger den rigtige nøgle for hvert af trappens udfald", () => {
  const names = riderNameByIdFixture();
  const [riderId, riderName] = [...names.entries()][0];
  const describe = (params) =>
    describeEvent({ type: "incident", km: 40, params: { rider_id: riderId, ...params } }, { riderNameById: names });

  const light = describe({ kind: "crash", severity: "light", outcome: "time_loss", time_loss_seconds: 12, injury_days: null });
  assert.equal(light.key, "incident_crash_time_loss");
  assert.equal(light.params.rider, riderName);
  assert.equal(light.params.seconds, 12);

  const hard = describe({ kind: "crash", severity: "hard", outcome: "time_loss", time_loss_seconds: 140.4, injury_days: 3 });
  assert.equal(hard.key, "incident_crash_hard");
  assert.equal(hard.params.seconds, 140);
  assert.equal(hard.params.days, 3);

  const abandon = describe({ kind: "crash", severity: "serious", outcome: "abandoned", time_loss_seconds: null, injury_days: 9 });
  assert.equal(abandon.key, "incident_crash_abandon");
  assert.equal(abandon.params.days, 9);

  const mechanical = describe({ kind: "mechanical", severity: null, outcome: "time_loss", time_loss_seconds: 60, helper_assist: false });
  assert.equal(mechanical.key, "incident_mechanical");

  const helped = describe({ kind: "mechanical", severity: null, outcome: "time_loss", time_loss_seconds: 27, helper_assist: true });
  assert.equal(helped.key, "incident_mechanical_helper");
  assert.equal(helped.params.seconds, 27);

  const protectedByRule = describe({ kind: "crash", severity: "light", outcome: "protected_three_km_rule", time_loss_seconds: null });
  assert.equal(protectedByRule.key, "incident_protected");
});

test("#2944: et gammelt incident-event uden alvorsakse falder tilbage på den oprindelige nøgle", () => {
  const names = riderNameByIdFixture();
  const [riderId] = [...names.keys()];
  const legacy = describeEvent(
    { type: "incident", km: 40, params: { rider_id: riderId, kind: "mechanical", outcome: "time_loss", time_loss_seconds: 30 } },
    { riderNameById: names },
  );
  assert.equal(legacy.key, "incident", "v3-events (uden severity) skal beholde den art-only sætning");
  assert.equal(legacy.params.kind, "mechanical");
});

test("#2944: alle trappens nøgler findes i BEGGE locale-filer", async () => {
  const { readFileSync } = await import("node:fs");
  const { dirname, join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const localesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "public", "locales");
  for (const lang of ["en", "da"]) {
    const doc = JSON.parse(readFileSync(join(localesDir, lang, "races.json"), "utf8"));
    for (const key of INCIDENT_LADDER_KEYS) {
      assert.ok(doc.detail.film.event[key], `${lang}: mangler detail.film.event.${key}`);
    }
  }
});

// ── #4879: filmen skal kunne læse løbsmotor v4's EGNE events ────────────────
// v4's tidslinje persisteres nu under timeline_version 2 i den samme tabel
// (backend/lib/raceTimeline.js buildStageTimelineV4). Motorens param-former er
// ikke identiske med v3's, og en linje filmen ikke forstår springes tavst over
// — derfor låses de her.

test("#4879: v4's sprint_decided navngiver vinderen via winner_rider_id", () => {
  const names = riderNameByIdFixture();
  const [riderId] = [...names.keys()];
  const d = describeEvent(
    { type: "sprint_decided", km: 180, params: { winner_rider_id: riderId, group_id: "finale-winner-0", finale_type: "bunch_sprint" } },
    { riderNameById: names },
  );
  assert.ok(d, "v4-formen må ikke springes over");
  assert.equal(d.key, "sprint_decided");
  assert.equal(d.params.rider, names.get(riderId));
});

test("#4879: v3's sprint_decided (rider_ids) virker uændret", () => {
  const names = riderNameByIdFixture();
  const [riderId] = [...names.keys()];
  const d = describeEvent(
    { type: "sprint_decided", km: 180, params: { rider_ids: [riderId], photo_finish: true } },
    { riderNameById: names },
  );
  assert.equal(d.key, "sprint_decided_photo");
  assert.equal(d.params.rider, names.get(riderId));
});

test("#2582: tidsgrænse-events rendres som tælletal — ALDRIG procent eller sekundgrænse", () => {
  const otl = describeEvent(
    { type: "outside_time_limit", km: 180, params: { rider_ids: ["a", "b", "c"], rider_count: 3 } },
    { riderNameById: new Map() },
  );
  assert.equal(otl.key, "outside_time_limit");
  assert.deepEqual(otl.params, { count: 3 });

  const saved = describeEvent(
    { type: "grupetto_saved", km: 180, params: { rider_ids: ["a", "b"], rider_count: 2 } },
    { riderNameById: new Map() },
  );
  assert.equal(saved.key, "grupetto_saved");
  assert.deepEqual(saved.params, { count: 2 });

  // Et event uden ryttere er ikke en historie — ingen tom linje i feedet.
  assert.equal(describeEvent({ type: "outside_time_limit", km: 180, params: { rider_ids: [], rider_count: 0 } }), null);
});

test("#2582: tidsgrænse-nøglerne findes i BEGGE locale-filer", async () => {
  const { readFileSync } = await import("node:fs");
  const { dirname, join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const localesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "public", "locales");
  for (const lang of ["en", "da"]) {
    const doc = JSON.parse(readFileSync(join(localesDir, lang, "races.json"), "utf8"));
    for (const key of ["outside_time_limit", "grupetto_saved"]) {
      assert.ok(doc.detail.film.event[key], `${lang}: mangler detail.film.event.${key}`);
      assert.ok(
        !/%|procent|percent/i.test(doc.detail.film.event[key]),
        `${lang}: ${key} må ALDRIG vise procenten (fog of war, ejer-beslutning 6/9)`,
      );
    }
  }
});

test("#4879: collectRiderIds fanger v4's winner_rider_id (ellers skippes spurt-linjen tavst)", () => {
  const ids = collectRiderIds([
    { type: "sprint_decided", km: 180, params: { winner_rider_id: "w1", group_id: "g" } },
    { type: "finish", km: 180, params: { top: [{ rider_id: "w1", rank: 1, gap: 0 }] } },
  ]);
  assert.deepEqual(ids, ["w1"]);
});

// ── M13: holdtidskørslen (#3463) ─────────────────────────────────────────

const TTT_TIMELINE = {
  distanceKm: 40,
  events: [
    { type: "stage_start", km: 0, params: { field_count: 160, profile_type: "ttt", distance_km: 40 } },
    { type: "ttt_rider_dropped", km: 12, params: { team_id: "t1", rider_id: "r9", group_id: "ttt-t1" } },
    { type: "gap_update", km: 20, params: { group_id: "ttt-t1", gap_seconds: 18 } },
    { type: "gap_update", km: 20, params: { group_id: "ttt-t2", gap_seconds: 4 } },
    { type: "ttt_team_result", km: 40, params: { team_id: "t1", group_id: "ttt-t1", time_seconds: 3018, counted_rider_id: "r5", dropped_rider_ids: ["r9"] } },
    { type: "ttt_team_result", km: 40, params: { team_id: "t2", group_id: "ttt-t2", time_seconds: 3000, counted_rider_id: "r1", dropped_rider_ids: [] } },
    { type: "finish", km: 40, params: { top: [{ rider_id: "r1", rank: 1, gap: 0 }], win_type: "ttt_win" } },
  ],
};

test("#3463: ttt_team_result er data, ikke en feed-linje — ét hold pr. linje ville være en mur", () => {
  const built = buildFilmTimeline(TTT_TIMELINE);
  assert.equal(built.feedEvents.filter((e) => e.type === "ttt_team_result").length, 0);
  // ...men de bliver stående i den fulde event-liste (holdenes officielle tider).
  assert.equal(built.events.filter((e) => e.type === "ttt_team_result").length, 2);
});

test("#3463: ingen gap-kurve på en tidskørsel — der er intet felt at måle afstand til", () => {
  assert.deepEqual(buildFilmTimeline(TTT_TIMELINE).gapCurve, []);
  const itt = { ...TTT_TIMELINE, events: TTT_TIMELINE.events.map((e) => (e.type === "stage_start" ? { ...e, params: { ...e.params, profile_type: "itt" } } : e)) };
  assert.deepEqual(buildFilmTimeline(itt).gapCurve, []);
  // Regressionsvagt: massestarts-etaper beholder kurven.
  assert.ok(buildFilmTimeline(MOUNTAIN_TIMELINE).gapCurve.length > 0);
});

test("#3463: en droppet rytter får en broadcast-linje, uden rå id og uden tal", () => {
  const described = describeEvent(
    { type: "ttt_rider_dropped", km: 12, params: { team_id: "t1", rider_id: "r9" } },
    { riderNameById: new Map([["r9", "Jonas Vinge"]]) },
  );
  assert.deepEqual(described, { key: "ttt_rider_dropped", params: { rider: "Jonas Vinge" } });
  // Uden navn: ingen linje (samme #4026-regel som resten af feedet).
  assert.equal(describeEvent({ type: "ttt_rider_dropped", km: 12, params: { rider_id: "r9" } }, { riderNameById: new Map() }), null);
});

test("#3463: ttt-nøglerne findes i BEGGE locale-filer og lækker ingen tal", async () => {
  const { readFileSync } = await import("node:fs");
  const { dirname, join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const localesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "public", "locales");
  for (const lang of ["en", "da"]) {
    const doc = JSON.parse(readFileSync(join(localesDir, lang, "races.json"), "utf8"));
    for (const key of ["ttt_rider_dropped", "stage_start_ttt", "finish_ttt_win"]) {
      assert.ok(doc.detail.film.event[key], `${lang}: mangler detail.film.event.${key}`);
    }
    assert.ok(
      !/\{seconds\}|\{gap\}|%/.test(doc.detail.film.event.ttt_rider_dropped),
      `${lang}: ttt_rider_dropped må ikke vise tempo, tid eller procenter (fog of war)`,
    );
  }
});
