// backend/lib/engine/v4/mechanics/queenStageGap7236.test.ts
// #7236 (KUN s5_profiles_v3 + kontakten queen_stage_gap_7236, SLUKKET): dronningeetaper.
// Ingen balance-tal her (hard rule 17): testene laaser reglerne (kontakten, loftets form,
// hvor det gaelder, bit-identitet uden kontakten), ikke kalibreringen. Loftet laeses fra
// tuningen; de maalte tal ligger privat (balance-internals/7236/).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { simulateStageV4 } from "../index.ts";
import { QUEEN_STAGE_GAP_7236_TUNING as Q } from "../tuning.ts";
import type { GcContext, RaceGroup, RouteV2, Segment, StageInput, StageOutput } from "../types.ts";
import { queenStageGap7236On } from "./queenStageGap7236.ts";
import { queenStageTopCap7236, queenStageTopCap7236Applies } from "./climbSelection.ts";
import { DESCENT_REGROUP_6486_TUNING, DESCENT_REGROUP_7236_TUNING, descentRegroupTuning7236 } from "./descentRegroup6486.ts";
import { SHARED_TIME_MODEL_V4_TUNING } from "./timeModel.ts";
import { __resetRaceEngineV4Cache, loadRaceEngineV4 } from "../../../raceEngineV4Bridge.js";
import { breakawaySets, runStagesInOrder as runStagesInOrderJs } from "../../../../scripts/dev/lib/tourScorecard.mjs";
import { median } from "../../../../scripts/lib/headToHeadStats.js";

// ── Kontakten ────────────────────────────────────────────────────────────────

test("#7236: kontakten kraever s5_profiles_v3 OG et eksplicit flag", () => {
  assert.equal(queenStageGap7236On({ rules_revision: "s5_profiles_v3", queen_stage_gap_7236: true }), true);
  assert.equal(queenStageGap7236On({ rules_revision: "s5_profiles_v3" }), false);
  assert.equal(queenStageGap7236On({ rules_revision: "s5_profiles_v3", queen_stage_gap_7236: null }), false);
  assert.equal(queenStageGap7236On({ rules_revision: "s5_profiles_v2", queen_stage_gap_7236: true }), false);
  assert.equal(queenStageGap7236On({ rules_revision: "official_times_v4", queen_stage_gap_7236: true }), false);
  assert.equal(queenStageGap7236On({ rules_revision: null, queen_stage_gap_7236: true }), false);
});

// ── Loftet (ren funktion) ────────────────────────────────────────────────────

const g = (id: string, gap: number, riders: number, extra: Partial<RaceGroup> = {}): RaceGroup =>
  ({ id, kind: "chase", rider_ids: Array.from({ length: riders }, (_, i) => `${id}-${i}`), gap_seconds: gap, cohesion: 1, ...extra });

test("#7236: under loftet er grupperne uroerte (samme array)", () => {
  const groups = [g("a", 0, 3), g("b", Q.capSeconds * 0.5, 4), g("c", Q.capSeconds, 5), g("d", Q.capSeconds * 3, 20)];
  assert.equal(queenStageTopCap7236(groups), groups);
  const single = [g("a", 0, 12)];
  assert.equal(queenStageTopCap7236(single), single, "én gruppe: intet hul at lofte");
});

test("#7236: over loftet ligger favorit nr. capRank paa loftet; raekkefoelge og forhold foran ham bevares", () => {
  const over = Q.capSeconds * 2;
  const breakaway = g("brk", 0, 4, { kind: "breakaway", origin: "breakaway" });
  const groups = [
    breakaway,
    g("front", 60, 1, { kind: "peloton" }),
    g("b", 60 + over * 0.25, 2),
    g("c", 60 + over * 0.5, 3),
    g("d", 60 + over, Q.capRank), // favorit nr. capRank sidder her
    g("e", 60 + over + 200, 30, { kind: "gruppetto" }),
  ];
  const out = queenStageTopCap7236(groups);
  assert.notEqual(out, groups);
  const by = new Map(out.map((x) => [x.id, x.gap_seconds]));
  assert.equal(by.get("brk"), 0, "dagens udbrud flyttes aldrig");
  assert.equal(by.get("front"), 60, "den forreste favoritgruppe flyttes aldrig");
  assert.equal((by.get("d") as number) - 60, Q.capSeconds, "nr. capRank paa loftet");
  const rel = (id: string) => (by.get(id) as number) - 60;
  assert.ok(Math.abs(rel("b") / rel("c") - 0.5) < 1e-3, "forholdet foran nr. capRank bevares");
  assert.ok(rel("b") < rel("c") && rel("c") < rel("d") && rel("d") < rel("e"), "raekkefoelgen bevares");
  assert.ok(Math.abs((rel("e") - rel("d")) - 200) < 1e-6, "dem bag nr. capRank rykker det samme stykke frem");
  for (const x of out) assert.ok(x.gap_seconds <= (groups.find((y) => y.id === x.id) as RaceGroup).gap_seconds, `${x.id}: et hul vokser aldrig`);
});

