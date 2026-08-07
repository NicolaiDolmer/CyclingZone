// scripts/lint-t2-container-guard.test.mjs
// ============================================================
// Tests for the T2-container forward-guard (#3454).
// Run: node --test scripts/lint-t2-container-guard.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { findT2CandidatesInSource, scanPages, ALLOWLIST } from "./lint-t2-container-guard.mjs";

test("flags a page using DataTable inside a max-w-4xl container", () => {
  const src = `
    export default function X() {
      return (
        <div className="max-w-4xl mx-auto">
          <DataTable columns={cols} rows={rows} />
        </div>
      );
    }
  `;
  assert.equal(findT2CandidatesInSource(src), true);
});

test("does not flag a page using DataTable inside a T2 (max-w-[1600px]) container", () => {
  const src = `
    export default function X() {
      return (
        <div className="mx-auto max-w-[1600px]">
          <DataTable columns={cols} rows={rows} />
        </div>
      );
    }
  `;
  assert.equal(findT2CandidatesInSource(src), false);
});

test("does not flag a T1 page with no DataTable at all", () => {
  const src = `
    export default function X() {
      return (
        <div className="max-w-4xl mx-auto">
          <Card>Some reading content</Card>
        </div>
      );
    }
  `;
  assert.equal(findT2CandidatesInSource(src), false);
});

test("does not flag a page that only imports DataTable without rendering it", () => {
  const src = `
    import { DataTable } from "../components/ui";
    export default function X() {
      return <div className="max-w-4xl mx-auto">no table used here</div>;
    }
  `;
  // Import line alone must not match the JSX-usage regex.
  assert.equal(findT2CandidatesInSource(src), false);
});

test("ignores matches inside comments", () => {
  const src = `
    // old pattern: <DataTable /> used to live in a max-w-4xl container here
    export default function X() {
      return <div className="max-w-4xl mx-auto">reading content</div>;
    }
  `;
  assert.equal(findT2CandidatesInSource(src), false);
});

test("real repo scan: every DataTable+max-w-4xl page is either fixed or allowlisted with a reason", () => {
  const hits = scanPages();
  const unallowed = hits.filter((f) => !(f in ALLOWLIST));
  assert.deepEqual(
    unallowed,
    [],
    `T2-container-guard fund uden begrundelse (kør node scripts/lint-t2-container-guard.mjs):\n${unallowed.join("\n")}`
  );
  // Allowlisten skal kun indeholde begrundede strenge, aldrig tomme entries.
  for (const [file, reason] of Object.entries(ALLOWLIST)) {
    assert.ok(reason && reason.length > 20, `ALLOWLIST-entry for ${file} mangler en reel begrundelse`);
  }
});
