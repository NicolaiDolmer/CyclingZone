// #5443 · DEN EKSTRAORDINÆRE VÆRDIKØRSEL (ejer-beslutning 3, 20/9 aften).
//
// Rytterværdier flytter sig normalt KUN søndag fra kl. 06 dansk tid, med ét
// dato-claim pr. søndag (sundayValueSweep.js, ECONOMY_RULES §9.1). Ejeren har
// besluttet at model-skiftet skal ud som ÉN ekstraordinær kørsel uden for
// søndagen, så snart spillerbeskeden er ude og han selv siger "kør".
//
// Dette script er den sikre vej til præcis dén ene kørsel. Det er IKKE en ny
// værdi-motor: der findes ingen formel i filen. Den skriver gennem
// refreshChangedRiderValues — nøjagtig samme funktion som søndagen kalder, med
// samme model-valg, samme baselines og samme diff-regel ("skriv kun det der
// faktisk ændrer sig"). Alt andet ville betyde at det ejeren godkendte i
// tørkørslen og det der lander i databasen var to forskellige regnestykker.
//
// ── FEM LÅSE FØR DER SKRIVES NOGET ──────────────────────────────────────────
//   1. Tørkørsel er DEFAULT. Uden --apply skrives intet, nogensinde.
//   2. --apply kræver BÅDE --confirm "<sætningen nedenfor>" OG
//      VALUE_EVENT_5443_OWNER_ACK=true i miljøet. To ting man ikke rammer ved
//      et uheld, og ingen af dem ligger i scriptet.
//   3. app_config.rider_valuation_model SKAL stå på 'v5'. Står den på v4, er
//      kørslen enten for tidlig eller et forsøg på at regne den gamle model
//      igennem uden for søndagen — begge dele nægtes.
//   4. Backup af de fire kolonner kørslen kan skrive tages FØR første
//      skrivning, og verificeres (antal rækker) før der gås videre.
//   5. Dagen claimes i rider_value_sunday_log FØR mutationen — samme mutex som
//      søndagen bruger. Er dagen allerede claimet, køres der ikke. Det er det
//      der gør "én gang" til en garanti og ikke en hensigt.
//
// ── ROLLBACK ────────────────────────────────────────────────────────────────
//   --rollback lægger de fire kolonner tilbage fra backup-tabellen. Den kræver
//   sin egen bekræftelses-sætning. VIGTIGT: sæt app_config-nøglen tilbage til
//   'v4' FØR eller umiddelbart efter rollbacken — ellers skriver den
//   førstkommende søndagskørsel v5-værdierne igen.
//
// ── SÅDAN KØRES DEN (ejeren, fra repo-roden) ────────────────────────────────
//   Tørkørsel (read-only):
//     infisical run --env=prod --silent -- node backend/scripts/riderValueExtraordinaryRun5443.js
//   Rigtig kørsel:
//     $env:VALUE_EVENT_5443_OWNER_ACK="true"
//     infisical run --env=prod --silent -- node backend/scripts/riderValueExtraordinaryRun5443.js --apply --confirm "KOER VAERDISKIFTET 5443"
//   Rollback:
//     $env:VALUE_EVENT_5443_OWNER_ACK="true"
//     infisical run --env=prod --silent -- node backend/scripts/riderValueExtraordinaryRun5443.js --rollback --confirm "RUL VAERDISKIFTET 5443 TILBAGE"
//
//   Nemmere: scripts/run-value-event-5443.ps1 (klik Run) gør det samme med
//   ordentlige spørgsmål undervejs. Runbook: docs/runbooks/5443-ekstraordinaer-vaerdikoersel.md
//
// Forudsætninger i databasen (begge kommer med PR'ens migrationer):
//   - public.backup_5443_value_event_20260920  (database/2026-09-20-5443-value-event-backup.sql)
//   - public.rider_value_sunday_log            (database/2026-08-30-4419-rider-value-sunday-log.sql)

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { fetchAllRows } from "../lib/supabasePagination.js";
import { refreshChangedRiderValues } from "../lib/riderValueRefresh.js";
import {
  RIDER_VALUE_PHASE_STEP_KEY,
  readProductionValueModelId,
  readValuationModelId,
  writePhaseStep,
} from "../lib/riderValuationModelSelect.js";
import { copenhagenDateString, copenhagenWeekdayKey } from "../lib/copenhagenTime.js";
import { RIDER_VALUE_SUNDAY_LOG_TABLE } from "../lib/sundayValueSweep.js";