test("#7236: udbruddet taeller ikke med i favoritternes nr. capRank", () => {
  const groups = [g("brk", 0, 20, { kind: "breakaway", origin: "breakaway" }), g("front", 300, 2, { kind: "peloton" }), g("b", 330, 3)];
  assert.equal(queenStageTopCap7236(groups), groups, "kun fem favoritter: intet nr. capRank, intet loft");
});

// ── Hvor loftet gaelder ──────────────────────────────────────────────────────

const climb = (from: number, to: number, category = "HC", gradient = 8): Segment => ({ kind: "climb", from_km: from, to_km: to, category, avg_gradient: gradient, top_elevation_m: 2200 } as Segment);
const descent = (from: number, to: number): Segment => ({ kind: "descent", from_km: from, to_km: to, technicality: 2 } as Segment);
const rolling = (from: number, to: number): Segment => ({ kind: "rolling", from_km: from, to_km: to } as Segment);
const flat = (from: number, to: number): Segment => ({ kind: "flat", from_km: from, to_km: to } as Segment);
const head = (): Segment[] => [rolling(0, 60), climb(60, 78), descent(78, 95), rolling(95, 110), climb(110, 126)];
const shortTail = (): Segment[] => [descent(126, 135), flat(135, 136)];
const longTail = (): Segment[] => [descent(126, 126 + Q.maxTopToFinishKm + 1), flat(126 + Q.maxTopToFinishKm + 1, 126 + Q.maxTopToFinishKm + 2)];
const routeOf = (segments: Segment[], profile_type: RouteV2["profile_type"] = "mountain", finale_type: RouteV2["finale_type"] = "descent") =>
  ({ distance_km: segments[segments.length - 1].to_km, segments, profile_type, finale_type }) as RouteV2;

test("#7236: loftet gaelder kun paa den afgoerende stigning foer en kort nedkoersel paa bjerg/hoejfjeld", () => {
  const t = SHARED_TIME_MODEL_V4_TUNING;
  const queen = routeOf([...head(), ...shortTail()]);
  assert.equal(queenStageTopCap7236Applies({ route: queen, segmentIndex: 4 }, t), true, "sidste stigning");
  assert.equal(queenStageTopCap7236Applies({ route: queen, segmentIndex: 1 }, t), false, "en tidligere stigning");
  assert.equal(queenStageTopCap7236Applies({ route: queen, segmentIndex: 5 }, t), false, "nedkoerslen");
  assert.equal(queenStageTopCap7236Applies({ route: { ...queen, profile_type: "high_mountain" }, segmentIndex: 4 }, t), true, "hoejfjeld");
  assert.equal(queenStageTopCap7236Applies({ route: { ...queen, profile_type: "hilly" }, segmentIndex: 4 }, t), false, "kuperet");
  const long = routeOf([...head(), ...longTail()]);
  assert.equal(queenStageTopCap7236Applies({ route: long, segmentIndex: 4 }, t), false, "lang nedkoersel");
  const summit = routeOf(head(), "mountain", "long_climb");
  assert.equal(queenStageTopCap7236Applies({ route: summit, segmentIndex: 4 }, t), false, "topankomst");
});

