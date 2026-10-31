// #7390 · Sæt én privat indstilling i private_config (kun på ejerens ordrette go).
//
// Flow:
//   1. Læs værdien fra --file (JSON) og valider den mod registret
//      (backend/lib/privateConfig.ts). Ukendt nøgle eller ugyldig værdi = stop.
//   2. Læs den nuværende række og vis forskellen VÆRDI-FRIT for private nøgler:
//      hash før/efter + hvilke felter der tilføjes, fjernes eller ændres.
//      Klartekst vises kun for nøgler der ikke er markeret private.
//   3. --dry-run stopper her. Ellers skrives rækken med service-rollen.
//      Optimistisk vagt: en eksisterende række opdateres kun hvis updated_at
//      stadig er den læste (ingen stille overskrivning af en samtidig ændring).
//   4. Rækken læses tilbage, valideres igen og hashen sammenlignes: kun et match
//      tæller som bekræftet. Triggeren har logget gammel og ny værdi i
//      private_config_history.
//
// Værdi-filen hører hjemme uden for repoet (fx balance-internals/, gitignoreret);
// ingen balance-tal i repoet (hard rule 17).
//
// Brug (fra backend/):
//   infisical run --env=prod -- node scripts/ops/setPrivateConfig.mjs --key development_curve_b_params --file ../balance-internals/curve-b.json --dry-run
//   infisical run --env=prod -- node scripts/ops/setPrivateConfig.mjs --key development_curve_b_params --file ../balance-internals/curve-b.json
//   ... --actor "claude (ejer-go 30/10)"   # updated_by (default "claude")

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PRIVATE_CONFIG_KEYS, PRIVATE_CONFIG_TABLE, canonicalJson, changedPaths, clearPrivateConfigCache,
  privateConfigHash, privateConfigSpec, validatePrivateConfigValue,
} from "../../lib/privateConfig.ts";

export function parseArgs(argv) {
  const out = { key: null, file: null, dryRun: false, actor: "claude", help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) throw new Error(`${a} kræver en værdi`);
      return v;
    };
    if (a === "--key") out.key = next();
    else if (a.startsWith("--key=")) out.key = a.slice(6);
    else if (a === "--file") out.file = next();
    else if (a.startsWith("--file=")) out.file = a.slice(7);
    else if (a === "--actor") out.actor = next();
    else if (a.startsWith("--actor=")) out.actor = a.slice(8);
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else throw new Error(`Ukendt argument: ${a}`);
  }
  return out;
}

/**
 * Den værdi-frie (for private nøgler) beskrivelse af ændringen.
 * Returnerer linjer, så testen kan låse at tallene aldrig står i output.
 */
export function describeChange({ key, spec, before, after }) {
  const lines = [
    `Nøgle: ${key} (${spec.private ? "privat: kun hash og felter vises" : "ikke privat"})`,
    `Hash før:  ${privateConfigHash(before)}`,
    `Hash efter: ${privateConfigHash(after)}`,
  ];
  const paths = before === null || before === undefined ? ["(ny række)"] : changedPaths(before, after);
  lines.push(paths.length ? `Felter der ændres: ${paths.join(", ")}` : "Felter der ændres: ingen");
  if (!spec.private) {
    lines.push(`Før:   ${before === null || before === undefined ? "(ingen)" : canonicalJson(before)}`);
    lines.push(`Efter: ${canonicalJson(after)}`);
  }
  return lines;
}

/**
 * Kernen (testbar med en falsk klient). Kaster med en værdi-fri besked ved fejl.
 * Returnerer { status: "unchanged" | "dry-run" | "written", lines }.
 */
