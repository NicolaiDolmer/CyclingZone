// #6285 B: "input betyder noget" under den live revision (official_times_v3, #6452).
//
// Parrede koersler paa det anonymiserede Giro-felt (scripts/baselines/
// giro-field-6088-2026-10-02.json): samme felt, samme etape, samme seed og samme
// klassement foer etapen; KUN ét input aendres. Testen gater kun RETNINGEN, og
// kun hvor retningen staar i docs/RACE_ENGINE_RULES.md. Ingen taersklere: et
// fortegn (bedre/daarligere, faerre/flere) er hele gaten.
//
//  1. Bedre klatrer paa bjerg: "En svagere klatrer faar aldrig et mindre hul end
//     en staerkere paa samme stigning" og "svag slaar aldrig staerk paa samme
//     trin" (RULES "Én tidsmodel for stigning og nedkoersel" punkt 1 og §9
//     beslutning 3). Samme rytter med feltets bedste klatreevne skal samlet
//     ende foran sig selv.
//  2. Spar kraefter mod normal: "`save` stopper spontane forsoeg" (RULES
//     "Morgenudbrud under orders_gc_v1"). En fri rytter uden udbrudsordre forsoeger paa normal,
//     aldrig paa save. (Kaptajnens stoette fra save-hjaelpere, #3460, er en
//     loft-regel uden en dokumenteret retning paa resultatet; den gates ikke.)
//  3. Farlig GC-rytter i udbrud mod ufarlig: under orders_gc_v3-arvelinjen
//     "kommer han sjaeldnere afsted, og forspringet bliver mindre" (RULES,
//     Farlig rytter i udbrud). Samme rytter og samme udbrudsordrer; kun hans
//     plads i klassementet foer etapen aendres.
//  4. Formtop til/fra (#6156): motoren laeser ikke formen. Testen er `todo`
//     saa laenge motoren ignorerer den, og bliver en gate naar #6156 lander.
//
// Maalte tal (hvor meget) skrives kun til CZ_6285_REPORT_DIR (fx
// balance-internals/6285-live/), aldrig i repoet eller CI-loggen (hard rule 17).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runStagesInOrder, sortedStages, splitEntrants } from "../../scripts/dev/lib/tourScorecard.mjs";
import { analyzeAnchorRun, anchorOrders } from "../../scripts/dev/dangerousRiderLeash5978.mjs";
import { loadRaceEngineV4 } from "../../lib/raceEngineV4Bridge.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(here, "..", "..", "scripts", "baselines", "giro-field-6088-2026-10-02.json");
const data = JSON.parse(readFileSync(FIXTURE, "utf8"));
const stages: any[] = sortedStages(data);
// #6452: den live revision. official_times_v2 er frosset byte-identisk
// (officialTimesV2Frozen6200.test.ts), saa retningen gates paa den nye.
const REVISION = "official_times_v3";

/** Bjergetapen med lang slutstigning (klatring afgoer). */
const CLIMB_STAGE = 11;
/** En kuperet og en bjergetape med morgenudbrud. */
const BREAK_STAGES = [3, 6];
/** Prod-etapen for den farlige rytter (#5978-ankeret). */
const DANGER_STAGE = 6;
const SEEDS = 3;
const DANGER_SEEDS = 8;

const v4 = await loadRaceEngineV4();

// Klassementet foer hver etape (ét fast seed, alle etaper i raekkefoelge som i
// spillet). Begge sider af hvert par faar praecis det samme.
const before = new Map<number, { gc: any[]; entrants: any[] }>();
const lastStage = Math.max(CLIMB_STAGE, DANGER_STAGE, ...BREAK_STAGES);
runStagesInOrder({
  v4, data, revision: REVISION, seedTag: "pair6285-chain",
  stages: stages.filter((p) => p.stage_number <= lastStage),
  entrants: splitEntrants(data).entrants,
  onStage: ({ profile, gcBefore, entrants }: any) => before.set(profile.stage_number, { gc: gcBefore, entrants }),
});

function run({ stage, entrants, gc, orders = data.orders, seed }: { stage: number; entrants: any[]; gc: any[]; orders?: any[]; seed: number }) {
  return v4.simulateStage({
    entrants, stageProfile: stages.find((p) => p.stage_number === stage), seedString: `${data.race.id}:${stage}:pair6285-${seed}`, stageNumber: stage,
    teamOrderRows: orders, isStageRace: true, raceStages: stages, squad: data.race.squad ?? null, rulesRevision: REVISION, gcStandings: gc,
  });
}

const rankOf = (res: any, id: string): number | null => res.ranked.find((r: any) => r.rider_id === id)?.rank ?? null;
const humanTeams = new Set(data.teams.filter((t: any) => !t.is_ai).map((t: any) => t.id));
const report: string[] = [`# #6285 B: parrede koersler under ${REVISION} (Giro-feltet)`, ""];

