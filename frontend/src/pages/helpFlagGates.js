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

const RACE_DAY_TICK_OFF = Object.freeze({ flag: "training_tick_per_race_day", when: false });
const RACE_DAY_TICK_ON = Object.freeze({ flag: "training_tick_per_race_day", when: true });

/**
 * BLOK-niveau (#4847). `dailytraining` er altid synlig, men nogle af dens
 * blokke modsiger hinanden og maa aldrig staa side om side. `when` er den
 * flag-tilstand blokken beskriver.
 *  - "runDayNow" (dagens samlede traening + den frivillige knap) gaelder naar
 *    training_tick_per_race_day er on, "trainToday" (+25 %-bonussen) indtil da.
 *  - #4849: "raceDays" og "formFatigue" beskriver kalenderdags-modellen (traening
 *    oven i loebet, restitution én gang i doegnet efter kl. 22). Deres tvillinger
 *    "raceDaysPerRaceDay" og "formFatiguePerRaceDay" beskriver loebsdags-modellen:
 *    loeb ELLER traening, etapeloebet binder inkl. hviledage, restitution pr.
 *    loebsdag, samlet koersel tidligst kl. 20.
 */
export const HELP_BLOCK_FLAGS = Object.freeze({
  dailytraining: Object.freeze({
    runDayNow: RACE_DAY_TICK_ON,
    trainToday: RACE_DAY_TICK_OFF,
    raceDays: RACE_DAY_TICK_OFF,
    raceDaysPerRaceDay: RACE_DAY_TICK_ON,
    formFatigue: RACE_DAY_TICK_OFF,
    formFatiguePerRaceDay: RACE_DAY_TICK_ON,
  }),
});

/**
 * FAQ-niveau (#4849). Samme kontakt som blokkene: et off-svar og dets on-tvilling
 * maa aldrig staa side om side, og de tre nye loebsdags-FAQ'er findes kun naar
 * loebsdags-modellen er taendt. En FAQ uden en linje her er altid synlig.
 */
export const HELP_FAQ_FLAGS = Object.freeze({
  raceDayIntensityFaq: RACE_DAY_TICK_OFF,
  raceDayIntensityPerRaceDayFaq: RACE_DAY_TICK_ON,
  raceDayAcademyFaq: RACE_DAY_TICK_OFF,
  raceDayAcademyPerRaceDayFaq: RACE_DAY_TICK_ON,
  lowerDivisionTrainingFaq: RACE_DAY_TICK_ON,
  multipleStagesTrainingFaq: RACE_DAY_TICK_ON,
  stageRaceRestDayFaq: RACE_DAY_TICK_ON,
});

/**
 * Alle flag-navne Hjaelp-siden gater paa (til krydstjek mod backendens
 * allowlist). `extraKeys` er de enkeltstaaende BLOK-niveau-flag der staar
 * direkte i SECTION_DEFS (HelpPage.jsx) via `flag: "<key>"` (#5274) — de bor
 * IKKE i en af tabellerne ovenfor, saa krydstjekket (HelpPage.flagGates.test.js)
 * laeser dem ud af SECTION_DEFS-kilden og sender dem med her.
 */
export function helpGateFlagKeys(extraKeys = []) {
  const keys = new Set(Object.values(HELP_SECTION_FLAGS));
  for (const blocks of Object.values(HELP_BLOCK_FLAGS)) {
    for (const gate of Object.values(blocks)) keys.add(gate.flag);
  }
  for (const gate of Object.values(HELP_FAQ_FLAGS)) keys.add(gate.flag);
  for (const key of extraKeys) keys.add(key);
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
  return gateMatches(blocks[blockId], flags);
}

/**
 * BLOK-niveau, generisk enkelt-flag (#5274). Til forskel fra HELP_BLOCK_FLAGS
 * ovenfor (parrede off/on-tvillinger, der begge maa erklaeres i en tabel) er
 * dette for en blok der IKKE har en modsat tvilling: den peger direkte paa et
 * PLAYER_VISIBLE_FLAG_KEYS-flag med `flag: "<key>"` i selve SECTION_DEFS
 * (HelpPage.jsx) og vises kun naar det flag er evalueret true for viewer'en —
 * samme kontakt/beta-gruppe-evaluering som fladen selv (featureStage off/beta/on,
 * GET /api/feature-flags). Mens svaret hentes (null) eller ved et fejlsvar er
 * blokken skjult, samme fail-safe som resten af mekanismen.
 * @param {string|undefined} flagKey  SECTION_DEFS-blokkens `flag`-egenskab
 * @param {Record<string, boolean>|null} flags
 */
export function isHelpBlockFlagVisible(flagKey, flags) {
  if (!flagKey) return true;
  return flagState(flags, flagKey) === true;
}

/**
 * #4849: samme regel for en FAQ. Mens svaret hentes er begge sider af en
 * kontakt skjult, af samme grund som blokkene.
 * @param {string} faqId  FAQ_KEYS-noeglen
 * @param {Record<string, boolean>|null} flags
 */
export function isHelpFaqVisible(faqId, flags) {
  if (!Object.hasOwn(HELP_FAQ_FLAGS, faqId)) return true;
  return gateMatches(HELP_FAQ_FLAGS[faqId], flags);
}

function gateMatches(gate, flags) {
  const state = flagState(flags, gate.flag);
  return state !== null && state === gate.when;
}
