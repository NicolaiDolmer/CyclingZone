// #5098 — det ugemte udtagelses-udkast, holdt i live mens manageren kigger et
// andet sted hen på løbssiden.
//
// Spillerrapporten (spørgeskema 8/9): "valget annulleres når man skifter mellem
// etaper i et etapeløb". Løbssiden er faner (#4613), og de to ting bor i hver
// sin fane: holdudtagelsen i Hold-fanen, etape-striben i Etaper-fanen. Man kan
// altså ikke slå etape 2's profil op midt i en udtagelse uden at forlade
// panelet — og fanerne renderes betinget, så RaceSelectionPanel afmonteres og
// tager sin `sel`-state med sig. Manageren kom tilbage til et tomt panel.
//
// Rettelsen holder udkastet ÉT sted uden for komponenten, så det overlever en
// afmontering i samme session (fane-skift, et smut til Mit Hold og tilbage).
// Bevidst i hukommelsen og ikke i sessionStorage: et udkast er ikke en gemt
// udtagelse, og det må ikke kunne dukke op igen efter en genindlæsning som om
// det var gemt. Reload-porten (#5159) dækker allerede release-drevne reloads
// mens panelet er rørt.
//
// ÉT slot: manageren udtager ét løb ad gangen, og et udkast fra et andet løb
// skal aldrig kunne lægge sig oven i det han står i nu.

/** @typedef {{riderIds: Array<string|number>, captainId: any, sprintCaptainId: any, hunterId: any, freeRoleIds: Array<string|number>}} SelectionDraft */

let slot = null; // { raceId: string, draft: SelectionDraft }

/** Normaliseret kopi — udkastet må aldrig dele reference med panelets state. */
function copy(sel) {
  return {
    riderIds: Array.isArray(sel?.riderIds) ? [...sel.riderIds] : [],
    captainId: sel?.captainId ?? null,
    sprintCaptainId: sel?.sprintCaptainId ?? null,
    hunterId: sel?.hunterId ?? null,
    freeRoleIds: Array.isArray(sel?.freeRoleIds) ? [...sel.freeRoleIds] : [],
  };
}

/**
 * Husk managerens ugemte udkast for ét løb. Overskriver et udkast fra et andet
 * løb — der er kun ét slot.
 *
 * @param {string|number|null|undefined} raceId
 * @param {Partial<SelectionDraft>|null|undefined} sel
 */
export function rememberSelectionDraft(raceId, sel) {
  if (raceId == null) return;
  slot = { raceId: String(raceId), draft: copy(sel) };
}

/**
 * Udkastet for dette løb, eller null. Et udkast fra et ANDET løb svarer null
 * (og bliver liggende — manageren kan stadig nå tilbage til det).
 *
 * @param {string|number|null|undefined} raceId
 * @returns {SelectionDraft|null}
 */
export function readSelectionDraft(raceId) {
  if (raceId == null || !slot || slot.raceId !== String(raceId)) return null;
  return copy(slot.draft);
}

/**
 * Glem udkastet for dette løb — kaldes når serveren har overtaget sandheden
 * (et lykkedes Gem eller assistentens udtagelse). Rører ikke et udkast der
 * hører til et andet løb.
 *
 * @param {string|number|null|undefined} raceId
 */
export function forgetSelectionDraft(raceId) {
  if (raceId == null || !slot || slot.raceId !== String(raceId)) return;
  slot = null;
}

/**
 * Skær udkastet til den rytterliste serveren svarer med NU. En rytter kan være
 * solgt, skadet ud af listen eller bundet i et andet løb siden udkastet blev
 * lavet; han må ikke leve videre i truppen, og en rolle må aldrig pege på en
 * rytter der ikke er udtaget.
 *
 * Uden en brugbar rytterliste returneres udkastet uændret — vi har så intet at
 * validere imod, og at kaste managerens arbejde væk ville være værre.
 *
 * @param {Partial<SelectionDraft>|null|undefined} draft
 * @param {Array<{id: string|number}>|null|undefined} riders
 * @returns {SelectionDraft}
 */
export function reconcileSelectionDraft(draft, riders) {
  const next = copy(draft);
  if (!Array.isArray(riders)) return next;
  const known = new Set(riders.map((r) => r?.id));
  next.riderIds = next.riderIds.filter((id) => known.has(id));
  const selected = new Set(next.riderIds);
  next.freeRoleIds = next.freeRoleIds.filter((id) => selected.has(id));
  for (const key of ["captainId", "sprintCaptainId", "hunterId"]) {
    if (next[key] != null && !selected.has(next[key])) next[key] = null;
  }
  return next;
}
