// #6285: tre motor-tests der fanger SPILLERVENDTE fejl foer spillerne goer.
//
// Hver test har to lag:
//  1. Detektoren (samme funktion som Tour-scorecardet i
//     scripts/dev/lib/tourScorecard.mjs) skal slaa ud paa fejlens kendte form,
//     bygget syntetisk efter prod-symptomet. Det lag er altid en gate.
//  2. Motoren koeres deterministisk paa det anonymiserede Giro-felt
//     (scripts/baselines/giro-field-6088-2026-10-02.json: rigtige roller,
//     holdordrer, evner og etaper, ingen navne eller id'er) under hver
//     revision, ALLE etaper i raekkefoelge med klassementet akkumuleret som i
//     spillet (runStagesInOrder: fra etape 2 faar motoren klassementet foer
//     etapen, saa orders_gc's klassementslogik koeres). Fejlen maa ikke
//     optraede. En revision hvor fejlen er KENDT og aaben, staar i
//     KNOWN_OPEN_GATES (delt med scorecardet, som aldrig taeller den som groen)
//     og koeres som `todo` (rapporteres, blokerer ikke CI). Alle andre
//     kombinationer er en haard gate: en regression dér faelder backend-suiten
//     (npm test i CI).
//
// Fjern en linje fra KNOWN_OPEN_GATES naar fejlen er rettet i den revision, saa
// gaten bliver haard. Taersklerne er detektorernes definitioner af fejlen ("med
// minutter", "liste-gab != raa tid", "modsiger"), ikke motor-tuning.
//
// Den LIVE revision (official_times_v3, CURRENT_RACE_RULES_REVISION fra ejerens "taend", #6452)
// har ingen KNOWN_OPEN_GATES-linje og faar desuden tre haarde gates (#6285 A):
// et hold jagter aldrig sine egne (ownChaseViolations), ingen minuttab paa 0 km
// i loebsfilmen (minuteLossAtZeroKm) og intet morgenudbrud over profilens loft
// (breakawaysOverSizeCap, loftet laest fra motorens tuning). Det typiske spaend
// (tuningens `room`) gates ikke; det skrives kun til en privat rapport, naar
// CZ_6285_REPORT_DIR peger paa balance-internals/6285-live/ (hard rule 17).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  breakawaysOverSizeCap,
  breakawayWin,
  clampedAtCap,
  FLAT_BREAKAWAY_MINUTES_SECONDS,
  flatBreakawayWinWithMinutes,
  gateStatus,
  KNOWN_OPEN_GATES,
  labelContradictions,
  minuteLossAtZeroKm,
  overCapRaw,
  runStagesInOrder,
  sortedStages,
  splitEntrants,
  STAGE_GAP_CAP_SECONDS,
} from "../../scripts/dev/lib/tourScorecard.mjs";
import { ownChaseViolations } from "../../scripts/dev/ownRiderAhead6187.mjs";
import { loadRaceEngineV4 } from "../../lib/raceEngineV4Bridge.js";
import { CURRENT_RACE_RULES_REVISION } from "../../lib/raceEngineRulesRevision.ts";
import { BREAKAWAY_SIZE_V3_TUNING } from "../../lib/engine/v4/mechanics/breakawayPermission.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(here, "..", "..", "scripts", "baselines", "giro-field-6088-2026-10-02.json");
const data = JSON.parse(readFileSync(FIXTURE, "utf8"));
const stages: any[] = sortedStages(data);
const { entrants, droppedWithoutAbilities } = splitEntrants(data);
const SEEDS = 3;
const TIME_TRIALS = new Set(["itt", "itt_hilly", "ttt"]);

/** Den revision nye loeb bindes til (live fra ejerens "taend", #6452). */
const LIVE_REVISION = "official_times_v3";
/**
 * De tidligere prod-revisioner, Tour-revisionen, den officielle tidsmodel
 * (#6284), den forrige live (official_times_v2, loeb bundet til den koerer
 * faerdig paa den) og den live.
 */
const REVISIONS = ["orders_gc_v2", "orders_gc_v3", "official_times_v1", "official_times_v2", LIVE_REVISION] as const;
type Revision = (typeof REVISIONS)[number];
type Check = keyof typeof KNOWN_OPEN_GATES;

