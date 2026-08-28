// #1307: ren udtagelses-state-logik (testbar uden React). Spejler backendens
// valideringskoder så fejl kan vises FØR kaldet.

export function toggleRider(state, riderId, max) {
  const has = state.riderIds.includes(riderId);
  if (!has && state.riderIds.length >= max) return state;
  const riderIds = has ? state.riderIds.filter((id) => id !== riderId) : [...state.riderIds, riderId];
  return {
    riderIds,
    captainId: has && state.captainId === riderId ? null : state.captainId,
    sprintCaptainId: has && state.sprintCaptainId === riderId ? null : state.sprintCaptainId,
    hunterId: has && state.hunterId === riderId ? null : state.hunterId,
  };
}

// #2028: vælg en fallback-kaptajn EFTER FORTJENESTE når manageren ikke selv har sat en.
// Tidligere valgte board'et `ids[0]` (første rytter i arrayet) → en vilkårlig, ofte
// svagere rytter blev gemt som kaptajn uden intention (fx GC-lederen blev forbigået).
// Nu: højest løb-suitability blandt de udtagne, ekskl. sprint/jæger så roller forbliver
// distinkte; kun hvis ALLE kandidater allerede har en anden rolle falder vi tilbage til
// hele feltet. Tiebreak: rider_id asc (deterministisk). Tom trup → null.
// `suitabilityOf(id)` → 0-100 (eller null/undefined når ukendt → behandles som lavest).
// Spejler race-enginens egen GC-fallback (raceAutopick.resolveCaptain: stærkeste rytter).
export function pickFallbackCaptain({ riderIds = [], sprintId = null, hunterId = null, suitabilityOf }) {
  if (!riderIds.length) return null;
  const eligible = riderIds.filter((id) => id !== sprintId && id !== hunterId);
  const pool = eligible.length ? eligible : riderIds;
  let best = null;
  let bestScore = -Infinity;
  for (const id of pool) {
    const raw = suitabilityOf ? Number(suitabilityOf(id)) : NaN;
    const score = Number.isFinite(raw) ? raw : -1;
    if (score > bestScore || (score === bestScore && best != null && String(id) < String(best))) {
      best = id;
      bestScore = score;
    }
  }
  return best;
}

// Spejler backend raceSelection.validateSelection (backend/lib/raceSelection.js:25).
//
// KONTRAKTEN (#4295): klienten må ALDRIG afvise et gem serveren ville acceptere.
// Præcis tre ting blokerer:
//   selection_wrong_size       → flere ryttere end feltstørrelsen (size.max)
//   selection_captain_required → ingen kaptajn blandt de udtagne
//   selection_role_overlap     → samme rytter i to roller
// ANTAL blokerer aldrig nedad. En DELVIS TRUP ER ALTID LOVLIG (ejer 28/6): er truppen
// ikke fuld ved race-tid, top-fylder raceEntryGenerator gabet fra holdets ledige ryttere.
//
// #1906's "hårde fulde opstilling" er hermed helt afløst. Historikken, så den ikke
// genopfindes:
//   #1906  gjorde en fuld trup til et krav i panelet (nudge mod komplet trup).
//   #2637  lempede kravet til kun at gælde en FØRSTEGANGS-udtagelse, via kalderens
//          `requireFull: !data.selection`, så en skadet rytter kunne fjernes fra en
//          allerede gemt trup.
//   #4175  tilføjede en escape-ventil: kravet gjaldt kun når `availableCount >= size.max`,
//          altså når holdet FAKTISK kunne fylde feltet.
//   #4295  viste at ventilen var utæt. `availableCount` er "hele den raske trup"
//          (backend/lib/raceSelection.js:223) og trækker ALDRIG ryttere fra der er bundet
//          i et overlappende løb. bound_riders beregnes separat i ruten. Et hold med 29
//          ryttere har derfor altid `availableCount >= size.max`, så ventilen udløste
//          aldrig i praksis, og en førstegangs-udtagelse (efter "Ryd alt" eller en
//          kalender-rebuild) var stadig blokeret. Oveni løj fejlteksten: brugeren fik
//          "Du kan højst udtage {max} ryttere" fordi han havde valgt for FÅ.
//
// Nudgen mod en fuld trup lever videre, men som en IKKE-BLOKERENDE hint-linje i
// RaceSelectionPanel (`selection.partialHint`), bygget på ryttere der faktisk er frie til
// DETTE løb (ikke bundet, ikke skadet). Den hører ikke hjemme her: denne funktion afgør
// om der MÅ gemmes, ikke hvad der er klogt at gemme.
export function validateSelectionClient({ riderIds, captainId, sprintCaptainId, hunterId, size }) {
  const errors = [];
  if (riderIds.length > size.max) errors.push("selection_wrong_size");
  // BEVIDST divergens der står tilbage efter #4295: backenden kræver kun kaptajn når
  // riderIds.length > 0 (raceSelection.js:36-41), klienten kræver den altid. En helt tom
  // trup (ren auto-udtagelse) kan derfor ikke gemmes fra løbssiden. Uden for #4295's
  // scope: det er en ejer-beslutning, ikke en overset fejl.
  if (!captainId) errors.push("selection_captain_required");
  const roles = [captainId, sprintCaptainId, hunterId].filter(Boolean);
  if (new Set(roles).size !== roles.length) errors.push("selection_role_overlap");
  return errors;
}

