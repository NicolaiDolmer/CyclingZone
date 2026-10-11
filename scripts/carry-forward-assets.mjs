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
// (gulvet) OG alle releases afløst inden for tidsgulvets vindue (72 t med en
// frisk måling, ellers 7 døgn; se timeFloorReleaseIds/timeFloorWindowHours).
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
  MEASURE_LOOKBACK_DAYS,
  MIN_WINDOW_HOURS,
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
// Hvor mange manifester tidsgulvet højst kigger på (nyeste først). Rigeligt over
// loftet; et list-kald henter op til 1.000 rækker.
const MANIFEST_SCAN_LIMIT = 200;

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
 * Tidsgulvet (#5162, 11/10): alle releases der er AFLØST inden for de sidste
 * `windowHours` (se timeFloorWindowHours). Afløst-tidspunkt =
 * næste nyere manifests oprettelse; den nyeste lagrede release afløses først
 * af dette build, så den er altid med.
 *
 * Hvorfor: tælle-gulvet "3 nyeste" dækkede kun få timer på en dag med mange
 * deploys (10/10: 7 frontend-releases), og retention.json var aldrig skrevet
 * (målingen springer over uden PostHog-nøgle, og PostHog ser kun spillere med
 * analytics-samtykke). En auktionsfane fra en release afløst ca. 21 t før fik
 * 404, fordi releasen var nr. 5 bagud. Tidsgulvet gælder uanset telemetri.
 *
 * @param {Array<{id: string, createdAt: string|null}>} rows nyeste først
 * @returns {{ ids: string[], capped: string[] }} ids nyeste først; capped = dem
 *          over loftet MAX_RELEASES, som IKKE bæres (kalderen advarer højlydt).
 */
export function timeFloorReleaseIds({ rows, currentId, now = Date.now(), windowHours = MIN_WINDOW_HOURS }) {
  const ordered = rows
    .map((row) => ({ id: row.id, at: Date.parse(row.createdAt ?? "") }))
    .filter((row) => isValidReleaseId(row.id) && Number.isFinite(row.at))
    .sort((a, b) => b.at - a.at);
  const cutoff = now - windowHours * 3_600_000;
  const ids = [];
  for (let i = 0; i < ordered.length; i += 1) {
    const supersededAt = i === 0 ? now : ordered[i - 1].at;
    if (supersededAt < cutoff) break; // ældre rækker er afløst endnu tidligere
    if (ordered[i].id !== currentId) ids.push(ordered[i].id);
  }
  return { ids: ids.slice(0, MAX_RELEASES), capped: ids.slice(MAX_RELEASES) };
}

/**
 * Tidsgulvets vindue. Med en frisk måling (retention.json skrevet inden for
 * 72 t) er det specens gulv, 72 t: målingen bærer selv p99 + 24 t oven i.
 * Uden måling, eller hvis den er gået i stå, kendes p99 ikke, og 10/10-11/10
 * så faner på 80+ t; så bæres hele målevinduet (7 døgn) op til loftet. At
 * bære for meget koster build-størrelse; at bære for lidt koster en frosset side.
 */
export function timeFloorWindowHours(retention, now = Date.now()) {
  const measuredAt = Date.parse(retention?.generated_at ?? "");
  const fresh = retentionReleaseIds(retention).length > 0
    && Number.isFinite(measuredAt)
    && now - measuredAt <= MIN_WINDOW_HOURS * 3_600_000;
  return fresh ? MIN_WINDOW_HOURS : MEASURE_LOOKBACK_DAYS * 24;
}

/**
 * Hvilke releases der bæres videre: gulvet og tidsgulvet forenet med
 * retention-listen, uden den aktuelle release, i stabil rækkefølge.
 *
 * Gulvene kommer FØRST, så det samlede loft aldrig skærer en release der er
 * afløst inden for vinduet væk til fordel for en ældre fra retention.json.
 * Gulvene er selv begrænset (3 nyeste + tidsgulvet ≤ MAX_RELEASES, og de
 * nyeste ligger i begge), så de passer altid under loftet.
 *
 * @returns {{ ids: string[], dropped: string[] }} dropped = over loftet, bæres
 *          IKKE (kalderen advarer højlydt).
 */
export function selectReleases({ retentionIds, floorIds, timeFloorIds = [], currentId }) {
  const out = [];
  for (const id of [...floorIds, ...timeFloorIds, ...retentionIds]) {
    if (id !== currentId && !out.includes(id)) out.push(id);
  }
  // Sidste værn mod en korrupt retention.json, der ellers kunne fylde buildet.
  const cap = MAX_RELEASES + FLOOR_RELEASES;
  return { ids: out.slice(0, cap), dropped: out.slice(cap) };
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
export async function carryForwardAssets({ distDir, env = process.env, store: injectedStore, now = Date.now, log = console.log, warn = console.warn }) {
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
    const newestRows = await listNewestReleaseIds(store, MANIFEST_SCAN_LIMIT);
    const floorIds = newestRows.slice(0, FLOOR_RELEASES + 1).map((row) => row.id);
    const windowHours = timeFloorWindowHours(retention, now());
    const timeFloor = timeFloorReleaseIds({ rows: newestRows, currentId: frontend, now: now(), windowHours });
    if (timeFloor.capped.length > 0) {
      warn(
        `${LOG_PREFIX} ⚠️ ${timeFloor.ids.length + timeFloor.capped.length} releases er afløst inden for ` +
          `${windowHours} t; loftet er ${MAX_RELEASES}. De ${timeFloor.capped.length} ældste bæres IKKE af tidsgulvet.`,
      );
    }
    const selection = selectReleases({ retentionIds, floorIds, timeFloorIds: timeFloor.ids, currentId: frontend });
    const releases = selection.ids;
    if (selection.dropped.length > 0) {
      warn(
        `${LOG_PREFIX} ⚠️ ${selection.dropped.length} releases fra retention.json er over loftet ` +
          `(${MAX_RELEASES + FLOOR_RELEASES}) og bæres IKKE: ${selection.dropped.join(", ")}.`,
      );
    }
    if (windowHours !== MIN_WINDOW_HOURS) {
      log(
        `${LOG_PREFIX} ${retention ? "retention.json er forældet eller tom" : "retention.json findes ikke endnu"} — ` +
          `bruger gulvet (${FLOOR_RELEASES} nyeste) + tidsgulvet (afløst inden for ${windowHours} t: ${timeFloor.ids.length} releases).`,
      );
    }

    const manifests = [];
    for (const id of releases) {
      const manifest = await store.getJson(manifestObjectPath(id));
      if (!manifest) {
        warn(`${LOG_PREFIX} ⚠️ retention nævner ${id}, men lageret har intet manifest for den — springes over.`);
        continue;
      }
      try {
        manifests.push(validateManifest(manifest, id));
      } catch (err) {
        // Et manifest der ikke kan stoles på er en integritetsfejl, ikke en
        // netværksfejl: buildet stoppes i alle miljøer.
        throw new IntegrityError(err.message);
      }
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
        `retention ${retentionIds.length} + gulv ${floorIds.length} + tidsgulv ${timeFloor.ids.length}). Lager: ${storeLabel}.`,
    );
    return { status: "carried", carried: [...carried].sort(), releases: manifests.map((m) => m.frontend) };
  } catch (err) {
    if (err instanceof IntegrityError) throw err;
    const strict = isStrictProductionBuild(env) && env.CZ_CARRY_FORWARD_ALLOW_FAILURE !== "1";
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
