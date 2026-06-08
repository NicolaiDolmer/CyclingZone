**Brief til #1101: Eget dynamisk værdisystem (base_value, ikke uci_points)**

**Mål:** Implementer cutover til det nye dynamiske værdisystem, der bruger `base_value` i stedet for `uci_points` til at drive `market_value`/`salary`. Sørg for, at `uci_points` afkobles fra player-facing visning.

**Runtime-evidens:**
*   `backend/lib/riderValuation.js`: Indeholder den nye `ln(base_value) = a + b·output + offset[type]` model, som er blevet kalibreret med ejer-anchors. Denne model skal nu være primær [14].
*   `riderValuationAnchors.json`: Indeholder de 22 ejer-anchors, der blev brugt til kalibrering af `base_value` [14].
*   `fitRiderValuationModel.js`: Scriptet, der fitter modellen fra anchors [14].
*   `backend/scripts/backfillRiderBaseValue.js`: Scriptet til at backfille `riders.base_value` for hele populationen [14].
*   `database/schema.sql` (L57-64): De tre GENERATED STORED kolonner (`price`, `market_value`, `salary`) på `riders` skal omskrives til at bygge på `base_value` i stedet for `uci_points`.
*   `backend/lib/marketUtils.js` og `backend/lib/economyConstants.js`: Indeholder duplikerede formler for `market_value`/`salary` baseret på `uci_points`, som skal afkobles og opdateres til at bruge `base_value`.

**Invarianters der beskyttes:**
*   Marked/auktion/løn bruger `base_value`, ikke `uci_points`.
*   Ingen ryttere med `base_value = 0` efter backfill.
*   Fordeling af `base_value` ligner det godkendte prisspænd (stjerner vs. domestiques).
*   `uci_points` vises ikke længere player-facing.

**Minimal change:**
*   Ejer-verificer shadow-værdierne før nogen cutover.
*   Omskriv de GENERATED STORED kolonner i `schema.sql` til at bruge `base_value`.
*   Opdater de runtime-paths der stadig beregner market/salary fra `uci_points`.
*   Sørg for, at `uci_points` ikke længere vises player-facing.
*   Hold dynamisk glidning mod handelspris ude af denne cutover. Det er en separat produkt- og økonomibeslutning med egen kalibrering og rollback.

**Verification path:**
*   Ejer-verify af shadow-værdier i admin-preview er en BLOKKER og skal være kvitteret før cutover.
*   Testsuite grøn (økonomi/marked-paths).
*   Verificer, at marked/auktion/løn korrekt bruger `base_value`.
*   Kontroller, at `uci_points` ikke er synlige for spillere.
*   Kør et cutover-audit der fejler ved `base_value IS NULL/0` eller divergerende runtime-formler.
