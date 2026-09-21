// trainingMobileModel — den rene model bag traeningssidens MOBILE visning (#3643).
//
// Ejer-valg 18/9 (laast): mobilformen er "mockup 2, tabel" —
// docs/design/mockups-training-mobile-2026-09-18/m2-table.html. Raekker er
// ryttere, KOLONNER er dagens loebsdage, og den rytter man trykker paa faar sit
// fulde kort EEN gang — foldet ud lige under sin egen raekke (ejer-beslutning
// 21/9, variant A; se expandScrollAdjustment nederst).
//
// REALISME-REGLEN (ejer 18/9): enheden er loebsdagen = een dato i cykelaaret.
// Rytteren koerer ET loeb ELLER traener paa en loebsdag, aldrig begge.
//
// HVORFOR DENNE FIL FINDES: antallet af loebsdage pr. kalenderdag er IKKE laast
// (docs/TRAINING_RULES.md §13.3), og i prod koerer traeningen stadig som EET
// dagligt tick — `training_tick_per_race_day` er OFF. Kolonne-modellen maa
// derfor kunne baere 1-5 loebsdage uden at fladen aendrer form, og den maa
// ALDRIG vise et haardkodet saeson-tal ("140"). Kolonnerne udledes her, ud fra
// det API'et faktisk leverer, saa komponenterne kun tegner det de faar.
//
// Ingen React, ingen DOM, ingen i18n: labels laves i komponenterne. Testes
// isoleret med `node --test`.

// ── Loebsdags-kolonner ──────────────────────────────────────────────────────

// En kolonne i dagens stribe og i tabellens hoved.
//   key   : stabil noegle (React-key + kolonneopslag pr. rytter)
//   index : 1-baseret loebsdags-nummer inden for kalenderdagen
//   state : "done" (afregnet) · "now" (den aabne loebsdag) · "upcoming"
export type RaceDayColumn = {
  key: string;
  index: number;
  state: "done" | "now" | "upcoming";
};

// Kolonne-modellen for dagens tabel.
//
//   raceDayCount : antal loebsdage paa kalenderdagen, som API'et oplyser det.
//                  null/undefined/0 = flaget er OFF (dagens model er EET tick),
//                  og fladen viser saa PRAECIS een kolonne: "i dag".
//   currentIndex : den aabne loebsdag (1-baseret), eller null.
//   settled      : true naar dagens koersel er afregnet (todayRun findes).
//
// Kontrakten der goer 1-5 ufarligt: outputtet er altid mindst een kolonne, og
// komponenterne laeser kun `columns.length` — aldrig et saeson-tal.
export function buildRaceDayColumns({
  raceDayCount,
  currentIndex = null,
  settled = false,
}: {
  raceDayCount?: number | null;
  currentIndex?: number | null;
  settled?: boolean;
} = {}): RaceDayColumn[] {
  const raw = Number(raceDayCount);
  // Loftet paa 5 er ikke en balance-konstant: det er den bredde tabellen kan
  // tegne uden vandret scroll paa 375 px (navnekolonne + 5 celler). Kommer der
  // flere fra serveren, er det en UI-beslutning der skal traeffes, ikke noget
  // fladen skal gaette sig ud af — derfor klampes der her, eet sted.
  const count = Number.isFinite(raw) && raw >= 1 ? Math.min(5, Math.floor(raw)) : 1;
  // `Number(null)` er 0 og finite — uden null-tjekket ville "ingen aaben
  // loebsdag" blive til loebsdag 0, og hele striben stod som "upcoming".
  const active =
    currentIndex != null && Number.isFinite(Number(currentIndex)) && Number(currentIndex) >= 1
      ? Math.floor(Number(currentIndex))
      : null;

  return Array.from({ length: count }, (_, i) => {
    const index = i + 1;
    let state: RaceDayColumn["state"];
    if (settled) state = "done";
    else if (active == null) state = count === 1 ? "now" : "upcoming";
    else if (index < active) state = "done";
    else if (index === active) state = "now";
    else state = "upcoming";
    return { key: `rd${index}`, index, state };
  });
}

