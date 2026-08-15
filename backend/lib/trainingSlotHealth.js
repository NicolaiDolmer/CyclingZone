// Trænings-slot-vagt (#3639) — RENE funktioner.
//
// Baggrund: tre spillere meldte 10/8 at "klatring ikke stiger ved VO2max-træning".
// De havde ret. Et træningsfokus træner FLERE evner (vo2max = climbing+punch+tempo),
// og en evne der har nået sit livstidsloft stiger aldrig igen — men fladen
// aggregerede fokusset til ét tal, så en rytter med climbing på loftet og tempo i
// vækst så helt normal ud. Målt i prod 11/8: 117 ryttere med ALLE fokus-evner døde,
// 741 med mindst én død evne, 110 af 197 spillerhold ramt.
//
// UI-rettelsen alene er ikke nok: enhver fremtidig loft-ændring (23/8-pakken,
// 1-99-remappen i #3564) kan producere det samme igen, og sidste gang tog det
// uger før nogen opdagede det. Denne vagt tæller derfor døde slots HVER DAG, så
// tallet stiger synligt i stedet for i stilhed.
//
// Vagten måler EKSAKT det samme som fladen viser: samme cappedVisibleAbilities()
// som /api/training/me sender til klienten. Divergerer de to, er metrikken
// værdiløs — derfor genimplementeres loft-logikken bevidst IKKE her.
//
// Ren JS uden DB/Date/Math.random (samme kontrakt som training.js) — I/O og
// cron-wiring ligger i trainingSlotHealthWatch.js.

import { TRAINING_FOCUSES, cappedVisibleAbilities, smartDefaultFocus } from "./training.js";
import { ALL_SESSIONS } from "./trainingDayTypes.js";

// Nøgle for total-rækken i training_slot_health_daily. Ikke et gyldigt fokus, så
// den kan aldrig kollidere med TRAINING_FOCUS_KEYS.
export const TOTAL_FOCUS_KEY = "__total__";

// Startværdier — bevidst konservative, kalibreres når vagten har en uges historik
// (ingen historiske snapshots eksisterer før denne PR, så tærsklerne kan ikke
// bagud-verificeres mod 11/8-tallene; det er en kendt begrænsning, ikke en
// antagelse der er skjult).
export const TRAINING_SLOT_HEALTH_TUNING = Object.freeze({
  // Andel af ryttere i træning hvis fokus er HELT dødt. 11/8-målingen: 5,0 %.
  deadShareCeiling: 0.07,
  // Absolut dag-til-dag-stigning i helt døde slots. Ryttertype-migrationen 11/8
  // dræbte 35 slots på én dag (og befriede 28) — en ændring af den størrelse skal
  // ses uanset at NETTO-tallet kun flyttede sig +7.
  deadJumpAbsolute: 15,
});

// Tilstanden for ÉT fokus på ÉN rytter, målt mod backendens egne cap-nøgler.
//   focus            : fokus-nøgle
//   cappedAbilityKeys: cappedVisibleAbilities(row) — ability-NØGLER, aldrig tal
// Returnerer "open" | "partial" | "dead", eller null ved ukendt fokus.
// Spejler frontendens focusCapState (frontend/src/lib/trainingReport.js) 1:1.
export function focusSlotState(focus, cappedAbilityKeys) {
  const abilities = TRAINING_FOCUSES[focus];
  if (!abilities?.length) return null;
  const set = new Set(cappedAbilityKeys ?? []);
  const cappedCount = abilities.reduce((n, a) => n + (set.has(a) ? 1 : 0), 0);
  if (cappedCount === 0) return "open";
  return cappedCount === abilities.length ? "dead" : "partial";
}

