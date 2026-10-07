#!/usr/bin/env node
// Carry-forward: de aktive, tidligere releases' hashede filer kopieres ind i
// dette builds dist/assets (#5162, spor K2).
//
// Kaldes i `frontend/package.json`'s build lige efter `vite build`, fra frontend/:
//   node ../scripts/carry-forward-assets.mjs [--dist <dir>]
//
// Resultat: en fane der kører release A kan efter deploy B stadig hente A's
// chunks på cyclingzone.org/assets/..., med samme immutable-headere, uden CORS
// og uden et ekstra origin. Kun `assets/` bæres videre; app.html, version.json
// og public/ er pr. definition nyeste.
//
// Hvilke releases: `retention.json` fra lageret (skrevet af
// scripts/measure-client-release-age.mjs) FORENET med de 3 nyeste manifester
// (gulvet). Findes retention.json ikke endnu, bruges gulvet alene.
//
// Sikkerhed:
//   · hver hentet fil verificeres mod manifestets sha256 og byte-størrelse;
//     en afvigelse KASTER altid (en forkert chunk under et gammelt navn er
//     værre end en 404, fordi den aldrig selvheler: `immutable`).
//   · en fil der allerede findes i dist med samme navn springes over (samme
//     Rollup-hash = samme indhold; buildets egen fil vinder).
//   · navne valideres (`assets/<fil>`, intet `..`), så et manifest aldrig kan
//     skrive uden for dist/assets.
//
// Uden lager (lokal `npm run build`, CI's markør-build): springer over med en
// tydelig linje og fejler IKKE, ellers kunne ingen bygge lokalt. En netværks-
// eller lagerfejl fejler kun et rigtigt production-build (VERCEL=1 +
// VERCEL_ENV=production) — CZ_CARRY_FORWARD_ALLOW_FAILURE=1 er nødventilen
// hvis lageret er nede og et hotfix skal ud alligevel. I alle andre miljøer
// logges fejlen, og buildet fortsætter uden carry-forward.
//
// Sidecar: listen over båret-videre filer skrives til dist/.cz-carried-forward.json,
// så upload-release-assets.mjs kun registrerer buildets EGNE filer. Upload
// sletter sidecar-filen igen.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  ASSET_PREFIX,
  CARRIED_SIDECAR,
  FLOOR_RELEASES,
  MAX_RELEASES,
  RETENTION_OBJECT_PATH,
  RETENTION_SCHEMA,
  assetObjectPath,
  createStore,
  describeStore,
  isStrictProductionBuild,
  isValidReleaseId,
  listNewestReleaseIds,
  manifestObjectPath,
  mapWithConcurrency,
  readVersionFile,
  resolveStoreConfig,
  validateManifest,
} from "./lib/releaseAssetsStore.mjs";

const LOG_PREFIX = "[release-assets:carry-forward]";

export class IntegrityError extends Error {}

function writeSidecar(distDir, frontend, carried) {
  fs.writeFileSync(
    path.join(distDir, CARRIED_SIDECAR),
    `${JSON.stringify({ frontend, carried: [...carried].sort() }, null, 2)}\n`,
  );
}

/** Release-id'erne fra retention.json (tom liste ved ukendt form). */
export function retentionReleaseIds(retention) {
  if (!retention || retention.schema !== RETENTION_SCHEMA || !Array.isArray(retention.releases)) return [];
  return retention.releases.filter(isValidReleaseId);
}

/**
 * Hvilke releases der bæres videre: retention-listen forenet med gulvet,
 * uden den aktuelle release, i stabil rækkefølge (retention først).
 */
export function selectReleases({ retentionIds, floorIds, currentId }) {
  const out = [];
  for (const id of [...retentionIds, ...floorIds]) {
    if (id !== currentId && !out.includes(id)) out.push(id);
  }
  // Loftet håndhæves af målingen (med alarm). Her er det kun et sidste værn
  // mod en korrupt retention.json, der ellers kunne fylde buildet.
  return out.slice(0, MAX_RELEASES + FLOOR_RELEASES);
}

/**
 * Hvilke filer der skal hentes: alt fra de valgte manifester, som dist ikke
 * allerede har. Samme navn med to forskellige sha256 i to manifester er
 * korruption og kaster.
 */
export function planCarry({ manifests, presentNames }) {
  const present = new Set(presentNames);
  const wanted = new Map();
  for (const manifest of manifests) {
    for (const file of manifest.files) {
      const prior = wanted.get(file.name);
      if (prior && prior.sha256 !== file.sha256) {
        throw new IntegrityError(
          `${file.name} har to forskellige sha256 i manifesterne ${prior.from} og ${manifest.frontend}`,
        );
      }
      if (!prior && !present.has(file.name)) wanted.set(file.name, { ...file, from: manifest.frontend });
    }
  }
  return [...wanted.values()].sort((a, b) => (a.name < b.name ? -1 : 1));
}

