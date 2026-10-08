# #5860: binding følger rytteren, ikke holdet

- #5693 løste skriverækkefølgen for to ændrede enheder hos samme hold.
- Generatoren grupperede stadig låse på race/hold; en rytter hos et nyt hold
  kunne derfor foreslås til en optaget løbsdag. Vedvarende participation blev
  heller ikke læst af generatoren efter #5983.
- Fire nye generatorregressioner fejlede før fixet med én failed unit hver;
  de dækker eksternt frosset etapeløb og slettet completed entry efter holdskifte,
  begge med/uden batch-RPC. Anden sæson og næste løbsdag er frie kontrolcases.
- Fix læser canonical spans og faktisk participation efter rider-id/sæson,
  også ved UQ-retry. Spændets sidste etape er inkluderet; deltagelse har præcise dage.
- Bulk-regenerate og fallback-restore er selvstændige kodeveje og må ikke
  lukkes på baggrund af generatorens tests. Ingen prod-reparation udført.
