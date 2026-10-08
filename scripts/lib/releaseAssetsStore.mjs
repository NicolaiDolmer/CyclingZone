// Release-lageret til carry-forward af gamle frontend-assets (#5162, spor K1).
//
// Hvorfor det findes: Vercel serverer præcis ét builds filer pr. deploy. En
// spiller med en åben fane fra deploy A beder efter deploy B om A's chunks, og
// de svarede 404 (audit E2). Løsningen (spec
// docs/drafts/spec-5162-chunk-verdensklasse-2026-09-25.md) er at hvert build
// tager de aktive, tidligere releases' hashede filer med i sit eget
// `dist/assets/`, så A's URL'er stadig svarer 200 på B, på samme origin.
//
// Denne fil er den ENE kilde til bucket-navn, sti-layout, grænser og miljø-
// beslutninger. De tre scripts der bruger den:
//
//   scripts/upload-release-assets.mjs       skriver dette builds filer + manifest
//   scripts/carry-forward-assets.mjs        henter de aktive releases' filer ned
//   scripts/measure-client-release-age.mjs  skriver retention.json (hvilke releases er aktive)
//
// ── Layout i den private bucket `frontend-release-assets` ─────────────────────
//
//   assets/<filnavn>               én kopi pr. hashet filnavn (dedup på navn:
//                                  Rollup-hashen ER indholdet, så to releases
//                                  der deler en chunk deler også objektet)
//   manifests/<frontend-id>.json   pr. release: filnavne + sha256 + bytes
//   retention.json                 listen af aktive release-id'er
//
// Afvigelse fra specens `releases/<id>/assets/<navn>`: med én fil pr. release
// ville dedup på navn ikke kunne ske, og `manifests/` som flad mappe kan
// sorteres på oprettelsestid i ét list-kald (gulvet "3 nyeste").
//
// ── Ingen afhængigheder ──────────────────────────────────────────────────────
//
// Vercel bygger med root directory `frontend/` og installerer kun frontendens
// pakker. Scripts i repo-roden kan derfor ikke importere noget fra
// root-node_modules. Alt her er Node-builtins + global fetch mod Supabase
// Storage's REST-API.

import fs from "node:fs";
import path from "node:path";

export const RELEASE_ASSETS_BUCKET = "frontend-release-assets";
export const ASSET_PREFIX = "assets";
export const MANIFEST_PREFIX = "manifests";
export const RETENTION_OBJECT_PATH = "retention.json";
export const MANIFEST_SCHEMA = 1;
export const RETENTION_SCHEMA = 1;

// Ops-værn (ejer 7/10): reglen er p99-alder + 24 t; 72 t er gulvet, 30 releases
// loftet. Gulvet på 3 nyeste releases holder listen i live hvis telemetrien er
// nede.
export const FLOOR_RELEASES = 3;
export const MAX_RELEASES = 30;
export const MIN_WINDOW_HOURS = 72;
export const MARGIN_HOURS = 24;
export const MEASURE_LOOKBACK_DAYS = 7;

// Sidecar i dist-roden: carry-forward skriver hvilke filer der blev båret
// videre, så upload kun registrerer buildets EGNE filer i manifestet. Ellers
// ville B's manifest også nævne A's filer, og A ville leve videre for evigt
// gennem B. Upload sletter filen igen, så den aldrig deployes.
export const CARRIED_SIDECAR = ".cz-carried-forward.json";

const ASSET_NAME_PATTERN = /^assets\/[A-Za-z0-9._-]+$/;
const RELEASE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** True for et gyldigt asset-navn (`assets/<fil>`), uden mapper eller `..`. */
export function isValidAssetName(name) {
  return typeof name === "string" && ASSET_NAME_PATTERN.test(name) && !name.includes("..");
}

export function isValidReleaseId(id) {
  return typeof id === "string" && RELEASE_ID_PATTERN.test(id);
}

/**
 * Hvilke filer under dist/assets der hører med. Source maps er bevidst UDE:
 * en gammel fane henter dem aldrig (kun devtools gør), Sentry har sin egen
 * kopi, og de er de største filer i buildet.
 */