// ── 1. Bedre klatrer paa bjerg ──────────────────────────────────────────────

test(`#6285-B ${REVISION}: samme rytter med bedre klatreevne ender samlet foran sig selv paa bjerg`, () => {
  const { gc, entrants } = before.get(CLIMB_STAGE)!;
  assert.equal(stages.find((p) => p.stage_number === CLIMB_STAGE).profile_type, "mountain");
  const best = Math.max(...entrants.map((e) => e.abilities.climbing));
  // Tre hjaelpere midt i feltet paa klatreevne (ingen kaptajn, ingen rolle med egen taktik).
  const helpers = entrants.filter((e) => e.race_role === "helper" && humanTeams.has(e.team_id)).sort((a, b) => a.abilities.climbing - b.abilities.climbing || a.rider_id.localeCompare(b.rider_id));
  const picked = helpers.slice(Math.floor(helpers.length / 2) - 1, Math.floor(helpers.length / 2) + 2).map((e) => e.rider_id);
  assert.equal(picked.length, 3);
  const gains: Array<{ id: string; seed: number; gain: number }> = [];
  for (let seed = 1; seed <= SEEDS; seed++) {
    const base = run({ stage: CLIMB_STAGE, entrants, gc, seed });
    for (const id of picked) {
      assert.ok(entrants.find((e) => e.rider_id === id).abilities.climbing < best, "rytteren skal kunne blive bedre");
      const up = entrants.map((e) => (e.rider_id === id ? { ...e, abilities: { ...e.abilities, climbing: best } } : e));
      const a = rankOf(base, id);
      const b = rankOf(run({ stage: CLIMB_STAGE, entrants: up, gc, seed }), id);
      assert.ok(a !== null && b !== null, `etape ${CLIMB_STAGE} seed ${seed}: rytteren skal komme i maal i begge koersler`);
      gains.push({ id, seed, gain: a! - b! });
    }
  }
  report.push("## Bedre klatrer", "", `Etape ${CLIMB_STAGE}, ${picked.length} hjaelpere x ${SEEDS} seeds. Placeringer vundet pr. par: ${gains.map((g) => g.gain).join(", ")}.`, "");
  assert.ok(gains.reduce((s, g) => s + g.gain, 0) > 0, `bedre klatreevne skal samlet give en bedre placering (par: ${gains.map((g) => `${g.id}/seed ${g.seed}`).join(", ")})`);
});

// ── 2. Spar kraefter mod normal ─────────────────────────────────────────────

test(`#6285-B ${REVISION}: en fri rytter uden udbrudsordre forsoeger paa normal, aldrig paa save`, () => {
  let normalAttempts = 0;
  const saveHits: string[] = [];
  for (const stage of BREAK_STAGES) {
    const { gc, entrants } = before.get(stage)!;
    // Menneskeholdenes frie ryttere (AI-holdenes indsats kommer fra M14, ikke fra startlisten).
    const free = new Set(entrants.filter((e) => e.race_role === "free_role" && humanTeams.has(e.team_id)).map((e) => e.rider_id));
    assert.ok(free.size > 0, "feltet skal have frie ryttere paa menneskehold");
    // Ingen effektiv udbrudsordre til dem: kun spontane forsoeg kan sende dem afsted.
    const orders = data.orders.map((o: any) => (o.stage_number !== stage ? o : { ...o, riders: o.riders.map((r: any) => (free.has(r.rider_id) ? { ...r, try_break: false } : r)) }));
    const saving = entrants.map((e) => (free.has(e.rider_id) ? { ...e, effort: "save" } : e));
    const attempters = (res: any) => (res.v4Output.timeline.events.find((e: any) => e.type === "breakaway_attempt")?.params?.rider_ids ?? []).filter((id: string) => free.has(id));
    for (let seed = 1; seed <= SEEDS; seed++) {
      normalAttempts += attempters(run({ stage, entrants, gc, orders, seed })).length;
      for (const id of attempters(run({ stage, entrants: saving, gc, orders, seed }))) saveHits.push(`etape ${stage} seed ${seed}: ${id}`);
    }
  }
  report.push("## Spar kraefter", "", `Etaper ${BREAK_STAGES.join(", ")} x ${SEEDS} seeds. Spontane forsoeg fra frie ryttere: normal ${normalAttempts}, save ${saveHits.length}.`, "");
  // Ikke-tom forudsaetning: uden spontane forsoeg paa normal kunne gaten aldrig slaa ud.
  assert.ok(normalAttempts > 0, "frie ryttere paa normal skal forsoege spontant mindst én gang");
  assert.deepEqual(saveHits, [], "save stopper spontane forsoeg");
});

// ── 3. Farlig GC-rytter i udbrud mod ufarlig ────────────────────────────────