// Er vi i een-kolonne-tilstanden (flaget OFF)? Fladen bruger det til at vaelge
// mellem "Today"-overskriften og loebsdags-nummereringen — og til IKKE at
// paastaa en loebsdags-model der ikke koerer endnu.
export function isSingleRaceDay(columns: RaceDayColumn[]): boolean {
  return (columns?.length ?? 0) <= 1;
}

// ── Rytter-navnet i en 124 px kolonne ───────────────────────────────────────

// Selve reglen bor i `lib/riderName.ts` siden 19/9 (#5383): DataTable's
// navnecelle bruger den samme korte form paa mobil, og een kopi af "M.
// Sørensen"-reglen er een kopi. Re-eksporteres her, saa traeningens egne
// import-steder er uaendrede.
export { riderShortName } from "./riderName.ts";

// ── "Taeller for <rolle>" ───────────────────────────────────────────────────

// Rollens opskrift som en raekke evne-noegler, taettest-vejede foerst. Selve
// vaegtene forlader ALDRIG funktionen — spilleren skal se HVILKE evner der
// taeller og deres egne vaerdier, ikke opskriftens tal.
//
//   recipes  : DISPLAY_RECIPES fra lib/generated/displayRecipes.js
//   roleKey  : rytterens primaere type
//   abilities: rytterens fladede evner
//   capped   : evne-noegler paa livstidsloftet (#1162: kun noegler, aldrig tal)
export type CountsForRow = { ability: string; value: number | null; atCap: boolean };

// `weights` er `Partial`, fordi DISPLAY_RECIPES er en GENERERET fil: hver
// opskrift naevner kun sine EGNE evner, saa TypeScript ser de oevrige noegler
// som `undefined` i union-typen. Vi laeser kun noeglerne, saa sorteringen
// haandterer et manglende tal som 0.
export function countsForRole(
  recipes: ReadonlyArray<{ key: string; weights: Partial<Record<string, number>> }> | null | undefined,
  roleKey: string | null | undefined,
  abilities: Record<string, unknown> | null | undefined,
  capped: readonly string[] | null | undefined,
  limit = 4,
): CountsForRow[] {
  if (!roleKey) return [];
  const recipe = (recipes ?? []).find((r) => r?.key === roleKey);
  if (!recipe?.weights) return [];
  const lockedSet = new Set(Array.isArray(capped) ? capped : []);
  const ordered = Object.entries(recipe.weights)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .map(([ability]) => ability);

  // Loftet er BINDENDE indhold (#3643, ejer 13/8: "loft-tilstand som chip i
  // evnelisten"). En evne paa loftet er praecis den der IKKE rykker sig, saa den
  // maa aldrig falde ud af listen bare fordi den vejer lidt i rollens opskrift —
  // det var forvekslingen i #3649. Den tages med ud over `limit`.
  const shown = ordered.slice(0, Math.max(0, limit));
  for (const ability of ordered) {
    if (lockedSet.has(ability) && !shown.includes(ability)) shown.push(ability);
  }

  return shown.map((ability) => {
    // `flattenAbilities` kopierer en NULL-kolonne videre som null, og
    // `Number(null)` er 0 og finite — uden null-tjekket ville en evne der ikke
    // er beregnet endnu staa som et maalt "0". "—" er sandt, 0 er en paastand.
    const cell = abilities?.[ability];
    const raw = cell == null ? Number.NaN : Number(cell);
    return {
      ability,
      value: Number.isFinite(raw) ? raw : null,
      atCap: lockedSet.has(ability),
    };
  });
}

// ── Tempo som HASTIGHED, aldrig som ankomsttid ──────────────────────────────