// #4295 (ejer-beslutning 27/8): et hold skal have MINDST 6 udtagne ryttere for at stille
// op i et løb. Fladt gulv, uafhængigt af feltstørrelsen (6/7/8 pr. klasse). Backendens
// SSOT er raceAutopick.MIN_RACE_ENTRIES; frontend og backend er separate npm-pakker og
// kan ikke dele et build-time-import (samme mønster som rulesNumbers.js), så tallet er
// duplikeret her og PINNET af drift-guarden i raceSelectionLogic.test.js. Ændrer
// backenden gulvet, fejler den test indtil dette tal følger med.
export const MIN_RACE_ENTRIES = 6;

// Hvad sker der med de tomme pladser? ÉN kilde til den sætning, så panelet og dagsboardets
// kolonne aldrig kan sige to forskellige ting om det samme løb.
//
//   "willNotStart"             — under gulvet, og assistenten kan ikke nå det med de frie
//                                ryttere holdet har tilbage. Holdet stiller ikke op.
//   "assistantFills"           — pladser åbne, og der er frie ryttere nok til dem alle.
//   "assistantFillsWhatItCan"  — pladser åbne, færre frie ryttere end pladser, men gulvet
//                                nås stadig, så holdet stiller op.
//   null                       — intet at sige (fuld trup, urørt panel, eller et løb der
//                                allerede er i gang).
//
// `raceLive` (stages_completed > 0): assistenten top-fylder ALDRIG et igangværende løb
// (#1825), så hverken løftet om et auto-fyld eller gulvet gælder dér — gulvet afgør hvem
// der STILLER OP, og det er afgjort da løbet startede.
//
// selected === 0 — RETTET (#4295 opfølgning, blokerende fund på #4301, målt 27/8):
// funktionen returnerede tidligere bevidst null her, på ANTAGELSEN om at assistenten
// altid fylder en hel trup når manageren intet har valgt. Det holder ikke under gulvet:
// fillMissingTeamEntries (raceRunner.js) skriver INTET hvis den ikke kan nå 6, så et
// urørt løb med for få frie ryttere endte uden ét ord på nogen flade. Målt: 195 af 226
// menneskehold har nul udtagelser, og 128 af 130 tabte starter rammer hold i præcis den
// tilstand. To udfald, samme som ved en delvis udtagelse:
//   assistantFills (emptySelection: true) — nok frie ryttere til at NÅ EN HEL TRUP
//                                            (uændret adfærd, #1307/#4174).
//   willNotStart   (emptySelection: true) — færre frie ryttere end gulvet; redningen
//                                            kan ikke nå 6, og holdet stiller ikke op.
// `emptySelection` lader panelet/kolonnen vælge den rigtige sætning uden at duplikere
// gulv-logikken — selve reglen (er der ryttere nok) er identisk med den delvise gren.
export function partialSquadOutlook({ selected, free = 0, fieldMax, raceLive = false }) {
  if (raceLive) return null;
  const picked = Number(selected) || 0;
  const freeLeft = Math.max(0, Number(free) || 0);
  if (picked <= 0) {
    const open = Math.max(0, Number(fieldMax) || 0);
    if (freeLeft < MIN_RACE_ENTRIES) {
      return { kind: "willNotStart", open, free: freeLeft, min: MIN_RACE_ENTRIES, emptySelection: true };
    }
    return { kind: "assistantFills", open, free: freeLeft, min: MIN_RACE_ENTRIES, emptySelection: true };
  }
  const open = Math.max(0, (Number(fieldMax) || picked) - picked);
  if (picked < MIN_RACE_ENTRIES && picked + freeLeft < MIN_RACE_ENTRIES) {
    return { kind: "willNotStart", open, free: freeLeft, min: MIN_RACE_ENTRIES };
  }
  if (open === 0) return null;
  return {
    kind: freeLeft >= open ? "assistantFills" : "assistantFillsWhatItCan",
    open, free: freeLeft, min: MIN_RACE_ENTRIES,
  };
}
