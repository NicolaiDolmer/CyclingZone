// DOMMER #7855: fryser dommerens facit. KUN dommeren koerer den, KUN paa commit'en foer byggeriet
// (origin/main 8a02593dd, 13/11). Byggebanen koerer den ALDRIG: facit maa ikke genskabes med ny kode.
//   node backend/lib/dommer7855.frys-facit.mjs <kilde-sha>
// Ikke en test (ingen .test.-endelse).
import { writeFileSync } from "node:fs";
import { valideringstabel, slukketAftryk, hentPointAftryk } from "./dommer7855.facit-scenarier.mjs";

const kilde = process.argv[2];
if (!/^[0-9a-f]{40}$/.test(kilde ?? "")) throw new Error("angiv kilde-commit (40 tegn)");
const { slukket, taendtUdenJagt } = await slukketAftryk();
const hentPoint = await hentPointAftryk();
const facit = {
  beskrivelse: "Dommerens frosne facit for #7855 (ejerens tre valg 13/11). Frosset FOER byggeriet. Maa ikke genskabes med ny kode.",
  kilde,
  afrunding: "alle decimaltal afrundet til 6 decimaler foer hash (#8113)",
  validering: await valideringstabel(),
  slukket,
  taendtUdenJagt,
  hentPoint: hentPoint.aftryk,
  hentPointJagedePassager: hentPoint.jagedePassager,
};
writeFileSync(new URL("./__fixtures__/dommer7855Facit.json", import.meta.url), JSON.stringify(facit, null, 1) + "\n");
console.log("frosset:", Object.keys(slukket).length, "slukkede,", Object.keys(taendtUdenJagt).length, "taendt uden jagt,", Object.keys(hentPoint.aftryk).length, "Hent point;", facit.validering.antal, "planer; jagede passager", hentPoint.jagedePassager);
