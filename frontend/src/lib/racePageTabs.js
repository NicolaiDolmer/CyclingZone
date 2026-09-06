// Løbssidens faner (#4613) — ren logik, ingen React, ingen I/O.
//
// Løbssiden er T3 (hero + faner, docs/design/PAGE_TEMPLATES.md). Fanerne følger
// LØBETS TILSTAND, ikke en fast liste: hvad der er åbent at gøre skifter tre
// gange i et løbs liv, og en fane der ikke kan bruges er værre end ingen fane.
//
//   before  Overview · Team · Tactics · Stages
//   during  Overview · Team · Tactics · Stages · Results
//   after   Overview · Results · Stages · Team
//
// Endagsløb: der er kun ÉN dag, og den dags taktik låser i samme sekund løbet
// starter. Taktik-fanen forsvinder derfor når et endagsløb er startet — der er
// intet tilbage at sætte, og en tom fane ville love en beslutning der ikke
// findes. Etapeløb beholder fanen under løbet, fordi de kommende etaper stadig
// er åbne.
//
// FOG OF WAR: intet her kender tal eller lofter. Filen svarer kun på "hvilken
// fase er løbet i" og "hvilke faner giver mening i den fase".

export const RACE_PHASES = Object.freeze(["before", "during", "after"]);

/** Fane-nøgler i den rækkefølge de vises. Labels kommer fra i18n. */
export const RACE_TAB_KEYS = Object.freeze([
  "overview", "team", "tactics", "stages", "results",
]);

/**
 * Løbets fase.
 *
 * `status` bliver først noget andet end 'scheduled' når løbet er HELT færdigt
 * (#1825) — et løb midt i afviklingen står stadig som 'scheduled'. Fasen kan
 * derfor ikke aflæses af status alene: den skal krydses med hvor mange etaper
 * der er kørt, og (for gamle/importerede løb uden stages_completed) med om der
 * overhovedet findes resultater.
 *
 * @param {{status?: string|null, stagesCompleted?: number|null, stages?: number|null, hasResults?: boolean}} race
 * @returns {"before"|"during"|"after"}
 */
export function racePhase({ status, stagesCompleted = 0, stages = 1, hasResults = false } = {}) {
  const done = Number(stagesCompleted) || 0;
  const total = Math.max(1, Number(stages) || 1);
  if (status === "completed") return "after";
  if (done > 0 && done >= total) return "after";
  if (done > 0) return "during";
  // Et importeret/ældre løb uden stages_completed men MED resultater er kørt
  // færdigt — det har aldrig haft en "under løbet"-tilstand i denne app, og må
  // ikke få en Taktik-fane der lover en beslutning der ikke findes.
  if (hasResults) return "after";
  return "before";
}

/**
 * Fanerne for en fase. `isStageRace` afgør om Taktik-fanen overlever starten:
 * et endagsløb har ingen kommende etape at sætte noget på når flaget er faldet.
 *
 * @param {{phase: string, isStageRace?: boolean}} args
 * @returns {string[]}
 */
export function raceTabsFor({ phase, isStageRace = true }) {
  if (phase === "after") return ["overview", "results", "stages", "team"];
  if (phase === "during") {
    return isStageRace
      ? ["overview", "team", "tactics", "stages", "results"]
      : ["overview", "team", "stages", "results"];
  }
  return ["overview", "team", "tactics", "stages"];
}

/** Første fane i fasen — også fallbacken når en URL peger på en fane der ikke findes. */
export function defaultRaceTab(tabs) {
  return (tabs && tabs[0]) || "overview";
}

/**
 * Hold ?tab= gyldig. En dyb-link til Taktik på et afsluttet løb (eller en fane
 * fra en tidligere fase efter at løbet skiftede tilstand under fingeren) skal
 * lande på fasens første fane i stedet for at vise ingenting.
 */
export function resolveRaceTab(requested, tabs) {
  return tabs?.includes(requested) ? requested : defaultRaceTab(tabs);
}

/**
 * Er en etape låst for taktik? Spejler backendens `isStageLocked`
 * (backend/lib/raceTeamOrdersApi.js): kørt etape ELLER planlagt start passeret.
 * Manglende scheduled_at ⇒ ÅBEN (et schedule-hul må aldrig fastlåse et helt
 * løbs taktik) — præcis samme defensive valg som serveren.
 *
 * Kun en visnings-gate: serveren afviser stadig selv en write efter lås.
 */
export function isStageLockedForTactics({ stageNumber, stagesCompleted = 0, scheduledAt = null, raceCompleted = false, now = Date.now() }) {
  if (raceCompleted) return true;
  if (stageNumber <= (Number(stagesCompleted) || 0)) return true;
  if (!scheduledAt) return false;
  const startMs = Date.parse(scheduledAt);
  return Number.isFinite(startMs) && now >= startMs;
}

/**
 * Den etape taktik-fanen skal åbne på: dagens/den første etape der stadig kan
 * sættes. Er alt låst, åbnes den SIDSTE etape read-only ("det du sendte dem ud
 * med") frem for ingenting.
 *
 * @param {{stages: Array<{stage_number: number, locked?: boolean}>}} args
 * @returns {number|null}
 */
export function firstOpenStage(stages) {
  const list = stages || [];
  if (!list.length) return null;
  const open = list.find((s) => !s.locked);
  return (open ?? list[list.length - 1]).stage_number ?? null;
}
