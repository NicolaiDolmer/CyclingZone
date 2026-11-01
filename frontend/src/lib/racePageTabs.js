// Løbssidens fase og taktik-lås (#4613) — ren logik, ingen React, ingen I/O.
//
// Fasen (before | during | after) styrer hero'ens nøgletal og taktik-låsen.
// Selve fanerne ejes af etapeside 2.0 (stagePageV2Model.ts); den gamle fane-liste
// er fjernet med den gamle etapeside (#6570).
//
// FOG OF WAR: intet her kender tal eller lofter. Filen svarer kun på "hvilken
// fase er løbet i".

export const RACE_PHASES = Object.freeze(["before", "during", "after"]);

/**
 * Løbets fase.
 *
 * `status` bliver først noget andet end 'scheduled' når løbet er HELT færdigt
 * (#1825) — et løb midt i afviklingen står stadig som 'scheduled'. Fasen kan
 * derfor ikke aflæses af status alene: den skal krydses med hvor mange etaper
 * der er kørt, og (for gamle/importerede løb uden stages_completed) med om der
 * overhovedet findes resultater.
 *
 * #6959: taktik og trup låser samtidig ved løbets start (etape 1's planlagte start),
 * også i en pause hvor ingen etape er kørt. `firstStageScheduledAt` (+ `now`) gør at et
 * løb hvis start er passeret, men uden kørt etape, er "during" i stedet for "before" —
 * så Hold-fanen ikke tilbyder en åben udtagelse mens Taktik allerede er låst.
 *
 * @param {{status?: string|null, stagesCompleted?: number|null, stages?: number|null, hasResults?: boolean, firstStageScheduledAt?: string|null, now: number}} race
 * @returns {"before"|"during"|"after"}
 */
export function racePhase({ status, stagesCompleted = 0, stages = 1, hasResults = false, firstStageScheduledAt = null, now }) {
  // Hard rule 16 (Codex P1 #7063): uret injiceres altid; intet vaegur-default.
  if (!Number.isFinite(now)) throw new Error("racePhase: now (ms) skal injiceres");
  const done = Number(stagesCompleted) || 0;
  const total = Math.max(1, Number(stages) || 1);
  if (status === "completed") return "after";
  if (done > 0 && done >= total) return "after";
  if (done > 0) return "during";
  // Et importeret/ældre løb uden stages_completed men MED resultater er kørt
  // færdigt — det har aldrig haft en "under løbet"-tilstand i denne app, og må
  // ikke få en Taktik-fane der lover en beslutning der ikke findes.
  if (hasResults) return "after";
  if (hasScheduledStartPassed(firstStageScheduledAt, now)) return "during";
  return "before";
}

/**
 * Er et planlagt tidspunkt passeret? Spejler backendens `hasScheduledStartPassed`
 * (backend/lib/raceStartLock.js, #6959). Manglende/ugyldigt tidspunkt => false (åben):
 * et schedule-hul må aldrig fastlåse et helt løb.
 */
/**
 * @param {string|null|undefined} scheduledAt
 * @param {number} now
 */
export function hasScheduledStartPassed(scheduledAt, now) {
  if (!scheduledAt) return false;
  if (!Number.isFinite(now)) throw new Error("hasScheduledStartPassed: now (ms) skal injiceres");
  const startMs = Date.parse(scheduledAt);
  return Number.isFinite(startMs) && now >= startMs;
}

/**
 * Er en etape låst for taktik? Spejler backendens `isStageLocked`
 * (backend/lib/raceTeamOrdersApi.js): kørt etape ELLER planlagt start passeret.
 * Manglende scheduled_at ⇒ ÅBEN (et schedule-hul må aldrig fastlåse et helt
 * løbs taktik) — præcis samme defensive valg som serveren.
 *
 * Kun en visnings-gate: serveren afviser stadig selv en write efter lås.
 *
 * @param {{stageNumber: number, stagesCompleted?: number, scheduledAt?: string|null, raceCompleted?: boolean, now?: number}} args
 */
export function isStageLockedForTactics({ stageNumber, stagesCompleted = 0, scheduledAt = null, raceCompleted = false, now = Date.now() }) {
  if (raceCompleted) return true;
  if (stageNumber <= (Number(stagesCompleted) || 0)) return true;
  return hasScheduledStartPassed(scheduledAt, now);
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
