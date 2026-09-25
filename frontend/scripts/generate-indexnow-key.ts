#!/usr/bin/env node
// #5493: skriver IndexNow-nøglefilen `frontend/public/<key>.txt` FØR `vite
// build` kører (public/ kopieres 1:1 ind i dist/, samme mekanik som
// sitemap.xml/robots.txt).
//
// Nøglen læses fra INDEXNOW_KEY (Infisical/Vercel env) og må ALDRIG
// hardkodes eller committes — filnavnet ER selve nøglen. Ejeren genererer
// den i Ahrefs: Project settings -> Site Audit -> Crawl settings ->
// IndexNow (https://help.ahrefs.com/en/articles/9317209).
//
// Ubesat (lokalt/preview, jf. VITE_GA_MEASUREMENT_ID-mønstret i
// .env.example) → no-op, IKKE build-fejl: nøglen findes ikke endnu (ejeren
// skal generere den først), og andre laner/udviklere skal fortsat kunne
// bygge uden den.
//
// frontend/.gitignore ignorerer `public/*.txt` (undtagen robots.txt) netop
// fordi denne fil er build-genereret og aldrig må havne i git.
//
// CodeRabbit-fund: uden oprydning overlever en FORRIGE nøgles .txt-fil et
// build med en ny (eller ingen) INDEXNOW_KEY, og bliver kopieret med ind i
// dist/ — en død/forkert nøglefil forbliver hostet. Vi rydder derfor ALLE
// tidligere genererede kandidater (samme mønster som .gitignore: alt
// public/*.txt undtagen robots.txt) FØR vi evt. skriver en ny.
import { readdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PUBLIC_DIR = path.join(__dirname, "..", "public");

// IndexNow-spec: 8-128 tegn, kun [a-zA-Z0-9-]. Vi validerer let for at fange
// en fejl-indsat værdi (fx en hel URL) tidligt frem for at deploye en
// ubrugelig .txt-fil.
const KEY_PATTERN = /^[a-zA-Z0-9-]{8,128}$/;

export function resolveIndexNowKeyPath(publicDir: string, key: string): string {
  return path.join(publicDir, `${key}.txt`);
}

// Alt public/*.txt undtagen robots.txt regnes som en tidligere genereret
// IndexNow-nøglefil (samme undtagelse som frontend/.gitignore).
function removeStaleKeyFiles(publicDir: string): void {
  let entries: string[];
  try {
    entries = readdirSync(publicDir);
  } catch {
    return; // public/ findes ikke endnu (fx et isoleret test-scenarie) — intet at rydde.
  }
  for (const name of entries) {
    if (!name.endsWith(".txt") || name === "robots.txt") continue;
    rmSync(path.join(publicDir, name), { force: true });
  }
}

export function main(env: NodeJS.ProcessEnv = process.env, publicDir: string = DEFAULT_PUBLIC_DIR): void {
  removeStaleKeyFiles(publicDir);
  const key = (env.INDEXNOW_KEY || "").trim();
  if (!key) {
    console.log("generate-indexnow-key: INDEXNOW_KEY er ikke sat — springer over (#5493).");
    return;
  }
  if (!KEY_PATTERN.test(key)) {
    throw new Error(
      `generate-indexnow-key: INDEXNOW_KEY matcher ikke IndexNow-formatet ([a-zA-Z0-9-]{8,128}) — fik en værdi på ${key.length} tegn.`,
    );
  }
  const target = resolveIndexNowKeyPath(publicDir, key);
  writeFileSync(target, key, "utf-8");
  console.log(`generate-indexnow-key: skrev ${path.basename(target)} (#5493).`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