// #3643 (ejer 13/8, bindende): *"Naar 47 om 14 uger"* ville afsloere det
// maskerede loft; *"ca. 1 point om ugen"* laekker ingenting. Tallet er derfor
// altid en hastighed — og det er MAALT paa rytterens egne landede point, ikke
// en fremskrivning: `gained` er sæsonens faktisk opnaaede hele point.
//
// Returnerer null naar grundlaget er for tyndt (< minDays traeningsdage). En
// tom tempo-linje er aerlig; et tal fra to dage er stoej (P11: ingenting
// opdigtet).
export function pacePerWeek({
  gainedPoints,
  daysElapsed,
  minDays = 7,
}: {
  gainedPoints?: number | null;
  daysElapsed?: number | null;
  minDays?: number;
}): number | null {
  // `Number(null)` er 0 og finite — en manglende kvittering ville derfor blive
  // til et maalt "0 point om ugen". Manglende grundlag skal tie, ikke paastaa nul.
  if (gainedPoints == null || daysElapsed == null) return null;
  const points = Number(gainedPoints);
  const days = Number(daysElapsed);
  if (!Number.isFinite(points) || points < 0) return null;
  if (!Number.isFinite(days) || days < minDays) return null;
  const perWeek = (points / days) * 7;
  // Een decimal: "ca. 0,7 point om ugen" er sandere end "ca. 1" naar tempoet
  // ligger under et point, og fladen maa ikke runde en langsom rytter op til
  // en hurtig.
  return Math.round(perWeek * 10) / 10;
}

// ── Traeningsscoren paa telefonen (#4851) ───────────────────────────────────

// Rytterens score-udsnit, som `/api/training/me` leverer det
// (backend/lib/trainingScore.js, buildTrainingScoreView). Feltet UDELADES helt
// naar `training_score_visible` er off — derfor er hele viewet nullable, ikke
// bare tallet.
export type MobileScoreView = {
  today?: number | null;
  todayIsRaceDay?: boolean;
  spark?: ReadonlyArray<{ date: string; score: number | null; raceDay?: boolean }> | null;
};

// De TRE tilstande fladen skal kunne vise — praecis de samme som desktop-
// kolonnen (TrainingPage.jsx):
//   "score"   dagens tal (tabular figures)
//   "race"    loebsdag uden tal ⇒ "Race"/"Loeb"
//   "none"    ingen maaling ⇒ streg
export type MobileScoreCell =
  | { state: "score"; value: number }
  | { state: "race" }
  | { state: "none" };

// Raekkefoelgen er bindende: en loebsdag MED et tal er stadig en maalt dag, saa
// tallet vinder. Kun en loebsdag UDEN tal skriver "loeb" — ellers ville en
// loebsdag hvor motoren faktisk maalte passet forsvinde bag et ord.
export function mobileScoreCell(view: MobileScoreView | null | undefined): MobileScoreCell {
  const raw = view?.today;
  // `Number(null)` er 0 og finite: uden det eksplicitte null-tjek ville "ingen
  // maaling" blive til et maalt 0 — samme fald som countsForRole ovenfor.
  if (raw != null && Number.isFinite(Number(raw))) return { state: "score", value: Number(raw) };
  if (view?.todayIsRaceDay) return { state: "race" };
  return { state: "none" };
}

// Kan score-kolonnen vaere i tabellen uden at fortraenge noget?
//
// Formen er laast (ejer 18/9): navnekolonne + datakolonner, INGEN sidelaens
// scroll paa 375 px. Navnecellen er 124 px, og resten deles ligeligt af
// `table-fixed`. Budgettet er derfor "navn + hoejst 3 datakolonner": under det
// bliver en celle smallere end de korteste session-labels ("Norm.", "Hvile")
// og begynder at truncate. Med loebsdags-flaget OFF er der PRAECIS een
// loebsdags-kolonne, saa scoren staar i tabellen i dag. Taendes flaget og der
// kommer 3-5 loebsdage, falder scoren ud af TABELLEN — men ikke af fladen:
// den staar fortsat med tal + kurve i rytterens kort eet tryk vaek, samme
// kontrakt som alder/form/traethed (ejer 18/9: "intet tal forsvinder helt").
export const MOBILE_DATA_COLUMN_BUDGET = 3;

export function canShowScoreColumn(columns: readonly RaceDayColumn[] | null | undefined): boolean {
  return (columns?.length ?? 0) + 1 <= MOBILE_DATA_COLUMN_BUDGET;
}