export function verifyBytes(file, bytes) {
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  if (bytes.length !== file.bytes || sha256 !== file.sha256) {
    throw new IntegrityError(
      `${file.name} fra release ${file.from} matcher ikke manifestet ` +
        `(forventet ${file.bytes} bytes / ${file.sha256.slice(0, 12)}…, fik ${bytes.length} bytes / ${sha256.slice(0, 12)}…)`,
    );
  }
}

/**
 * @returns {Promise<{status: "skipped"|"carried"|"failed-soft", carried: string[], releases: string[]}>}
 */
export async function carryForwardAssets({ distDir, env = process.env, store: injectedStore, log = console.log, warn = console.warn }) {
  const { frontend } = readVersionFile(distDir);
  const carried = new Set();
  // Skrives FØR noget andet: upload må aldrig læse en sidecar fra et tidligere build.
  writeSidecar(distDir, frontend, carried);

  const config = injectedStore ? { kind: "injected" } : resolveStoreConfig(env);
  if (!injectedStore && config.kind === "none") {
    log(`${LOG_PREFIX} springer over: ${config.reason}. Ingen gamle assets båret videre (forventet lokalt og i CI).`);
    return { status: "skipped", carried: [], releases: [] };
  }
  const store = injectedStore ?? createStore(config);
  const storeLabel = injectedStore ? "injiceret lager" : describeStore(config);

  try {
    const retention = await store.getJson(RETENTION_OBJECT_PATH);
    const retentionIds = retentionReleaseIds(retention);
    const floorIds = (await listNewestReleaseIds(store, FLOOR_RELEASES + 1)).map((row) => row.id);
    const releases = selectReleases({ retentionIds, floorIds, currentId: frontend }).slice();
    if (!retention) log(`${LOG_PREFIX} retention.json findes ikke endnu — bruger gulvet (${FLOOR_RELEASES} nyeste releases).`);

    const manifests = [];
    for (const id of releases) {
      const manifest = await store.getJson(manifestObjectPath(id));
      if (!manifest) {
        warn(`${LOG_PREFIX} ⚠️ retention nævner ${id}, men lageret har intet manifest for den — springes over.`);
        continue;
      }
      manifests.push(validateManifest(manifest, id));
    }

    const presentNames = fs.readdirSync(path.join(distDir, ASSET_PREFIX)).map((n) => `${ASSET_PREFIX}/${n}`);
    const plan = planCarry({ manifests, presentNames });

    let bytesTotal = 0;
    await mapWithConcurrency(plan, 8, async (file) => {
      const bytes = await store.getBytes(assetObjectPath(file.name));
      if (!bytes) throw new IntegrityError(`${file.name} (release ${file.from}) står i manifestet men findes ikke i lageret`);
      verifyBytes(file, bytes);
      fs.writeFileSync(path.join(distDir, file.name), bytes, { flag: "wx" });
      carried.add(file.name);
      bytesTotal += bytes.length;
    });

    const fromReleases = new Set(plan.map((f) => f.from));
    log(
      `${LOG_PREFIX} ${carried.size} filer fra ${fromReleases.size} releases båret videre ` +
        `(${(bytesTotal / 1024 / 1024).toFixed(2)} MB; ${manifests.length} manifester læst, ` +
        `retention ${retentionIds.length} + gulv ${floorIds.length}). Lager: ${storeLabel}.`,
    );
    return { status: "carried", carried: [...carried].sort(), releases: manifests.map((m) => m.frontend) };
  } catch (err) {
    if (err instanceof IntegrityError) throw err;
    const strict = !injectedStore && isStrictProductionBuild(env) && env.CZ_CARRY_FORWARD_ALLOW_FAILURE !== "1";
    if (strict) throw err;
    warn(`${LOG_PREFIX} ⚠️ carry-forward fejlede (${err.message}) — buildet fortsætter UDEN gamle assets.`);
    return { status: "failed-soft", carried: [...carried].sort(), releases: [] };
  } finally {
    writeSidecar(distDir, frontend, carried);
  }
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
    await carryForwardAssets({ distDir, env });
    return 0;
  } catch (err) {
    console.error(`${LOG_PREFIX} ❌ ${err.message}`);
    if (err instanceof IntegrityError) {
      console.error(`${LOG_PREFIX} Integritetsfejl: en båret-videre fil matcher ikke sit manifest. Buildet stoppes (#5162).`);
    } else {
      console.error(`${LOG_PREFIX} Production-build stoppet. Nødventil hvis lageret er nede: CZ_CARRY_FORWARD_ALLOW_FAILURE=1.`);
    }
    return 1;
  }
}

const invokedDirectly = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) {
  process.exitCode = await main();
}
