#!/usr/bin/env node
// #6818 Read-only tjek foer taend af s5_profiles_v2 (#6820). Skriver intet i prod.
//
//   1. Migrationen 2026-10-17-6818-engine-rules-revision-s5-v2.sql er applied
//      (auto-migrate.yml registrerer den i schema_migrations efter psql -v ON_ERROR_STOP=1,
//      saa raekken findes kun hvis baade erstatningen og VALIDATE lykkedes).
//   2. app_config.race_form_peaks er SLUKKET (ejer 21/10: v2 uden formtoppe), evalueret
//      med spillets egen isRaceFormPeaksEnabled.
//   3. Intet loeb er bundet til s5_profiles_v2 endnu (foer taend: 0).
//   4. Info: S5's startdato og hvor mange ikke-startede S4-loeb der er tilbage
//      (de bindes til s5_profiles_v1 af saesonvaernet, ogsaa efter taend).
//
// Klienten kan kun laese (readOnlyDb). Kun ja/nej og antal printes; intet secret.
// Exit 0 = klar, 1 = ikke klar.
//
// Koer (ejeren, PowerShell):
//   infisical run --env=prod --silent -- node backend/scripts/dev/verifyS5v2Taend.mjs
//
// Refs #6818 #6820
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readOnlyDb } from "./lib/motorTestportInputs.mjs";
import { prodDb } from "./motorTestport.mjs";
import { RACE_FORM_PEAKS_FLAG_KEY, isRaceFormPeaksEnabled } from "../../lib/raceEngineFlag.js";

export const S5_V2_MIGRATION = "2026-10-17-6818-engine-rules-revision-s5-v2.sql";

/**
 * auto-migrate.yml gemmer stien som `find database ...` giver den ("database/<fil>"),
 * aeldre raekker kan staa uden mappe. Match paa filnavnet, uanset praefiks. Ren.
 */
export function migrationRow(rows, file = S5_V2_MIGRATION) {
  return (rows ?? []).find((r) => typeof r?.filename === "string" && r.filename.replace(/\\/g, "/").split("/").pop() === file) ?? null;
}

/** Ren dom over de indsamlede fakta. */
export function verdict({ migrationApplied, formPeaksEnabled, boundToV2 }) {
  const checks = [
    { name: `migration ${S5_V2_MIGRATION} applied`, ok: migrationApplied === true },
    { name: `${RACE_FORM_PEAKS_FLAG_KEY} slukket`, ok: formPeaksEnabled === false },
    { name: "ingen loeb bundet til s5_profiles_v2 endnu", ok: boundToV2 === 0 },
  ];
  return { ready: checks.every((c) => c.ok), checks };
}

export async function main() {
  const db = readOnlyDb(await prodDb());
  // Raekken findes kun hvis auto-migrate koerte filen med ON_ERROR_STOP (erstatning + VALIDATE lykkedes).
  // CHECK-constraint'en selv (pg_constraint) kan ikke laeses via PostgREST uden rpc, og rpc er afvist her.
  const { data: migRows, error: mErr } = await db.from("schema_migrations").select("filename, applied_at").in("filename", [S5_V2_MIGRATION, `database/${S5_V2_MIGRATION}`]);
  if (mErr) throw new Error(`schema_migrations: ${mErr.message}`);
  const mig = migrationRow(migRows);
  const formPeaksEnabled = await isRaceFormPeaksEnabled(db);
  const { count: boundToV2, error: bErr } = await db.from("races").select("id", { count: "exact", head: true }).eq("engine_rules_revision", "s5_profiles_v2");
  if (bErr) throw new Error(`races (v2): ${bErr.message}`);
  const { data: seasons, error: sErr } = await db.from("seasons").select("id, number, status, start_date").in("number", [4, 5]);
  if (sErr) throw new Error(`seasons: ${sErr.message}`);
  const s4 = seasons.find((s) => s.number === 4);
  const s5 = seasons.find((s) => s.number === 5);
  let s4NotStarted = null;
  if (s4) {
    const { count, error } = await db.from("races").select("id", { count: "exact", head: true }).eq("season_id", s4.id).or("stages_completed.is.null,stages_completed.eq.0");
    if (error) throw new Error(`races (S4): ${error.message}`);
    s4NotStarted = count;
  }
  const v = verdict({ migrationApplied: !!mig, formPeaksEnabled, boundToV2 });
  for (const c of v.checks) console.log(`${c.ok ? "OK  " : "FEJL"} ${c.name}`);
  console.log(`info: migration ${mig?.filename ?? "-"} applied_at ${mig?.applied_at ?? "-"} · S5 start_date ${s5?.start_date ?? "-"} (${s5?.status ?? "-"}) · ikke-startede S4-loeb ${s4NotStarted ?? "-"} (bindes til s5_profiles_v1)`);
  console.log(v.ready ? "KLAR til taend (kraever stadig ejerens ordrette \"taend\")" : "IKKE KLAR");
  return v;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const v = await main();
  process.exitCode = v.ready ? 0 : 1;
}