const v4 = await loadRaceEngineV4();
const teamByRider = new Map(entrants.map((e: any) => [e.rider_id, e.team_id]));
const riderIds = entrants.map((e: any) => e.rider_id);

/** Det gates skal bruge fra én etape (hele broens svar gemmes ikke). */
type StageHit = {
  stage: number;
  seed: number;
  road: boolean;
  profileType: string;
  gcStatus: string | null;
  flatMinutes: number | null;
  clamped: number;
  overCap: number;
  labels: string[];
  /** #6187: et hold jagter sine egne (antal). */
  ownChase: number;
  /** Hvor mange steder et hold kunne have jagtet sine egne (reaktioner + jagtede indhentninger). */
  chaseChances: number;
  /** #5951: minuttab paa 0 km i loebsfilmen; null = filmen kan intet vise. */
  zeroKmLoss: number | null;
  /** Morgenudbruddenes stoerrelser og dem over profilens loft (#6201). */
  breakSizes: number[];
  breakOverCap: number[];
};

const tourCache = new Map<Revision, StageHit[]>();

/** Hele loebet x SEEDS under revisionen, klassementet akkumuleret som i spillet (memoiseret pr. revision). */
function tourHits(revision: Revision): StageHit[] {
  const cached = tourCache.get(revision);
  if (cached) return cached;
  const hits: StageHit[] = [];
  for (let seed = 1; seed <= SEEDS; seed++) {
    runStagesInOrder({
      v4, data, revision, seedTag: `gate${seed}`, stages, entrants,
      onStage: ({ profile, res }: any) => {
        const road = !TIME_TRIALS.has(profile.profile_type);
        const flat = flatBreakawayWinWithMinutes(res.v4Output, profile);
        const events: any[] = res.v4Output.timeline?.events ?? [];
        const gc = events.find((e: any) => e.type === "gc_context");
        hits.push({
          stage: profile.stage_number,
          seed,
          road,
          profileType: profile.profile_type,
          gcStatus: gc?.params?.status ?? null,
          flatMinutes: flat.hit ? Math.round(flat.margin ?? 0) : null,
          clamped: road ? clampedAtCap(res.ranked, res.v4Output) : 0,
          overCap: road ? overCapRaw(res.v4Output) : 0,
          labels: road ? labelContradictions(res.ranked, res.v4Output).map((i: any) => i.kind) : [],
          ownChase: road ? ownChaseViolations(events, teamByRider).length : 0,
          chaseChances: events.filter((e: any) => (e.type === "gc_reaction" && e.params?.status === "started") || (e.type === "breakaway_caught" && (e.params?.chasing_team_ids ?? []).length > 0)).length,
          zeroKmLoss: road ? minuteLossAtZeroKm(res.timeline?.events ?? null, { riderIds }) : null,
          breakSizes: events.filter((e: any) => e.type === "breakaway_formed").map((e: any) => (e.params?.rider_ids ?? []).length),
          breakOverCap: road ? breakawaysOverSizeCap(res.v4Output, profile) : [],
        });
      },
    });
  }
  tourCache.set(revision, hits);
  return hits;
}

const where = (h: StageHit) => `etape ${h.stage} seed ${h.seed}`;

function revisionCase(check: Check, revision: Revision) {
  return gateStatus(check, revision) === "todo" ? { todo: (KNOWN_OPEN_GATES[check] as Record<string, string>)[revision] } : {};
}

// ── Forudsaetninger: feltet er helt, og klassementet naar motoren ────────────

test("#6285 fixturet: hele startlisten har evner (ingen ryttere smides stille ud)", () => {
  assert.equal(droppedWithoutAbilities, 0);
  const partial = splitEntrants({ ...data, abilities: data.abilities.slice(1) });
  assert.equal(partial.droppedWithoutAbilities, 1, "en rytter uden evner skal taelles, ikke forsvinde");
});

for (const revision of REVISIONS) {
  test(`#6285 ${revision}: motor-gates koeres med klassementet fra etape 2 (ikke first_stage paa alle etaper)`, () => {
    const after1 = tourHits(revision).filter((h) => h.road && h.stage !== stages[0].stage_number && h.gcStatus !== null);
    assert.ok(after1.length > 0, "vejetaperne efter etape 1 skal melde klassementsstatus");
    assert.deepEqual(after1.filter((h) => h.gcStatus !== "standings").map((h) => `${where(h)}: ${h.gcStatus}`), []);
  });
}

