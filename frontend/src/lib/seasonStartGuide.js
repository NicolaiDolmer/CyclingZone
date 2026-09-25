// "Season N — get started"-kortet (#2925): ren logik bag dashboardets
// sæsonstart-guide. Ingen DB, ingen React — alt herinde er testbart isoleret.
//
// BAGGRUND (season-cutover-auditen 2026-07-25, docs/audits/season-cutover-audit-2026-07-25.md):
// mandag morgen efter et sæsonskifte venter fire beslutninger på hver manager,
// spredt over fire sider uden nogen guide. Kortet samler dem ét sted med
// deep-links + en "udført"-markering pr. punkt.

// ─── Vindues-signal ──────────────────────────────────────────────────────────
//
// Kortet må IKKE hænge på et nyt flag i databasen (endnu en ting der kan blive
// stale). Signalet er i stedet afledt af data der allerede findes: dage siden
// den AKTIVE sæsons `start_date` (seasons.start_date, en NOT NULL DATE — verificeret
// i prod 2026-07-25: sæson 1 = 2026-06-22, sæson 2 = 2026-07-27).
//
// Vinduets længde er ikke et smagsvalg: den er forankret i den eneste HÅRDE
// deadline i skiftet — akademi-graduerings-vinduet, GRADUATION.DEADLINE_DAYS = 7
// (backend/lib/academyGraduation.js). Efter 7 døgn har sweepen auto-resolveret
// de graduates manageren ikke tog stilling til, og et af kortets fire punkter er
// dermed ikke længere til at handle på. Vinduet lukker derfor samme sted.
export const SEASON_START_WINDOW_DAYS = 7;

// Trup-måltal for "byg din trup"-punktet.
//
// VIGTIGT: dette er en UI-vejledningstærskel, ikke en spilregel. Der findes ingen
// kanonisk "anbefalet trupstørrelse" i motoren — kun et loft (MAX_SQUAD_SIZE = 30,
// lib/dashboardSquadStats.js) og et gulv på 0. Tallet 18 er udledt sådan her:
//   • største startfelt er 8 ryttere (SELECTION_SIZE.TourFrance/GiroVuelta,
//     backend/lib/raceAutopick.js),
//   • kalender-overlap er tilsigtet i ALLE divisioner, og én rytter må kun køre
//     ét løb pr. løbsdag → to samtidige løb kræver op til 16 ryttere,
//   • +2 til rotation ved træthed/skader = 18.
// Det matcher også auditens observerede kohorte ("kun 32 af 153 hold har 18+").
export const SEASON_START_SQUAD_TARGET = 18;

const DAY_MS = 86_400_000;
const DISMISS_KEY_PREFIX = "cz-dashboard-season-start-dismissed-";

/**
 * Hele døgn gået siden sæsonens startdato.
 *
 * `start_date` er en DATE ("YYYY-MM-DD") og parses som UTC-midnat. Vi arbejder på
 * døgn-granularitet, så CET/CEST-forskydningen på 1-2 timer er uden betydning her
 * (den kan aldrig flytte et helt døgn).
 *
 * @returns {number|null} antal hele døgn, eller null hvis datoen mangler/er ugyldig.
 */
export function daysSinceSeasonStart(startDate, now = new Date()) {
  if (!startDate) return null;
  const startMs = Date.parse(startDate);
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(startMs) || !Number.isFinite(nowMs)) return null;
  return Math.floor((nowMs - startMs) / DAY_MS);
}

/**
 * Er vi i sæsonstart-vinduet for den AKTIVE sæson?
 *
 * Gates:
 *   • sæsonen skal være aktiv (dashboardet henter kun status='active', men den
 *     rene funktion skal kunne stå alene i tests),
 *   • number > 1 — sæson 1 er en FØRSTE sæson, ikke en genopsætning. Der er ingen
 *     gammel træningsplan der blev ugyldig og ingen bestyrelse at genforhandle;
 *     nye managere dækkes af onboarding-kortet i stedet,
 *   • højst SEASON_START_WINDOW_DAYS hele døgn siden start_date.
 *
 * Negativ daysSince (start_date i fremtiden for en aktiv sæson = datafejl) fejler
 * bevidst ÅBENT: guiden er mere værd end en skjult guide i det tilfælde.
 */
export function isSeasonStartWindow(season, now = new Date()) {
  if (!season || season.status !== "active") return false;
  if (!(Number(season.number) > 1)) return false;
  const days = daysSinceSeasonStart(season.start_date, now);
  if (days === null) return false;
  return days <= SEASON_START_WINDOW_DAYS;
}

/** localStorage-nøgle: dismiss huskes PR. SÆSON, så guiden vender tilbage næste skifte. */
export function seasonStartDismissKey(seasonId) {
  return `${DISMISS_KEY_PREFIX}${seasonId}`;
}

export function readSeasonStartDismissed(seasonId) {
  if (!seasonId) return false;
  try {
    return globalThis.localStorage?.getItem(seasonStartDismissKey(seasonId)) === "1";
  } catch {
    return false; // private mode / storage afvist
  }
}

export function writeSeasonStartDismissed(seasonId) {
  if (!seasonId) return;
  try {
    globalThis.localStorage?.setItem(seasonStartDismissKey(seasonId), "1");
  } catch {
    /* private mode / storage afvist — ignorer */
  }
}

