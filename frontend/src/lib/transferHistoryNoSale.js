// #2400: en gennemført auktion uden bud ("ingen salg") er ikke en faktisk
// handel — rytteren blev bare på holdet. TeamTransferHistoryTab viste den
// alligevel mellem de reelle signeringer/salg/frigivelser, hvilket gjorde
// historikken sværere at bruge til det den er tiltænkt (Discord-feedback #2400).
//
// Ren funktion (unit-testbar) så filtreringen ikke kun kan verificeres via en
// kilde-tekst-regex — udtrukket af TeamTransferHistoryTab så komponenten selv
// forbliver tynd.

// Returnerer { visible, hiddenCount }:
//   visible     = events der skal vises (alle events når showNoSale=true,
//                 ellers alle UNDTAGEN no_sale-auktioner).
//   hiddenCount = hvor mange no_sale-events der blev skjult (0 når showNoSale=true).
export function filterTransferHistoryNoSale(events, showNoSale) {
  const list = events || [];
  if (showNoSale) {
    return { visible: list, hiddenCount: 0 };
  }
  const hiddenCount = list.reduce((n, e) => (e?.no_sale ? n + 1 : n), 0);
  return { visible: list.filter((e) => !e?.no_sale), hiddenCount };
}
