// DOMMER #6110 R5: aldersforloebet som en ren regel over en andels-funktion (alder -> andel).
//
// Ejeren 12/11: fuld udvikling til og med 26, mindre for hvert aar fra 27, naesten intet fra
// 31. Ejeren 14/11: "naesten intet" er ca. en fjerdedel af fuld udvikling ved 31.
//
// Fable-dom 15/11, fund 5: "mindre for hvert aar" fangede ikke en kurve med naesten fuld
// udvikling til 30 og et brat fald ved 31 (hvert aar et haar lavere er stadig "mindre").
// Ejerens ord er et fald HVERT aar fra 27, altsaa et jaevnt fald, ikke et stop. Uden at
// opfinde nye ejertal regnes faldet ud fra ejerens egne to punkter: fra fuld (1) ved 26 til
// ca. en fjerdedel ved 31 er der fem aar, saa et ligeligt fald er (1 - en fjerdedel) / 5
// pr. aar. Dommerens laesning af "jaevnt": hvert aar fra 27 til 31 skal falde mindst
// halvdelen af et ligeligt aars fald (JAEVNT_MINDST). Halvdelen er dommerens tal, ikke
// ejerens; det tillader en blid kurve (lidt mindre fald i starten, mere senere) og fanger
// en kurve, der staar naesten stille og saa falder brat.
//
// Filen er ikke en test og koerer ikke af sig selv.

export const NAESTEN_INTET = 0.25; // ejer 14/11: "ca. en fjerdedel" af fuld udvikling ved 31
export const CA = 0.05; // dommerens laesning af "ca.": hoejst saa langt fra en fjerdedel
export const JAEVNT_MINDST = 0.5; // dommerens laesning af "et fald hvert aar": mindst halvt ligeligt fald

/** Fejl i aldersforloebet. `andel(alder)` er andelen af fuld udvikling. Tom liste = holder. */
export function aldersforloebBrud(andel) {
  const fejl = [];
  for (let alder = 16; alder <= 26; alder++) if (andel(alder) !== 1) fejl.push(`${alder} aar skal have fuld udvikling`);
  const ligeligt = (1 - NAESTEN_INTET) / 5;
  for (let alder = 27; alder <= 31; alder++) {
    const fald = andel(alder - 1) - andel(alder);
    if (!(fald >= JAEVNT_MINDST * ligeligt)) {
      fejl.push(`fra ${alder - 1} til ${alder} skal udviklingen falde mærkbart (et jævnt fald hvert år, ikke et brat stop senere)`);
    }
  }
  if (!(andel(27) >= 0.5)) fejl.push("faldet er gradvist: en 27-aarig har stadig det meste af sin udvikling");
  if (!(Math.abs(andel(31) - NAESTEN_INTET) <= CA)) fejl.push("31 aar: ca. en fjerdedel af fuld udvikling");
  for (let alder = 31; alder <= 40; alder++) {
    if (!(andel(alder) > 0)) fejl.push(`${alder} aar: aldrig nul`);
    if (!(andel(alder) <= NAESTEN_INTET + CA)) fejl.push(`${alder} aar: naesten intet`);
    if (!(andel(alder) <= andel(alder - 1))) fejl.push(`${alder} aar: udviklingen stiger aldrig igen`);
  }
  return fejl;
}
