// #5259 forward-guard: et stadie-flag der findes i koden men ikke i
// STAGE_FLAGS skal fejle HER — ikke ved at ejeren ikke kan flytte det fra
// admin-fladen. Samme moenster som notificationTypes.test.js (#3016).
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  FLAG_STAGES,
  STAGE_FLAGS,
  findStageFlag,
  isStageFlagKey,
  isUnknownStageValue,
  isValidFlagStage,
  normalizeStageValue,
} from "./stageFlagCatalog.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = join(__dirname, "..");

function collectJsFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules") continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) collectJsFiles(full, out);
    else if (entry.endsWith(".js") && !entry.endsWith(".test.js")) out.push(full);
  }
  return out;
}

// `evaluateFlagStage(await readFlagStage(<klient>, <noegle-udtryk>)` — noeglen
// er enten en strengliteral ("facilities_enabled" i economyEngine.js) eller et
// identifier der er defineret som en strengliteral i SAMME fil (det moenster
// alle *Flag.js-modulerne foelger).
const CALL_RE = /evaluateFlagStage\(\s*await\s+readFlagStage\(\s*\w+\s*,\s*([^)]+?)\s*\)/g;
const CONST_RE = /(?:export\s+)?const\s+([A-Z][A-Z0-9_]*)\s*=\s*"([^"]+)"/g;
// ACADEMY.FLAG_KEY-formen: et objekt-felt der er en strengliteral.
const FIELD_RE = /\b([A-Z][A-Z0-9_]*)\s*:\s*"([^"]+)"/g;

function resolveKeysInFile(source) {
  const literals = new Map();
  for (const m of source.matchAll(CONST_RE)) literals.set(m[1], m[2]);
  const fields = new Map();
  for (const m of source.matchAll(FIELD_RE)) fields.set(m[1], m[2]);

  const keys = [];
  for (const m of source.matchAll(CALL_RE)) {
    const expr = m[1].trim();
    const quoted = expr.match(/^"([^"]+)"$/);
    if (quoted) { keys.push(quoted[1]); continue; }
    if (literals.has(expr)) { keys.push(literals.get(expr)); continue; }
    // OBJEKT.FELT — slaa feltet op (fx ACADEMY.FLAG_KEY).
    const dotted = expr.match(/^[A-Za-z_$][\w$]*\.([A-Z][A-Z0-9_]*)$/);
    if (dotted && fields.has(dotted[1])) { keys.push(fields.get(dotted[1])); continue; }
    // Uoploeselig — rapportér som sig selv, saa testen fejler synligt i stedet
    // for tavst at springe et rigtigt flag over.
    keys.push(`UNRESOLVED:${expr}`);
  }
  return keys;
}

test("#5259: hver evaluateFlagStage-noegle i backend staar i STAGE_FLAGS", () => {
  const missing = [];
  for (const file of collectJsFiles(BACKEND_ROOT)) {
    const source = readFileSync(file, "utf8");
    if (!source.includes("evaluateFlagStage")) continue;
    for (const key of resolveKeysInFile(source)) {
      if (!isStageFlagKey(key)) missing.push(`${key} (${file.replace(BACKEND_ROOT, "backend")})`);
    }
  }
  assert.deepEqual(
    missing,
    [],
    `Stadie-flag uden post i backend/lib/stageFlagCatalog.js — ejeren kan ikke flytte dem fra admin-fladen:\n${missing.join("\n")}`,
  );
});

test("#5259: scanneren finder faktisk noegler (guard mod en regex der er holdt op med at matche)", () => {
  const source = readFileSync(join(BACKEND_ROOT, "lib", "boardMandateFlag.js"), "utf8");
  assert.deepEqual(resolveKeysInFile(source), ["board_mandate_model_enabled"]);
});

test("#5259: kataloget har unikke noegler og kendte omraader", () => {
  const keys = STAGE_FLAGS.map((f) => f.key);
  assert.equal(new Set(keys).size, keys.length, "dubletnoegle i STAGE_FLAGS");
  for (const flag of STAGE_FLAGS) {
    assert.ok(flag.label?.length > 0, `mangler label: ${flag.key}`);
    assert.ok(flag.area?.length > 0, `mangler area: ${flag.key}`);
  }
});

test("#5259: email_loop og rider_reputation er IKKE i kataloget", () => {
  // De har egne tre-tilstande (off|dry_run|on og off|shadow|on). Et "beta"
  // skrevet paa dem ville vaere en vaerdi ingen kode forstaar.
  assert.equal(isStageFlagKey("email_loop_enabled"), false);
  assert.equal(isStageFlagKey("rider_reputation_enabled"), false);
});

test("#5259: normalizeStageValue er bagudkompatibel med boolean-skemaet", () => {
  assert.equal(normalizeStageValue(true), "on");
  assert.equal(normalizeStageValue("on"), "on");
  assert.equal(normalizeStageValue("beta"), "beta");
  assert.equal(normalizeStageValue(false), "off");
  assert.equal(normalizeStageValue("off"), "off");
  assert.equal(normalizeStageValue(null), "off");
  assert.equal(normalizeStageValue("vrøvl"), "off");
});

test("#5259: isUnknownStageValue skelner drift fra fravaer", () => {
  assert.equal(isUnknownStageValue(null), false);
  assert.equal(isUnknownStageValue(undefined), false);
  assert.equal(isUnknownStageValue(true), false);
  assert.equal(isUnknownStageValue("beta"), false);
  assert.equal(isUnknownStageValue("dry_run"), true);
  assert.equal(isUnknownStageValue(42), true);
});

test("#5259: isValidFlagStage accepterer praecis de tre stadier", () => {
  assert.deepEqual(FLAG_STAGES, ["off", "beta", "on"]);
  for (const s of FLAG_STAGES) assert.equal(isValidFlagStage(s), true);
  assert.equal(isValidFlagStage("dry_run"), false);
  assert.equal(isValidFlagStage(true), false);
});

test("#5259: findStageFlag slaar op paa noegle", () => {
  assert.equal(findStageFlag("board_mandate_model_enabled").area, "board");
  assert.equal(findStageFlag("findes_ikke"), null);
});
