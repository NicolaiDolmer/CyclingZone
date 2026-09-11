import test from "node:test";
import assert from "node:assert/strict";

import {
  computeFrontendContentId,
  FRONTEND_META_NAME,
  VERSION_FILE_NAME,
  frontendContentIdPlugin,
} from "./frontend-content-id.js";

test("samme input giver samme id — ellers ville hvert deploy se ud som en ny frontend", () => {
  const input = {
    assetNames: ["assets/index-AAA.js", "assets/AuctionsPage-BBB.js"],
    files: [["public/chunk-selfheal.js", "hash1"]],
  };
  assert.equal(computeFrontendContentId(input), computeFrontendContentId(input));
});

test("raekkefoelgen i listerne betyder intet — kun indholdet", () => {
  const a = computeFrontendContentId({
    assetNames: ["assets/a.js", "assets/b.js"],
    files: [["public/x", "1"], ["public/y", "2"]],
  });
  const b = computeFrontendContentId({
    assetNames: ["assets/b.js", "assets/a.js"],
    files: [["public/y", "2"], ["public/x", "1"]],
  });
  assert.equal(a, b);
});

test("et aendret chunk-navn (= aendret chunk-indhold) giver et nyt id", () => {
  const before = computeFrontendContentId({ assetNames: ["assets/index-AAA.js"] });
  const after = computeFrontendContentId({ assetNames: ["assets/index-BBB.js"] });
  assert.notEqual(before, after);
});

test("en aendret public-fil giver et nyt id — public kopieres uhashet", () => {
  const before = computeFrontendContentId({ files: [["public/chunk-selfheal.js", "hash1"]] });
  const after = computeFrontendContentId({ files: [["public/chunk-selfheal.js", "hash2"]] });
  assert.notEqual(before, after);
});

test("version.json og patch notes taeller IKKE med — de er deploy-/redaktionsstoej", () => {
  const base = computeFrontendContentId({ assetNames: ["assets/index-AAA.js"] });
  const withNoise = computeFrontendContentId({
    assetNames: ["assets/index-AAA.js", VERSION_FILE_NAME, "patch-notes.json", "patch-notes-meta.json"],
  });
  assert.equal(base, withNoise);
});

test("navne kan ikke kollidere ved sammenklistring (a+b vs ab)", () => {
  const one = computeFrontendContentId({ assetNames: ["ab", "c"] });
  const two = computeFrontendContentId({ assetNames: ["a", "bc"] });
  assert.notEqual(one, two);
});

test("id'et er kort nok til et meta-tag og kun hex", () => {
  const id = computeFrontendContentId({ assetNames: ["assets/index-AAA.js"] });
  assert.match(id, /^[0-9a-f]{16}$/);
});

test("pluginet injicerer meta-tagget og emitterer version.json med BEGGE id'er", () => {
  const plugin = frontendContentIdPlugin({ releaseSha: "sha-123" });
  plugin.configResolved({ build: {}, publicDir: "", root: "" });

  const bundle = { "assets/index-AAA.js": {}, "assets/Page-BBB.js": {} };
  const tags = plugin.transformIndexHtml.handler("<html></html>", { bundle });
  assert.equal(tags.length, 1);
  assert.equal(tags[0].attrs.name, FRONTEND_META_NAME);
  const injectedId = tags[0].attrs.content;
  assert.match(injectedId, /^[0-9a-f]{16}$/);

  const emitted = [];
  plugin.generateBundle.call({ emitFile: (f) => emitted.push(f) }, {}, bundle);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].fileName, VERSION_FILE_NAME);
  const payload = JSON.parse(emitted[0].source);
  assert.equal(payload.release, "sha-123", "git-sha'en beholdes til fejlsporing");
  assert.equal(
    payload.frontend,
    injectedId,
    "HTML'ens id og version.json's id SKAL vaere det samme — ellers ville hver fane tro der var en ny frontend ved foerste tjek",
  );
});

test("pluginet roerer ikke SSR-buildet (dist-ssr er ikke en server-rod)", () => {
  const plugin = frontendContentIdPlugin({ releaseSha: "sha-123" });
  plugin.configResolved({ build: { ssr: "src/entry-server.jsx" }, publicDir: "", root: "" });
  assert.equal(plugin.transformIndexHtml.handler("<html></html>", { bundle: {} }), undefined);
  const emitted = [];
  plugin.generateBundle.call({ emitFile: (f) => emitted.push(f) }, {}, {});
  assert.deepEqual(emitted, []);
});