/**
 * De fire beslutninger, i den rækkefølge de bør tages.
 *
 * `done` er tri-state med vilje:
 *   true  → afgjort udført (checkmark),
 *   false → mangler,
 *   null  → kan ikke afgøres endnu (data ikke hentet/kaldet fejlede) → INGEN
 *           checkmark. Vi viser hellere et punkt uden markering end et falsk
 *           "udført" der får manageren til at springe en beslutning over.
 *
 * @param {object} p
 * @param {number} p.squadCount            ejede senior-ryttere nu (ownedNow)
 * @param {number} [p.squadTarget]
 * @param {number|null} p.trainingPlanCount rækker i training_plans for aktiv sæson
 * @param {boolean} p.boardPlanMissing      dashboardets eksisterende D3-signal
 * @param {boolean} p.boardStatusLoaded     blev /api/board/status besvaret?
 * @param {number|null} p.pendingGraduations pending rækker i academy_graduation
 * @param {boolean} p.academyEnabled        har holdet overhovedet et akademi?
 */
export function buildSeasonStartItems({
  squadCount = 0,
  squadTarget = SEASON_START_SQUAD_TARGET,
  trainingPlanCount = null,
  boardPlanMissing = false,
  boardStatusLoaded = false,
  pendingGraduations = null,
  academyEnabled = false,
} = {}) {
  const items = [
    // Rækkefølgen er auditens prioritering: "byg din trup" er reelt den vigtigste,
    // fordi gennemsnitstruppen er under den størrelse spillet forventer.
    { key: "squad", to: "/auctions", done: Number(squadCount) >= squadTarget },
    { key: "training", to: "/training", done: trainingPlanCount === null ? null : trainingPlanCount > 0 },
    // Ukendt board-status (fetch fejlede) må ikke læses som "forhandlet færdig".
    { key: "board", to: "/board", done: boardStatusLoaded ? !boardPlanMissing : null },
  ];
  // Akademiet er feature-gated (Layout.jsx / academyNavVisibility.js). Hold uden
  // akademi skal ikke se et punkt de ikke kan handle på.
  if (academyEnabled) {
    items.push({
      key: "academy",
      to: "/academy",
      done: pendingGraduations === null ? null : pendingGraduations === 0,
    });
  }
  return items;
}

/** Antal punkter der er bekræftet udført (null tæller ikke med). */
export function countDoneItems(items = []) {
  return items.filter((i) => i.done === true).length;
}

/**
 * Bestyrelses-punktets EFFEKTIVE `to`/`done` naar mandat-modellen
 * (board_mandate_model_enabled) er aktiv for viewer — ejer-go 25/9 19:45,
 * mandatet on for alle fra lørdag 27/9 (#5755).
 *
 * SeasonStartGuideCard.jsx henter selv flag-stadiet (lib/featureStage.ts'
 * loadFeatureFlagStages — "beta" ELLER "on" tæller som aktivt for viewer) og
 * GET /board/meeting (annualMeeting/meetingApi.js' fetchBoardMeeting). Denne
 * funktion er den rene beslutningslogik derefter, testbar uden netværk/React.
 *
 * `null` retur = flaget er OFF for viewer → kortet skal beholde
 * `buildSeasonStartItems`s legacy board-punkt (boardPlanMissing-baseret)
 * fuldstændig uændret, med legacy-copy'en (items.boardLegacy i dashboard.json),
 * så en spiller der ikke har fået mandatet endnu ALDRIG mister linjen før
 * flippet.
 *
 * REVIEWER-FUND (#5755, rettet før merge): `available:false` betyder IKKE i
 * sig selv "underskrevet" — backend svarer også `available:false` når holdet
 * slet ikke har noget mandat endnu (13 menneskehold i prod uden mandat-række).
 * At læse `!meetingAvailable` som Done gav dem et falsk flueben ved flippet.
 * `buildBoardMeetingPayload` (backend/lib/boardMandateMeeting.js) bærer nu et
 * `reason`-felt ('no_mandate' | 'signed' | 'no_proposal') på `available:false`
 * — KUN `reason === 'signed'` (aktivt, underskrevet mandat) må sætte Done.
 * Uden mandat vises punktet som ikke-udført med link til `/board` (ikke
 * `/board/meeting` — der er intet forslag at åbne).
 *
 * @param {object} p
 * @param {boolean} [p.mandateEnabled]         flag-stadie er "beta" eller "on" for viewer
 * @param {boolean|null} [p.meetingAvailable]  fetchBoardMeeting()?.available
 * @param {boolean} [p.meetingLoaded]          lykkedes fetchBoardMeeting() (payload != null)?
 * @param {string|null} [p.meetingReason]      fetchBoardMeeting()?.reason ('no_mandate'|'signed'|'no_proposal') når available er false
 * @returns {{to: string, done: boolean|null}|null}
 */
export function resolveBoardStartItem({
  mandateEnabled = false,
  meetingAvailable = null,
  meetingLoaded = false,
  meetingReason = null,
} = {}) {
  if (!mandateEnabled) return null;
  if (!meetingLoaded) return { to: "/board", done: null };
  if (meetingAvailable) return { to: "/board/meeting", done: false };
  // available:false: Done KUN ved et bekræftet underskrevet mandat
  // (reason === 'signed'). Alt andet — inkl. 'no_mandate', 'no_proposal' og
  // en manglende/ukendt reason — er bevidst IKKE done, og linker til /board.
  return { to: "/board", done: meetingReason === "signed" };
}
