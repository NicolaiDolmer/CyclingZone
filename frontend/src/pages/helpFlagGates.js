// #4948 · ÉN mekanisme for de flag-gatede dele af Hjaelp-siden.
//
// Foer: tre dele, tre mekanismer. Mandatet spurgte GET /board/room, "raceDay"
// var hardkodet skjult, og traenings-blokkene var hardkodet til den gamle
// model, fordi der ikke fandtes et globalt flag-svar at spoerge. Nu spoerger
// siden GET /api/feature-flags én gang, og alt herunder foelger det svar. Et
// flag-flip kraever derfor ingen kodeaendring her.
//
// Hvert flag-navn her SKAL staa i backendens allowlist
// (PLAYER_VISIBLE_FLAG_KEYS i backend/lib/stageFlagCatalog.js), ellers svarer
// endpointet aldrig paa det og delen forbliver skjult. Det haandhaeves af en
// test ved siden af HelpPage.
//
// Rent modul uden imports, saa det kan testes direkte med node --test.

/**
 * Sektioner der kun vises naar et flag er taendt for viewer'en.
 *  - mandate (#4855): mandat-modellen. Supplerer board-sektionen, som beskriver
 *    den model spilleren moeder indtil flaget er on.
 *  - raceDay (#4910): loebsmotor v4 + loebsdagens intention. Teksten ligger
 *    klar i help.json en+da og vises foerst ved v4-flippet.
 */
export const HELP_SECTION_FLAGS = Object.freeze({
  mandate: "board_mandate_model_enabled",
  raceDay: "race_engine_v4",
});

/**
 * BLOK-niveau (#4847). `dailytraining` er altid synlig, men to af dens blokke
 * modsiger hinanden og maa aldrig staa side om side: "runDayNow" (dagens
 * samlede traening + den frivillige knap) gaelder naar
 * training_tick_per_race_day er on, "trainToday" (+25 %-bonussen) gaelder
 * indtil da. `when` er den flag-tilstand blokken beskriver.
 */
export const HELP_BLOCK_FLAGS = Object.freeze({
  dailytraining: Object.freeze({
    runDayNow: Object.freeze({ flag: "training_tick_per_race_day", when: true }),
    trainToday: Object.freeze({ flag: "training_tick_per_race_day", when: false }),
  }),
});

/** Alle flag-navne Hjaelp-siden gater paa (til krydstjek mod backendens allowlist). */
export function helpGateFlagKeys() {
  const keys = new Set(Object.values(HELP_SECTION_FLAGS));
  for (const blocks of Object.values(HELP_BLOCK_FLAGS)) {
    for (const gate of Object.values(blocks)) keys.add(gate.flag);
  }
  return [...keys].sort();
}

// null = flag-svaret kendes ikke endnu (siden henter stadig). Ellers er KUN
// et strengt `true` taendt: manglende noegle, fejlsvar og alt andet er off,
// samme fail-safe som backendens evaluateFlagStage.
function flagState(flags, key) {
  if (!flags || typeof flags !== "object") return null;
  return flags[key] === true;
}

/**
 * @param {string} sectionKey  SECTION_DEFS-noeglen
 * @param {Record<string, boolean>|null} flags  svaret fra GET /api/feature-flags, null mens det hentes
 */
export function isHelpSectionVisible(sectionKey, flags) {
  if (!Object.hasOwn(HELP_SECTION_FLAGS, sectionKey)) return true;
  return flagState(flags, HELP_SECTION_FLAGS[sectionKey]) === true;
}

/**
 * En gated blok vises kun naar flag-tilstanden er KENDT og matcher `when`.
 * Mens svaret hentes er begge sider af en kontakt skjult, saa siden aldrig
 * kortvarigt viser den forkerte model og derefter skifter.
 */
export function isHelpBlockVisible(sectionKey, blockId, flags) {
  const blocks = Object.hasOwn(HELP_BLOCK_FLAGS, sectionKey) ? HELP_BLOCK_FLAGS[sectionKey] : null;
  if (!blocks || !Object.hasOwn(blocks, blockId)) return true;
  const gate = blocks[blockId];
  const state = flagState(flags, gate.flag);
  return state !== null && state === gate.when;
}
