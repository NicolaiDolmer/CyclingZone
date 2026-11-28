#!/usr/bin/env node
// #7470 (ejer 27/11: "skifte inden rytterne har trænet"). Sæsonskiftet kører om
// eftermiddagen med sæsonstartens nulstillinger slået fra (season_fatigue_reset_enabled
// , season_injury_reset_mode og season_form_reset_mode = off), så aftenkørslen kl. 20 træner den gamle sæsons
// sidste dato på den gamle sæsons form og træthed. Bagefter kører dette script de
// samme to nulstillinger alene, med de samme funktioner som skiftet bruger.
//
// Brug (fra backend/):
//   infisical run --env=prod -- node scripts/seasonStartResets7470.js --to-season 6            # dry-run
//   infisical run --env=prod -- node scripts/seasonStartResets7470.js --to-season 6 --execute  # skriver
//
// Vagter (fail closed):
//   · den nye sæson findes og er aktiv; den gamle er afsluttet
//   · den gamle sæsons sidste træningsdato er afregnet for alle hold (samme gate som
//     "Afslut sæson", vurderet efter kl. 20 = bevis kræves)
//   · skaderne nulstilles kun, før den nye sæsons første løbsdag (applySeasonInjuryReset)
// Bagefter tændes de to kontakter igen (manuelt, ejer-go), så næste skifte er som før.
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applySeasonFatigueReset } from "../lib/seasonFatigueReset.js";
import { applySeasonInjuryReset, SEASON_INJURY_RESET_DEFAULTS } from "../lib/seasonInjuryReset.js";
import { loadFinalTrainingDate } from "../lib/seasonTransitionReadiness.js";
import { copenhagenDateString } from "../lib/copenhagenTime.js";
import { fetchAllRows } from "../lib/supabasePagination.js";
import { applySeasonFormReset, readSeasonFormResetConfig } from "../lib/seasonFormReset.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env"), quiet: true });

export function parseArgs(argv) {
  const args = { execute: false, toSeason: null, injuryMode: "clear", formMode: "decay" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--execute") args.execute = true;
    else if (argv[i] === "--to-season") args.toSeason = Number(argv[++i]);
    else if (argv[i] === "--injury-mode") args.injuryMode = argv[++i];
    else if (argv[i] === "--form-mode") args.formMode = argv[++i];
  }
  if (!Number.isInteger(args.toSeason) || args.toSeason < 1) throw new Error("--to-season <nummer> kræves");
  if (!["clear", "cap", "light"].includes(args.injuryMode)) throw new Error("--injury-mode skal være clear, cap eller light");
  if (!["decay", "band", "baseline", "off"].includes(args.formMode)) throw new Error("--form-mode skal være decay, band, baseline eller off");
  return args;
}

