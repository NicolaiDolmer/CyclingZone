#!/usr/bin/env node
// Upload af dette builds hashede assets + manifest til release-lageret (#5162, K1).
//
// Kaldes SIDST i `frontend/package.json`'s build, fra frontend/:
//   node ../scripts/upload-release-assets.mjs [--dist <dir>]
//
// Hvad det gør:
//   1. læser `dist/version.json` (frontend-id'et er release-nøglen),
//   2. lister dist/assets (uden source maps) og trækker de filer fra som
//      carry-forward lige har båret videre fra ÆLDRE releases (sidecar-filen),
//   3. uploader de filer lageret ikke allerede har (dedup på navn),
//   4. skriver `manifests/<id>.json` til sidst. Findes manifestet allerede,
//      er der intet at gøre (idempotent: samme frontend = samme id).
//
// Hvornår det kører:
//   · rigtigt Vercel production-build (VERCEL=1 + VERCEL_ENV=production):
//     uploader, og en manglende nøgle eller en fejlet upload FEJLER buildet.
//     Ellers har næste deploy intet at bære med, og hullet er tilbage uden at
//     nogen ser det (spec §A.2).
//   · preview-deploy med nøgle: springer over. Preview-releases må ikke
//     optage pladser i gulvet "3 nyeste releases". Kan tvinges med
//     CZ_RELEASE_ASSETS_UPLOAD=1 (fx en bevidst A→B-prøve).
//   · lokalt/CI uden nøgle: springer over med en tydelig linje.
//   · CZ_RELEASE_ASSETS_LOCAL_DIR=<mappe>: uploader til en lokal mappe (CI-kontrakt).
//
// Sidecar-filen slettes ALTID (også ved spring over), så den aldrig deployes.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  ASSET_PREFIX,
  CARRIED_SIDECAR,
  MANIFEST_SCHEMA,
  assetObjectPath,
  contentTypeFor,
  createStore,
  describeStore,
  isStrictProductionBuild,
  listDistAssets,
  manifestObjectPath,
  mapWithConcurrency,
  readVersionFile,
  resolveStoreConfig,
} from "./lib/releaseAssetsStore.mjs";

const LOG_PREFIX = "[release-assets:upload]";

/** Læser og fjerner sidecar-filen. Returnerer de båret-videre navne. */
export function consumeCarriedSidecar(distDir) {
  const file = path.join(distDir, CARRIED_SIDECAR);
  let carried = [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (Array.isArray(parsed?.carried)) carried = parsed.carried.filter((n) => typeof n === "string");
  } catch (err) {
    if (err.code !== "ENOENT") throw new Error(`${file} kunne ikke læses: ${err.message}`);
  }
  fs.rmSync(file, { force: true });
  return carried;
}

/** Ren manifest-opbygning. `files` er [{ name, bytes: Buffer }]. */
export function buildReleaseManifest({ frontend, release, builtAt, files }) {
  return {
    schema: MANIFEST_SCHEMA,
    frontend,
    release,
    built_at: builtAt,
    files: files
      .map(({ name, bytes }) => ({
        name,
        sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
        bytes: bytes.length,
      }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
  };
}

/** Om dette miljø skal uploade, givet et lager. */
export function uploadDecision(config, env = process.env) {
  if (config.kind === "none") {
    if (isStrictProductionBuild(env)) {
      return { upload: false, fail: true, reason: `production-build uden release-lager: ${config.reason}` };
    }
    return { upload: false, fail: false, reason: config.reason };
  }
  if (config.kind === "local") return { upload: true };
  if (env.VERCEL_ENV === "production" || env.CZ_RELEASE_ASSETS_UPLOAD === "1") return { upload: true };
  return {
    upload: false,
    fail: false,
    reason: `VERCEL_ENV=${env.VERCEL_ENV || "(tom)"}: kun production uploader (CZ_RELEASE_ASSETS_UPLOAD=1 tvinger)`,
  };
}

/**
 * Selve uploadet. Kaster ved enhver fejl — kalderen gør det til exit 1.
 * @returns {Promise<{status: "skipped"|"exists"|"uploaded", ...}>}
 */
export async function uploadReleaseAssets({ distDir, env = process.env, store: injectedStore, now = () => new Date(), log = console.log }) {
  const carried = new Set(consumeCarriedSidecar(distDir));
  const config = injectedStore ? { kind: injectedStore.kind || "injected" } : resolveStoreConfig(env);
  const decision = injectedStore ? { upload: true } : uploadDecision(config, env);

  if (!decision.upload) {
    if (decision.fail) throw new Error(decision.reason);
    log(`${LOG_PREFIX} springer over: ${decision.reason}. Næste deploy kan ikke bære denne release videre.`);
    return { status: "skipped", reason: decision.reason };
  }

  const store = injectedStore ?? createStore(config);
  const storeLabel = injectedStore ? "injiceret lager" : describeStore(config);
  const { frontend, release } = readVersionFile(distDir);
  const manifestPath = manifestObjectPath(frontend);

  if (await store.getJson(manifestPath)) {
    log(`${LOG_PREFIX} manifest for ${frontend} findes allerede i ${storeLabel} — intet at uploade.`);
    return { status: "exists", frontend };
  }

  const own = listDistAssets(distDir).filter((name) => !carried.has(name));
  if (own.length === 0) throw new Error(`${path.join(distDir, ASSET_PREFIX)} har ingen egne assets — buildet er tomt`);
  const files = own.map((name) => ({ name, bytes: fs.readFileSync(path.join(distDir, name)) }));

  const existing = new Set((await store.list(ASSET_PREFIX)).map((row) => `${ASSET_PREFIX}/${row.name}`));
  const missing = files.filter((file) => !existing.has(file.name));

  await mapWithConcurrency(missing, 6, async (file) => {
    await store.put(assetObjectPath(file.name), file.bytes, { contentType: contentTypeFor(file.name), upsert: false });
  });

  const manifest = buildReleaseManifest({ frontend, release, builtAt: now().toISOString(), files });
  // Manifestet skrives SIDST: findes det, er alle dets filer i lageret. En
  // afbrudt upload efterlader kun filer uden manifest, og næste forsøg
  // fortsætter hvor den slap.
  await store.put(manifestPath, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`), {
    contentType: "application/json",
    upsert: false,
  });

  const totalBytes = missing.reduce((sum, file) => sum + file.bytes.length, 0);
  log(
    `${LOG_PREFIX} release ${frontend}: ${files.length} filer i manifestet, ${missing.length} nye uploadet ` +
      `(${(totalBytes / 1024).toFixed(1)} KB), ${files.length - missing.length} delt med ældre releases, ` +
      `${carried.size} båret-videre filer udeladt. Lager: ${storeLabel}.`,
  );
  return { status: "uploaded", frontend, fileCount: files.length, uploaded: missing.length, excludedCarried: carried.size };
}

function parseArgs(argv) {
  const opts = { distDir: path.resolve(process.cwd(), "dist") };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--dist") opts.distDir = path.resolve(argv[++i]);
    else throw new Error(`Ukendt argument: ${argv[i]}`);
  }
  return opts;
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  try {
    const { distDir } = parseArgs(argv);
    await uploadReleaseAssets({ distDir, env });
    return 0;
  } catch (err) {
    console.error(`${LOG_PREFIX} ❌ ${err.message}`);
    console.error(`${LOG_PREFIX} Buildet fejler bevidst: uden manifest kan næste deploy ikke bære denne release videre (#5162).`);
    return 1;
  }
}

const invokedDirectly = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) {
  process.exitCode = await main();
}
