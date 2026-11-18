// #7982 (Fable 15/11): proeven mod et prod-billede, proevet mod et syntetisk "prod". Det syntetiske
// prod er dommerens database-stedfortraeder med en dag, hvor holdets etape er koert. Billedet fanges
// fra det med KUN laesninger, koeres begge veje, og "alt kl. 20"-vejen sammenlignes med det, "prods"
// egen aftenkoersel skrev. Den rigtige koersel mod prod sker med scriptet
// backend/scripts/dev/facit7982ProdImage.mjs (kun laesning, se dets hoved). Fast ur (regel 16).
import { test } from "node:test";
import assert from "node:assert/strict";
import { seedState, createFake, sweep, TEAM, rider } from "./trainNowSameResult7982.harness.js";
import { placeRace, finishStage1, contextOf } from "./trainingSettleRaceSession7982.facit.test.js";
import {
  captureProdImage, captureTeamTables, runProdImage, compareWithProd, readOnlyFetch, IGNITION_FLAGS,
} from "./trainingSettleRaceSession7982.prodImage.js";

const CAPTURE_AT = new Date("2026-11-09T18:30:00Z"); // 19:30 dansk tid: efter etapen, foer aftenkoerslen
const PROD_FLAGS_NOW = { training_settle_race_session: "off", fatigue_now_7801: "off" };
const SEED = { count: 14, entered: [1, 4, 6, 9, 12], tired: [4, 9], noPlan: [6], weekPlan: true, fatigueRules: true, staff: true, flags: PROD_FLAGS_NOW };
// Kvitteringens oejebliksbilleder, der maa afvige mellem de to veje (TRAINING_RULES 13.5, facit).
const SNAPSHOT_FIELDS = new Set(["fatigue", "fatigue_delta", "form", "progress_after", "progress_before"]);

function syntheticProd({ gameDay = 43 } = {}) {
  const state = seedState(SEED);
  placeRace(state, gameDay); finishStage1(state);
  return state;
}
async function capture(state) {
  const prod = createFake(state);
  const image = await captureProdImage({ supabase: prod.supabase, teamId: TEAM, now: CAPTURE_AT, loadContext: contextOf(state), loadFinalDate: async () => "2026-12-20" });
  return { prod, image };
}

test("fangsten laeser kun: ingen skrivning eller databasefunktion mod prod, og billedet er holdets dato", async () => {
  const state = syntheticProd();
  const before = JSON.stringify(state);
  const { prod, image } = await capture(state);
  assert.deepEqual(prod.log.filter((entry) => entry.kind !== "read"), [], "kun laesninger");
  // Stedfortraederen opretter en tom liste for en tabel, den laeser uden raekker; ellers er alt uroert.
  const keys = Object.keys(JSON.parse(before));
  assert.equal(JSON.stringify(Object.fromEntries(keys.map((key) => [key, state[key]]))), before, "prod er uroert");
  assert.ok(Object.keys(state).filter((key) => !keys.includes(key)).every((key) => state[key].length === 0));
  assert.equal(image.tickDate, "2026-11-09");
  assert.equal(image.riderIds.length, 14);
  assert.equal(image.tables.training_race_loads.length, 5, "etapens belastninger er med");
  assert.deepEqual(image.tables.training_rider_ticks, [], "datoen er ikke afregnet endnu");
  assert.deepEqual(JSON.parse(JSON.stringify(image)), image, "billedet kan gemmes som JSON");
});

