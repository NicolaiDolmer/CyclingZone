# 11/10: afbrudt auktionsafslutning gav købsummen tilbage + bølgen startet forkert tre gange

## 1. Auktionsfejlen (#6474, rettet i PR #6481)

**Symptom:** spiller (feedback 28/9) så både "Købte X" og "Solgte X" i økonomihistorikken for en rytter, han kun havde købt; "kassen er korrekt". Lå som known issue ("Money from a sale can look like it came back") og blev behandlet som en visningsfejl.

**Rodårsag:** `finalizeAuctionRecord` flytter rytteren FØR pengene. Blev kørslen afbrudt imellem (5 af 6 tilfælde i samme minut 28/9 kl. 14:18 dansk tid: genstart/timeout, ikke verificeret), så retry'en rytteren hos vinderen. På en fri-agent-auktion er initiativtageren også `seller_team_id`, så `sellerOwnsAuctionRider` blev sand, og vinderen fik købesummen udbetalt som "sælger". 6 auktioner, 4 managerhold, 1.092.657 CZ$ for meget (juni, 28/9, 30/9).

**Tre søsterhuller i samme retry-sti** (fundet af review, lukket samme dag): almindeligt salg blev annulleret som "stale owner" (køber beholdt rytteren gratis); saldo-tjekket og trup-tjekket blev gentaget og lukkede auktionen uden betaling, mens rytteren blev hos køberen; manglende ejerskabshændelse (best-effort-skrivning) gav ingen sælger.

**Læring:**
- En "visningsfejl" i penge skal altid afstemmes mod posterne (balance − sum(finance_transactions)) før den lukkes som visning. Spillerens "kassen er korrekt" var forkert.
- Ikke-atomiske flerstegs-afslutninger (flyt, så betal) skal have en eksplicit retry-gren: "er trin 1 allerede sket?" Tjek der kun gælder FØR trin 1 (saldo, trup) må ikke gentages efter.
- Modprøv nye tests (de fejlede uden rettelsen, 3/3).

## 2. Bølgen startet forkert tre gange

**Hvad skete:** (a) `Workflow({ scriptPath })` i stedet for `name: "wave"`: hooken reserverer kun ved navn, så fase 0 fandt ingen `wave-active.json`. (b) To spor ejede samme mappe (`database/migrations/`, som tilmed ikke findes; migrationer ligger i `database/`). (c) Ownership mod et andet spors `touches` (`frontend/src/lib/`) og samme fil ejet/touched af to spor.

**Læring (står også i memory):** start ALTID ved navn fra repo-root. Før start: tjek at ingen to spor ejer samme sti, at ingen ownership overlapper andres touches, og at ejede stier findes (migrationer = `database/<dato>-<navn>.sql`). Dry-run fanger IKKE adgangstjekket; kun hooken gør. Bølgen afviser også at køre en branch to gange: opfølgende rettelser på færdige spor laves direkte i worktreet.

## 3. Squash-merge af en stablet PR

Tænd-PR #6484 var stablet oven på #6465. Efter squash-merge af #6465 kunne #6484 ikke merges ("merge commit cannot be cleanly created"). Løsning: `checkout -B <branch> origin/main` + cherry-pick af tænd-commitet + force-with-lease. Næste gang: lav stablede PR'er som én PR eller rebase straks efter den første merge.