export function isCarriedAssetFile(name) {
  return isValidAssetName(name) && !name.endsWith(".map");
}

export function manifestObjectPath(releaseId) {
  if (!isValidReleaseId(releaseId)) throw new Error(`Ugyldigt release-id: ${JSON.stringify(releaseId)}`);
  return `${MANIFEST_PREFIX}/${releaseId}.json`;
}

export function assetObjectPath(assetName) {
  if (!isValidAssetName(assetName)) throw new Error(`Ugyldigt asset-navn: ${JSON.stringify(assetName)}`);
  return assetName;
}

const CONTENT_TYPES = {
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".txt": "text/plain",
};

export function contentTypeFor(name) {
  return CONTENT_TYPES[path.extname(name).toLowerCase()] ?? "application/octet-stream";
}

/**
 * Et rigtigt Vercel production-build. KUN her er en manglende nøgle en fejl:
 * lokale builds, CI's markør-/determinisme-builds og preview-deploys skal
 * kunne bygge uden lageret. CI's determinisme-job sætter VERCEL_ENV=production
 * for at ligne prod, men ikke VERCEL=1, så det rammes ikke.
 */
export function isStrictProductionBuild(env = process.env) {
  return env.VERCEL === "1" && env.VERCEL_ENV === "production";
}

/**
 * Hvor lageret er. Returnerer én af:
 *   { kind: "local", dir }              CZ_RELEASE_ASSETS_LOCAL_DIR (CI-kontrakt + tests)
 *   { kind: "supabase", url, key }      prod-bucketen
 *   { kind: "none", reason }            intet lager: spring over
 *
 * Nøglen logges aldrig og indgår aldrig i en fejlbesked.
 */
export function resolveStoreConfig(env = process.env) {
  if (env.CZ_RELEASE_ASSETS_LOCAL_DIR) {
    return { kind: "local", dir: path.resolve(env.CZ_RELEASE_ASSETS_LOCAL_DIR) };
  }
  if (env.CZ_RELEASE_ASSETS_DISABLE === "1") {
    return { kind: "none", reason: "CZ_RELEASE_ASSETS_DISABLE=1" };
  }
  const url = env.CZ_RELEASE_ASSETS_SUPABASE_URL || env.SUPABASE_URL || env.VITE_SUPABASE_URL || "";
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY || "";
  if (!url || !key) {
    const missing = [!url && "SUPABASE_URL", !key && "SUPABASE_SERVICE_ROLE_KEY"].filter(Boolean).join(" + ");
    return { kind: "none", reason: `${missing} mangler i miljøet` };
  }
  return { kind: "supabase", url: url.replace(/\/+$/, ""), key };
}

export function describeStore(config) {
  if (config.kind === "local") return `lokal mappe ${config.dir}`;
  if (config.kind === "supabase") return `Supabase Storage-bucket ${RELEASE_ASSETS_BUCKET} (${safeHost(config.url)})`;
  return `intet lager (${config.reason})`;
}

function safeHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return "ukendt host";
  }
}

export function createStore(config, { fetchImpl = globalThis.fetch } = {}) {
  if (config.kind === "local") return createDirStore(config.dir);
  if (config.kind === "supabase") return createSupabaseStore({ url: config.url, key: config.key, fetchImpl });
  return null;
}

// ── Lager-interface ───────────────────────────────────────────────────────────
//
//   getBytes(objectPath)            Buffer | null (null = findes ikke)
//   getJson(objectPath)             objekt | null
//   put(objectPath, bytes, { contentType, upsert })   { created: boolean }
//   list(prefix, { sort: "name" | "newest", limit })  [{ name, createdAt }]
//
// `name` i list er relativ til prefix (`index-AAA.js`, ikke `assets/index-AAA.js`).