export const BACKUP_TABLE = "backup_5443_value_event_20260920";
export const APPLY_CONFIRM_PHRASE = "KOER VAERDISKIFTET 5443";
export const ROLLBACK_CONFIRM_PHRASE = "RUL VAERDISKIFTET 5443 TILBAGE";
export const OWNER_ACK_ENV = "VALUE_EVENT_5443_OWNER_ACK";
export const REQUIRED_MODEL_ID = "v5";
// Ejer-beslutning 2 (20/9 aften): loengrundlaget bliver paa v4 under netop
// denne begivenhed. Staar noeglen anderledes, er forudsaetningen brudt.
export const DEFAULT_WAGE_MODEL_ID = "v4";

// De kolonner kørslen kan skrive, og dermed præcis dem backuppen skal
// bære. Holdes i ÉN konstant, så backup og rollback ikke kan komme i utakt.
export const BACKED_UP_COLUMNS = Object.freeze([
  "base_value", "current_production_value", "primary_type", "secondary_type",
  "best_role", "best_role_rating",
]);

const WRITE_CONCURRENCY = 25;
const UPSERT_BATCH = 500;

// ── Rene hjælpere (testbare uden DB) ────────────────────────────────────────

/**
 * Hvad blokerer en rigtig kørsel? Returnerer en liste af menneskelæselige
 * grunde; tom liste = klar. Ren funktion, så låsene kan testes uden en DB —
 * det er dem hele sikkerheden hviler på.
 * @param {{apply:boolean, confirm:string|null, ownerAck:boolean, modelId:string,
 *          wageModelId:string, weekday:string}} state
 */
export function applyBlockers({ apply, confirm, ownerAck, modelId, wageModelId, weekday }) {
  const blockers = [];
  if (!apply) return blockers; // tørkørsel har ingen låse
  if (confirm !== APPLY_CONFIRM_PHRASE) {
    blockers.push(`--apply kraever --confirm "${APPLY_CONFIRM_PHRASE}"`);
  }
  if (!ownerAck) {
    blockers.push(`--apply kraever ${OWNER_ACK_ENV}=true i miljoeet`);
  }
  if (modelId !== REQUIRED_MODEL_ID) {
    blockers.push(
      `app_config.rider_valuation_model staar paa '${modelId}', ikke '${REQUIRED_MODEL_ID}'`
      + " - flip noeglen foerst, ellers ville koerslen skrive den gamle models tal uden for soendagen"
    );
  }
  // Ejer-beslutning 2: loennen venter. Staar loen-noeglen paa noget andet end
  // v4, ville netop denne koersel ogsaa flytte fremtidige loenkrav - det
  // modsatte af beslutningen. En advarsel er ikke nok, for koerslen er
  // engangs og backuppen er allerede brugt naar man opdager det.
  if (wageModelId !== DEFAULT_WAGE_MODEL_ID) {
    blockers.push(
      `app_config.rider_production_value_model staar paa '${wageModelId}', ikke '${DEFAULT_WAGE_MODEL_ID}'`
      + " - ejer-beslutning 2 (20/9) var at loengrundlaget bliver paa v4 indtil forlaengelserne er overstaaet"
    );
  }
  // Soendagen har sin EGEN koersel og sit eget claim. Deler de to dato, kan
  // denne koersel enten blive blokeret af soendagens claim (efter at have
  // brugt sin engangs-backup) eller selv spaerre for soendagen.
  if (weekday === "sun") {
    blockers.push(
      "i dag er soendag - den ordinaere soendagskoersel ejer dagen."
      + " Den ekstraordinaere koersel er en undtagelse FRA soendagen, ikke en ekstra soendag."
    );
  }
  return blockers;
}

/** Samme, for tilbagerulningen. Modellen er bevidst IKKE en lås her: en
 *  rollback skal kunne køres uanset hvad nøglen står på. */
export function rollbackBlockers({ confirm, ownerAck }) {
  const blockers = [];
  if (confirm !== ROLLBACK_CONFIRM_PHRASE) {
    blockers.push(`--rollback kraever --confirm "${ROLLBACK_CONFIRM_PHRASE}"`);
  }
  if (!ownerAck) blockers.push(`--rollback kraever ${OWNER_ACK_ENV}=true i miljoeet`);
  return blockers;
}

/**
 * Hvilke ryttere skal skrives tilbage? Kun dem hvor mindst én af de fire
 * kolonner afviger fra backuppen — samme "skriv kun det der ændrer sig"-regel
 * som selve kørslen, så en gentagen rollback er et no-op.
 * @param {Array<object>} backupRows
 * @param {Map<string, object>} currentById
 */
