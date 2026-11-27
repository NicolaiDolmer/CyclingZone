// #8725 (TASTE v2 M1, ejer 26/11): små labels i versaler med spærring udgår
// overalt, også tabeloverskrifter og menuens grupper. Kittet beholder sin
// versal-opskrift, og denne klasse slår den fra, når beta-kontakten
// sentence_case_8725 har sat data-sentence-case på <html> (lib/sentenceCaseFlag.ts,
// variant `sentence:` i index.css). Slukket kontakt = samme pixels som før.
//
// Står sidst i klasselisten, så den vinder over kittets uppercase + tracking.
// Størrelse og tyngde er ikke rørt: dem afgør ejeren på før/efter-billederne.
export const SENTENCE_CASE = "sentence:normal-case sentence:tracking-normal";
