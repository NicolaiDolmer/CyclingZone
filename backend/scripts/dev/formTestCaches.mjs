#!/usr/bin/env node
// #6818/#6156 Formtest: laegger prod's form og formtoppe (formTestData.mjs) paa en
// testport-eksport, saa motorTestport --from-dir koerer loebene MED form - som spillet.
//
//   node backend/scripts/dev/formTestCaches.mjs --from-dir=<eksport>/races --form-data=<form-data.json> --out-dir=<ny eksport>/races [--peaks=on|off|tq1]
//
//   --peaks=on   form + formtoppe med spillets traeningskvalitet regnet paa data-dagen (default;
//                for kommende loeb en NEDRE graense, fordi optakten ikke er koert endnu)
//   --peaks=off  kun formen (kontrol: isolerer formtoppenes effekt)
//   --peaks=tq1  form + formtoppe med fuld traeningskvalitet (oevre graense: alle toppe forberedt perfekt)
//
// Formtoppe laegges kun paa fra loebets EGEN saeson (som raceRunner.attachPeakContext:
// rider_peak_plans.season_id = loebets saeson), og etapedagen (peakDay) fra
// race_stage_schedule. Offline, ingen prod. Output er private maalinger: kun under
// balance-internals/ (hard rule 17). Koer motorTestport --from-dir paa de nye caches
// UDEN --routes-from/--synthetic-field: de erstatter profiler/startliste og fjerner peakDay/form.
//
// Refs #6818 #6156 #6158
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertPrivateOutDir } from "./motorTestport.mjs";

export const PEAK_MODES = ["on", "off", "tq1"];

export function parseArgs(argv) {
  const get = (name) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
  const opts = { fromDir: get("from-dir"), formData: get("form-data"), outDir: get("out-dir"), peaks: get("peaks") ?? "on" };
  if (!opts.fromDir || !opts.formData || !opts.outDir) throw new Error("--from-dir, --form-data og --out-dir kraeves");
  if (!PEAK_MODES.includes(opts.peaks)) throw new Error(`--peaks skal vaere ${PEAK_MODES.join(", ")}`);
  assertPrivateOutDir(opts.outDir); // hard rule 17: et mappe-segment skal hedde balance-internals
  return opts;
}

/** Ét loebs cache med form/formtoppe/etapedage. Ren: aendrer ikke input. */
export function withForm(cache, formData, peaks = "on") {
  const raceId = cache.race?.id;
  const seasonId = formData.raceSeason?.[raceId] ?? null;
  const seasonPeaks = (seasonId && formData.peaksBySeason?.[seasonId]) || {};
  const days = formData.stageDays?.[raceId] ?? {};
  const entries = (cache.entries ?? []).map((e) => {
    const form = formData.conditions?.[e.rider_id]?.form;
    const windows = peaks === "off" ? [] : (seasonPeaks[e.rider_id] ?? []).map((w) => ({ start: w.start, end: w.end, trainingQuality: peaks === "tq1" ? 1 : (w.trainingQuality ?? 1) }));
    return { ...e, ...(form != null ? { form } : {}), ...(windows.length ? { peakWindows: windows } : {}) };
  });
  const profiles = (cache.profiles ?? []).map((p) => {
    const day = days[String(p.stage_number)];
    return day != null ? { ...p, peakDay: day } : { ...p };
  });
  return { ...cache, entries, profiles, formTest: { peaks, seasonId, formData: formData.generatedAt ?? null } };
}

export function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  const formData = JSON.parse(readFileSync(opts.formData, "utf8"));
  if (formData.format !== "cz-form-test-data/v1") throw new Error(`${opts.formData}: forkert format (${formData.format})`);
  let n = 0, withPeaks = 0, riders = 0;
  for (const id of readdirSync(opts.fromDir)) {
    const file = path.join(opts.fromDir, id, "cache.json");
    if (!existsSync(file)) continue;
    const out = withForm(JSON.parse(readFileSync(file, "utf8")), formData, opts.peaks);
    mkdirSync(path.join(opts.outDir, id), { recursive: true });
    writeFileSync(path.join(opts.outDir, id, "cache.json"), JSON.stringify(out));
    n += 1;
    riders += out.entries.length;
    withPeaks += out.entries.filter((e) => e.peakWindows).length;
  }
  console.log(`formtest-caches (${opts.peaks}): ${n} loeb, ${riders} startpladser, ${withPeaks} med formtop -> ${opts.outDir}`);
  return { races: n, riders, withPeaks };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