test("#7236: regrupperingen er #6486's egen uden kontakten og paa lange nedkoersler", () => {
  const queen = routeOf([...head(), ...shortTail()]);
  assert.equal(descentRegroupTuning7236(false, queen), DESCENT_REGROUP_6486_TUNING);
  assert.equal(descentRegroupTuning7236(true, routeOf([...head(), ...longTail()])), DESCENT_REGROUP_6486_TUNING);
  assert.equal(descentRegroupTuning7236(true, queen), DESCENT_REGROUP_7236_TUNING);
  assert.ok(DESCENT_REGROUP_7236_TUNING.reachSeconds > Q.capSeconds, "raekkevidden naar loftet");
  for (const kind of ["descent", "flat", "rolling"] as const) {
    assert.ok((DESCENT_REGROUP_7236_TUNING.secondsPerKmByKind[kind] ?? 0) >= (DESCENT_REGROUP_6486_TUNING.secondsPerKmByKind[kind] ?? 0), `${kind}: aldrig langsommere`);
  }
});

// ── Hele motoren: bit-identitet uden kontakten ───────────────────────────────

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const fixture = (name: string): StageInput => JSON.parse(readFileSync(path.join(fixturesDir, name, "input.json"), "utf8")) as StageInput;
const firstStage: GcContext = { status: "first_stage", stage_number: 1 };

test("#7236: uden kontakten er motoren bit-identisk; kontakten virker kun under v3 og er deterministisk", () => {
  for (const name of ["nedkoerselsfinale", "bjerg-selektion", "mellembjerg", "flat-massespurt"]) {
    const input = fixture(name);
    for (const rules_revision of ["official_times_v4", "s5_profiles_v1", "s5_profiles_v2", "s5_profiles_v3"] as const) {
      const base: string = JSON.stringify(simulateStageV4({ ...input, gc_context: firstStage, rules_revision }));
      assert.equal(JSON.stringify(simulateStageV4({ ...input, gc_context: firstStage, rules_revision, queen_stage_gap_7236: null })), base, `${name} ${rules_revision}: null = udeladt`);
      if (rules_revision !== "s5_profiles_v3") {
        assert.equal(JSON.stringify(simulateStageV4({ ...input, gc_context: firstStage, rules_revision, queen_stage_gap_7236: true })), base, `${name} ${rules_revision}: kun v3`);
      }
    }
    const on: string = JSON.stringify(simulateStageV4({ ...input, gc_context: firstStage, rules_revision: "s5_profiles_v3", queen_stage_gap_7236: true }));
    assert.equal(on, JSON.stringify(simulateStageV4({ ...input, gc_context: firstStage, rules_revision: "s5_profiles_v3", queen_stage_gap_7236: true })), `${name}: deterministisk`);
    // Ingen af fixturene har favoritter over loftet: saa griber hverken loftet eller regrupperingen.
    assert.equal(on, JSON.stringify(simulateStageV4({ ...input, gc_context: firstStage, rules_revision: "s5_profiles_v3" })), `${name}: uroert naar loftet ikke griber`);
  }
});

// ── Hele motoren: en dronningeetape med Giro-feltet ──────────────────────────

const runStagesInOrder = runStagesInOrderJs as unknown as (opts: Record<string, unknown>) => unknown;
const GIRO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "scripts", "baselines", "giro-field-6088-2026-10-02.json");
const SEEDS = 4;
// Fem stigninger, den sidste og haardeste kort foer maal (dronningeetapen fra issuet, syntetisk).
const queenHead = (): Segment[] => [
  rolling(0, 24), climb(24, 29, "3", 6), descent(29, 32), rolling(32, 40), climb(40, 49, "2", 7), descent(49, 61), rolling(61, 69),
  climb(69, 81, "1", 8), descent(81, 88), rolling(88, 95), climb(95, 110, "1", 7.3), descent(110, 122), rolling(122, 125), climb(125, 147, "HC", 9.5),
];
const queenShortTail = (): Segment[] => [descent(147, 156)];
const queenLongTail = (): Segment[] => [descent(147, 147 + Q.maxTopToFinishKm + 2), flat(147 + Q.maxTopToFinishKm + 2, 147 + Q.maxTopToFinishKm + 3)];
type StageRun = { res: { v4Output: StageOutput } };

