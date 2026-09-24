// #5242 — fokuseret regressionsværn for netværksfejl-grenen i
// riderContractActions.js.
//
// Reviewer-bemærkning fra skive A (PR #5372, kommentar 18/9): grenen manglede
// en dedikeret test. Modulets kontrakt (se filhovedet) er at netværksfejl
// KASTES, fordi kaldstederne (RiderManageActions, TeamPage) fanger dem og
// viser "auth:error.connectionFailed" + sender `cause` til
// reportActionFailure. apiFetch selv kaster ikke længere ved en transportfejl
// (#5322) — uden throwIfNetworkError() ville kaldstedet i stedet få
// { ok:false, data:{} } og vise en generisk ukendt-fejl uden årsag i
// telemetrien (samme klasse regression som #3619).
//
// Modulet opretter en rigtig Supabase-klient ved import (supabase.js), så det
// kan ikke køres direkte i node --test uden en fuld env/mocking-rig — testes
// derfor på kilden, samme mønster som useBlockedAction.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(dir, "riderContractActions.js"), "utf8");

test("throwIfNetworkError() kaster res.error, med et fallback-navn hvis exceptionen mangler", () => {
  assert.match(
    src,
    /function throwIfNetworkError\(res\) \{\s*if \(res\.networkError\) throw res\.error \?\? new Error\("Network request failed"\);\s*\}/,
  );
});

test("fetchRiderQuote() kalder throwIfNetworkError(res) FØR kroppen læses", () => {
  const start = src.indexOf("export async function fetchRiderQuote(");
  const end = src.indexOf("export async function postRiderContractAction(");
  assert.ok(start >= 0 && end > start, "fandt ikke fetchRiderQuote()'s body");
  const body = src.slice(start, end);

  const throwIdx = body.indexOf("throwIfNetworkError(res);");
  const dataReadIdx = body.indexOf("return { ok: res.ok, data: res.data || {} };");
  assert.ok(throwIdx >= 0, "fetchRiderQuote skal kalde throwIfNetworkError(res)");
  assert.ok(dataReadIdx > throwIdx, "throwIfNetworkError skal kaldes FØR kroppen returneres");
});

test("postRiderContractAction() kalder throwIfNetworkError(res) FØR kroppen læses", () => {
  const start = src.indexOf("export async function postRiderContractAction(");
  assert.ok(start >= 0, "fandt ikke postRiderContractAction()");
  const body = src.slice(start);

  const throwIdx = body.indexOf("throwIfNetworkError(res);");
  const dataReadIdx = body.indexOf("return { ok: res.ok, data: res.data || {} };");
  assert.ok(throwIdx >= 0, "postRiderContractAction skal kalde throwIfNetworkError(res)");
  assert.ok(dataReadIdx > throwIdx, "throwIfNetworkError skal kaldes FØR kroppen returneres");
});

test("SESSION_EXPIRED-genvejen kortslutter FØR apiFetch overhovedet kaldes (ingen session = ingen netværkskald)", () => {
  assert.match(src, /const SESSION_EXPIRED = \{ ok: false, data: \{ errorCode: "session_expired" \} \};/);
  const fetchQuoteBody = src.slice(
    src.indexOf("export async function fetchRiderQuote("),
    src.indexOf("export async function postRiderContractAction("),
  );
  assert.match(
    fetchQuoteBody,
    /if \(!headers\) return SESSION_EXPIRED;\s*const res = await apiFetch/,
    "manglende session skal returnere FØR apiFetch kaldes, ikke efter",
  );
});