test(`#6285-B ${REVISION}: en farlig klassementsrytter kommer sjaeldnere afsted end samme rytter uden klassementschance`, () => {
  const { gc, entrants } = before.get(DANGER_STAGE)!;
  // Prod-situationen fra #5978: klassementets nr. 8 og tre langt nede faar en udbrudsordre.
  const { orders, dangerousId } = anchorOrders({ data, standings: gc, stageNumber: DANGER_STAGE });
  assert.ok(dangerousId, "klassementet skal have en nr. 8");
  // Ufarlig: samme rytter sidst i klassementet med en time til foereren; alt andet ens.
  const me = gc.find((s) => s.rider_id === dangerousId);
  const harmlessGc = [...gc.filter((s) => s.rider_id !== dangerousId), { ...me, time: gc[gc.length - 1].time + 3600 }];
  const gapOf = (g: any[]) => new Map(g.map((s) => [s.rider_id, s.time - g[0].time]));
  const side = () => ({ escaped: [] as number[], leads: [] as number[] });
  const dangerous = side();
  const harmless = side();
  for (let seed = 1; seed <= DANGER_SEEDS; seed++) {
    for (const [acc, g] of [[dangerous, gc], [harmless, harmlessGc]] as const) {
      const a = analyzeAnchorRun(run({ stage: DANGER_STAGE, entrants, gc: g, orders, seed }).v4Output, dangerousId, gapOf(g));
      if (a.escaped) { acc.escaped.push(seed); acc.leads.push(a.maxLead); }
    }
  }
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  report.push("## Farlig rytter", "", `Etape ${DANGER_STAGE}, ${DANGER_SEEDS} seeds. Afsted: farlig ${dangerous.escaped.length} (seeds ${dangerous.escaped.join(",") || "-"}), ufarlig ${harmless.escaped.length} (seeds ${harmless.escaped.join(",") || "-"}). Stoerste forspring med ham (s): farlig ${dangerous.leads.map(Math.round).join(",") || "-"}, ufarlig ${harmless.leads.map(Math.round).join(",") || "-"}.`, "");
  // Ikke-tom forudsaetning: kommer han aldrig afsted som ufarlig, maaler parret intet.
  assert.ok(harmless.escaped.length > 0, "den ufarlige udgave skal komme afsted mindst én gang");
  assert.ok(dangerous.escaped.length < harmless.escaped.length, `den farlige udgave skal komme sjaeldnere afsted (farlig seeds ${dangerous.escaped.join(",") || "-"}, ufarlig seeds ${harmless.escaped.join(",")})`);
  // Forspringet sammenlignes kun naar begge udgaver kom afsted.
  if (dangerous.leads.length) assert.ok(mean(dangerous.leads) <= mean(harmless.leads), "forspringet med den farlige rytter skal vaere mindre");
});

// ── 4. Formtop til/fra (#6156) ──────────────────────────────────────────────

const FORM_STAGE = CLIMB_STAGE;
const formPair = (() => {
  const { gc, entrants } = before.get(FORM_STAGE)!;
  // Formtop for hele feltet mod ingen formoplysning (neutral), samme seed.
  const peak = entrants.map((e) => ({ ...e, form: 100 }));
  const a = run({ stage: FORM_STAGE, entrants, gc, seed: 1 });
  const b = run({ stage: FORM_STAGE, entrants: peak, gc, seed: 1 });
  return { ignored: JSON.stringify(a.v4Output.results) === JSON.stringify(b.v4Output.results), a, b, entrants, gc };
})();

test(
  `#6285-B ${REVISION}: en rytter med formtop ender samlet foran sig selv uden`,
  formPair.ignored ? { todo: "#6156: motoren ignorerer formen (resultatet er identisk med og uden formtop)" } : {},
  () => {
    assert.equal(formPair.ignored, false, "formen skal aendre etapen");
    const { gc, entrants } = formPair;
    const ids = entrants.filter((e) => e.race_role === "helper" && humanTeams.has(e.team_id)).slice(0, 3).map((e) => e.rider_id);
    let gain = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const base = run({ stage: FORM_STAGE, entrants, gc, seed });
      for (const id of ids) {
        const peak = entrants.map((e) => (e.rider_id === id ? { ...e, form: 100 } : e));
        gain += (rankOf(base, id) ?? 0) - (rankOf(run({ stage: FORM_STAGE, entrants: peak, gc, seed }), id) ?? 0);
      }
    }
    assert.ok(gain > 0, "formtop skal samlet give en bedre placering");
  },
);

test("#6285-B rapport (kun privat, naar CZ_6285_REPORT_DIR er sat)", () => {
  const dir = process.env.CZ_6285_REPORT_DIR;
  if (!dir) return;
  report.push("## Formtop", "", formPair.ignored ? "Motoren ignorerer formen (#6156): identisk resultat." : "Motoren laeser formen.", "");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `input-matters-${REVISION}.md`), `${report.join("\n")}\n`);
});
