// Week blocks: prioritet pr. felt og eet laast pas pr. dag (#8549, Refs #7456) - REN kerne.
//
// Design: docs/audits/undersoegelse-docs-8549-prioritet-laast-pas-design.md (PR #8558),
// ejer-svar paa #8549 21/11. PR 1 = denne fil + laesesiden i trainingPrograms.js.
// INGEN kalder endnu: motoren og prognosen tager den i brug bag kontakten i en senere PR.
//
// ═══ REGLEN ══════════════════════════════════════════════════════════════════
// En dag har PROGRAM_SLOTS felter (LD 1..5). Felternes raekkefoelge i dagen er baade
// tidsraekkefoelge og prioritet (felt 0 = prioritet 1). Et "kildefelt" er det felt i
// dagens plan, hvis pas (session + indsats) koeres: sessionForDayEntry(entry, kilde).
//
//   1. Afregnede felter (`settled`) ligger fast med deres kilde. Et allerede koert pas
//      koeres aldrig igen i et andet felt.
//   2. Laasen (entry.lockSlot = hjemmefeltet): staar hjemmefeltet frit, bliver passet
//      der. Ellers flytter det til det NAERMESTE frie felt, der ikke er afregnet; ved
//      lige afstand det SENERE felt (ejer 21/11, svar A). Intet frit felt = taget.
//   3. Resten: de ikke-laaste kilder i prioritetsraekkefoelge fyldes i de resterende
//      frie felter i tidsraekkefoelge. Kilder uden plads er taget af loeb. Loeb tager
//      altsaa laveste prioritet foerst, og pas taget af loeb indhentes ikke.
//
// Prefix-stabilitet: med de afregnede felter som `settled` aendrer et loeb, der kommer
// til senere paa datoen, aldrig et afregnet felt, og ingen kilde bruges to gange.
// Traethedsgraensen og selve loebsfeltet (racedToday) er motorens og uroert her.
//
// Ens pas paa alle felter (ingen `slots`) giver praecis dagens regel: hvert frit felt
// koerer dagens session, og antallet af tabte pas er antallet af loebsfelter.

import { PROGRAM_SLOTS } from "./trainingPrograms.js";

const FIELDS = Object.freeze(Array.from({ length: PROGRAM_SLOTS }, (_, i) => i));

function isField(value) {
  return Number.isInteger(value) && value >= 0 && value < PROGRAM_SLOTS;
}

// Dagens laaste hjemmefelt, eller null (ingen laas / ugyldig vaerdi).
export function lockSlotOf(entry) {
  if (!entry || typeof entry !== "object") return null;
  return isField(entry.lockSlot) ? entry.lockSlot : null;
}

// Naermeste kandidat til `home`; ved lige afstand den senere.
function nearestField(home, candidates) {
  let best = null;
  for (const field of candidates) {
    if (best == null) { best = field; continue; }
    const d = Math.abs(field - home);
    const bestD = Math.abs(best - home);
    if (d < bestD || (d === bestD && field > best)) best = field;
  }
  return best;
}

// entry      : dagens plan-raekke ({ session, slots?, lockSlot?, ... }) eller null.
// raceFields : felter (0..PROGRAM_SLOTS-1) hvor rytteren koerer loeb paa datoen
//              (Set, Array eller anden iterable). Ugyldige vaerdier ignoreres.
// settled    : allerede afregnede felter -> deres kildefelt (Map eller iterable af
//              [felt, kilde]). Kilden null = feltet blev afregnet uden pas (fx loeb).
// Returnerer { fieldSource, taken, lockMovedFrom }:
//   fieldSource   : laengde PROGRAM_SLOTS; kildefeltet pr. felt, null for et loebsfelt
//                   (eller et felt afregnet uden pas).
//   taken         : kilder der ikke faar plads (taget af loeb), i prioritetsraekkefoelge.
//   lockMovedFrom : laasens hjemmefelt, naar laasen koerer i et andet felt, ellers null.
export function assignDayFields({ entry = null, raceFields = [], settled = null } = {}) {
  const races = new Set([...(raceFields ?? [])].filter(isField));
  const fixed = new Map();
  for (const [field, source] of settled ?? []) {
    if (!isField(field)) continue;
    fixed.set(field, isField(source) ? source : null);
  }

  const fieldSource = FIELDS.map((field) => (fixed.has(field) ? fixed.get(field) : null));
  const used = new Set([...fixed.values()].filter((s) => s != null));
  // Frie felter, der endnu kan faa et pas: uden loeb og ikke afregnet, i tidsraekkefoelge.
  const open = FIELDS.filter((field) => !races.has(field) && !fixed.has(field));

  const lock = lockSlotOf(entry);
  let lockMovedFrom = null;
  const taken = [];
  if (lock != null) {
    if (used.has(lock)) {
      // Laasen er allerede koert (afregnet). Den flyttede, hvis den koerte uden for hjemmet.
      const ranAt = FIELDS.find((field) => fixed.get(field) === lock);
      if (ranAt !== lock) lockMovedFrom = lock;
    } else {
      const target = open.includes(lock) ? lock : nearestField(lock, open);
      if (target == null) {
        taken.push(lock);
      } else {
        fieldSource[target] = lock;
        used.add(lock);
        open.splice(open.indexOf(target), 1);
        if (target !== lock) lockMovedFrom = lock;
      }
    }
  }

  // Resten i prioritetsraekkefoelge ind i de resterende frie felter i tidsraekkefoelge.
  const queue = FIELDS.filter((source) => source !== lock && !used.has(source));
  for (const field of open) {
    if (!queue.length) break;
    fieldSource[field] = queue.shift();
  }
  taken.push(...queue);
  taken.sort((a, b) => a - b);

  return { fieldSource, taken, lockMovedFrom };
}
