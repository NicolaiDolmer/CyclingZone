// Spejler backend/lib/contractSeed.js · contractOnAcquirePatch.
//
// Efter #3620 regenererer oprykning IKKE en kontrakt for en rytter der
// allerede har en: patchen returnerer {} når både salary og contract_end_season
// er sat, så løn, længde og udløbssæson står uændret.
//
// Bekræftelses-modalen skal sige det samme som motoren gør. Før denne helper
// lovede den ubetinget at "akademi-lønnen erstattes af senior-lønnen vist
// ovenfor" og viste et projiceret tal — sandt før #3620, usandt efter, og
// præsenteret i selve klik-øjeblikket foran en irreversibel handling.
//
// Betingelsen bor ÉT sted af samme grund som #3681's backwards-check: en regel
// der er kopieret i hånden til en tekst og et tal, driver fra hinanden.
export function keepsExistingContractOnPromote(rider = {}) {
  return rider?.salary != null && rider?.contract_end_season != null;
}