/** Kører begge nulstillinger. Kaster, hvis en vagt ikke holder. */
export async function runSeasonStartResets({ supabase, toSeason, execute, injuryMode = "clear", formMode = "decay", now = new Date(), log = console.log }) {
  const { data: seasons, error } = await supabase.from("seasons").select("id,number,status")
    .in("number", [toSeason - 1, toSeason]);
  if (error) throw new Error(`seasons: ${error.message}`);
  const from = seasons?.find((s) => s.number === toSeason - 1);
  const to = seasons?.find((s) => s.number === toSeason);
  if (!to || to.status !== "active") throw new Error(`Sæson ${toSeason} er ikke aktiv (${to?.status ?? "mangler"}): kør skiftet først`);
  if (!from || from.status !== "completed") throw new Error(`Sæson ${toSeason - 1} er ikke afsluttet (${from?.status ?? "mangler"})`);

  // Fable hul C: kun samme aften. Efter den gamle sæsons sidste dato (bro-datoen før S6's
  // første løbsdag) eller når S6 har træningsarbejde, ville trætheden ugyldiggøre S6's
  // åbningsbillede. Så nægtes, og nulstillingen besluttes med ejeren.
  const tickDate = await loadFinalTrainingDate({ supabase, seasonId: from.id });
  const today = copenhagenDateString(now);
  if (!tickDate) throw new Error(`Sæson ${from.number}s sidste træningsdato kan ikke findes`);
  if (today !== tickDate) throw new Error(`Kun på sæsonens sidste dato ${tickDate} (i dag ${today}): spørg ejeren`);
  const { data: newWork, error: newWorkError } = await supabase.from("training_date_work").select("team_id").eq("season_id", to.id).limit(1);
  if (newWorkError) throw new Error(`training_date_work (S${to.number}): ${newWorkError.message}`);
  if (newWork?.length) throw new Error(`Sæson ${to.number} har allerede træningsarbejde: nulstillingen ville ugyldiggøre det`);

  // Fable hul B: beviset er det registrerede arbejde for datoen (ingen pending/partial),
  // ikke dagens hold (et hold oprettet efter skiftet har ingen registrering for S5).
  // Codex P1: alle sider (over 1.000 hold), stabil rækkefølge.
  const work = await fetchAllRows(() => supabase.from("training_date_work").select("team_id,status")
    .eq("season_id", from.id).eq("tick_date", tickDate).order("team_id"));
  const open = (work ?? []).filter((row) => !["complete", "needs_reconciliation"].includes(row.status));
  if (!work?.length || open.length) {
    throw new Error(`Sæson ${from.number}s ${tickDate} er ikke afregnet: ${work?.length ?? 0} registreringer, ${open.length} åbne`);
  }
  // Fable-gentjek 2: et hold, kørslen aldrig nåede, har ingen række. Sammenlign med holdene,
  // der havde ryttere på datoen (oplysning til operatøren; afgørelsen tages i drejebogen).
  const teamRows = await fetchAllRows(() => supabase.from("riders").select("team_id")
    .eq("is_retired", false).not("team_id", "is", null).lt("created_at", `${tickDate}T23:00:00Z`).order("id"));
  const registeredTeams = new Set(work.map((row) => row.team_id));
  const unregistered = [...new Set((teamRows ?? []).map((row) => row.team_id))].filter((id) => !registeredTeams.has(id));
  log(`Hold med ryttere uden registrering for ${tickDate}: ${unregistered.length}${unregistered.length ? " (tjek: nye hold efter skiftet, bank/test/frosne hold)" : ""}`);
  const settlement = { tick_date: tickDate, registered: work.length, unregistered: unregistered.length };
  log(`✅ Sæson ${from.number}s sidste træningsdato ${tickDate}: ${work.length} hold afregnet, 0 åbne.`);

  const dryRun = !execute;
  const injuryConfig = async () => ({ ...SEASON_INJURY_RESET_DEFAULTS, mode: injuryMode });
  // Fable: skade-vagten (fx season_already_started) prøves FØR trætheden skrives.
  const injuryCheck = await applySeasonInjuryReset({ supabase, dryRun: true, now, toSeasonId: to.id, readConfig: injuryConfig });
  if (injuryCheck.ran === false && injuryCheck.reason !== "already_applied") {
    throw new Error(`Skadenulstillingen ville ikke køre (${injuryCheck.reason}): intet skrevet`);
  }
  const fatigue = await applySeasonFatigueReset({ supabase, dryRun, now, isEnabled: async () => true });
  log(`Træthed: ${JSON.stringify(fatigue)}`);
  const injury = await applySeasonInjuryReset({
    supabase, dryRun, now, toSeasonId: to.id,
    readConfig: injuryConfig,
  });
  log(`Skader: ${JSON.stringify(injury)}`);
  // Prod 27/11: season_form_reset_mode = "decay" (tændt). Slås fra til skiftet og køres her
  // med de øvrige parametre fra app_config og den valgte mode.
  const formConfig = { ...(await readSeasonFormResetConfig(supabase)), mode: formMode };
  const form = await applySeasonFormReset({ supabase, dryRun, now, season: to.number, config: formConfig });
  log(`Form: ${JSON.stringify(form)}`);
  // Fable-gentjek 1: en form-nulstilling, der ikke kørte, må ikke ende i "✅ skrevet".
  if (formMode !== "off" && form?.ran === false && !(dryRun && form?.reason === "already_ran")) {
    throw new Error(`Form-nulstillingen kørte ikke (${form.reason}): træthed/skader er ${dryRun ? "ikke skrevet (dry-run)" : "skrevet"}, form skal håndteres`);
  }
  if (injury.ran === false && injury.reason !== "already_applied") {
    throw new Error(`Skadenulstillingen kørte ikke: ${injury.reason}`);
  }
  log(dryRun ? "DRY-RUN slut: intet skrevet. Gentag med --execute." : "✅ Nulstillingerne er skrevet. Tænd de to kontakter igen (ejer-go).");
  return { fatigue, injury, form, settlement };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { console.error("⚠ Missing SUPABASE creds"); process.exit(2); }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  runSeasonStartResets({ supabase, toSeason: args.toSeason, execute: args.execute, injuryMode: args.injuryMode, formMode: args.formMode })
    .catch((err) => { console.error(`❌ ${err.message}`); process.exitCode = 1; });
}
