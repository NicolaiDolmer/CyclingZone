// Sæsonstart-hooks (#2910 + #2911 + #3232) — ÉT kaldepunkt for de flag-/config-
// gatede sæsonskifte-mekanikker, så seasonTransition.js kun får ÉN tilføjet blok.
//
// Hvorfor et samle-modul: seasonTransition.js ejes af en parallel branch
// (fix/2916-2852-transition-carryover). Ved at samle hooks bag én funktion
// bliver diff'en i den delte fil nogle få linjer i stedet for mange, og en
// rebase er triviel.
//
// Kontrakt:
//   • Alle hooks er additive og ISOLEREDE — en fejl i én må hverken vælte de
//     andre eller sæson-transitionen (samme disciplin som
//     contract_expiry_release / global_rank_decay).
//   • Alle er gatede med fail-safe OFF. Uden flag/config = nuværende adfærd,
//     bit-for-bit.
//   • Rækkefølgen er bevidst: træthed FØR form FØR akademi. Trætheds- og
//     form-resetten rører begge rider_condition men forskellige kolonner (kan
//     bytte plads uden effekt); akademi-optagelsen kommer SIDST fordi den kan
//     indsætte nye ryttere med friske rider_condition-rækker, og de skal ikke
//     fanges af en efterfølgende reset-sweep.
//   • BETINGET FASE-LOG: et slukket flag/config logger INGENTING (samme mønster
//     som reset_board_test_data og season_calendar i seasonTransition.js).
//     Flag-off er dermed bit-identisk med adfærden før denne PR — også i
//     fase-loggen og dermed i admin-UI'ets fase-tælling. Alt ANDET (fejl,
//     no_active_season, academy_flag_off) logges, fordi det signalerer
//     fejlkonfiguration.

import { applySeasonFatigueReset } from "./seasonFatigueReset.js";
import { applySeasonFormReset } from "./seasonFormReset.js";
import { runSeasonAcademyIntake } from "./seasonAcademyIntake.js";
import { expireSeasonScopedConsequences } from "./boardConsequences.js";
import { captureException } from "./sentry.js";

/**
 * @returns {Promise<Array<{phase:string, [k:string]:any}>>} log-fragmenter til
 *   transitionens fase-log. Kaster ALDRIG.
 */
export async function runSeasonStartHooks({
  supabase,
  now = new Date(),
  toSeasonNumber = null,
  fromSeasonId = null,
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

  // #3232 · form-nulstilling — sit EGET håndtag (season_form_reset_mode),
  // adskilt fra trætheden ovenfor. `season` sendes med som idempotens-seed for
  // "band"-mode (se seasonFormReset.js). Default-mode er "off" → no-op,
  // bit-identisk med adfærden før denne PR.
  const formResetFn = deps.applySeasonFormReset ?? applySeasonFormReset;
  try {
    push("season_form_reset", await formResetFn({ supabase, now, season: toSeasonNumber }));
  } catch (err) {
    log.push({ phase: "season_form_reset", error: err.message });
    captureException(err, {
      tags: { phase: "season_form_reset" },
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

  // #4482 · Lag 6-bonustilbud hoerer til den saeson de blev givet i. Funktionen
  // fandtes, var testet og eksporteret, men blev ALDRIG kaldt i produktion: den
  // eneste kalder var dens egen test. Resultatet var 36 aktive tilbud paa
  // afsluttede saesoner 1 og 2, hvoraf det aeldste kunne indloeses to saesoner
  // efter det blev givet (200.000 CZ$ pr. stk.).
  //
  // IKKE flag-gatet, i modsaetning til hookene ovenfor. De tre andre aendrer
  // spil-balance og skal kunne slaas fra; denne LUKKER et hul. Et slukket flag
  // ville betyde "lad pengehullet staa aabent", hvilket ikke er en tilstand
  // nogen skal kunne ende i ved et uheld.
  //
  // Placeringen er bevidst: hookene koerer FOER season-payroll i
  // seasonTransition. Det er praecis derfor filteret paa lag 6 i
  // expireSeasonScopedConsequences er loadbearing - lag 5 skal udloebe EFTER
  // payroll, og goer det allerede i economyEngine.
  const expireFn = deps.expireSeasonScopedConsequences ?? expireSeasonScopedConsequences;
  try {
    const r = await expireFn(supabase, fromSeasonId);
    log.push({ phase: "board_bonus_offer_expiry", ...r });
  } catch (err) {
    log.push({ phase: "board_bonus_offer_expiry", error: err.message });
    captureException(err, {
      tags: { phase: "board_bonus_offer_expiry" },
      extra: { toSeasonNumber, fromSeasonId },
    });
  }

  return log;
}