export function rollbackUpdates(backupRows, currentById) {
  const out = [];
  for (const b of backupRows) {
    const cur = currentById.get(b.rider_id);
    if (!cur) continue; // rytteren findes ikke mere - der er intet at rulle tilbage
    if (BACKED_UP_COLUMNS.every((c) => (cur[c] ?? null) === (b[c] ?? null))) continue;
    out.push({
      id: b.rider_id,
      ...Object.fromEntries(BACKED_UP_COLUMNS.map((c) => [c, b[c] ?? null])),
    });
  }
  return out;
}

/** Kort opsummering af en tørkørsel, til konsollen. Ingen holdnavne, ingen
 *  rytter-id'er — outputtet kan havne i en issue-tråd (hard rule 17). */
export function summariseUpdates(updates, beforeById) {
  let up = 0, down = 0, cpvMoved = 0;
  for (const u of updates) {
    const before = beforeById.get(u.id);
    if (!before) continue;
    if (u.base_value > (before.base_value ?? 0)) up += 1;
    else if (u.base_value < (before.base_value ?? 0)) down += 1;
    if (Object.hasOwn(u, "current_production_value")
      && (u.current_production_value ?? null) !== (before.current_production_value ?? null)) cpvMoved += 1;
  }
  return { up, down, cpvMoved };
}

// ── DB-trin ─────────────────────────────────────────────────────────────────

const RIDER_SNAPSHOT_SELECT = ["id", ...BACKED_UP_COLUMNS].join(", ");

async function readAllRiderSnapshots(supabase) {
  return fetchAllRows(() => supabase.from("riders").select(RIDER_SNAPSHOT_SELECT).order("id"));
}

async function readBackupRows(supabase) {
  return fetchAllRows(() => supabase
    .from(BACKUP_TABLE)
    .select(`rider_id, ${BACKED_UP_COLUMNS.join(", ")}`)
    .order("rider_id"));
}

/**
 * Tag backuppen. Kaster hvis tabellen mangler (migrationen ikke kørt) eller
 * hvis den allerede indeholder rækker: den ekstraordinære kørsel er EN
 * engangs-begivenhed, og en backup oven i en backup ville gøre rollbacken
 * tvetydig.
 */
async function writeBackup(supabase, riders, log) {
  const existing = await readBackupRows(supabase).catch((err) => {
    throw new Error(
      `kunne ikke laese ${BACKUP_TABLE} (${err.message}). Er migrationen `
      + "database/2026-09-20-5443-value-event-backup.sql koert mod prod?"
    );
  });
  if (existing.length > 0) {
    throw new Error(
      `${BACKUP_TABLE} indeholder allerede ${existing.length} raekker - koerslen er enten `
      + "allerede udfoert, eller en tidligere backup staar i vejen. Brug --rollback, "
      + "eller drop tabellen bevidst foer du koerer igen."
    );
  }
  const rows = riders.map((r) => ({
    rider_id: r.id,
    ...Object.fromEntries(BACKED_UP_COLUMNS.map((c) => [c, r[c] ?? null])),
  }));
  for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
    const { error } = await supabase.from(BACKUP_TABLE).upsert(rows.slice(i, i + UPSERT_BATCH), { onConflict: "rider_id" });
    if (error) throw new Error(`backup-skrivning fejlede ved raekke ${i}: ${error.message}`);
  }
  const written = await readBackupRows(supabase);
  if (written.length !== rows.length) {
    throw new Error(
      `backup ufuldstaendig: ${written.length}/${rows.length} raekker landede. INGEN vaerdier er aendret.`
    );
  }
  log(`backup: ${written.length} raekker i ${BACKUP_TABLE}`);
  return written.length;
}

/** Dagens claim, samme mutex som søndagen. Vundet claim = vi ejer dagen. */
async function claimDay(supabase, runDate) {
  const { error } = await supabase.from(RIDER_VALUE_SUNDAY_LOG_TABLE).insert({ run_date: runDate });
  if (!error) return true;
  if (error.code === "23505" || /duplicate key|unique constraint/i.test(String(error.message || ""))) {
    return false;
  }
  throw new Error(`kunne ikke claime dagen i ${RIDER_VALUE_SUNDAY_LOG_TABLE}: ${error.message}`);
}

async function completeDay(supabase, runDate, summary) {
  const { error } = await supabase.from(RIDER_VALUE_SUNDAY_LOG_TABLE).update({
    scanned: summary.scanned ?? null,
    changed: summary.changed ?? null,
    written: summary.written ?? null,
    market_sweep_ran: false,
    completed_at: new Date().toISOString(),
  }).eq("run_date", runDate);
  if (error) throw new Error(`kunne ikke afslutte log-raekken: ${error.message}`);
}

