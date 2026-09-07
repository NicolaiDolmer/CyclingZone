#!/usr/bin/env node
// #4819 — ryd forældreløse filer i Storage-bucketen `forum-images`.
//
// HVORFOR SCRIPTET FINDES
// Billeder uploades FØR indlægget sendes, så et fejlet upload aldrig koster
// brugeren sin tekst (se frontend/src/components/forum/ForumImagePicker.jsx).
// Prisen er at en fil kan blive liggende hvis nogen lukker editoren uden at
// sende. Fjern-krydset i editoren sletter selv filen; dette script fanger
// resten.
//
// SIKKERHED
// - Dry-run er DEFAULT. Intet slettes uden --execute.
// - Kun filer ÆLDRE end --min-age-hours (default 24) kommer i betragtning, så
//   en fil der lige er uploadet til en editor der stadig er åben aldrig
//   rammes.
// - En fil slettes kun hvis dens sti IKKE findes i images-kolonnen på hverken
//   forum_posts eller forum_replies (slettede indlæg tæller med som
//   reference — soft delete kan rulles tilbage).
// - Idempotent: en kørsel mere finder simpelthen ingenting.
//
// Kør:
//   node scripts/sweep-forum-image-orphans.mjs                 # dry-run
//   node scripts/sweep-forum-image-orphans.mjs --execute
//   node scripts/sweep-forum-image-orphans.mjs --min-age-hours 72
//
// Forudsætninger i backend/.env: SUPABASE_URL, SUPABASE_SERVICE_KEY.

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import process from "node:process";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "../backend/.env"), quiet: true });

const BUCKET = "forum-images";
const PAGE_SIZE = 100;
const ROW_PAGE_SIZE = 1000;

function parseArgs(argv) {
  const args = { execute: false, minAgeHours: 24 };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === "--execute") args.execute = true;
    else if (argv[i] === "--min-age-hours") args.minAgeHours = Number(argv[i + 1]);
  }
  if (!Number.isFinite(args.minAgeHours) || args.minAgeHours < 0) args.minAgeHours = 24;
  return args;
}

/** Alle stier der er refereret af et indlæg eller et svar (også soft-slettede). */
async function loadReferencedPaths(supabase) {
  const referenced = new Set();
  for (const table of ["forum_posts", "forum_replies"]) {
    let from = 0;
    for (;;) {
      const { data, error } = await supabase
        .from(table)
        .select("id, images")
        .order("id", { ascending: true })
        .range(from, from + ROW_PAGE_SIZE - 1);
      if (error) throw new Error(`could not read ${table}: ${error.message}`);
      for (const row of data || []) {
        for (const img of Array.isArray(row.images) ? row.images : []) {
          if (img && typeof img.path === "string") referenced.add(img.path);
        }
      }
      if (!data || data.length < ROW_PAGE_SIZE) break;
      from += ROW_PAGE_SIZE;
    }
  }
  return referenced;
}

/** Alle objekter i bucketen som `<mappe>/<fil>` plus deres oprettelsestid. */
async function listBucketObjects(supabase) {
  const objects = [];
  const folders = [];

  let offset = 0;
  for (;;) {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .list("", { limit: PAGE_SIZE, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw new Error(`could not list bucket root: ${error.message}`);
    for (const entry of data || []) {
      // Rod-niveauet er brugermapper (id === null for en mappe-placeholder).
      if (!entry.id) folders.push(entry.name);
    }
    if (!data || data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  for (const folder of folders) {
    let folderOffset = 0;
    for (;;) {
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .list(folder, { limit: PAGE_SIZE, offset: folderOffset, sortBy: { column: "name", order: "asc" } });
      if (error) throw new Error(`could not list ${folder}: ${error.message}`);
      for (const entry of data || []) {
        if (!entry.id) continue;
        objects.push({ path: `${folder}/${entry.name}`, createdAt: entry.created_at || null });
      }
      if (!data || data.length < PAGE_SIZE) break;
      folderOffset += PAGE_SIZE;
    }
  }

  return objects;
}

async function main() {
  const args = parseArgs(process.argv);
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error("SUPABASE_URL / SUPABASE_SERVICE_KEY mangler i backend/.env");
    process.exit(1);
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const cutoff = Date.now() - args.minAgeHours * 60 * 60 * 1000;
  const [referenced, objects] = await Promise.all([
    loadReferencedPaths(supabase),
    listBucketObjects(supabase),
  ]);

  const orphans = objects.filter((obj) => {
    if (referenced.has(obj.path)) return false;
    // Uden et tidsstempel kan vi ikke vide om filen lige er uploadet — så
    // lader vi den ligge. Fail closed.
    if (!obj.createdAt) return false;
    return new Date(obj.createdAt).getTime() < cutoff;
  });

  console.log(`Bucket ${BUCKET}: ${objects.length} filer, ${referenced.size} refererede stier.`);
  console.log(`Foraeldreloese og aeldre end ${args.minAgeHours} timer: ${orphans.length}`);
  for (const orphan of orphans) console.log(`  ${orphan.path}  (${orphan.createdAt})`);

  if (!orphans.length) return;
  if (!args.execute) {
    console.log("\nDry-run. Koer med --execute for at slette dem.");
    return;
  }

  for (let i = 0; i < orphans.length; i += PAGE_SIZE) {
    const batch = orphans.slice(i, i + PAGE_SIZE).map((o) => o.path);
    const { error } = await supabase.storage.from(BUCKET).remove(batch);
    if (error) throw new Error(`could not remove batch: ${error.message}`);
    console.log(`Slettet ${batch.length} filer.`);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
