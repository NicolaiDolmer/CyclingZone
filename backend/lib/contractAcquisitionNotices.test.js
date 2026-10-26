import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

// Cross-module call-site invariant: a newly added acquisition function must opt
// into the shared warning, including raw academy acquisition RPCs.
test("acquisition functions use the shared contract notice helper", () => {
  const dir = new URL("./", import.meta.url);
  const checked = new Set();
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".js") && !f.endsWith(".test.js") && f !== "contractSeed.js")) {
    const source = readFileSync(new URL(file, dir), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
    const starts = [...source.matchAll(/^(?:export )?(?:async )?function\s+(\w+)\s*\(/gm)];
    for (let i = 0; i < starts.length; i += 1) {
      const body = source.slice(starts[i].index, starts[i + 1]?.index ?? source.length);
      if (!/contractOnAcquirePatch\s*\(|\.rpc\("(?:finalize_academy_acquisition|demote_rider_to_academy)"/.test(body)) continue;
      assert.match(body, /notifyIfContractExpiresThisSeason\s*\(/, `${file}:${starts[i][1]} must warn after acquisition`);
      checked.add(file);
    }
  }
  for (const file of ["academyIntake.js", "academyTransfer.js", "academyGraduation.js", "auctionFinalization.js", "transferExecution.js", "squadEnforcement.js"]) {
    assert.ok(checked.has(file), `${file} remains covered by the inventory`);
  }
});