function profileOf(id: string, segments: Segment[], finale_type: string) {
  const climbs = segments.filter((s) => s.kind === "climb").map((s) => ({
    category: (s as { category?: string }).category, crest_km: s.to_km, length_km: Math.round((s.to_km - s.from_km) * 10) / 10,
    avg_gradient: (s as { avg_gradient?: number }).avg_gradient, summit_finish: finale_type === "long_climb" && s === segments[segments.length - 1],
  }));
  const distance = segments[segments.length - 1].to_km;
  return Object.freeze({
    id, race_id: "queen-7236", stage_number: 1, profile_type: "high_mountain", finale_type,
    demand_vector: { punch: 0.04, tempo: 0.12, tactics: 0.02, climbing: 0.5, recovery: 0.06, endurance: 0.14, randomness: 0.1, positioning: 0.02 },
    generator_version: 5, is_manual: false, generated_at: null, distance_km: distance, elevation_gain_m: 4000,
    climbs, sprints: [{ km: distance, kind: "finish" }], sectors: [], segments, weather: { kind: "overcast", wind_exposure: 0.2 },
  });
}

/** Favoritternes nr. capRank (uden for morgenudbruddet) ved sidste top og i maal, pr. seed. */
async function queenRun(profile: ReturnType<typeof profileOf>, on: boolean) {
  const data = JSON.parse(readFileSync(GIRO, "utf8"));
  __resetRaceEngineV4Cache();
  const raw = await loadRaceEngineV4();
  const v4 = on ? { ...raw, simulateStage: (a: Record<string, unknown>) => raw.simulateStage({ ...a, queenStageGap7236: true }) } : raw;
  const topKm = Math.max(...profile.climbs.map((c) => c.crest_km));
  const top: number[] = [];
  const finish: number[] = [];
  const outputs: string[] = [];
  for (let seed = 1; seed <= SEEDS; seed++) {
    runStagesInOrder({
      v4, data: { ...data, profiles: [profile] }, revision: "s5_profiles_v3", seedTag: `queen-7236-${seed}`, stages: [profile],
      onStage: ({ res }: StageRun) => {
        const out = res.v4Output;
        const { formed } = breakawaySets(out);
        const snap = out.groupSnapshots.filter((s) => s.km <= topKm + 1e-6).at(-1);
        const atTop = (snap?.groups ?? []).filter((x) => x.kind !== "breakaway").flatMap((x) => x.rider_ids.map(() => Number(x.gap_seconds))).sort((a, b) => a - b);
        if (atTop.length >= Q.capRank) top.push(atTop[Q.capRank - 1] - atTop[0]);
        const fav = out.results.filter((r) => r.status === "finished" && !formed.has(r.rider_id)).sort((a, b) => a.time_seconds - b.time_seconds);
        if (fav.length >= Q.capRank) finish.push(fav[Q.capRank - 1].time_seconds - fav[0].time_seconds);
        outputs.push(JSON.stringify(out.results.map((r) => [r.rider_id, r.time_seconds])));
      },
    });
  }
  return { top: median(top) as number, finish: median(finish) as number, outputs };
}

test("#7236: dronningeetapen med kort nedkoersel - over toppen hoejst loftet, og nr. capRank kommer taettere i maal", async () => {
  const queen = profileOf("queen-7236-short", [...queenHead(), ...queenShortTail()], "descent");
  const off = await queenRun(queen, false);
  const on = await queenRun(queen, true);
  assert.ok(off.top > Q.capSeconds, "problemet er gengivet uden kontakten");
  assert.ok(on.top <= Q.capSeconds + 1, "med kontakten: hoejst loftet over toppen");
  assert.ok(on.finish < off.finish, "med kontakten: taettere i maal");
  assert.ok(on.finish > 0, "favoritterne kommer ikke alle samlet");
});

test("#7236: topankomst og lang nedkoersel er uroerte af kontakten", async () => {
  for (const [name, profile] of [
    ["topankomst", profileOf("queen-7236-summit", queenHead(), "long_climb")],
    ["lang nedkoersel", profileOf("queen-7236-long", [...queenHead(), ...queenLongTail()], "descent")],
  ] as const) {
    const off = await queenRun(profile, false);
    const on = await queenRun(profile, true);
    assert.deepEqual(on.outputs, off.outputs, `${name}: bit-identisk med og uden kontakten`);
  }
});
