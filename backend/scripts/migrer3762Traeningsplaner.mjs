#!/usr/bin/env node
//
// #3762 — migrér training_plans til dagstype-modellen.
//
// EJER-BESLUTNING 14/8: bevar EVNERNE, ikke intensiteten. Fokusset følger med,
// intensiteten følger den nye model. Konsekvensen er MÅLT mod prod, ikke gættet:
// 0 planer skifter hvad de trænes med, og 2.922 af 4.589 skifter niveau — 1.928
// af dem opad, fordi de fysiologiske zoner kun findes som hårde sessioner.
//
// EJER-BESLUTNING 2, samme dag: de 1.928 der rykker OP starter på HVILE.
// Målt: 1.085 af dem har allerede træthed ≥ 70 (median 80), hvor skaderisikoen
// tænder, og migrationen ville derfor koste ~109 skader dag 1 hos managere der
// aldrig har valgt hård træning.
//
// Reglen bor IKKE her — den bor i backend/lib/trainingDayTypes.js
// (normalizeProgram), som er den SAMME funktion fladen bruger til at vise en
// umigreret plan. Det er med vilje: hvis migrationen havde sin egen kopi af
// mapningen, kunne det der VISES og det der SKRIVES divergere.
//
// DRY-RUN ER DEFAULT. `--apply` skriver, og kun rækker der faktisk flytter sig.
// Idempotent: anden kørsel finder 0 at ændre (vogtet af en test).
//
//   node scripts/migrer3762Traeningsplaner.mjs              # dry-run + tabel
//   node scripts/migrer3762Traeningsplaner.mjs --json=ud.json
//   node scripts/migrer3762Traeningsplaner.mjs --apply       # skriver
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY

import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import "dotenv/config";
import { normalizeProgram, dayTypeForProgram, migrationTargetFor } from "../lib/trainingDayTypes.js";

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, ...r] = a.replace(/^--/, "").split("=");
  return [k, r.length ? r.join("=") : true];
}));
const APPLY = args.apply === true || args.apply === "true";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("SUPABASE_URL og SUPABASE_SERVICE_KEY skal vaere sat.");
  process.exit(2);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

// Hent ALLE planer (pagineret — .select() topper ved 1000 rækker uden range).
async function hentAllePlaner() {
  const alle = [];
  const side = 1000;
  for (let fra = 0; ; fra += side) {
    const { data, error } = await supabase
      .from("training_plans")
      .select("id, rider_id, team_id, season_id, focus, intensity")
      .order("id", { ascending: true })
      .range(fra, fra + side - 1);
    if (error) throw new Error(error.message);
    alle.push(...(data ?? []));
    if (!data || data.length < side) break;
  }
  return alle;
}

const planer = await hentAllePlaner();
const foer = new Map();
const efter = new Map();
const aendringer = [];

for (const plan of planer) {
  const fraNoegle = `${plan.focus} + ${plan.intensity}`;
  foer.set(fraNoegle, (foer.get(fraNoegle) ?? 0) + 1);

  const ny = normalizeProgram(plan);
  const tilNoegle = ny.dayType === "rest" || ny.dayType === "recovery"
    ? ny.dayType
    : `${ny.dayType} · ${ny.session} (${ny.intensity})`;
  efter.set(tilNoegle, (efter.get(tilNoegle) ?? 0) + 1);

  if (ny.changed) {
    // Naadesdags-reglen bor i libbet (migrationTargetFor), ikke her — den er
    // ejer-besluttet, den er testet, og den maa ikke kunne divergere fra det
    // fladen viser.
    const maal = migrationTargetFor(plan);
    aendringer.push({
      id: plan.id, fra: fraNoegle, til: `${maal.focus} + ${maal.intensity}`,
      dayType: maal.dayType, focus: maal.focus, intensity: maal.intensity,
      naadesdag: maal.graceDay,
    });
  }
}

// Kontrol-invariant: INGEN plan må skifte fokus, undtagen de rækker der bliver
// til restitution (som pr. definition er en anden dag). Det er ejer-beslutningen,
// og den tjekkes her i stedet for kun at blive påstået i en PR-beskrivelse.
const skiftedeFokus = planer.filter((plan) => {
  const ny = normalizeProgram(plan);
  return ny.focus !== plan.focus && ny.dayType !== "recovery";
});

console.log(`\ntraining_plans: ${planer.length} raekker\n`);
console.log("FOER (fokus + intensitet):");
for (const [k, n] of [...foer.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(5)}  ${k}`);
}
console.log("\nEFTER (dagstype / session):");
for (const [k, n] of [...efter.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(5)}  ${k}`);
}

const hviledage = planer.filter((p) => dayTypeForProgram(p) === "rest").length;

// RETNINGEN betyder mere end antallet, og den er grunden til naadesdags-reglen
// ovenfor: en plan der flytter OP i niveau giver mere traethed hver dag og —
// over traethedsgulvet paa 70 — skaderisiko, uden at manageren har bedt om det.
const naadesdage = aendringer.filter((a) => a.naadesdag).length;
console.log(`\nplaner der flytter sig: ${aendringer.length} af ${planer.length}`);
console.log(`  heraf OP i niveau → starter paa HVILE (ejer 14/8): ${naadesdage}`);
console.log(`  ned i niveau → skrives direkte: ${aendringer.length - naadesdage}`);
console.log(`hviledage i populationen (fokusset var allerede uden virkning): ${hviledage}`);
console.log(`planer der skifter FOKUS (skal vaere 0): ${skiftedeFokus.length}`);

if (args.json) {
  writeFileSync(String(args.json), JSON.stringify({
    total: planer.length,
    foer: Object.fromEntries(foer),
    efter: Object.fromEntries(efter),
    aendringer,
  }, null, 2));
  console.log(`\nskrev ${args.json}`);
}

if (skiftedeFokus.length > 0) {
  console.error("\nSTOP: mindst en plan ville skifte fokus. Det bryder ejer-beslutningen.");
  process.exit(1);
}

if (!APPLY) {
  console.log("\nDRY-RUN — intet skrevet. Koer med --apply naar ejeren har godkendt tallene.");
  process.exit(0);
}

console.log("\n--apply: skriver de aendrede raekker...");
let skrevet = 0;
for (let i = 0; i < aendringer.length; i += 200) {
  const parti = aendringer.slice(i, i + 200);
  for (const a of parti) {
    const { error } = await supabase
      .from("training_plans")
      .update({ focus: a.focus, intensity: a.intensity, updated_at: new Date().toISOString() })
      .eq("id", a.id);
    if (error) throw new Error(`${a.id}: ${error.message}`);
    skrevet++;
  }
  console.log(`  ${skrevet}/${aendringer.length}`);
}

// Post-verify: kør normaliseringen igen mod frisk data. Anden kørsel skal finde 0.
const efterPlaner = await hentAllePlaner();
const restende = efterPlaner.filter((p) => normalizeProgram(p).changed).length;
console.log(`\nskrevet: ${skrevet}`);
console.log(`post-verify: ${restende} raekker staar stadig paa en form modellen ikke tilbyder (skal vaere 0)`);
process.exit(restende === 0 ? 0 : 1);
