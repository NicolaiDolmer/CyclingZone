# 2026-09-02: Halvårsprisen blev sat 30 kr for højt af en fejlregning, første 6-mdr-kunde betalte for meget

## Hvad skete

- 20/8 låste ejeren prisen: 49 kr/md og 265 kr/6 mdr, alt inkl. moms. `/pro` viste 265.
- 31/8 skrev Claude i #4005 og `BILLING_STACK.md` at halvåret skulle reprises til 23600 øre ekskl. = 295 kr inkl., "ca. 17% rabat mod 6 x 49". Regnestykket var forkert: 6 x 49 = 294, så 295 var **dyrere** end at betale månedligt. Rabatten på 17% var målt mod den gamle 61,25-pris.
- Planen blev reprised til 23600 i Alunta uden at siden blev rettet. Checkout åbnede 2/9 med 6 mdr som forudvalgt plan.
- Første 6-mdr-kunde så 265 på `/pro` og 295 på Aluntas betalingsside, og betalte 295 (faktura 4).
- Ejeren opdagede det, skrev til kunden inden for minutter, og krediterede præcis 30 kr (faktura 5). Netto 265 = korrekt.

## Rod-årsag

To tal for samme pris uden én kilde: `pro.json` (265) og Alunta-planen (295). Drift-tjekket i `alunta-setup-plans.js` sammenlignede Alunta mod scriptets konstant, ikke mod det spilleren ser. En regnefejl i en issue-kommentar blev til en prod-pris uden at nogen regnede efter.

## Rettelse

- Alunta-planen reprises til 21200 øre = 265,00 kr via `PUT /plans/{uuid}/renewal-intervals/{intervalUuid}` (API'et tillader det med aktive abonnenter; kun UI'et nægter). Eksisterende abonnenter beholder deres pris, så kundens abonnement får en planlagt prisændring til 21200 fra 2027-03-02 (`PUT /subscriptions/{uuid}/price`).
- PR #4608 har allerede 21200/265 i script, SSOT og vilkår.

## Læring

1. **Rabatpåstande regnes efter mod den aktuelle pris**, ikke mod en pris der er på vej ud. Skriv regnestykket (6 x 49 = 294) i samme sætning som påstanden.
2. **Prisen der vises og prisen der trækkes skal kunne tjekkes mod hinanden.** `alunta-setup-plans.js` bør også læse `pro.json` og fejle ved afvigelse (forward-guard, ikke bygget endnu).
3. **Alunta-API'et kan reprise en plan med aktive abonnenter.** Arbejdshypotesen i `BILLING_STACK.md` ("kun uden abonnenter") gjaldt kun dashboardet.
4. **Netto-kontrol ved kreditering:** `remaining_creditable_amount` på fakturalinjen viser hvad kunden reelt har betalt. Brug den før du konkluderer "fuld refusion".