for (const gameDay of [41, 43, 45]) {
  test(`billedet koert begge veje (etapen paa loebsdag ${gameDay}): spillets tal er ens, kun kvitteringernes oejebliksbilleder maa afvige`, async () => {
    const { image } = await capture(syntheticProd({ gameDay }));
    const result = await runProdImage(image);
    assert.ok(result.valid, JSON.stringify({ errors: result.errors, unsupported: result.unsupported, missingTables: result.missingTables }));
    assert.ok(result.settled?.settled > 0 && result.settled.failed === 0, `delkoerslen afregnede: ${JSON.stringify(result.settled)}`);
    assert.equal(result.raceSessions, 5, "loebssessionerne er gemt ved etapen");
    assert.ok(result.numbersEqual, `spillets tal er ens (foerste forskel: ${result.firstDifference})`);
    assert.ok(result.receiptsPlainEqual, "pr. kvittering: gevinster, score, intensitet, status");
    assert.ok(result.receiptFieldsThatDiffer.every((key) => SNAPSHOT_FIELDS.has(key)), result.receiptFieldsThatDiffer.join(","));
    // Taendings-kontakterne var kun taendt i stedfortraederen.
    assert.equal(image.tables.app_config.find((row) => row.key === "training_settle_race_session").value, "off");
    assert.equal(result.early.state.app_config.find((row) => row.key === "training_settle_race_session").value, IGNITION_FLAGS.training_settle_race_session);
  });
}

test("efter prods aftenkoersel: 'alt kl. 20' fra billedet er lig det, prod skrev; en afvigelse fanges", async () => {
  const state = syntheticProd();
  const { prod, image } = await capture(state);
  // "Prods" egen aftenkoersel, efter billedet blev fanget.
  const evening = await sweep(state, createFake(state));
  assert.ok(evening.every((row) => !row.error), JSON.stringify(evening));
  const read = () => captureTeamTables({ supabase: prod.supabase, teamId: TEAM, seasonId: image.season.id, tickDate: image.tickDate,
    riderIds: image.riderIds, todayRaceIds: image.context.stages.map((row) => row.race_id) });
  const same = await compareWithProd(image, await read());
  assert.ok(same.valid);
  assert.ok(same.equal, JSON.stringify({ keys: same.keys, receipts: same.receiptFieldsThatDiffer }));
  assert.deepEqual(same.receiptCount, [70, 70]);
  // En anden score paa én kvittering i prod: fanges felt for felt.
  const receipt = state.training_rider_ticks.find((row) => row.rider_id === rider(4));
  receipt.report = { ...receipt.report, score: Number(receipt.report.score ?? 0) + 1 };
  const differs = await compareWithProd(image, await read());
  assert.equal(differs.equal, false);
  assert.deepEqual(differs.receiptFieldsThatDiffer, ["score"]);
  // En evne, prod skrev anderledes: fanges paa noeglen.
  state.rider_derived_abilities.find((row) => row.rider_id === rider(2)).climbing += 1;
  const abilities = await compareWithProd(image, await read());
  assert.equal(abilities.keys.abilities.equal, false);
});

test("selvtjek: en tabel, motoren laeser, men billedet mangler, goer koerslen ugyldig (aldrig groen)", async () => {
  const { image } = await capture(syntheticProd());
  delete image.tables.team_training_rules;
  const result = await runProdImage(image);
  assert.equal(result.valid, false);
  assert.deepEqual(result.missingTables, ["team_training_rules"]);
});

test("kun-laesning paa netvaerksniveau: GET og HEAD gaar igennem, alt andet afvises og taelles", async () => {
  const stats = { calls: 0, blocked: 0 };
  const seen = [];
  const guarded = readOnlyFetch(async (input, init) => { seen.push(init?.method ?? "GET"); return new Response("[]"); }, stats);
  await guarded("https://example.invalid/rest/v1/riders");
  await guarded("https://example.invalid/rest/v1/riders", { method: "HEAD" });
  for (const method of ["POST", "PATCH", "DELETE", "PUT"]) {
    await assert.rejects(guarded("https://example.invalid/rest/v1/rpc/commit_training_date_tick", { method }), /kun laesning/);
  }
  await assert.rejects(guarded(new Request("https://example.invalid/rest/v1/riders", { method: "POST" })), /kun laesning/);
  assert.deepEqual(stats, { calls: 2, blocked: 5 });
  assert.deepEqual(seen, ["GET", "HEAD"]);
});
