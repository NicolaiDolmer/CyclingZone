// Sæsonstart-hooks (#2910 + #2911) — ÉT kaldepunkt for de to nye, flag-gatede
// sæsonskifte-mekanikker, så seasonTransition.js kun får ÉN tilføjet blok.
//
// Hvorfor et samle-modul: seasonTransition.js ejes af en parallel branch
// (fix/2916-2852-transition-carryover). Ved at samle begge hooks bag én
// funktion bliver diff'en i den delte fil 6 linjer i stedet for 40, og en
// rebase er triviel.
//
// Kontrakt:
//   • Begge hooks er additive og ISOLEREDE — en fejl i den ene må hverken vælte
//     den anden eller sæson-transitionen (samme disciplin som
//     contract_expiry_release / global_rank_decay).
//   • Begge er flag-gatede med fail-safe OFF. Uden flag = nuværende adfærd,
//     bit-for-bit.
//   • Rækkefølgen er bevidst: træthed FØR akademi. Akademi-optagelsen kan
//     indsætte nye ryttere med friske rider_condition-rækker (fatigue 0), og de
//     skal ikke fanges af en efterfølgende reset-sweep.
//   • BETINGET FASE-LOG: et slukket flag logger INGENTING (samme mønster som
//     reset_board_test_data og season_calendar i seasonTransition.js). Flag-off
//     er dermed bit-identisk med adfærden før denne PR — også i fase-loggen og
//     dermed i admin-UI'ets fase-tælling. Alt ANDET (fejl, no_active_season,
//     academy_flag_off) logges, fordi det signalerer fejlkonfiguration.

import { applySeasonFatigueReset } from "./seasonFatigueReset.js";
import { runSeasonAcademyIntake } from "./seasonAcademyIntake.js";
import { captureException } from "./sentry.js";

/**
 * @returns {Promise<Array<{phase:string, [k:string]:any}>>} log-fragmenter til
 *   transitionens fase-log. Kaster ALDRIG.
 */
export async function runSeasonStartHooks({
  supabase,
  now = new Date(),
  toSeasonNumber = null,
  deps = {},
} = {}) {
  const log = [];

  // Slukket flag → ingen fase-række (se BETINGET FASE-LOG ovenfor).
  const push = (phase, result) => {
    if (result?.ran === false && result?.reason === "flag_off") return;
    log.push({ phase, ...result });
  };

  const fatigueFn = deps.applySeasonFatigueReset ?? applySeasonFatigueReset;
  try {
    push("season_fatigue_reset", await fatigueFn({ supabase, now }));
  } catch (err) {
    log.push({ phase: "season_fatigue_reset", error: err.message });
    captureException(err, {
      tags: { phase: "season_fatigue_reset" },
      extra: { toSeasonNumber },
    });
  }

  const intakeFn = deps.runSeasonAcademyIntake ?? runSeasonAcademyIntake;
  try {
    push("season_academy_intake", await intakeFn({ supabase }));
  } catch (err) {
    log.push({ phase: "season_academy_intake", error: err.message });
    captureException(err, {
      tags: { phase: "season_academy_intake" },
      extra: { toSeasonNumber },
    });
  }

  return log;
}
