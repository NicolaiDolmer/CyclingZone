// Tests for upload-release-assets.mjs + release-lagerets Supabase-adapter (#5162, K1).

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  CARRIED_SIDECAR,
  createDirStore,
  createSupabaseStore,
  isStrictProductionBuild,
  resolveStoreConfig,
} from "./lib/releaseAssetsStore.mjs";
import { buildReleaseManifest, main, uploadDecision, uploadReleaseAssets } from "./upload-release-assets.mjs";

const quiet = () => {};

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `cz-${prefix}-`));
}

function write(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function makeDist({ frontend = "aaaaaaaaaaaaaaaa", assets = { "assets/index-AAA1.js": "own entry\n" } } = {}) {
  const dist = tmp("dist");
  write(dist, "version.json", JSON.stringify({ release: "sha-1", frontend }));
  write(dist, "app.html", "<!doctype html>");
  for (const [name, content] of Object.entries(assets)) write(dist, name, content);
  return dist;
}

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

test("manifest-form: schema, id, built_at og sorterede filer med sha256 + bytes", () => {
  const manifest = buildReleaseManifest({
    frontend: "fe1",
    release: "sha-1",
    builtAt: "2026-10-07T10:00:00.000Z",
    files: [
      { name: "assets/b-BBB1.js", bytes: Buffer.from("bb") },
      { name: "assets/a-AAA1.js", bytes: Buffer.from("a") },
    ],
  });
  assert.deepEqual(manifest, {
    schema: 1,
    frontend: "fe1",
    release: "sha-1",
    built_at: "2026-10-07T10:00:00.000Z",
    files: [
      { name: "assets/a-AAA1.js", sha256: sha("a"), bytes: 1 },
      { name: "assets/b-BBB1.js", sha256: sha("bb"), bytes: 2 },
    ],
  });
});

test("uploader egne filer + manifest; udelader source maps og BAARET-VIDERE filer; sletter sidecar", async () => {
  const dist = makeDist({
    assets: {
      "assets/index-AAA1.js": "own entry\n",
      "assets/index-AAA1.js.map": "{}",
      "assets/style-CSS1.css": ":root{}\n",
      "assets/Old-OLD1.js": "fra en aeldre release\n",
    },
  });
  write(dist, CARRIED_SIDECAR, JSON.stringify({ frontend: "aaaaaaaaaaaaaaaa", carried: ["assets/Old-OLD1.js"] }));
  const storeDir = tmp("store");

  const result = await uploadReleaseAssets({ distDir: dist, env: { CZ_RELEASE_ASSETS_LOCAL_DIR: storeDir }, log: quiet });

  assert.equal(result.status, "uploaded");
  assert.equal(result.excludedCarried, 1);
  const manifest = JSON.parse(fs.readFileSync(path.join(storeDir, "manifests", "aaaaaaaaaaaaaaaa.json"), "utf8"));
  assert.deepEqual(manifest.files.map((f) => f.name), ["assets/index-AAA1.js", "assets/style-CSS1.css"]);
  assert.ok(fs.existsSync(path.join(storeDir, "assets", "index-AAA1.js")));
  assert.ok(!fs.existsSync(path.join(storeDir, "assets", "Old-OLD1.js")), "en aeldre release maa ikke leve videre gennem denne");
  assert.ok(!fs.existsSync(path.join(storeDir, "assets", "index-AAA1.js.map")), "source maps baeres ikke");
  assert.ok(!fs.existsSync(path.join(dist, CARRIED_SIDECAR)), "sidecar-filen maa aldrig deployes");
});

test("eksisterende manifest = no-op (idempotent: samme frontend giver samme id)", async () => {
  const dist = makeDist();
  const puts = [];
  const store = {
    kind: "spy",
    getJson: async () => ({ schema: 1 }),
    getBytes: async () => null,
    list: async () => [],
    put: async (p) => puts.push(p),
  };
  const result = await uploadReleaseAssets({ distDir: dist, store, log: quiet });
  assert.equal(result.status, "exists");
  assert.deepEqual(puts, []);
});

test("dedup paa navn: filer lageret allerede har uploades ikke igen; manifestet skrives sidst", async () => {
  const dist = makeDist({ assets: { "assets/shared-SHR1.js": "delt\n", "assets/new-NEW1.js": "ny\n" } });
  const puts = [];
  const store = {
    kind: "spy",
    getJson: async () => null,
    getBytes: async () => null,
    list: async (prefix) => (prefix === "assets" ? [{ name: "shared-SHR1.js" }] : []),
    put: async (p) => {
      puts.push(p);
      return { created: true };
    },
  };
  const result = await uploadReleaseAssets({ distDir: dist, store, log: quiet });
  assert.equal(result.uploaded, 1);
  assert.deepEqual(puts, ["assets/new-NEW1.js", "manifests/aaaaaaaaaaaaaaaa.json"]);
});

test("upload-fejl kaster, og CLI'en giver exit 1 (buildet fejler bevidst)", async () => {
  const dist = makeDist();
  const store = {
    kind: "spy",
    getJson: async () => null,
    list: async () => [],
    put: async () => {
      throw new Error("Storage PUT svarede 500");
    },
  };
  await assert.rejects(uploadReleaseAssets({ distDir: dist, store, log: quiet }), /500/);

  // CLI-vejen: et lager-mappe-argument der er en FIL kan ikke skrives til.
  const blocker = path.join(tmp("blocker"), "not-a-dir");
  fs.writeFileSync(blocker, "x");
  const errors = [];
  const origError = console.error;
  console.error = (m) => errors.push(m);
  try {
    assert.equal(await main(["--dist", dist], { CZ_RELEASE_ASSETS_LOCAL_DIR: blocker }), 1);
  } finally {
    console.error = origError;
  }
  assert.ok(errors.some((m) => /fejler bevidst/.test(m)));
});

test("uden noegle: lokalt/CI springer over med tydelig linje; Vercel production FEJLER", async () => {
  const dist = makeDist();
  write(dist, CARRIED_SIDECAR, "{}");
  const lines = [];
  const result = await uploadReleaseAssets({ distDir: dist, env: {}, log: (m) => lines.push(m) });
  assert.equal(result.status, "skipped");
  assert.match(lines.join("\n"), /springer over/);
  assert.ok(!fs.existsSync(path.join(dist, CARRIED_SIDECAR)), "sidecar slettes ogsaa ved spring over");

  await assert.rejects(
    uploadReleaseAssets({ distDir: makeDist(), env: { VERCEL: "1", VERCEL_ENV: "production" }, log: quiet }),
    /production-build uden release-lager/,
  );
});

test("CI's determinisme-job (VERCEL_ENV=production uden VERCEL=1) er IKKE strengt", () => {
  assert.equal(isStrictProductionBuild({ VERCEL_ENV: "production" }), false);
  assert.equal(isStrictProductionBuild({ VERCEL: "1", VERCEL_ENV: "preview" }), false);
  assert.equal(isStrictProductionBuild({ VERCEL: "1", VERCEL_ENV: "production" }), true);
});

test("preview med noegle uploader ikke (maa ikke optage gulvets pladser), medmindre det tvinges", () => {
  const supa = { kind: "supabase", url: "https://x.supabase.co", key: "k" };
  assert.equal(uploadDecision(supa, { VERCEL: "1", VERCEL_ENV: "preview" }).upload, false);
  assert.equal(uploadDecision(supa, { VERCEL: "1", VERCEL_ENV: "preview", CZ_RELEASE_ASSETS_UPLOAD: "1" }).upload, true);
  assert.equal(uploadDecision(supa, { VERCEL: "1", VERCEL_ENV: "production" }).upload, true);
});

test("resolveStoreConfig: lokal mappe vinder; ellers URL + noegle; noeglen staar aldrig i reason", () => {
  assert.equal(resolveStoreConfig({ CZ_RELEASE_ASSETS_LOCAL_DIR: "x" }).kind, "local");
  const supa = resolveStoreConfig({ SUPABASE_URL: "https://p.supabase.co/", SUPABASE_SERVICE_ROLE_KEY: "secret-value" });
  assert.equal(supa.kind, "supabase");
  assert.equal(supa.url, "https://p.supabase.co");
  const none = resolveStoreConfig({ SUPABASE_URL: "https://p.supabase.co" });
  assert.equal(none.kind, "none");
  assert.doesNotMatch(none.reason, /secret-value/);
  assert.equal(resolveStoreConfig({ SUPABASE_URL: "u", SUPABASE_SERVICE_KEY: "k", CZ_RELEASE_ASSETS_DISABLE: "1" }).kind, "none");
});

function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, ...init });
    const { status = 200, body = "" } = (await handler(url, init)) ?? {};
    const text = typeof body === "string" ? body : JSON.stringify(body);
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => text,
      json: async () => JSON.parse(text),
      arrayBuffer: async () => new TextEncoder().encode(text).buffer,
    };
  };
  fn.calls = calls;
  return fn;
}