/** Filsystem-lager: CI's "B indeholder A"-kontrakt og testene. */
export function createDirStore(root) {
  const full = (objectPath) => {
    const resolved = path.resolve(root, objectPath);
    if (!resolved.startsWith(path.resolve(root) + path.sep)) throw new Error(`Sti uden for lageret: ${objectPath}`);
    return resolved;
  };
  return {
    kind: "local",
    async getBytes(objectPath) {
      try {
        return fs.readFileSync(full(objectPath));
      } catch (err) {
        if (err.code === "ENOENT") return null;
        throw err;
      }
    },
    async getJson(objectPath) {
      const buf = await this.getBytes(objectPath);
      return buf ? JSON.parse(buf.toString("utf8")) : null;
    },
    async put(objectPath, bytes, { upsert = false } = {}) {
      const target = full(objectPath);
      if (!upsert && fs.existsSync(target)) return { created: false };
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, bytes);
      return { created: true };
    },
    async list(prefix, { sort = "name", limit = Infinity } = {}) {
      const dir = full(prefix);
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile());
      } catch (err) {
        if (err.code === "ENOENT") return [];
        throw err;
      }
      const rows = entries.map((e) => ({
        name: e.name,
        createdAt: fs.statSync(path.join(dir, e.name)).mtime.toISOString(),
      }));
      rows.sort(sort === "newest" ? (a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0) : (a, b) => (a.name < b.name ? -1 : 1));
      return rows.slice(0, limit);
    },
  };
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

async function withRetry(fn, { attempts = 3, baseDelayMs = 400 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!err.retryable || i === attempts - 1) throw err;
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** i));
    }
  }
  throw lastErr;
}

function storageError(message, status, retryable) {
  const err = new Error(message);
  err.status = status;
  err.retryable = retryable;
  return err;
}

// Supabase Storage svarer på et manglende objekt enten 404, eller 400 med
// `{"statusCode":"404","error":"not_found"}` afhængigt af version. Begge er
// "findes ikke", ikke en fejl.
function isNotFound(status, bodyText) {
  if (status === 404) return true;
  return status === 400 && /"statusCode"\s*:\s*"404"|not_found|Object not found/i.test(bodyText);
}

function isDuplicate(status, bodyText) {
  if (status === 409) return true;
  return status === 400 && /"statusCode"\s*:\s*"409"|Duplicate|already exists/i.test(bodyText);
}

function encodePath(objectPath) {
  return objectPath.split("/").map(encodeURIComponent).join("/");
}

/**
 * Supabase Storage via REST. Nøglen sendes i `apikey`; i `Authorization` kun
 * når den er en JWT (legacy service_role). De nye `sb_secret_`-nøgler afvises
 * af gatewayen som Bearer-token, men accepteres i `apikey`.
 */
export function createSupabaseStore({ url, key, bucket = RELEASE_ASSETS_BUCKET, fetchImpl = globalThis.fetch }) {
  if (typeof fetchImpl !== "function") throw new Error("fetch findes ikke i denne Node-version");
  const base = `${url}/storage/v1`;
  const headers = (extra = {}) => ({
    apikey: key,
    ...(key.startsWith("eyJ") ? { Authorization: `Bearer ${key}` } : {}),
    ...extra,
  });

  async function request(method, endpoint, { body, extraHeaders } = {}) {
    let res;
    try {
      res = await fetchImpl(`${base}${endpoint}`, { method, headers: headers(extraHeaders), body });
    } catch (err) {
      throw storageError(`Netværksfejl mod Storage (${method} ${endpoint}): ${err.message}`, 0, true);
    }
    return res;
  }

  return {
    kind: "supabase",
    async getBytes(objectPath) {
      return withRetry(async () => {
        const res = await request("GET", `/object/authenticated/${bucket}/${encodePath(objectPath)}`);
        if (res.ok) return Buffer.from(await res.arrayBuffer());
        const text = await res.text().catch(() => "");
        if (isNotFound(res.status, text)) return null;
        throw storageError(`Storage GET ${objectPath} svarede ${res.status}`, res.status, RETRYABLE_STATUS.has(res.status));
      });
    },
    async getJson(objectPath) {
      const buf = await this.getBytes(objectPath);
      return buf ? JSON.parse(buf.toString("utf8")) : null;
    },
    async put(objectPath, bytes, { contentType = "application/octet-stream", upsert = false } = {}) {
      return withRetry(async () => {
        const res = await request("POST", `/object/${bucket}/${encodePath(objectPath)}`, {
          body: bytes,
          extraHeaders: {
            "Content-Type": contentType,
            "x-upsert": upsert ? "true" : "false",
            "Cache-Control": "max-age=31536000",
          },
        });
        if (res.ok) return { created: true };
        const text = await res.text().catch(() => "");
        if (!upsert && isDuplicate(res.status, text)) return { created: false };
        throw storageError(`Storage PUT ${objectPath} svarede ${res.status}`, res.status, RETRYABLE_STATUS.has(res.status));
      });
    },
    async list(prefix, { sort = "name", limit = Infinity } = {}) {
      const out = [];
      const pageSize = 1000;
      for (let offset = 0; out.length < limit; offset += pageSize) {
        const page = await withRetry(async () => {
          const res = await request("POST", `/object/list/${bucket}`, {
            body: JSON.stringify({
              prefix,
              limit: pageSize,
              offset,
              sortBy: sort === "newest" ? { column: "created_at", order: "desc" } : { column: "name", order: "asc" },
            }),
            extraHeaders: { "Content-Type": "application/json" },
          });
          if (res.ok) return res.json();
          throw storageError(`Storage LIST ${prefix} svarede ${res.status}`, res.status, RETRYABLE_STATUS.has(res.status));
        });
        // Mapper har id = null; kun rigtige objekter tæller.
        for (const row of page) {
          if (row && row.id !== null && typeof row.name === "string") {
            out.push({ name: row.name, createdAt: row.created_at ?? null });
          }
        }
        if (page.length < pageSize) break;
      }
      return out.slice(0, limit);
    },
  };
}

