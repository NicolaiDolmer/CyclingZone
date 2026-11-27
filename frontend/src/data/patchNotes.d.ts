// Typen for patchNotes.js. Datafilen er ~2 MB JSON bag `export const PATCHES = [`
// (scripts/patch-notes-number.mjs kraever den header, saa en JSDoc-type kan ikke staa
// oeverst). Uden denne fil infererede tsc en literal-union over alle noter og ramte
// TS2590 ("union type that is too complex") paa main 26/11, da 7.521-7.525 kom med.
// Formen valideres af scripts/check-patch-notes-*.mjs og lib/patchNotes.data.test.js.

export interface PatchNoteText {
  title: string;
  body?: string;
  [key: string]: unknown;
}

export interface PatchNoteChange {
  category?: string;
  audience?: string;
  rollout?: string;
  topic?: string;
  area?: unknown;
  image?: unknown;
  flag?: string;
  en: PatchNoteText;
  da: PatchNoteText;
  [key: string]: unknown;
}

export interface PatchNote {
  version: string;
  date: string;
  changes: PatchNoteChange[];
  [key: string]: unknown;
}

export declare const PATCHES: PatchNote[];
