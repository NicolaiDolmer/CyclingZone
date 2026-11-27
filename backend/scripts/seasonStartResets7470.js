#!/usr/bin/env node
// #7470 (ejer 27/11: "skifte inden rytterne har trænet"). Sæsonskiftet kører om
// eftermiddagen med sæsonstartens nulstillinger slået fra (season_fatigue_reset_enabled
// og season_injury_reset_mode = off), så aftenkørslen kl. 20 træner den gamle sæsons
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
import { assessFinalTrainingDateSettlement } from "../lib/seasonTransitionReadiness.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env"), quiet: true });

export function parseArgs(argv) {
  const args = { execute: false, toSeason: null, injuryMode: "clear" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--execute") args.execute = true;
    else if (argv[i] === "--to-season") args.toSeason = Number(argv[++i]);
    else if (argv[i] === "--injury-mode") args.injuryMode = argv[++i];
  }
  if (!Number.isInteger(args.toSeason) || args.toSeason < 1) throw new Error("--to-season <nummer> kræves");
  if (!["clear", "cap", "light"].includes(args.injuryMode)) throw new Error("--injury-mode skal være clear, cap eller light");
  return args;
}

/** Kører begge nulstillinger. Kaster, hvis en vagt ikke holder. */
export async function runSeasonStartResets({ supabase, toSeason, execute, injuryMode = "clear", now = new Date(), log = console.log }) {
  const { data: seasons, error } = await supabase.from("seasons").select("id,number,status")
    .in("number", [toSeason - 1, toSeason]);
  if (error) throw new Error(`seasons: ${error.message}`);
  const from = seasons?.find((s) => s.number === toSeason - 1);
  const to = seasons?.find((s) => s.number === toSeason);
  if (!to || to.status !== "active") throw new Error(`Sæson ${toSeason} er ikke aktiv (${to?.status ?? "mangler"}): kør skiftet først`);
  if (!from || from.status !== "completed") throw new Error(`Sæson ${toSeason - 1} er ikke afsluttet (${from?.status ?? "mangler"})`);

  // Bevis efter aftenkørslen: vurderet som om det er efter kl. 20, så intet udskydes.
  const evening = new Date(now);
  const settlement = await assessFinalTrainingDateSettlement({ supabase, season: from, now: evening });
  if (settlement.blocked || settlement.deferred) {
    throw new Error(`Sæson ${from.number}s sidste træningsdato ${settlement.tick_date} er ikke afregnet for alle hold: ${settlement.detail}`);
  }
  log(`✅ Sæson ${from.number}s sidste træningsdato ${settlement.tick_date} er afregnet for alle hold.`);

  const dryRun = !execute;
  const fatigue = await applySeasonFatigueReset({ supabase, dryRun, now, isEnabled: async () => true });
  log(`Træthed: ${JSON.stringify(fatigue)}`);
  const injury = await applySeasonInjuryReset({
    supabase, dryRun, now, toSeasonId: to.id,
    readConfig: async () => ({ ...SEASON_INJURY_RESET_DEFAULTS, mode: injuryMode }),
  });
  log(`Skader: ${JSON.stringify(injury)}`);
  if (injury.ran === false && injury.reason !== "already_applied") {
    throw new Error(`Skadenulstillingen kørte ikke: ${injury.reason}`);
  }
  log(dryRun ? "DRY-RUN slut: intet skrevet. Gentag med --execute." : "✅ Nulstillingerne er skrevet. Tænd de to kontakter igen (ejer-go).");
  return { fatigue, injury, settlement };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { console.error("⚠ Missing SUPABASE creds"); process.exit(2); }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  runSeasonStartResets({ supabase, toSeason: args.toSeason, execute: args.execute, injuryMode: args.injuryMode })
    .then(() => process.exit(0))
    .catch((err) => { console.error(`❌ ${err.message}`); process.exit(1); });
}
