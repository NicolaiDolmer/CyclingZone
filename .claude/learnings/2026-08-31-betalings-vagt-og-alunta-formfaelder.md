# 2026-08-31 — Kunde betalte ikke i 23 dage med fuld adgang + fire fejlslutninger på vejen

## Hvad skete

Under opsætning af Alunta- og Dinero-MCP'er blev det opdaget at den eneste betalende kunde
havde en ubetalt faktura (61,25 kr.) i **23 dage** og beholdt fuld Pro-adgang hele perioden.
Ingen fik besked. Fundet ved en tilfældig gennemgang, ikke af et system.

Rod-årsagen bag den manglende opkrævning er **stadig åben** (afventer Alunta support): kortet
er gyldigt (`has_valid_payment_card: true`), faktureringsmetoden står på Automatisk, planen er
kort-only — og der findes præcis **én** betaling i kontoens historik: checkout-betalingen 25/7.
Automatisk korttræk har aldrig kørt. Indstillingen der blokerer det findes hverken i MCP-fladen
eller i REST-API'et (hele OpenAPI-specen gennemgået).

Overvågnings-hullet er lukket: `backend/lib/aluntaOverdueWatch.js` (#4514, PR #4516).

## Hvorfor ingen opdagede det — tre huller der dækkede for hinanden

1. **Alle Aluntas betalings-notifikationer stod med `enabled_channels: []`** — `payment_failed`,
   `invoice_generated`, `invoice_paid`, `automatic_invoicing_reminder`, `webhook_delivery_failed`.
2. **Selv tændt havde de ikke fanget sagen.** `payment_failed` udløses når et KORT AFVISES. Her
   blev der aldrig forsøgt et træk, så der var ingen fejl at melde — og Alunta har **ingen
   "faktura forfalden"-notifikation** i sit katalog. En faktura hvor der ikke forsøges betaling
   producerer **ingen event overhovedet**. Hverken fejl eller succes. Stilhed.
3. **Vi havde ingen vagt selv.** `past_due` tæller bevidst stadig som Pro indtil
   `current_period_end` (respitperiode, fornuftigt). Men intet eskalerede.

> **Generaliseringen:** et event-drevet system kan kun opdage det der *sker*. En tilstand der
> opstår ved at **intet sker** er usynlig for det. Til den slags skal man spørge, ikke lytte.

## Fire fejlslutninger jeg lavede undervejs — alle samme klasse

Jeg konkluderede fire gange ud fra én kilde uden at spørge den kilde der kunne vise sandheden.
Tre af dem kostede ejeren tid; én kostede ham en plan.

| # | Konklusion | Hvorfor forkert | Konsekvens |
|---|---|---|---|
| 1 | "Fakturaerne er ikke bogført i Dinero" | Læste `document_number.status: provisional` + `driver: null` i Alunta som "ikke bogført". Alunta ejer selv nummeret; Dinero havde begge fakturaer korrekt. | Ejeren fik en falsk fejlmelding + en unødig opgave |
| 2 | "Pro-planen er en dublet — arkivér den" | Så to planer med samme reelle pris uden at læse #4005, hvor prisen 49 kr. inkl. allerede var halvt besluttet. Planen var bygget til netop den beslutning. | **Ejeren slettede den rigtige plan** |
| 3 | "Kunden har intet gemt kort" | Sluttede fra Aluntas dokumenterede adfærd i stedet for at måle. `/customers/{uuid}` har `has_valid_payment_card`. | Skylden lagt det forkerte sted |
| 4 | "Abonnementet er ikke flyttet" | Læste uændret MRR i MCP-fladen som en mislykket flytning. Planskift sker ved næste fornyelse og ligger i REST'ens `scheduled_plan_change` — et felt MCP'en slet ikke har. | Ejeren bebrejdet for noget han havde gjort rigtigt |

**Mønsteret:** fravær af bevis blev læst som bevis for fravær, i en kilde der ikke kunne vise
fænomenet. Fejl 1 og 4 var samme fejl i to retninger. Ejeren fangede nr. 3 og 4 selv.

## Formfælder i Alunta-integrationen (verificeret mod live-API 31/8)

- **Priser gemmes i øre EKSKL. moms**, momsen lægges oveni når `charge_vat: true`.
  `4900` → kunden betaler **61,25**, ikke 49. Vil du ramme 49 inkl., skal du taste **3920**.
  Denne fælde kostede en fejlpris på den første betalende kunde.
- **MCP og REST bruger forskellige feltnavne for samme data:**
  `prices[]/interval_months/amount_minor` mod `renewal_intervals[]/interval/price`.
- **Envelope-formen er ikke ensartet:** `GET /me` svarer **fladt**; `/plans`,
  `/checkout-sessions` og `/portal-link` har `data`-envelope.
- **MCP'en viser ikke alt:** `scheduled_plan_change` og `scheduled_price_changes` findes kun
  i REST.
- **`GET /invoices` har intet status-filter** — forfaldne fakturaer må findes klient-side på
  `outstanding` + `due_date`.
- **Supabase-timestamps parser ikke med `new Date()`:** formen
  `2026-08-31 21:59:59.999999+00` (mellemrum, mikrosekunder, offset uden minutter) giver
  Invalid Date. Fanget af regressionstesten, hvor den ægte prod-række ellers ville være
  klassificeret som ulæselig i stedet for udløbende — altså fejlet på præcis den række vagten
  er bygget til at overvåge.

Alt sammen dokumenteret i [`docs/BILLING_STACK.md`](../../docs/BILLING_STACK.md) (#4510, PR #4513).

## Læredomme / guards

- **Vælg en kilde der KAN vise fænomenet, før du læser noget ud af dens tavshed.** MCP'en er
  en delmængde af REST, som er en delmængde af UI'et. Konkludér aldrig "det skete ikke" fra
  den snævreste flade.
- **Mål svaret før du læser felter af det.** Fjerde gang samme klasse fejl ramte Alunta-koden
  (se `2026-07-20-alunta-contract-assumptions-and-icu-syntax.md` og
  `2026-08-03-alunta-invoice-paid-missing-current-period-end.md`). Jeg gentog den selv i
  drift-tjekket 15 minutter efter at have skrevet den ned som faldgrube.
- **Læs issuet før du foreslår at slette noget.** #4005 indeholdt prisbeslutningen. Et enkelt
  opslag ville have forhindret at ejeren slettede den rigtige plan.
- **Regressionstests med RÅ prod-data, ikke opfundne.** De opfundne testdata passerede;
  de ægte afslørede timestamp-fejlen. En test der bruger pæne værdier tester din fantasi.
- **En vagt skal kunne gå rød, og den skal ikke kunne skrive.** Negativ prøve inkluderet
  (jf. #4463); en proxy-test håndhæver at vagten kun læser.
- **Vagter gates ikke bag et default-off-flag.** `alunta_reconcile_enabled` gav mening — den
  skriver. En observerende vagt der er slukket som default er præcis den fejl den findes for
  at fange.

## Åbent efter denne session

- **#4514** rod-årsag: hvorfor trækkes kortet aldrig? Supporthenvendelse udkast klar.
- **#4511** moms på EU-privatkunder — konto 1050 er forkert under 10.000 EUR-tærsklen.
- **#4512** udløb uden fornyelsessti; dunning-politik er en ejer-beslutning.
- **#2813** go-live: verifikation 1+2 lukket 31/8, restpunkt er den eksisterende kunde uden
  accept-log.
- **`invoice_due_days: 0`** — fakturaer forfalder på selve fakturadatoen. Nul betalingsvindue.