// ── Syntetiske udfald (fejlens form fra prod) ───────────────────────────────

function finished(times: Array<[string, number]>) {
  return times.map(([rider_id, time_seconds], i) => ({ rider_id, rank: i + 1, time_seconds, status: "finished" }));
}

function syntheticOut({ times, formed = [], caught = [] }: { times: Array<[string, number]>; formed?: string[]; caught?: string[] }) {
  const events: any[] = [];
  if (formed.length) events.push({ km: 12, type: "breakaway_formed", params: { group_id: "breakaway-0", rider_ids: formed } });
  if (caught.length) events.push({ km: 150, type: "breakaway_caught", params: { rider_ids: caught } });
  return { results: finished(times), timeline: { events }, groupSnapshots: [] };
}

/** Et realistisk felt: 4 udbrydere og 40 ryttere i feltet paa samme tid. */
function fieldTimes(breakLead: number): Array<[string, number]> {
  const out: Array<[string, number]> = [["b1", 15000], ["b2", 15000], ["b3", 15002], ["b4", 15004]];
  for (let i = 0; i < 40; i++) out.push([`p${i}`, 15000 + breakLead]);
  return out;
}

// ── 1. Udbrud der vinder med minutter mod et realistisk felt ────────────────

test("#6285-1 detektoren fanger en flad udbrudssejr med minutter og lader en indhentet, en med sekunder og en kuperet ude", () => {
  const formed = ["b1", "b2", "b3", "b4"];
  const flat = { profile_type: "flat" };
  const won = flatBreakawayWinWithMinutes(syntheticOut({ times: fieldTimes(FLAT_BREAKAWAY_MINUTES_SECONDS + 30), formed }), flat);
  assert.equal(won.hit, true);
  assert.ok(won.margin! >= FLAT_BREAKAWAY_MINUTES_SECONDS, `margin ${won.margin}`);
  assert.equal(flatBreakawayWinWithMinutes(syntheticOut({ times: fieldTimes(20), formed }), flat).hit, false, "sekunder er ikke minutter");
  assert.equal(flatBreakawayWinWithMinutes(syntheticOut({ times: fieldTimes(FLAT_BREAKAWAY_MINUTES_SECONDS + 30), formed }), { profile_type: "hilly" }).hit, false, "kun flade etaper");
  const caughtOut = syntheticOut({ times: [["b1", 15000], ...fieldTimes(0).slice(4)], formed, caught: formed });
  assert.equal(breakawayWin(caughtOut).won, false);
  assert.equal(flatBreakawayWinWithMinutes(caughtOut, flat).hit, false);
});

for (const revision of REVISIONS) {
  test(`#6285-1 ${revision}: intet udbrud vinder en flad etape med minutter`, revisionCase("flatBreakawayMinutes", revision), () => {
    const flatStages = stages.filter((p) => p.profile_type === "flat");
    assert.ok(flatStages.length >= 2, "fixturet skal have flade etaper");
    const hits = tourHits(revision).filter((h) => h.flatMinutes !== null).map((h) => `${where(h)}: udbruddet vandt med ${h.flatMinutes} s`);
    assert.deepEqual(hits, []);
  });
}

// ── 2. +30:00-klumper ────────────────────────────────────────────────────────

test("#6285-2 detektoren fanger liste-gab der ikke er den raa tid over loftet, ogsaa et andet loft end 30:00", () => {
  const out = syntheticOut({ times: [["w", 18000], ["a", 18000 + 1500], ["b", 18000 + 2400], ["c", 18000 + 2700]] });
  const clamped = [
    { rider_id: "w", rank: 1, stageGap: 0 },
    { rider_id: "a", rank: 2, stageGap: 1500 },
    { rider_id: "b", rank: 3, stageGap: STAGE_GAP_CAP_SECONDS },
    { rider_id: "c", rank: 4, stageGap: STAGE_GAP_CAP_SECONDS },
  ];
  assert.equal(clampedAtCap(clamped, out), 2);
  const official = clamped.map((r, i) => ({ ...r, stageGap: [0, 1500, 2400, 2700][i] }));
  assert.equal(clampedAtCap(official, out), 0);
  // Et nyt, hoejere loft (fx 40:00) er samme fejl: listen lyver om rytter c.
  const otherCap = official.map((r) => ({ ...r, stageGap: Math.min(r.stageGap, 2500) }));
  assert.equal(clampedAtCap(otherCap, out), 1);
  assert.equal(overCapRaw(out), 2);
});

