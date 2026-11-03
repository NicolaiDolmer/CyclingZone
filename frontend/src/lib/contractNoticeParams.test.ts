import test from "node:test";
import assert from "node:assert/strict";
import { formatBackendParams } from "./backendMessage.js";

test("structured contract lists translate each squad without changing rider names", () => {
  const t = (code: string, params?: Record<string, unknown>): string => {
    if (code === "notif.contractSquad.junior") return "Juniors-local";
    if (code === "notif.contractSquad.u23") return "U23-local";
    if (code === "notif.contractRoster.entry") return `${params?.rider} (${params?.squad}), ${params?.value} CZ$`;
    return code;
  };
  const result = formatBackendParams({ season: 5, contractRiders: [
    { rider: "Rider A", squad: "junior", value: 1200 },
    { rider: "Rider B", squad: "u23", value: 2300 },
  ] }, t);
  assert.equal(result.season, "5");
  assert.ok(typeof result.contractRiders === "string");
  assert.match(result.contractRiders, /Rider A \(Juniors-local\)/);
  assert.match(result.contractRiders, /\nRider B \(U23-local\)/);
});

test("contract list fallback without translator shows no raw squad code or hardcoded currency", () => {
  const result = formatBackendParams({ contractRiders: [
    { rider: "Rider A", squad: "u23", value: 1200 },
    { rider: "Rider B", squad: "academy", value: null },
  ] });
  const lines = String(result.contractRiders).split("\n");
  assert.equal(lines.length, 2);
  assert.ok(lines[0].startsWith("Rider A"));
  assert.equal(lines[1], "Rider B");
  assert.doesNotMatch(String(result.contractRiders), /u23|academy|CZ\$/);
});

test("contract list with translator uses entryUnknown when value is null", () => {
  const t = (code: string, params?: Record<string, unknown>): string =>
    code === "notif.contractRoster.entryUnknown" ? `${params?.rider} unknown` : `${code}:${params?.rider}`;
  const result = formatBackendParams({ contractRiders: [{ rider: "Rider B", squad: "senior", value: null }] }, t);
  assert.equal(result.contractRiders, "Rider B unknown");
});
