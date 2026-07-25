// Tests for i18n error-code coverage guard — Refs #2848.
// Kør: node --test scripts/i18n-check-error-codes.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractErrorCodesFromSource,
  collectBackendErrorCodes,
  findMissingErrorCodeTranslations,
  findDeadErrorCodeKeys,
} from "./i18n-check-error-codes.mjs";

test("extractErrorCodesFromSource: direct literal property (res.status(4xx).json({ error, errorCode }))", () => {
  const src = `router.post("/x", (req, res) => {
    return res.status(409).json({ error: "Nope", errorCode: "cannot_afford" });
  });`;
  assert.deepEqual([...extractErrorCodesFromSource(src)], ["cannot_afford"]);
});

test("extractErrorCodesFromSource: single- and double-quoted literals both match", () => {
  const src = `a({ errorCode: 'single_quoted' }); b({ errorCode: "double_quoted" });`;
  assert.deepEqual([...extractErrorCodesFromSource(src)].sort(), ["double_quoted", "single_quoted"]);
});

test("extractErrorCodesFromSource: assignment (boardMembers.js's err.errorCode = \"...\" pattern)", () => {
  const src = `
    const err = new Error("nope");
    err.errorCode = "dna_requires_identity_basis"; // comment after
    throw err;`;
  assert.deepEqual([...extractErrorCodesFromSource(src)], ["dna_requires_identity_basis"]);
});

test("extractErrorCodesFromSource: ternary — BOTH arms are candidate codes", () => {
  const src = `res.json({ errorCode: squadViolation.softCapBuffer ? "squad_full_buffer" : "squad_full" });`;
  assert.deepEqual([...extractErrorCodesFromSource(src)].sort(), ["squad_full", "squad_full_buffer"]);
});

test("extractErrorCodesFromSource: inline lookup table indexed by a variable — all VALUES extracted", () => {
  const src = `
    failed.push({ id: u?.id, errorCode: {
      not_found: "listing_not_found",
      not_owner: "listing_not_owner",
      already_closed: "listing_already_closed",
      invalid_price: "invalid_asking_price",
    }[issue.code] });`;
  assert.deepEqual(
    [...extractErrorCodesFromSource(src)].sort(),
    ["invalid_asking_price", "listing_already_closed", "listing_not_found", "listing_not_owner"].sort()
  );
});

test("extractErrorCodesFromSource: const-assigned lookup table (same shape, `const errorCode = {...}[x]`)", () => {
  const src = `
    const errorCode = {
      not_found: "listing_not_found",
      not_owner: "listing_not_owner",
    }[issue.code];
    return res.status(status).json({ error: message, errorCode });`;
  assert.deepEqual([...extractErrorCodesFromSource(src)].sort(), ["listing_not_found", "listing_not_owner"]);
});

test("extractErrorCodesFromSource: literal 3rd arg to transferExecution.js's failure(status, error, code) helper", () => {
  const src = `return failure(409, "This rider is on an active auction", "rider_on_auction_transfer");`;
  assert.deepEqual([...extractErrorCodesFromSource(src)], ["rider_on_auction_transfer"]);
});

test("extractErrorCodesFromSource: { code: \"...\" } inside getTransferExecutionIssue/getSwapExecutionIssue IS captured (rule 6)", () => {
  const src = `
export function getTransferExecutionIssue({
  rider,
  sellerState,
}) {
  if (!rider) {
    return { code: "seller_no_longer_owns_rider" };
  }
  const sellerViolation = getOutgoingSquadViolation(sellerState);
  if (sellerViolation) {
    return { code: "seller_squad_too_small", ...sellerViolation };
  }
  return null;
}

export function getSwapExecutionIssue({ swap }) {
  if (!swap) {
    return { code: "offered_rider_moved" };
  }
  return null;
}`;
  assert.deepEqual(
    [...extractErrorCodesFromSource(src)].sort(),
    ["offered_rider_moved", "seller_no_longer_owns_rider", "seller_squad_too_small"].sort()
  );
});

test("extractErrorCodesFromSource: { code: \"...\" } inside a SIBLING issue-getter is NOT captured (#2848 — avoids false positives; api.js remaps these, see script header)", () => {
  const src = `
export function getListingCancelIssue(listing, { teamId } = {}) {
  if (!listing) return { code: "not_found" };
  if (listing.seller_team_id !== teamId) return { code: "not_owner" };
  return null;
}`;
  assert.deepEqual([...extractErrorCodesFromSource(src)], []);
});

test("extractErrorCodesFromSource: combines multiple rules across a realistic multi-construct file without cross-contamination", () => {
  const src = `
    res.status(400).json({ error: "x", errorCode: "direct_one" });
    err.errorCode = "assigned_one";
    res.json({ errorCode: cond ? "ternary_a" : "ternary_b" });
    const errorCode = { k: "lookup_one" }[x];
    return failure(409, "msg", "failure_one");
  `;
  assert.deepEqual(
    [...extractErrorCodesFromSource(src)].sort(),
    ["assigned_one", "direct_one", "failure_one", "lookup_one", "ternary_a", "ternary_b"].sort()
  );
});