async function writeRiderPatches(supabase, updates, log) {
  let written = 0;
  for (let i = 0; i < updates.length; i += WRITE_CONCURRENCY) {
    const batch = updates.slice(i, i + WRITE_CONCURRENCY);
    await Promise.all(batch.map(({ id, ...patch }) =>
      supabase.from("riders").update(patch).eq("id", id).then(({ error }) => {
        if (error) throw new Error(`riders update ${id}: ${error.message}`);
      })));
    written += batch.length;
    if (written % 500 === 0) log(`  ${written}/${updates.length} skrevet`);
  }
  return written;
}

// ── Kørslerne ───────────────────────────────────────────────────────────────

// #5497 trin-tælleren: kørselsdagen ER trin 0 (fuld elitepræmie), både i
// tørkørslen og i den rigtige kørsel. Sendes eksplicit, så et trin der står i
// app_config fra en tidligere kørsel aldrig tavst overtager.
export const EXTRAORDINARY_PHASE_STEP = 0;

export async function runExtraordinaryValueEvent(supabase, {
  apply, confirm, ownerAck, now = new Date(), log = console.log,
  refreshFn = refreshChangedRiderValues,
  resetPhaseStepFn = writePhaseStep,
} = {}) {
  const modelId = await readValuationModelId(supabase);
  const wageModelId = await readProductionValueModelId(supabase);
  const runDate = copenhagenDateString(now);
  const weekday = copenhagenWeekdayKey(runDate);
  log(`model: pris=${modelId} · loengrundlag=${wageModelId} · dato ${runDate} (${weekday}, dansk tid)`);

  // ALLE laase tjekkes FOER foerste laesning af populationen og laenge foer
  // backuppen skrives. Backuppen er engangs: en afvisning der kommer EFTER den
  // ville efterlade en fyldt backup-tabel og blokere naeste forsoeg.
  const blockers = applyBlockers({ apply, confirm, ownerAck, modelId, wageModelId, weekday });
  if (blockers.length > 0) {
    for (const b of blockers) log(`BLOKERET: ${b}`);
    return { ran: false, blockers };
  }

  // Tørkørsel: PRÆCIS samme beregning, ingen skrivning.
  if (!apply) {
    if (modelId !== REQUIRED_MODEL_ID) {
      log(`BLOKERET: toerkoerslen her maaler den kommende koersel, og den kraever at noeglen allerede staar paa '${REQUIRED_MODEL_ID}'.`);
      log("  Skal du se hvad v5 VILLE goere foer du flipper noeglen, saa brug backend/scripts/dev/valuationV5DryRun5443.mjs.");
      return { ran: false, blockers: [`model=${modelId}`] };
    }
    // Tørkørslen rører IKKE trin-tælleren (app_config.rider_value_phase_step).
    const res = await refreshFn(supabase, { log, dryRun: true, phaseStep: EXTRAORDINARY_PHASE_STEP });
    const beforeById = new Map(res.before.map((r) => [r.id, r]));
    const { up, down, cpvMoved } = summariseUpdates(res.updates, beforeById);
    log("");
    log("TOERKOERSEL - intet er skrevet.");
    log(`  scannet: ${res.scanned} · ville aendre: ${res.changed}`);
    log(`  op: ${up} · ned: ${down}`);
    log(`  loengrundlag der flytter sig: ${cpvMoved}${wageModelId === "v4" ? " (forventet 0 saa laenge loen-noeglen staar paa v4)" : ""}`);
    log("");
    log(`Naar ejeren siger "koer": tilfoej --apply --confirm "${APPLY_CONFIRM_PHRASE}" og saet ${OWNER_ACK_ENV}=true.`);
    return { ran: false, dryRun: true, scanned: res.scanned, changed: res.changed, up, down, cpvMoved };
  }

  // ── RIGTIG KØRSEL ─────────────────────────────────────────────────────────
  log("ekstraordinaer vaerdikoersel - alle laase er aabne");

  const riders = await readAllRiderSnapshots(supabase);
  log(`foer-billede: ${riders.length} ryttere`);
  await writeBackup(supabase, riders, log);

  const claimed = await claimDay(supabase, runDate);
  if (!claimed) {
    throw new Error(
      `dagen ${runDate} er allerede claimet i ${RIDER_VALUE_SUNDAY_LOG_TABLE}. `
      + "Vaerdierne er enten allerede flyttet i dag, eller soendagskoerslen har koert. "
      + "INGEN vaerdier er aendret af dette kald."
    );
  }

  // #5497: trin-tælleren nulstilles til 0 lige FØR første rytterværdi skrives,
  // så den næste søndagskørsel regner trin 1 (75 %), præcis som
  // indfasningsplanen. Efter backuppen og dags-claimet med vilje: afvises
  // kørslen der (backup findes allerede, dagen er taget), står nøglen urørt
  // og beskriver stadig de værdier rytterne faktisk har.
  await resetPhaseStepFn(supabase, EXTRAORDINARY_PHASE_STEP);
  log(`trin-taeller: app_config.${RIDER_VALUE_PHASE_STEP_KEY} = ${EXTRAORDINARY_PHASE_STEP}`);

  // SAMME funktion som søndagen. Ingen ny formel, ingen ny model-valg-logik.
  const res = await refreshFn(supabase, { log, phaseStep: EXTRAORDINARY_PHASE_STEP });
  await completeDay(supabase, runDate, res);

  // Post-verify: læs igen og tæl hvor mange der reelt afviger fra backuppen.
  const after = await readAllRiderSnapshots(supabase);
  const backupById = new Map((await readBackupRows(supabase)).map((b) => [b.rider_id, b]));
  const moved = after.filter((r) => {
    const b = backupById.get(r.id);
    return b && BACKED_UP_COLUMNS.some((c) => (r[c] ?? null) !== (b[c] ?? null));
  }).length;
  log("");
  log(`FAERDIG · scannet ${res.scanned} · aendret ${res.changed} · skrevet ${res.written}`);
  log(`post-verify: ${moved} ryttere afviger nu fra foer-billedet`);
  log(`rollback: samme script med --rollback --confirm "${ROLLBACK_CONFIRM_PHRASE}"`);
  return { ran: true, runDate, ...res, moved };
}

