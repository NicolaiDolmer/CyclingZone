// #1857 (ejer 26/10, designbord S8): motorens FULDE input pr. etape, gemt privat.
//
// Hvorfor: race_simulation_runs.entrant_snapshot gemmer kun rytter-ID'er. Form,
// træthed, evner, roller, ordrer, rute og GC-kontekst læses live ved afviklingen
// og driver resultatet, så en afviklet etape kunne ikke køres om 1:1. Her fanges
// PRÆCIS det argument-objekt raceRunner giver motoren (v3 simulateStage eller
// v4-adapterens simulateStage), lige før kaldet, plus en hash af motorens output.
// replayStage1857.mjs kan så køre en rigtig etape igen og bevise bit-identitet
// (samme output-hash) på samme revision, eller sammenligne med en kandidat-revision.
//
// Kontrakt:
//  - Optageren er null ved dryRun og i alle tests der ikke beder om den →
//    runRecordedEngineCall er da et rent `call(args)` (ingen ændret adfærd).
//  - Optagelse og skrivning må ALDRIG vælte en afvikling: fejl samles og sendes
//    til Sentry; en manglende tabel (migrationen er ikke kørt endnu) springes over.
//  - Tabellen har RLS uden policies (kun service-rollen) — data er private.
//
// Codec: JSON kan ikke bære Map/Set/NaN/±Infinity/-0/undefined/BigInt/Date.
// encodeValue/decodeValue tagger dem, så genafspilningen får præcis de samme
// værdier som motoren fik (ellers kunne en NaN blive til null og ændre et udfald).

import { createHash } from "node:crypto";
import { gzip as gzipCb, gunzipSync } from "node:zlib";
import { promisify } from "node:util";
import { captureException } from "./sentry.js";

const gzip = promisify(gzipCb);

export const ENGINE_INPUT_SNAPSHOT_TABLE = "race_stage_engine_inputs";
export const ENGINE_INPUT_FORMAT = "gzip-base64-tagged-json-v1";
const TAG = "$t";
const PERSIST_TIMEOUT_MS = 10_000;

// ── Codec ──────────────────────────────────────────────────────────────────

function encodeNumber(n) {
  if (Number.isNaN(n)) return { [TAG]: "num", v: "NaN" };
  if (n === Infinity) return { [TAG]: "num", v: "Infinity" };
  if (n === -Infinity) return { [TAG]: "num", v: "-Infinity" };
  if (Object.is(n, -0)) return { [TAG]: "num", v: "-0" };
  return n;
}

/** Værdi → JSON-sikker træstruktur (tabsfri for de typer motoren kan få). */
export function encodeValue(value, seen = new Set()) {
  if (value === undefined) return { [TAG]: "undef" };
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return encodeNumber(value);
  if (typeof value === "bigint") return { [TAG]: "bigint", v: value.toString() };
  if (typeof value === "function" || typeof value === "symbol") {
    throw new TypeError(`engineInputSnapshot: cannot store a ${typeof value}`);
  }
  if (seen.has(value)) throw new TypeError("engineInputSnapshot: circular reference");
  seen.add(value);
  try {
    if (value instanceof Date) return { [TAG]: "date", v: value.toISOString() };
    if (Array.isArray(value)) {
      // Huller i arrays bevares som undefined (samme som motoren ville se).
      return Array.from({ length: value.length }, (_, i) => encodeValue(value[i], seen));
    }
    if (value instanceof Map) return { [TAG]: "map", v: [...value].map(([k, v]) => [encodeValue(k, seen), encodeValue(v, seen)]) };
    if (value instanceof Set) return { [TAG]: "set", v: [...value].map((v) => encodeValue(v, seen)) };
    if (ArrayBuffer.isView(value)) throw new TypeError("engineInputSnapshot: typed arrays are not supported");
    const out = {};
    for (const key of Object.keys(value)) out[key] = encodeValue(value[key], seen);
    // Et almindeligt objekt der selv har en "$t"-nøgle pakkes ind, så det aldrig
    // forveksles med et tag ved afkodning.
    return Object.prototype.hasOwnProperty.call(out, TAG) ? { [TAG]: "obj", v: out } : out;
  } finally {
    seen.delete(value);
  }
}