test("collectBackendErrorCodes: aggregates codes across files and records origin file(s) per code", () => {
  const codeFiles = collectBackendErrorCodes({
    "backend/lib/a.js": `res.json({ errorCode: "shared_code" });`,
    "backend/lib/b.js": `res.json({ errorCode: "shared_code" }); res.json({ errorCode: "only_in_b" });`,
  });
  assert.deepEqual([...codeFiles.get("shared_code")].sort(), ["backend/lib/a.js", "backend/lib/b.js"]);
  assert.deepEqual([...codeFiles.get("only_in_b")], ["backend/lib/b.js"]);
});

test("findMissingErrorCodeTranslations: nothing missing when every code has an entry in every language", () => {
  const missing = findMissingErrorCodeTranslations(
    ["cannot_afford", "rider_retired"],
    { en: { api: { cannot_afford: "x", rider_retired: "y" } }, da: { api: { cannot_afford: "x", rider_retired: "y" } } },
    "api"
  );
  assert.deepEqual(missing, []);
});

test("findMissingErrorCodeTranslations: catches a code missing SYMMETRICALLY in both locales (#2834's actual bug shape)", () => {
  // This is exactly the #2834 postmortem: 3 new errorCode literals had no entry
  // in EITHER locale. i18n-check-keys.mjs (en-vs-da diff only) would stay green
  // here — this guard's whole reason to exist is catching this shape.
  const missing = findMissingErrorCodeTranslations(
    ["cannot_afford", "seller_squad_risk_too_small"],
    { en: { api: { cannot_afford: "x" } }, da: { api: { cannot_afford: "y" } } },
    "api"
  );
  assert.equal(missing.length, 1);
  assert.equal(missing[0].code, "seller_squad_risk_too_small");
  assert.deepEqual(missing[0].missingIn.sort(), ["da", "en"]);
});

test("findMissingErrorCodeTranslations: catches a code missing in only ONE locale", () => {
  const missing = findMissingErrorCodeTranslations(
    ["cannot_afford"],
    { en: { api: { cannot_afford: "x" } }, da: { api: {} } },
    "api"
  );
  assert.equal(missing.length, 1);
  assert.deepEqual(missing[0].missingIn, ["da"]);
});

test("findDeadErrorCodeKeys: flags an errors.json api.* key with no matching backend code, per language", () => {
  const dead = findDeadErrorCodeKeys(
    ["cannot_afford"],
    { en: { api: { cannot_afford: "x", nobody_sends_this: "y" } }, da: { api: { cannot_afford: "x" } } },
    "api"
  );
  assert.deepEqual(dead, [{ key: "nobody_sends_this", lng: "en" }]);
});

test("findDeadErrorCodeKeys: nothing flagged when every translated key matches a backend code", () => {
  const dead = findDeadErrorCodeKeys(
    ["cannot_afford", "rider_retired"],
    { en: { api: { cannot_afford: "x", rider_retired: "y" } } },
    "api"
  );
  assert.deepEqual(dead, []);
});

// Integration test: import the ÆGTE backend source files + the ÆGTE locale
// files and run the same comparison as the CLI script. This is the actual
// forward guard — it fails if a NEW backend errorCode literal is added
// without a matching frontend/public/locales/{en,da}/errors.json entry.
test("integration: every errorCode literal in backend/{lib,routes} has an en+da entry in errors.json's api.* namespace", async () => {
  const { readFileSync, readdirSync } = await import("node:fs");
  const { join, relative, extname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");

  const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
  const LOCALES_DIR = join(ROOT, "frontend", "public", "locales");

  function listJsFilesRecursive(dir) {
    const out = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...listJsFilesRecursive(full));
      else if (entry.isFile() && extname(entry.name) === ".js" && !entry.name.endsWith(".test.js")) out.push(full);
    }
    return out;
  }

  const files = ["backend/lib", "backend/routes"].flatMap((d) => listJsFilesRecursive(join(ROOT, d)));
  const sourcesByFile = {};
  for (const f of files) sourcesByFile[relative(ROOT, f).replace(/\\/g, "/")] = readFileSync(f, "utf8");

  const codeFiles = collectBackendErrorCodes(sourcesByFile);
  const codes = [...codeFiles.keys()];
  assert.ok(codes.length > 50, `sanity check: expected 50+ backend errorCode literals, found ${codes.length}`);

  const loadJSON = (lng) => JSON.parse(readFileSync(join(LOCALES_DIR, lng, "errors.json"), "utf8"));
  const localeDataByLng = { en: loadJSON("en"), da: loadJSON("da") };

  const missing = findMissingErrorCodeTranslations(codes, localeDataByLng, "api");
  assert.deepEqual(missing, [], `errors.json api.* is missing translation(s) for: ${JSON.stringify(missing)}`);
});