export async function rollbackExtraordinaryValueEvent(supabase, { confirm, ownerAck, log = console.log } = {}) {
  const blockers = rollbackBlockers({ confirm, ownerAck });
  if (blockers.length > 0) {
    for (const b of blockers) log(`BLOKERET: ${b}`);
    return { ran: false, blockers };
  }
  const backupRows = await readBackupRows(supabase);
  if (backupRows.length === 0) {
    throw new Error(`${BACKUP_TABLE} er tom - der er intet at rulle tilbage.`);
  }
  const current = await readAllRiderSnapshots(supabase);
  const updates = rollbackUpdates(backupRows, new Map(current.map((r) => [r.id, r])));
  log(`rollback: ${backupRows.length} sikrede raekker · ${updates.length} ryttere skal skrives tilbage`);
  if (updates.length === 0) return { ran: true, written: 0 };

  const written = await writeRiderPatches(supabase, updates, log);
  log("");
  log(`FAERDIG · ${written} ryttere rullet tilbage`);
  const modelId = await readValuationModelId(supabase);
  if (modelId === REQUIRED_MODEL_ID) {
    log("");
    log("ADVARSEL: app_config.rider_valuation_model staar stadig paa 'v5'.");
    log("  Den foerstkommende soendagskoersel vil skrive v5-vaerdierne igen.");
    log("  Saet noeglen tilbage:");
    log("    UPDATE public.app_config SET value = '\"v4\"'::jsonb WHERE key = 'rider_valuation_model';");
  }
  return { ran: true, written };
}

// ── CLI ─────────────────────────────────────────────────────────────────────

if (process.argv[1] && process.argv[1].endsWith("riderValueExtraordinaryRun5443.js")) {
  const here = dirname(fileURLToPath(import.meta.url));
  dotenv.config({ path: join(here, "../.env"), quiet: true });
  dotenv.config({ path: join(here, "../../.env"), quiet: true });

  const argValue = (name) => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] ?? null : null;
  };
  const apply = process.argv.includes("--apply");
  const rollback = process.argv.includes("--rollback");
  const confirm = argValue("--confirm");
  const ownerAck = process.env[OWNER_ACK_ENV] === "true";

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("FEJL: SUPABASE_URL / SUPABASE_SERVICE_KEY mangler. Koer via: infisical run --env=prod --silent -- node backend/scripts/riderValueExtraordinaryRun5443.js");
    process.exit(1);
  }
  if (apply && rollback) {
    console.error("FEJL: --apply og --rollback kan ikke kombineres.");
    process.exit(1);
  }
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const job = rollback
    ? rollbackExtraordinaryValueEvent(sb, { confirm, ownerAck })
    : runExtraordinaryValueEvent(sb, { apply, confirm, ownerAck });

  job
    .then((res) => { process.exit(res.blockers?.length ? 1 : 0); })
    .catch((err) => { console.error(`FEJL: ${err.message}`); process.exit(1); });
}