/** Omvendt af encodeValue. */
export function decodeValue(node) {
  if (node === null || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map(decodeValue);
  if (Object.prototype.hasOwnProperty.call(node, TAG)) {
    switch (node[TAG]) {
      case "undef": return undefined;
      case "num": return node.v === "-0" ? -0 : Number(node.v);
      case "bigint": return BigInt(node.v);
      case "date": return new Date(node.v);
      case "map": return new Map(node.v.map(([k, v]) => [decodeValue(k), decodeValue(v)]));
      case "set": return new Set(node.v.map(decodeValue));
      case "obj": return decodePlainObject(node.v);
      default: throw new TypeError(`engineInputSnapshot: unknown tag ${node[TAG]}`);
    }
  }
  return decodePlainObject(node);
}

function decodePlainObject(node) {
  const out = {};
  for (const key of Object.keys(node)) out[key] = decodeValue(node[key]);
  return out;
}

export function sha256Hex(text) {
  return createHash("sha256").update(text).digest("hex");
}

/** Stabil hash af motorens output (hele resultat-objektet, Map'er inkluderet). */
export function hashEngineOutput(result) {
  return sha256Hex(JSON.stringify(encodeValue(result)));
}

// ── Optagelse ──────────────────────────────────────────────────────────────

/**
 * Ny optager for én afvikling. `build` (fx RAILWAY_GIT_COMMIT_SHA) gemmes så en
 * genafspilning ved hvilken kode-version etapen kørte på.
 */
export function createEngineInputRecorder({ raceId, build = process.env.RAILWAY_GIT_COMMIT_SHA ?? null } = {}) {
  return { raceId, build, calls: [], errors: [] };
}

/**
 * Kald motoren og optag dens input. recorder=null ⇒ præcis `call(args)`.
 * Input serialiseres FØR kaldet (raceRunner muterer entrants mellem etaper, og
 * motoren må ikke kunne ændre det optagne), output-hashen EFTER.
 *
 * @param {object|null} recorder  fra createEngineInputRecorder
 * @param {{stageNumber:number, engine:"v3"|"v4", engineVersion?:number, rulesRevision?:string, seedInput?:string, formPeaksOff?:boolean}} meta
 * @param {object} args   det objekt motoren kaldes med
 * @param {(args:object)=>object} call
 */
export function runRecordedEngineCall(recorder, meta, args, call) {
  if (!recorder) return call(args);
  let entry = null;
  try {
    entry = {
      stageNumber: meta.stageNumber,
      engine: meta.engine,
      engineVersion: meta.engineVersion ?? null,
      rulesRevision: meta.rulesRevision ?? "legacy",
      seedInput: meta.seedInput ?? null,
      formPeaksOff: meta.formPeaksOff === true,
      argsJson: JSON.stringify(encodeValue(args)),
      outputSha256: null,
    };
    recorder.calls.push(entry);
  } catch (err) {
    // best-effort: buildRaceResults er synkron; fejlen sendes til Sentry af persistEngineInputSnapshots.
    recorder.errors.push(err);
    entry = null;
  }
  const result = call(args);
  if (entry) {
    try {
      entry.outputSha256 = hashEngineOutput(result);
    } catch (err) {
      // best-effort: samme vej til Sentry som ovenfor (persistEngineInputSnapshots).
      recorder.errors.push(err);
    }
  }
  return result;
}

/** Selve payloaden (før komprimering) — det replayEngineInput læser. */
export function snapshotPayload(entry) {
  return `{"format":1,"engine":${JSON.stringify(entry.engine)},"formPeaksOff":${entry.formPeaksOff},`
    + `"rulesRevision":${JSON.stringify(entry.rulesRevision)},"stageNumber":${entry.stageNumber},`
    + `"seedInput":${JSON.stringify(entry.seedInput)},"args":${entry.argsJson}}`;
}

/** Én tabel-række pr. optaget kald. */
export async function buildSnapshotRows({ raceId, recorder }) {
  const rows = [];
  for (const entry of recorder?.calls ?? []) {
    const payload = snapshotPayload(entry);
    const gz = await gzip(Buffer.from(payload, "utf8"), { level: 9 });
    const encoded = gz.toString("base64");
    rows.push({
      race_id: raceId,
      stage_number: entry.stageNumber,
      engine: entry.engine,
      engine_version: entry.engineVersion,
      rules_revision: entry.rulesRevision,
      seed_input: entry.seedInput,
      engine_build: recorder.build ?? null,
      format: ENGINE_INPUT_FORMAT,
      input_gzip_b64: encoded,
      input_bytes: Buffer.byteLength(payload, "utf8"),
      stored_bytes: Buffer.byteLength(encoded, "utf8"),
      input_sha256: sha256Hex(payload),
      output_sha256: entry.outputSha256,
    });
  }
  return rows;
}

/** Tabellen findes ikke (endnu): Postgres 42P01 direkte, PGRST205 via PostgREST. */
export function isMissingSnapshotTableError(error) {
  if (!error) return false;
  if (error.code === "42P01" || error.code === "PGRST205") return true;
  const msg = String(error.message ?? "");
  return msg.includes(ENGINE_INPUT_SNAPSHOT_TABLE) && (msg.includes("does not exist") || msg.includes("schema cache"));
}

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`engine input snapshot: timed out after ${ms} ms`)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * Skriv optagne input. Kaster ALDRIG: alle fejl går til Sentry (manglende tabel
 * springes stille over). Returnerer en lille status til logning/tests.
 */
