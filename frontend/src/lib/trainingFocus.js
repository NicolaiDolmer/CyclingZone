// trainingFocus.js — ren logik bag fokus-panelet (#3721, ejer-godkendt 16/8).
//
// Panelet erstatter fokus-<select>'en begge steder man vælger fokus (/training-
// rosteret og rytterprofilens Træning-fane). Én række pr. fokus: hvad det
// træner, hvad rytteren ville få, og hvor godt det passer. Ingen DB, ingen
// React, ingen Date — unit-testes isoleret med node --test.
//
// Hele grunden til at panelet findes: der er FEM ting på vej ind på den samme
// flade, og de kommer fra samme model (et tag og en rate). En <select> kan bære
// ét ord pr. option. En række kan bære en kolonne mere, hver gang der kommer en.

import { TRAINING_FOCUS_ABILITIES, TRAINING_FOCUS_KEYS } from "./training.js";

// Hvad panelet siger om et fokus' egnethed. TRE værdier, ikke backendens tre —
// `limited` oversættes bevidst til "ingen påstand", se focusSignal nedenfor.
export const FOCUS_SIGNAL = Object.freeze({
  STRONG: "strong",
  WEAK: "weak",
  NONE: "none",
});

// Backendens trænbarheds-niveau → panelets signal.
//
// `limited` bliver til NONE, altså ingen påstand. Det er ikke forsigtighed, det
// er det eneste ærlige: `limited` er den bucket hvor håndværks-evner (tag 0,95)
// og anden-rolle-evner (tag 0,70) lander sammen, og forskellen på dem er 36 %
// af loftet. Chippen "Limited upside for this rider type" kunne derfor sige det
// samme om en evne der næsten når en sekundær evnes loft og om en der ikke gør
// (#3747). Panelet siger hellere ingenting end noget forkert.
//
// `blocked` beholdes selvom den i dag er uopnåelig: målt 0 af 384 kombinationer
// (8 primærtyper × 8 sekundær-muligheder × 6 fokus) på både main og #3741's
// konstanter — en rytter uden primærtype falder til `limited` via en tidlig
// return, ikke til `blocked`. Mapningen står, så en fremtidig konstant-ændring
// giver et signal i stedet for tavshed; den RØDE chip på rosteret er derimod
// slettet, fordi den aldrig har kunnet rendere.
//
// Når trin 4 lander, splittes `limited` i to og NONE forsvinder af sig selv.
export function focusSignal(level) {
  if (level === "strength") return FOCUS_SIGNAL.STRONG;
  if (level === "blocked") return FOCUS_SIGNAL.WEAK;
  return FOCUS_SIGNAL.NONE;
}

// Rækkerne panelet tegner, i TRAINING_FOCUS_KEYS-rækkefølge.
//
//   trainability   : { [focus]: 'strength'|'limited'|'blocked' } for DENNE rytter,
//                    eller null/undefined (ukendt → intet signal, ikke et gæt)
//   activeFocus    : rytterens valgte fokus, eller null
//   assistantFocus : hvad assistenten træner ham med når intet er valgt (#1894),
//                    eller null
//   perSeason      : { [focus]: { [ability]: number } } — point pr. sæson pr.
//                    evne. RESERVERET: trin 4 (#3741) leverer den, og indtil da
//                    er den undefined og kolonnen renderes ikke. Det er den ene
//                    grund til at panelet er en tabel og ikke en liste.
//
// Returnerer [{ focus, abilities, active, isAssistantDefault, signal, perSeason }].
export function focusPanelRows({ trainability, activeFocus = null, assistantFocus = null, perSeason } = {}) {
  return TRAINING_FOCUS_KEYS.map((focus) => ({
    focus,
    abilities: TRAINING_FOCUS_ABILITIES[focus] ?? [],
    active: focus === activeFocus,
    // Kun relevant når rytteren IKKE har et eget valg: assistenten overskriver
    // aldrig en managers fokus (server-håndhævet, #1894 variant 3).
    isAssistantDefault: !activeFocus && focus === assistantFocus,
    signal: focusSignal(trainability?.[focus]),
    perSeason: perSeason?.[focus],
  }));
}

// Har panelet noget at vise i signal-kolonnen overhovedet? Med `limited`
// oversat til NONE kan hele kolonnen være tom for en rytter, og en tabel med en
// tom kolonne ser ud som om noget mangler. Kolonnen udelades i stedet.
export function hasAnySignal(rows) {
  return (rows ?? []).some((row) => row.signal !== FOCUS_SIGNAL.NONE);
}

// Har nogen række et point-pr-sæson-tal? Samme regel som ovenfor: kolonnen
// findes kun når trin 4 har fyldt den.
export function hasAnyPerSeason(rows) {
  return (rows ?? []).some((row) => row.perSeason && Object.keys(row.perSeason).length > 0);
}