/** Kører `worker` over `items` med højst `limit` samtidige kald. */
export async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

/** Læser `dist/version.json` → { frontend, release }. Kaster hvis id'et mangler. */
export function readVersionFile(distDir) {
  const file = path.join(distDir, "version.json");
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    throw new Error(`Kan ikke læse ${file} (${err.message}) — kørte vite build?`);
  }
  if (!isValidReleaseId(parsed?.frontend)) {
    throw new Error(`${file} har intet gyldigt frontend-id (fik ${JSON.stringify(parsed?.frontend)})`);
  }
  return { frontend: parsed.frontend, release: typeof parsed.release === "string" ? parsed.release : "" };
}

/** Navnene (`assets/<fil>`) på de filer i dist/assets der hører med. */
export function listDistAssets(distDir) {
  const dir = path.join(distDir, ASSET_PREFIX);
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  return entries
    .filter((e) => e.isFile())
    .map((e) => `${ASSET_PREFIX}/${e.name}`)
    .filter(isCarriedAssetFile)
    .sort();
}

/** Validerer et manifest fra lageret. Kaster ved en form der ikke kan stoles på. */
export function validateManifest(manifest, expectedId) {
  if (!manifest || typeof manifest !== "object") throw new Error(`Manifest for ${expectedId} er ikke et objekt`);
  if (manifest.schema !== MANIFEST_SCHEMA) throw new Error(`Manifest for ${expectedId} har ukendt schema ${manifest.schema}`);
  if (manifest.frontend !== expectedId) throw new Error(`Manifest for ${expectedId} bærer id ${manifest.frontend}`);
  if (!Array.isArray(manifest.files)) throw new Error(`Manifest for ${expectedId} mangler files[]`);
  for (const file of manifest.files) {
    if (!isValidAssetName(file?.name) || !/^[0-9a-f]{64}$/.test(file?.sha256 ?? "") || !Number.isInteger(file?.bytes)) {
      throw new Error(`Manifest for ${expectedId} har en ugyldig fil-post: ${JSON.stringify(file)}`);
    }
  }
  return manifest;
}

/** Release-id'erne for de `count` nyeste manifester (nyeste først). */
export async function listNewestReleaseIds(store, count) {
  const rows = await store.list(MANIFEST_PREFIX, { sort: "newest", limit: count });
  return rows
    .map((row) => ({ id: row.name.replace(/\.json$/, ""), createdAt: row.createdAt }))
    .filter((row) => isValidReleaseId(row.id));
}