export async function persistEngineInputSnapshots({
  supabase, race, recorder,
  captureExceptionFn = captureException,
  timeoutMs = PERSIST_TIMEOUT_MS,
}) {
  if (!recorder) return { written: 0, skipped: "no-recorder" };
  const raceId = race?.id ?? recorder.raceId;
  const context = { tags: { flow: "race-run", stage: "engine-input-snapshot" }, fingerprint: ["engine-input-snapshot-failed"], raceId };
  for (const err of recorder.errors.splice(0)) captureExceptionFn(err, context);
  if (!recorder.calls.length) return { written: 0, skipped: "no-calls" };
  try {
    const rows = await buildSnapshotRows({ raceId, recorder });
    const { error } = await withTimeout(
      Promise.resolve(supabase.from(ENGINE_INPUT_SNAPSHOT_TABLE).upsert(rows, { onConflict: "race_id,stage_number" })),
      timeoutMs,
    );
    if (error) {
      if (isMissingSnapshotTableError(error)) return { written: 0, skipped: "missing-table" };
      throw Object.assign(new Error(`engine input snapshot: ${error.message}`), { code: error.code });
    }
    recorder.calls.length = 0;
    return { written: rows.length, bytes: rows.map((r) => r.stored_bytes) };
  } catch (err) {
    console.error(`  ⚠️  race ${raceId}: engine input snapshot not stored (${err?.message}) - race run continues`);
    captureExceptionFn(err, context);
    return { written: 0, skipped: "error" };
  }
}

// ── Genafspilning ──────────────────────────────────────────────────────────

/** Række (eller rå base64) → payload-objekt med afkodede motor-argumenter. */
export function decodeSnapshot(rowOrB64) {
  const b64 = typeof rowOrB64 === "string" ? rowOrB64 : rowOrB64?.input_gzip_b64;
  if (!b64) throw new Error("engineInputSnapshot: input_gzip_b64 missing");
  const text = gunzipSync(Buffer.from(b64, "base64")).toString("utf8");
  const payload = JSON.parse(text);
  if (payload.format !== 1) throw new Error(`engineInputSnapshot: unknown format ${payload.format}`);
  return { ...payload, args: decodeValue(payload.args), inputSha256: sha256Hex(text) };
}

/**
 * Kør motoren igen på et afkodet snapshot. revisionOverride (kun v4) kører den
 * samme etape under en kandidat-revision. loadV4/simulateV3 er injicerbare.
 */
export async function replayEngineInput(payload, { revisionOverride = null, loadV4, simulateV3 } = {}) {
  const args = { ...payload.args };
  if (revisionOverride) {
    if (payload.engine !== "v4") throw new Error("engineInputSnapshot: revision override requires a v4 stage");
    if (revisionOverride === "legacy") delete args.rulesRevision;
    else args.rulesRevision = revisionOverride;
  }
  let result;
  if (payload.engine === "v4") {
    const load = loadV4 ?? (await import("./raceEngineV4Bridge.js")).loadRaceEngineV4;
    const engine = await load();
    result = engine.simulateStage(payload.formPeaksOff ? { ...args, formPeaks: false } : args);
  } else if (payload.engine === "v3") {
    const simulate = simulateV3 ?? (await import("./raceSimulator.js")).simulateStage;
    result = simulate(args);
  } else {
    throw new Error(`engineInputSnapshot: unknown engine ${payload.engine}`);
  }
  return { result, outputSha256: hashEngineOutput(result) };
}

/** Kort før/efter-sammenligning af to ranked-lister (rang-skift + tidsforskel). */
export function compareRanked(baseRanked = [], candidateRanked = [], { top = 20 } = {}) {
  const candById = new Map(candidateRanked.map((r) => [r.rider_id, r]));
  const baseById = new Map(baseRanked.map((r) => [r.rider_id, r]));
  // ranked-rækker bærer stageGap (sekunder efter vinderen) i både v3 og v4.
  const gapOf = (r) => r?.stageGap ?? null;
  const moves = baseRanked.slice(0, top).map((b) => {
    const c = candById.get(b.rider_id);
    return { rider_id: b.rider_id, base_rank: b.rank, candidate_rank: c?.rank ?? null, delta: c ? c.rank - b.rank : null, base_gap: gapOf(b), candidate_gap: gapOf(c) };
  });
  const changedRanks = baseRanked.filter((b) => candById.get(b.rider_id)?.rank !== b.rank).length;
  const onlyInBase = baseRanked.filter((b) => !candById.has(b.rider_id)).map((b) => b.rider_id);
  const onlyInCandidate = candidateRanked.filter((c) => !baseById.has(c.rider_id)).map((c) => c.rider_id);
  return {
    sameWinner: baseRanked[0]?.rider_id === candidateRanked[0]?.rider_id,
    changedRanks,
    total: baseRanked.length,
    onlyInBase,
    onlyInCandidate,
    moves,
  };
}
