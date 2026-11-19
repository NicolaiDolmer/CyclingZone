// #7982 (Fable 15/11, TRAINING_RULES 13.5): proeven mod et prod-billede. KUN LAESNING.
// Sporet koerer IKKE scriptet mod prod; ejeren eller hovedsessionen goer det paa en dag med etaper.
//
// Hvad den goer (logikken staar i backend/lib/trainingSettleRaceSession7982.prodImage.js):
//   capture  Efter holdets sidste etape og FOER aftenkoerslen (19:15-19:55): laeser holdets raekker
//            for datoen og datoens kontekst (den rigtige loadTrainingDateContext) og gemmer billedet
//            privat. Koerer straks begge veje i stedfortraederen ("alt kl. 20" mod "tidligt" med de
//            to taendings-kontakter taendt KUN i stedfortraederen) og skriver resultatet.
//   run      Koerer et gemt billede igen (ingen netvaerk).
//   compare  Efter prods aftenkoersel (efter ca. 20:50): laeser holdets raekker igen med samme
//            raekkevidde og sammenligner "alt kl. 20" fra billedet med det, prod faktisk skrev.
//
// Kun laesning, haandhaevet i processen: klientens fetch afviser alt andet end GET og HEAD, ogsaa
// fra moduler, der laver deres egen forespoergsel. Blokerede kald taelles og skal vaere 0.
// Billedet er rigtige spillerdata: det skrives KUN til --out (standard balance-internals/, som er
// gitignoreret). Konsollen viser kun noegler, antal og fingeraftryk (regel 17): ingen navne, ingen
// motortal. Hold-id vises forkortet som hash.
//
// Brug fra repo-roden (credentials hentes af Infisical, aldrig vist):
//   infisical run --env=prod --silent -- node backend/scripts/dev/facit7982ProdImage.mjs capture --team <team_id>
//   node backend/scripts/dev/facit7982ProdImage.mjs run --image <fil>
//   infisical run --env=prod --silent -- node backend/scripts/dev/facit7982ProdImage.mjs compare --image <fil>
//
// Godt (#8391: exit 0 kun da, ellers exit 1 med proofFailures): capture/run giver valid=true, numbersEqual=true, receiptsPlainEqual=true, raceSessions>0 og
// kun oejebliksfelter i receiptFieldsThatDiffer (progress_*, og form/fatigue/fatigue_delta naar
// loebet er datoens sidste session). compare giver equal=true og blocked=0.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

import { loadDayCloseSpans } from "../../lib/trainingDayCloseTrigger.js";
import {
  captureProdImage, captureTeamTables, compareWithProd, proofFailures, readOnlyFetch, runProdImage,
} from "../../lib/trainingSettleRaceSession7982.prodImage.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const [command, ...rest] = process.argv.slice(2);
const option = (name, fallback = null) => (rest.indexOf(name) >= 0 ? rest[rest.indexOf(name) + 1] : fallback);
const short = (id) => createHash("sha256").update(String(id)).digest("hex").slice(0, 8);
const USAGE = "brug: facit7982ProdImage.mjs capture --team <team_id> [--out <mappe>] | run --image <fil> | compare --image <fil>";

const stats = { calls: 0, blocked: 0 };
function prodClient() {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("mangler SUPABASE_URL/SUPABASE_SERVICE_KEY (koer via infisical run --env=prod)");
    process.exit(2);
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false }, global: { fetch: readOnlyFetch(globalThis.fetch, stats) } });
}

// Kun aggregater og fingeraftryk til konsollen.
const summaryOf = (result) => ({
  passed: proofFailures(result).length === 0, proofFailures: proofFailures(result),
  valid: result.valid, errors: result.errors.length, unsupported: result.unsupported, missingTables: result.missingTables,
  settled: result.settled ? { planned: result.settled.planned, settled: result.settled.settled, failed: result.settled.failed, skipped: result.settled.skipped ?? null } : null,
  raceSessions: result.raceSessions, numbersEqual: result.numbersEqual, firstDifference: result.firstDifference,
  receiptsPlainEqual: result.receiptsPlainEqual, receiptFieldsThatDiffer: result.receiptFieldsThatDiffer, digests: result.digests,
});
const loadImage = () => {
  const file = option("--image");
  if (!file) { console.error(USAGE); process.exit(2); }
  return { file, image: JSON.parse(readFileSync(file, "utf8")) };
};

if (command === "capture") {
  const teamId = option("--team");
  if (!teamId) { console.error(USAGE); process.exit(2); }
  const out = path.resolve(option("--out", path.join(REPO, "balance-internals", "7982-prod-image")));
  const supabase = prodClient();
  const image = await captureProdImage({ supabase, teamId, now: new Date(), loadDaySpans: loadDayCloseSpans });
  mkdirSync(out, { recursive: true });
  const file = path.join(out, `${image.tickDate}-${short(teamId)}.json`);
  writeFileSync(file, JSON.stringify(image));
  const result = await runProdImage(image);
  writeFileSync(file.replace(/\.json$/, ".run.json"), JSON.stringify(summaryOf(result), null, 2));
  console.log(JSON.stringify({ team: short(teamId), tickDate: image.tickDate, riders: image.riderIds.length,
    loads: image.tables.training_race_loads.length, receiptsAlready: image.tables.training_rider_ticks.length,
    image: path.relative(REPO, file), run: summaryOf(result), network: stats }, null, 2));
  process.exit(stats.blocked === 0 && proofFailures(result).length === 0 ? 0 : 1);
}

if (command === "run") {
  const { image } = loadImage();
  const result = await runProdImage(image);
  console.log(JSON.stringify(summaryOf(result), null, 2));
  process.exit(proofFailures(result).length === 0 ? 0 : 1);
}

if (command === "compare") {
  const { file, image } = loadImage();
  const supabase = prodClient();
  const prodTables = await captureTeamTables({ supabase, teamId: image.teamId, seasonId: image.season.id, tickDate: image.tickDate,
    riderIds: image.riderIds, todayRaceIds: (image.context.stages ?? []).map((row) => row.race_id) });
  const result = await compareWithProd(image, prodTables);
  const keys = Object.fromEntries(Object.entries(result.keys).map(([key, row]) => [key, { equal: row.equal, rows: row.rows, firstDifference: row.firstDifference }]));
  const report = { valid: result.valid, equal: result.equal, receiptCount: result.receiptCount, receiptFieldsThatDiffer: result.receiptFieldsThatDiffer,
    keys, unsupported: result.unsupported, missingTables: result.missingTables, network: stats };
  writeFileSync(file.replace(/\.json$/, ".compare.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(stats.blocked === 0 && result.valid && result.equal ? 0 : 1);
}

console.error(USAGE);
process.exit(2);