// Dagens slot-helbred for hele spiller-populationen.
//   riders        : [{ id, primary_type }] — ikke-pensionerede, spiller-ejede
//   planByRiderId : { [riderId]: focus } — KUN aktiv sæsons planer
//   abilityRows   : [rider_derived_abilities-rækker] (skal have rider_id)
//
// Ryttere UDEN plan tælles med under det fokus assistenten faktisk træner dem med
// (smartDefaultFocus — samme regel som dailyTraining.js' resolveProgram). Uden det
// ville vagten være blind for præcis den værste variant: et dødt fokus som
// spilleren aldrig selv har valgt og derfor slet ikke leder efter.
//
// Returnerer { rows: [{ focus, ridersInTraining, deadSlots, partialSlots }], totals }
// hvor rows indeholder ét fokus pr. TRAINING_FOCUS_KEYS (også med nul-tal, så en
// tom dag ikke ligner manglende data) og totals er summen på tværs.
//
// #3762: rækkerne følger ALL_SESSIONS (de sessioner en rytter kan trænes MED),
// ikke TRAINING_FOCUS_KEYS. Forskellen er `restitution`, som er en hel dagstype
// og ikke skubber nogen evne mod sit loft — en slot-helbreds-række for den ville
// altid være tom og fortynde vagtens signal.
export function computeTrainingSlotHealth({ riders = [], planByRiderId = {}, abilityRows = [] } = {}) {
  const cappedByRider = new Map();
  for (const row of abilityRows) {
    if (row?.rider_id == null) continue;
    cappedByRider.set(row.rider_id, cappedVisibleAbilities(row));
  }

  const tally = new Map(ALL_SESSIONS.map((k) => [k, { ridersInTraining: 0, deadSlots: 0, partialSlots: 0 }]));

  for (const rider of riders) {
    if (rider?.id == null) continue;
    // Ingen afledte evner endnu (helt ny rytter) → intet loft at måle mod. Tælles
    // ikke med; ellers ville hver akademi-indtagelse se ud som et sundt slot.
    if (!cappedByRider.has(rider.id)) continue;
    const focus = planByRiderId[rider.id] ?? smartDefaultFocus(rider.primary_type ?? null);
    const bucket = tally.get(focus);
    if (!bucket) continue;
    const state = focusSlotState(focus, cappedByRider.get(rider.id));
    bucket.ridersInTraining++;
    if (state === "dead") bucket.deadSlots++;
    else if (state === "partial") bucket.partialSlots++;
  }

  const rows = ALL_SESSIONS.map((focus) => ({ focus, ...tally.get(focus) }));
  const totals = rows.reduce(
    (acc, r) => ({
      ridersInTraining: acc.ridersInTraining + r.ridersInTraining,
      deadSlots: acc.deadSlots + r.deadSlots,
      partialSlots: acc.partialSlots + r.partialSlots,
    }),
    { ridersInTraining: 0, deadSlots: 0, partialSlots: 0 }
  );
  return { rows, totals };
}

// Skal dagens tal alarmere? To uafhængige udløsere, så både en LANGSOM forværring
// og et ENKELT spring fanges:
//   (a) andelen af helt døde slots over loftet, eller
//   (b) et absolut spring siden forrige snapshot.
//   totals   : dagens { ridersInTraining, deadSlots, partialSlots }
//   previous : forrige dags totals, eller null (første kørsel → kun (a) kan udløse)
// Returnerer { shouldAlert, reasons: [string], deadShare }.
export function evaluateSlotHealthAlert(totals, previous = null, tuning = TRAINING_SLOT_HEALTH_TUNING) {
  const inTraining = totals?.ridersInTraining ?? 0;
  const dead = totals?.deadSlots ?? 0;
  const deadShare = inTraining > 0 ? dead / inTraining : 0;
  const reasons = [];
  if (deadShare > tuning.deadShareCeiling) {
    reasons.push(
      `${dead} af ${inTraining} træningsslots er helt døde (${(deadShare * 100).toFixed(1)} % > loft ${(tuning.deadShareCeiling * 100).toFixed(0)} %)`
    );
  }
  if (previous?.deadSlots != null) {
    const jump = dead - previous.deadSlots;
    if (jump >= tuning.deadJumpAbsolute) {
      reasons.push(`døde slots steg ${jump} på ét døgn (${previous.deadSlots} → ${dead})`);
    }
  }
  return { shouldAlert: reasons.length > 0, reasons, deadShare };
}