for (const revision of REVISIONS) {
  test(`#6285-2 ${revision}: resultatlistens gab er den raa tid, ogsaa over 30:00`, revisionCase("capClump", revision), () => {
    const hits = tourHits(revision).filter((h) => h.road);
    // Ikke-tom forudsaetning: uden ryttere over loftet kunne gaten aldrig slaa ud.
    assert.ok(hits.reduce((a, h) => a + h.overCap, 0) > 0, "fixturet skal give ryttere med raa gab over 30:00");
    assert.deepEqual(hits.filter((h) => h.clamped > 0).map((h) => `${where(h)}: ${h.clamped} ryttere med liste-gab != raa tid`), []);
  });
}

// ── 3. Maerke der modsiger resultatet ────────────────────────────────────────

test("#6285-3 detektoren fanger 'indhentet men vandt alene' og en modstridende udbrudsdom", () => {
  // #6294: vinderen staar som i udbrud og indhentet, men vandt alene med 1:20.
  const out = syntheticOut({ times: [["w", 15000], ["x", 15080], ["y", 15080]], formed: ["w"], caught: ["w"] });
  const caughtSolo = [{ rider_id: "w", rank: 1, stageGap: 0, breakaway_win: false, breakaway_status: { in_breakaway: true, breakaway_caught: true } }];
  assert.deepEqual(labelContradictions(caughtSolo, out).map((i: any) => i.kind), ["caught_but_solo"]);
  // Motoren siger "udbruddet vandt ikke", men vinderen sad i det og blev aldrig indhentet.
  const flagMismatch = [{ rider_id: "w", rank: 1, stageGap: 0, breakaway_win: false, breakaway_status: { in_breakaway: true, breakaway_caught: null } }];
  assert.deepEqual(labelContradictions(flagMismatch, syntheticOut({ times: [["w", 15000], ["x", 15000]] })).map((i: any) => i.kind), ["win_flag_vs_label"]);
  // Konsistent: indhentet og vandt spurten paa samme tid.
  const consistent = [{ rider_id: "w", rank: 1, stageGap: 0, breakaway_win: false, breakaway_status: { in_breakaway: true, breakaway_caught: true } }];
  assert.deepEqual(labelContradictions(consistent, syntheticOut({ times: [["w", 15000], ["x", 15000]] })), []);
});

for (const revision of REVISIONS) {
  test(`#6285-3 ${revision}: vinderens udbrudsmaerke stemmer med resultatet`, revisionCase("labelContradiction", revision), () => {
    const hits = tourHits(revision).filter((h) => h.labels.length).map((h) => `${where(h)}: ${h.labels.join("+")}`);
    assert.deepEqual(hits, []);
  });
}

// ── Den live revision (#6285 A) ──────────────────────────────────────────────

test("#6285 live: revisionen nye loeb bindes til er gatet og har ingen kendt aaben fejl", () => {
  // Skifter CURRENT_RACE_RULES_REVISION, skal den nye revision ind i REVISIONS
  // (og de live gates flyttes med), ellers koerer spillerne paa en ugatet motor.
  assert.equal(CURRENT_RACE_RULES_REVISION, LIVE_REVISION);
  assert.ok((REVISIONS as readonly string[]).includes(CURRENT_RACE_RULES_REVISION));
  for (const check of Object.keys(KNOWN_OPEN_GATES) as Check[]) {
    assert.equal(gateStatus(check, LIVE_REVISION), "gate", `${check} maa ikke vaere kendt aaben paa den live revision`);
  }
});

