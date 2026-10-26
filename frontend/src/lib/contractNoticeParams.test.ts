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
  assert.match(result.contractRiders, /Rider A \(Juniors-local\)/);
  assert.match(result.contractRiders, /\nRider B \(U23-local\)/);
});