test("Supabase-adapter: 404 og 400/not_found = findes ikke; dublet = created:false; 5xx proeves igen", async () => {
  let attempts = 0;
  const fetchImpl = fakeFetch((url, init) => {
    if (url.endsWith("/missing.json")) return { status: 400, body: { statusCode: "404", error: "not_found" } };
    if (url.endsWith("/gone.json")) return { status: 404 };
    if (init.method === "POST" && url.includes("/object/frontend-release-assets/assets/dup.js")) {
      return { status: 400, body: { statusCode: "409", error: "Duplicate" } };
    }
    if (url.endsWith("/flaky.json")) {
      attempts += 1;
      return attempts < 2 ? { status: 503 } : { status: 200, body: { ok: true } };
    }
    return { status: 500 };
  });
  const store = createSupabaseStore({ url: "https://p.supabase.co", key: "sb_secret_x", fetchImpl });
  assert.equal(await store.getJson("missing.json"), null);
  assert.equal(await store.getJson("gone.json"), null);
  assert.deepEqual(await store.put("assets/dup.js", Buffer.from("x")), { created: false });
  assert.deepEqual(await store.getJson("flaky.json"), { ok: true });
  assert.equal(attempts, 2);
});

test("Supabase-adapter: sb_secret-noegle kun i apikey; legacy JWT ogsaa som Bearer", async () => {
  const fetchImpl = fakeFetch(() => ({ status: 200, body: "{}" }));
  await createSupabaseStore({ url: "https://p.supabase.co", key: "sb_secret_abc", fetchImpl }).getJson("x.json");
  assert.equal(fetchImpl.calls[0].headers.apikey, "sb_secret_abc");
  assert.equal(fetchImpl.calls[0].headers.Authorization, undefined);

  const jwtFetch = fakeFetch(() => ({ status: 200, body: "{}" }));
  await createSupabaseStore({ url: "https://p.supabase.co", key: "eyJhbGc.x.y", fetchImpl: jwtFetch }).getJson("x.json");
  assert.equal(jwtFetch.calls[0].headers.Authorization, "Bearer eyJhbGc.x.y");
  assert.match(jwtFetch.calls[0].url, /\/storage\/v1\/object\/authenticated\/frontend-release-assets\/x\.json$/);
});

test("Supabase-adapter: list paginerer og springer mapper (id null) over", async () => {
  const page1 = Array.from({ length: 1000 }, (_, i) => ({ id: `id${i}`, name: `f${i}.js`, created_at: "2026-10-07T00:00:00Z" }));
  const page2 = [{ id: null, name: "subfolder" }, { id: "last", name: "last.js", created_at: "2026-10-07T00:00:00Z" }];
  const fetchImpl = fakeFetch((_url, init) => (JSON.parse(init.body).offset === 0 ? { body: page1 } : { body: page2 }));
  const rows = await createSupabaseStore({ url: "https://p.supabase.co", key: "k", fetchImpl }).list("assets");
  assert.equal(rows.length, 1001);
  assert.equal(rows.at(-1).name, "last.js");
  assert.equal(JSON.parse(fetchImpl.calls[0].body).prefix, "assets");
});

test("dir-lager naegter stier uden for lageret", async () => {
  const store = createDirStore(tmp("store"));
  await assert.rejects(store.put("../escape.txt", Buffer.from("x")), /uden for lageret/);
});