test("#6285 detektoren for udbrudsloftet bruger motorens loft pr. profil og slaar ud lige over det", () => {
  const formedOf = (n: number) => ({ timeline: { events: [{ km: 12, type: "breakaway_formed", params: { group_id: "breakaway-0", rider_ids: Array.from({ length: n }, (_, i) => `b${i}`) } }] } });
  const mountainCap = BREAKAWAY_SIZE_V3_TUNING.byProfile.mountain!.maxSize;
  assert.deepEqual(breakawaysOverSizeCap(formedOf(mountainCap), { profile_type: "mountain" }), []);
  assert.deepEqual(breakawaysOverSizeCap(formedOf(mountainCap + 1), { profile_type: "mountain" }), [mountainCap + 1]);
  // Flad har intet trin: standardloftet gaelder.
  const flatCap = BREAKAWAY_SIZE_V3_TUNING.defaultMaxSize;
  assert.deepEqual(breakawaysOverSizeCap(formedOf(flatCap + 1), { profile_type: "flat" }), [flatCap + 1]);
  assert.deepEqual(breakawaysOverSizeCap({ timeline: { events: [] } }, { profile_type: "flat" }), []);
});

test(`#6285 ${LIVE_REVISION}: et hold jagter aldrig sine egne (#6187)`, () => {
  const hits = tourHits(LIVE_REVISION).filter((h) => h.road);
  // Ikke-tom forudsaetning: uden reaktioner eller jagtede indhentninger kunne gaten aldrig slaa ud.
  assert.ok(hits.reduce((a, h) => a + h.chaseChances, 0) > 0, "loebet skal have GC-reaktioner eller jagtede indhentninger");
  assert.deepEqual(hits.filter((h) => h.ownChase > 0).map((h) => `${where(h)}: ${h.ownChase} gange jagter et hold sine egne`), []);
});

test(`#6285 ${LIVE_REVISION}: ingen taber tid eller staar bagud i loebsfilmen paa 0 km (#5951)`, () => {
  const road = tourHits(LIVE_REVISION).filter((h) => h.road);
  // Ikke-tom forudsaetning: filmen skal kunne maales (null = ingen tidslinje eller ingen gruppe-gab).
  assert.deepEqual(road.filter((h) => h.zeroKmLoss === null).map(where), [], "hver vejetape skal have en loebsfilm med gruppe-gab");
  assert.deepEqual(road.filter((h) => (h.zeroKmLoss ?? 0) > 0).map((h) => `${where(h)}: ${h.zeroKmLoss} ryttere`), []);
});

test(`#6285 ${LIVE_REVISION}: intet morgenudbrud er stoerre end profilens loft (#6201)`, () => {
  const road = tourHits(LIVE_REVISION).filter((h) => h.road);
  assert.ok(road.some((h) => h.breakSizes.length > 0), "loebet skal have morgenudbrud");
  assert.deepEqual(road.filter((h) => h.breakOverCap.length).map((h) => `${where(h)} (${h.profileType}): ${h.breakOverCap.join(",")} ryttere`), []);
  writePrivateSpanReport(road);
});

/**
 * Det typiske spaend gates ikke (kun loftet). Med CZ_6285_REPORT_DIR (fx
 * balance-internals/6285-live/) skrives stoerrelserne pr. profil og hvor mange
 * der ligger over tuningens `room`. Aldrig i repoet eller CI-loggen.
 */
function writePrivateSpanReport(road: StageHit[]) {
  const dir = process.env.CZ_6285_REPORT_DIR;
  if (!dir) return;
  const byType = new Map<string, number[]>();
  for (const h of road) byType.set(h.profileType, [...(byType.get(h.profileType) ?? []), ...h.breakSizes]);
  const lines = [`# #6285 udbrudsstoerrelse under ${LIVE_REVISION} (Giro-feltet, ${SEEDS} seeds)`, "", "| Profil | Udbrud | Min | Median | Max | Typisk (room) | Over room | Loft |", "|---|---|---|---|---|---|---|---|"];
  for (const [type, sizes] of [...byType].sort()) {
    const s = sizes.slice().sort((a, b) => a - b);
    const tier = BREAKAWAY_SIZE_V3_TUNING.byProfile[type];
    const room = tier?.room ?? null;
    lines.push(`| ${type} | ${s.length} | ${s[0] ?? "-"} | ${s.length ? s[Math.floor((s.length - 1) / 2)] : "-"} | ${s.at(-1) ?? "-"} | ${room ?? "-"} | ${room === null ? "-" : s.filter((x) => x > room).length} | ${tier?.maxSize ?? BREAKAWAY_SIZE_V3_TUNING.defaultMaxSize} |`);
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `breakaway-span-${LIVE_REVISION}.md`), `${lines.join("\n")}\n`);
}