export async function runSetPrivateConfig({ supabase, key, value, dryRun = false, actor = "claude", log = console }) {
  const spec = privateConfigSpec(key);
  if (!spec) throw new Error(`Ukendt nøgle ${JSON.stringify(key)}. Kendte: ${Object.keys(PRIVATE_CONFIG_KEYS).join(", ")}`);
  if (!value || typeof value !== "object") throw new Error("Værdien skal være et JSON-objekt eller -array");
  const checked = validatePrivateConfigValue(spec.parse, value);
  if (!checked.ok) throw new Error(`Ugyldig værdi for ${key}: ${checked.reason}`);
  if (typeof actor !== "string" || !actor.trim()) throw new Error("--actor må ikke være tom");

  const { data: current, error: readError } = await supabase
    .from(PRIVATE_CONFIG_TABLE).select("value, updated_at").eq("key", key).maybeSingle();
  if (readError) throw new Error(`Læsning af ${key} fejlede: ${readError.message ?? readError}`);
  const before = current?.value ?? null;

  const lines = describeChange({ key, spec, before, after: value });
  for (const line of lines) log.log(line);

  if (before !== null && canonicalJson(before) === canonicalJson(value)) {
    log.log("Ingen ændring: værdien er allerede sat. Intet skrevet.");
    return { status: "unchanged", lines };
  }
  if (dryRun) {
    log.log("DRY-RUN: intet skrevet.");
    return { status: "dry-run", lines };
  }

  if (current) {
    const { data: updated, error } = await supabase
      .from(PRIVATE_CONFIG_TABLE)
      .update({ value, updated_by: actor.trim() })
      .eq("key", key)
      .eq("updated_at", current.updated_at)
      .select("key");
    if (error) throw new Error(`Skrivning af ${key} fejlede: ${error.message ?? error}`);
    if (!Array.isArray(updated) || updated.length !== 1) {
      throw new Error(`${key} blev ændret af en anden siden læsningen. Intet skrevet; kør igen.`);
    }
  } else {
    const { error } = await supabase.from(PRIVATE_CONFIG_TABLE).insert({ key, value, updated_by: actor.trim() });
    if (error) throw new Error(`Oprettelse af ${key} fejlede: ${error.message ?? error}`);
  }
  clearPrivateConfigCache();

  // Læs tilbage: samme hash og stadig gyldig.
  const { data: back, error: backError } = await supabase
    .from(PRIVATE_CONFIG_TABLE).select("value, updated_at, updated_by").eq("key", key).maybeSingle();
  if (backError) throw new Error(`Tilbagelæsning af ${key} fejlede: ${backError.message ?? backError}`);
  if (!back || canonicalJson(back.value) !== canonicalJson(value)) {
    throw new Error(`Tilbagelæsning af ${key} matcher ikke det skrevne (hash ${privateConfigHash(back?.value)}). Tjek private_config_history.`);
  }
  if (!validatePrivateConfigValue(spec.parse, back.value).ok) throw new Error(`Tilbagelæst ${key} er ugyldig. Tjek private_config_history.`);
  const confirmed = `Bekræftet: ${key} = hash ${privateConfigHash(back.value)}, updated_at ${back.updated_at}, updated_by ${back.updated_by}.`;
  log.log(confirmed);
  return { status: "written", lines: [...lines, confirmed] };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.key || !args.file) {
    console.log("Brug: node scripts/ops/setPrivateConfig.mjs --key <noegle> --file <vaerdi.json> [--dry-run] [--actor <navn>]");
    console.log(`Kendte nøgler: ${Object.keys(PRIVATE_CONFIG_KEYS).join(", ")}`);
    process.exit(args.help ? 0 : 2);
  }
  let value;
  try {
    value = JSON.parse(readFileSync(resolve(args.file), "utf8"));
  } catch {
    // Beskeden må ikke citere filens indhold.
    console.error(`Kunne ikke læse gyldig JSON fra ${args.file}`);
    process.exit(2);
  }
  const here = dirname(fileURLToPath(import.meta.url));
  dotenv.config({ path: join(here, "..", "..", ".env"), quiet: true });
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
    process.exit(2);
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
  await runSetPrivateConfig({ supabase, key: args.key, value, dryRun: args.dryRun, actor: args.actor });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((err) => { console.error(err?.message || err); process.exit(1); });
}
