// Tests for carry-forward-assets.mjs (#5162, K2).
//
// Lageret er en lokal mappe (samme interface som Supabase-bucketen), så
// testene kører hele kæden: release A og B uploades, release C bygges og skal
// bagefter kunne servere A's og B's filer.

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { CARRIED_SIDECAR } from "./lib/releaseAssetsStore.mjs";
import { IntegrityError, carryForwardAssets, main, planCarry, selectReleases } from "./carry-forward-assets.mjs";
import { uploadReleaseAssets } from "./upload-release-assets.mjs";

const quiet = () => {};

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `cz-${prefix}-`));
}

function write(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function makeDist(frontend, assets) {
  const dist = tmp(`dist-${frontend}`);
  write(dist, "version.json", JSON.stringify({ release: `sha-${frontend}`, frontend }));
  for (const [name, content] of Object.entries(assets)) write(dist, name, content);
  return dist;
}

/** Uploader en release til lageret og sætter manifestets mtime (= oprettelsestid). */
async function publish(storeDir, frontend, assets, ageMinutes) {
  const dist = makeDist(frontend, assets);
  await uploadReleaseAssets({ distDir: dist, env: { CZ_RELEASE_ASSETS_LOCAL_DIR: storeDir }, log: quiet });
  const when = new Date(Date.now() - ageMinutes * 60_000);
  fs.utimesSync(path.join(storeDir, "manifests", `${frontend}.json`), when, when);
  return dist;
}

const env = (storeDir, extra = {}) => ({ CZ_RELEASE_ASSETS_LOCAL_DIR: storeDir, ...extra });
const readSidecar = (dist) => JSON.parse(fs.readFileSync(path.join(dist, CARRIED_SIDECAR), "utf8"));

test("filer fra 2 releases baeres videre; delt navn springes over; sidecar navngiver kun de baarne", async () => {
  const store = tmp("store");
  await publish(store, "relA", { "assets/index-AAA1.js": "A entry\n", "assets/Auctions-AUC1.js": "A auctions\n", "assets/shared-SHR1.js": "delt\n" }, 30);
  await publish(store, "relB", { "assets/index-BBB1.js": "B entry\n", "assets/shared-SHR1.js": "delt\n" }, 20);

  const distC = makeDist("relC", { "assets/index-CCC1.js": "C entry\n", "assets/shared-SHR1.js": "delt\n" });
  const lines = [];
  const result = await carryForwardAssets({ distDir: distC, env: env(store), log: (m) => lines.push(m), warn: quiet });

  assert.equal(result.status, "carried");
  assert.deepEqual(result.carried, ["assets/Auctions-AUC1.js", "assets/index-AAA1.js", "assets/index-BBB1.js"]);
  assert.equal(fs.readFileSync(path.join(distC, "assets/index-AAA1.js"), "utf8"), "A entry\n");
  assert.equal(fs.readFileSync(path.join(distC, "assets/shared-SHR1.js"), "utf8"), "delt\n", "buildets egen fil vinder");
  assert.deepEqual(readSidecar(distC).carried, result.carried);
  assert.match(lines.join("\n"), /3 filer fra 2 releases båret videre/);
  assert.match(lines.join("\n"), /retention\.json findes ikke endnu/);

  // Upload af C bagefter registrerer KUN C's egne filer.
  await uploadReleaseAssets({ distDir: distC, env: env(store), log: quiet });
  const manifestC = JSON.parse(fs.readFileSync(path.join(store, "manifests", "relC.json"), "utf8"));
  assert.deepEqual(manifestC.files.map((f) => f.name), ["assets/index-CCC1.js", "assets/shared-SHR1.js"]);
});

test("retention.json styrer hvilke releases der baeres (forenet med gulvet)", async () => {
  const store = tmp("store");
  await publish(store, "relOld", { "assets/old-OLD1.js": "gammel\n" }, 500);
  for (const [i, id] of ["rel1", "rel2", "rel3", "rel4"].entries()) {
    await publish(store, id, { [`assets/p-${id.toUpperCase()}x.js`]: `${id}\n` }, 100 - i * 10);
  }
  write(store, "retention.json", JSON.stringify({ schema: 1, releases: ["rel4", "relOld"] }));

  const dist = makeDist("relNew", { "assets/index-NEW1.js": "ny\n" });
  const result = await carryForwardAssets({ distDir: dist, env: env(store), log: quiet, warn: quiet });
  // retention: rel4 + relOld; gulv (3 nyeste + 1 for den aktuelle): rel4, rel3, rel2, rel1.
  assert.deepEqual(result.releases, ["rel4", "relOld", "rel3", "rel2", "rel1"]);
  assert.ok(fs.existsSync(path.join(dist, "assets/old-OLD1.js")), "retention holder en gammel release i live");
});

test("sha256-mismatch KASTER altid, ogsaa lokalt (en forkert fil bag immutable selvheler aldrig)", async () => {
  const store = tmp("store");
  await publish(store, "relA", { "assets/index-AAA1.js": "A entry\n" }, 10);
  fs.writeFileSync(path.join(store, "assets", "index-AAA1.js"), "MANIPULERET\n");
  const dist = makeDist("relB", { "assets/index-BBB1.js": "B\n" });
  await assert.rejects(carryForwardAssets({ distDir: dist, env: env(store), log: quiet, warn: quiet }), IntegrityError);
  assert.ok(!fs.existsSync(path.join(dist, "assets/index-AAA1.js")), "den forkerte fil skrives ikke");
  assert.deepEqual(readSidecar(dist).carried, []);
});

test("samme navn med to forskellige sha256 i to manifester = korruption", () => {
  const sha = (c) => c.repeat(64);
  assert.throws(
    () =>
      planCarry({
        manifests: [
          { frontend: "a", files: [{ name: "assets/x-X1.js", sha256: sha("a"), bytes: 1 }] },
          { frontend: "b", files: [{ name: "assets/x-X1.js", sha256: sha("b"), bytes: 1 }] },
        ],
        presentNames: [],
      }),
    IntegrityError,
  );
});

test("uden noegle: springer over med tydelig linje og exit 0 (lokalt build skal virke)", async () => {
  const dist = makeDist("relA", { "assets/index-AAA1.js": "A\n" });
  const lines = [];
  const result = await carryForwardAssets({ distDir: dist, env: {}, log: (m) => lines.push(m) });
  assert.equal(result.status, "skipped");
  assert.match(lines[0], /springer over: .*mangler i miljøet/);
  assert.deepEqual(readSidecar(dist), { frontend: "relA", carried: [] });

  const origLog = console.log;
  console.log = quiet;
  try {
    assert.equal(await main(["--dist", dist], {}), 0);
  } finally {
    console.log = origLog;
  }
});

test("lagerfejl: preview/lokal fortsaetter uden carry-forward; Vercel production fejler; noedventil virker", async () => {
  const store = tmp("store");
  write(store, "retention.json", "{ ikke json");
  const dist = () => makeDist("relA", { "assets/index-AAA1.js": "A\n" });

  const soft = await carryForwardAssets({ distDir: dist(), env: env(store, { VERCEL: "1", VERCEL_ENV: "preview" }), log: quiet, warn: quiet });
  assert.equal(soft.status, "failed-soft");

  await assert.rejects(
    carryForwardAssets({ distDir: dist(), env: env(store, { VERCEL: "1", VERCEL_ENV: "production" }), log: quiet, warn: quiet }),
    SyntaxError,
  );

  const valve = await carryForwardAssets({
    distDir: dist(),
    env: env(store, { VERCEL: "1", VERCEL_ENV: "production", CZ_CARRY_FORWARD_ALLOW_FAILURE: "1" }),
    log: quiet,
    warn: quiet,
  });
  assert.equal(valve.status, "failed-soft");
});

test("retention naevner en release uden manifest: advarsel, ikke fejl", async () => {
  const store = tmp("store");
  await publish(store, "relA", { "assets/index-AAA1.js": "A\n" }, 10);
  write(store, "retention.json", JSON.stringify({ schema: 1, releases: ["relGhost", "relA"] }));
  const warnings = [];
  const result = await carryForwardAssets({
    distDir: makeDist("relB", { "assets/index-BBB1.js": "B\n" }),
    env: env(store),
    log: quiet,
    warn: (m) => warnings.push(m),
  });
  assert.deepEqual(result.releases, ["relA"]);
  assert.match(warnings.join("\n"), /relGhost/);
});

test("den aktuelle release baeres aldrig ind i sig selv, og listen er dublet-fri", () => {
  assert.deepEqual(selectReleases({ retentionIds: ["b", "a", "cur"], floorIds: ["cur", "b", "c"], currentId: "cur" }), ["b", "a", "c"]);
});

test("et manifest kan ikke skrive uden for dist/assets", async () => {
  const store = tmp("store");
  write(store, "manifests/relEvil.json", JSON.stringify({
    schema: 1,
    frontend: "relEvil",
    files: [{ name: "assets/../../evil.js", sha256: crypto.createHash("sha256").update("x").digest("hex"), bytes: 1 }],
  }));
  await assert.rejects(
    carryForwardAssets({ distDir: makeDist("relB", { "assets/index-BBB1.js": "B\n" }), env: env(store), log: quiet, warn: quiet }),
    /ugyldig fil-post/,
  );
});