// ── Kortet folder ud LIGE UNDER rytteren (#3643, ejer 21/9) ─────────────────
//
// Beta-tester @egomadsen 19/9: *"Der bliver meget scrolleri naar rytteren
// folder sig ud under tabellen. Den burde maaske bare folde sig ud lige under
// den paagaeldende rytter."* Maalt 21/9 paa rytter nr. 6 af 10: 201 px mellem
// raekkens bund og kortets top. En rigtig trup er 25-30 ryttere.
//
// Naar kortet nu bor INDE i listen, opstaar et nyt problem: lukker et kort der
// stod OVER den raekke man trykker paa, forsvinder dets hoejde fra flowet, og
// den raekke fingeren lige ramte hopper op — i vaerste fald ud af syne. Derfor
// denne rene funktion: den siger hvor mange px siden skal rulle EFTER layout,
// saa raekken og toppen af kortet staar synlige.
//
// Alt er i viewport-koordinater (getBoundingClientRect), og svaret er et delta
// til window.scrollBy: positivt = rul ned, negativt = rul op, 0 = lad vaere.

// Hvor meget af kortet der skal vaere synligt under raekken. 44 px er IKKE et
// nyt tal: det er det samme tryk-maal (#1602, `min-h-11`) raekkerne og kortets
// egne knapper allerede bruger — een raekke-hoejde af kortet er nok til at man
// SER at noget foldede ud, uden at kraeve at hele kortet presses ind i skaermen.
export const MOBILE_CARD_PEEK = 44;

export function expandScrollAdjustment({
  rowTop,
  rowBottom,
  cardBottom,
  safeTop = 0,
  safeBottom,
  peek = MOBILE_CARD_PEEK,
}: {
  rowTop: number;
  rowBottom: number;
  cardBottom: number;
  // Oeverste synlige kant (0 = skaermens top).
  safeTop?: number;
  // Nederste synlige kant. Den faste bundnavigation (MobileQuickNav, 56 px)
  // ligger OVEN PAA indholdet, saa et kort der slutter under denne linje er
  // gemt bag den — ikke bare "langt nede".
  safeBottom: number;
  peek?: number;
}): number {
  if (![rowTop, rowBottom, cardBottom, safeTop, safeBottom].every((n) => Number.isFinite(n))) return 0;

  // Raekken foerst: er den rullet op over kanten (typisk fordi et kort OVER den
  // lige lukkede), er det den eneste rettelse der betyder noget.
  if (rowTop < safeTop) return Math.round(rowTop - safeTop);

  // Ellers: er raekkens bund eller kortets foerste 44 px gemt bag bundnav'en,
  // saa rul praecis saa langt ned — men ALDRIG saa langt at raekken selv ryger
  // ud over toppen. Raekken under fingeren vejer tungere end kortets udsyn.
  const wantBottom = Math.min(cardBottom, rowBottom + peek);
  if (wantBottom <= safeBottom) return 0;
  return Math.round(Math.min(wantBottom - safeBottom, rowTop - safeTop));
}

// ── Program-gitteret: 7 ugedage x N loebsdage ───────────────────────────────

// Een celle i programgitteret. `intensity` er holdets (eller rytterens) rytme
// for den ugedag; med flere loebsdage pr. dag gentages ugedagens valg indtil
// spilleren kan saette dem hver for sig (TRAINING_RULES §13.3 beslutning 8's
// arkitekt-valg: ugedagens session udfylder alle slots som default).
export type ProgramCell = { weekday: string; raceDay: number; intensity: string };

export function programGrid(
  weekdays: readonly string[],
  columns: readonly RaceDayColumn[],
  intensityForWeekday: (weekday: string) => string,
): ProgramCell[][] {
  const cols = columns?.length ? columns : buildRaceDayColumns();
  return cols.map((col) =>
    (weekdays ?? []).map((weekday) => ({
      weekday,
      raceDay: col.index,
      intensity: intensityForWeekday(weekday),
    })),
  );
}
