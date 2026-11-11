# Axe quality gate (#7993, building block 1)

Owner-approved target: new automated accessibility findings block PRs; repaired known debt cannot return. This is a regression gate, not an accessibility compliance target. No player UI/copy or paid service is changed.

## Coverage and baseline

`frontend/tests/e2e/axe-quality.spec.ts` scans eight populated surfaces in desktop Chromium, mobile Chromium and mobile WebKit. It uses the existing mocked application, an explicit browser date, Danish and the light theme. Routes: dashboard, rider database, rider detail, race detail, race tactics, training, auctions, planning calendar. Readiness requires actual fixture content, not merely an empty page. The whole rendered document is scanned with axe's default rules (including contrast); no rules are globally disabled. Incomplete checks are attached for manual assessment, not counted as passing checks. Other languages/themes, expanded dialogs and color-alone semantics need further coverage/manual review.

`axe-baseline.json` is measured debt per browser/surface. Each key is the JSON fingerprint `[ruleId, axeTarget]`, with occurrence count. New keys or higher counts fail. Removed/reduced keys also fail until the automatically generated reduction is committed. Immutable PR-base comparison prevents growing or restoring previously removed debt. A missing file on a successfully read base commit permits this initial bootstrap; an unreadable base fails closed. Engine upgrades require a separate reviewed rebaseline; they cannot silently change the comparator.

Initial 11/11 measurement (axe 4.14.0, unchanged product base 76006e998): 229 rule/node occurrences across 24 scans, including repeated shared shell elements. These are not 229 unique user problems: 181 contrast, 33 label/content-name mismatches, 6 heading-order, 4 scrollable-region-focusable, 3 link-in-text-block, 1 landmark-unique, 1 empty-table-header. The technical PR records debt; fixing player UI still follows the design/preview gate.

## Normal workflow

1. Run all axe cases against the E2E build, through `scripts/verify-lock.ps1 -Max 2`: from frontend, `npx playwright test tests/e2e/axe-quality.spec.ts --retries=0`. Normal tests never update the committed baseline.
2. New findings fail and must be fixed. If only debt was repaired, run `node scripts/update-axe-baseline.mjs` from the root. It requires one fresh report for every case from the same run, rejects duplicates/missing cases, stale revisions/builds/gate inputs, version changes and all new findings, then writes only the reduced baseline. Reports carry a shared run identifier plus a SHA-256 fingerprint of the compiled application, frontend source, shared fixtures and gate inputs; uncommitted changes at the same HEAD cannot masquerade as fresh measurements.
3. Review and commit that generated diff. Rerun the affected cases. CI runs the same test through the existing required `frontend-smoke` collector, and script-only changes trigger it too. Its immutable base SHA is fetched explicitly with failure propagation.

First bootstrap only: local `AXE_CAPTURE=1` produces scan artifacts; `node scripts/update-axe-baseline.mjs --initialize` creates a previously absent baseline. Both refuse bootstrap in GitHub Actions, and initialization cannot overwrite existing debt. Ordinary CI cannot use this escape hatch.

Reports are test attachments and `testInfo.outputPath('axe-scan.json')`, under ignored test results by default. CI retains scan/proof JSON as `axe-scans-<lane>` artifacts on both success and failure. Collect all shard artifacts before using a combined reports directory (`--reports=<directory>`); a partial shard cannot reduce debt. No automatic bot commits or write credentials are needed: generation is automatic, the resulting diff must enter the reviewed PR.

## Proof

Pure tests cover new rules/targets/counts, complete-matrix reduction, malformed/missing reports and no-growth. A real browser fixture scans an unnamed button, repairs its accessible name, automatically reduces the synthetic baseline, and proves the original finding is then rejected. This runs in each of the three browser projects, independently of the application's existing debt. Initial capture and normal gate each passed 27/27 on 11/11; later verification is recorded in the PR.

Sources: [Playwright accessibility testing](https://playwright.dev/docs/accessibility-testing), [axe API](https://github.com/dequelabs/axe-core/blob/develop/doc/API.md). Axe supplements manual checks; a clean automated result does not establish that information never relies on color alone.

Final local verification: 2,053 full browser tests passed, 191 skipped, zero failures (no retries); final axe-only run 27/27 and pure unit tests 7/7. Raw scan fingerprints and real-DOM reduction proofs are committed in [7993-axe-verification.json](metrics/7993-axe-verification.json). The updater accepted all 24 fresh reports and left the 229-occurrence baseline unchanged.

Fresh-checkout regression check: without dist, Playwright test discovery initially failed before its automatic build could start. Fingerprinting now runs in beforeAll after webServer setup. The same no-dist discovery lists all 27 tests, and all 27 browser checks pass. The file-level hook also initializes replacement workers.
