# Auto-pris og bud-lås: grundlag for beta til live (#2176)

Dato: 14/11 2026. Undersøgelsesspor, intet bygget og intet tændt. Kun læsning af prod (Supabase SELECT, Postgres-logs, Sentry, Railway-logs). Ingen navne, kun antal. `app_config` er bevidst ikke læst.

## 0. Udgangspunkt: kun én af de to kontakter står på beta

Briefen siger, at begge kontakter står på beta. Det passer ikke længere:

- `market_commitment_6181` (bud-låsen) er **on for alle siden 12/11** ifølge `docs/FEATURE_REGISTRY.yml` (state `live`, "on for alle 12/11 (læst i prod 12/11)") og patch note 7.435 ("Bid money is now locked for every team", rollout `beta_to_live`). Jeg har ikke selv læst kontakten (app_config er uden for mit mandat), så hovedsessionen bør bekræfte med én læsning før tænding.
- `auto_accept_enabled` (auto-pris) står på **beta** (registry `state: beta`, `decision: taend`, `decide_by: 2026-11-28`; roadmap-punktet er `in_progress` med `beta_since` 11/11 kl. 20:56 dansk tid).

Resten af rapporten handler derfor om at tage **auto-pris** fra beta til alle.

## 1. Bevis fra beta (prod, kun antal)

Målevindue: fra tænding 11/11 kl. 20:53 dansk tid til 14/11 ca. kl. 18.

| Måling | Antal |
|---|---|
| Menneskehold med beta-adgang (beta-tester eller admin) | 17 af 315 aktive menneskehold |
| Transferopslag der har fået en auto-pris | 11 (alle sat af sælger, alle beta-sælgere, 4 forskellige hold) |
| Heraf auto-pris lig listeprisen | 5 |
| Opslag med auto-pris nu | 10 åbne, 1 lukket (det solgte) |
| Seneste ændring af en auto-pris | 12/11 kl. 11:09 |
| Forhandlingsbud (transfer offers) på opslag med auto-pris | 0 |
| Auto-auktioner startet | 1 (11/11 kl. 21:20, beta-køber hos beta-sælger) |
| Auto-auktioner afsluttet | 1 (kl. 21:52, køberen valgte 31 min) |
| Bud på auto-auktionen | 1 (åbningsbuddet), 1 byder, 0 forlængelser, solgt til startprisen |
| Rytteren hos køber efter salget | ja |
| Pengeposteringer ved afslutningen | 2 (købers og sælgers ben) |
| Kildeopslaget efter salget | lukket (`withdrawn`), som #4211 foreskriver |
| Almindelige auktionsbud i vinduet (bud-låsen) | 93 bud fra 21 hold, heraf 31 fra 7 beta-hold |
| Nye auktioner i vinduet | 45 (41 afsluttet, 4 aktive) |

**Fejl:**

- Sentry: 0 uløste issues med auto-accept, `market_commitment`, `place_auction_bid_6181` eller budfejl de seneste 7 dage. Eneste uløste issue med aktivitet de seneste 4 dage er stall-watchdog (uden relation).
- Postgres-logs 11/11 19:50 UTC til 14/11 17:00 UTC (tre 24-timers-vinduer, i alt ca. 6.100 linjer): 0 fejllinjer, der nævner auction, auto_accept, 6181 eller transfer.
- Railway: logs dækker kun det nuværende deploy (fra 14/11). 0 fejl-linjer om marked/bud; ingen 5xx på markedsruter. Fejl fra før 14/11 i Railway er **ikke målt**.

**Konklusion på beviset:** Pengevejen virker fejlfrit, men brugen er tynd. Én auto-auktion, uden konkurrence, uden forlængelse og uden en ikke-beta-deltager. Siden 12/11 formiddag er auto-prisen ikke brugt.

## 2. Til dørs-status mod de otte krav

`node scripts/til-doers-check.mjs --issue 2176` (dry-run): 1, 2, 6, 7 ok; mangler 3, 4, 5, 8.

| # | Krav | Status for "for alle" |
|---|---|---|
| 1-2 | Bygget, merget | ok (#7978, #7985 m.fl.) |
| 3 | Tændt | mangler: beta, ikke on |
| 4 | Synligt | mangler: kun 17 hold kan se det |
| 5 | Gammelt væk | mangler: Hjælp og sælgerhint har beta-sætninger, se nedenfor |
| 6 | Hjælp | findes på alle fem sprog (`help.json` → `autoAcceptPrice`), men **passer ikke til "for alle"** |
| 7 | Patch note | beta-noten 7.433 findes; "beta til live"-note mangler (udkast nedenfor) |
| 8 | Verificeret i prod | delvist: første auto-auktion gik igennem; ingen ikke-beta-deltager set |

**Hjælp (alle fem sprog):** teksten findes i `frontend/public/locales/{en,da,es,fr,nl}/help.json` og vises kun med kontakten (`HelpPage.jsx:142`, `flag: "auto_accept_enabled"`). Hver version har en beta-sætning, der bliver forkert ved tænding:

- EN: "During the beta, the auto-accept price is only shown on the transfer list when both you and the seller have beta access. Otherwise, you negotiate as usual."
- DA: "Under betaen vises auto-prisen kun på transferlisten, når både du og sælgeren har beta-adgang. Ellers forhandler du som normalt."
- ES/FR/NL: samme sætning.

Samme forhold i sælgerhintet `rider.json` → `sellRider.autoHelp` på alle fem sprog ("During the beta, the price is only shown to buyers with beta access, and you also need beta access."). Begge skal fjernes i samme PR som tændingen. Resten af teksten passer til alle.

**Patch note-udkast (beta til live), rollout `beta_to_live`, refs 2176:**

- EN, titel: "Auto-accept price is now for everyone"
- EN, tekst: "When you list a rider, you can now set an auto-accept price. A bid at that price or above starts a public auction: the buyer picks the length, and other managers can bid. It has run in beta since 11 November."
- DA, titel: "Auto-pris er nu for alle"
- DA, tekst: "Når I sætter en rytter til salg, kan I nu sætte en auto-pris. Et bud på den pris eller derover starter en offentlig auktion: køberen vælger længden, og andre managere kan byde med. Den har kørt i beta siden 11. november."

**Funktionsregistret:** `market-auto-accept` står `state: beta`, `decision: taend`, `decide_by: 2026-11-28`. Ved tænding: `state: live`, ny `verified`, note med tidspunkt, kør `node scripts/generate-feature-status.mjs`. Kontakten står ikke i `scripts/feature-registry-flag-expiry-baseline.json`.

**Roadmap:** det levende punkt (flag-koblet, `in_progress`, `this_week`) følger kontakten. Der findes også en arkiveret dublet uden flag (kendt fejl #8065). Efter tænding: `node scripts/roadmap-flip.mjs --issue 2176` (først dry-run, `--apply` når den er live for alle) og et roadbook-opslag på engelsk til ejeren.

**`docs/TRANSFER_MARKET_RULES.md`:** §5.1 beskriver kontakten som "beta fra 11/11" og beta-kontrakten (ejer 10/11). §8.1 beskriver bud-låsen. Linje 458: "`on` beholder den globale M3-kontrakt". Det er netop den regel, der giver overgangsfundet i afsnit 3. §5.1-overskriften og beta-kontrakt-afsnittet skal opdateres ved tænding.

## 3. Hvad sker der for spillere uden beta ved tænding

- **Åbne opslag:** 209 åbne opslag. De 10 med auto-pris bliver synlige for alle købere med det samme. 91 åbne opslag fra managere uden beta får muligheden for at sætte en auto-pris; intet ændrer sig, før sælgeren selv gør det.
- **Åbne forhandlinger:** reglen "en åben forhandling på eller over auto-prisen kan ikke længere accepteres" rammer i dag 0 forhandlinger (der er 0 bud på opslag med auto-pris). Tallet skal tages igen lige før tænding.
- **Igangværende auktioner:** 4 aktive, ingen er auto-auktioner (1 har bud, 1 autobud). De berøres ikke af selve auto-prisen.
- **Bud der allerede er afgivet:** står under bud-låsen, som er on for alle. Uændret.

**Overgang der kan gå galt (fundet i koden, bekræftet mod prod-definitionen):**
`market_beta_mode_2176()` er sand, når bud-låsen er `on` **og** auto-pris er `beta`. Den kontrollerer i dag (med bud-låsen on) for **alle hold**:

1. pengevagten på diskretionære udgifter (`market_discretionary_finance_guard_2176`: anlæg, scouting-rejse, staff-fratrædelse, akademikøb, transferkøb, kontantbytte, frikøbsgebyr),
2. atomisk frigivelse med gebyr (`auto_accept_release_paid_2176`),
3. atomisk kontantbytte (`auto_accept_claim_swap_paid`),
4. atomisk scouting-oprettelse (`market_scout_assignment_2176`),
5. ejerskabstjek under lås ved auktionsoprettelse (`create_market_auction_2176`).

Når auto-pris sættes til `on`, bliver `market_beta_mode_2176()` falsk. Så svarer 2-5 `legacy`, og 1 slår fra. Alle hold falder tilbage til de gamle JS-tjek før låsen (TRANSFER_MARKET_RULES §8.1: "Andre udgifter ... tjekker stadig i JS før låsen; finalize-gaten står som sidste værn"). Testen `SQL on/off retain global legacy values` i `backend/lib/marketBeta2176.pglite.test.js` viser, at det er designet sådan, og `marketBeta2176Payments.pglite.test.js` tester kun "auto-pris beta + bud-lås on". Kombinationen "begge on" med atomiske betalinger er ikke testet.

Konsekvens: at tænde auto-pris for alle **fjerner** en pengebeskyttelse, som alle hold har i dag. Det giver ingen fejl eller nedbrud. Et hold kan bare igen bruge penge, der er bundet i førende bud, på gebyrer og køb, indtil afregningen fanger det. Det er ikke en ejer-godkendt beslutning, jeg kan finde (beta-kontrakten 10/11 handler om beta-afgrænsning, ikke om at fjerne vagten ved on).

## 4. Åbne fund og issues der spærrer

| Fund | Spærrer? | Hvorfor |
|---|---|---|
| Overgangen i afsnit 3 (pengevagt og atomiske betalinger slår fra ved on) | **Ja** | Penge. Kræver rettelse eller et udtrykkeligt ejer-ja til nedgraderingen |
| Beta-sætninger i Hjælp + sælgerhint, 5 sprog | **Ja** | Bliver forkert info for alle i samme øjeblik |
| #8016 (priority:high): køberens kort er uklart (bud eller auktion?), og auto-prisen ses ikke på rytter-siden (Discord-melding 11/11) | **Ja, anbefalet** | Ejeren har selv set det i beta. Ingen PR. Rammer 300 managere i stedet for 17 |
| Krav 8: kun 1 auto-auktion, uden konkurrence og uden ikke-beta-deltager | Delvist | Pengevejen er set virke én gang. Første ikke-beta-auktion bliver selve krav 8 efter tænding |
| #8018: SQL-kildefiler genindfører akademi-spærren ved genskabelse; forældede kommentarer; dødt kald | Nej | Ingen fejl i prod i dag, men en senere migration kan slå reglen fra |
| #8083: "Auto-accept fra beta til alle: dommer og tænd-kort" | Nej (overlapper denne rapport) | Kræver uafhængig dommer, fordi det er penge |
| `sale_escrow_enabled` (#6181) | Nej | Egen binær kontakt, aldrig tændt, uden for dette spor |

## 5. Tænd-kort til ejeren

**Hvad tændes:** kun `auto_accept_enabled`, fra beta til on. Bud-låsen er allerede on for alle (bekræft det med én læsning før tænding).

**Hvad er målt:** 11 opslag med auto-pris, 1 auto-auktion startet og solgt rigtigt (rytter flyttet, begge pengeben bogført), 0 fejl i Sentry og Postgres-logs i hele beta-perioden, 93 almindelige bud under bud-låsen uden fejl.

**Hvad er ikke målt:** en auto-auktion med flere bydere, forlængelse eller en deltager uden beta; Railway-fejl før 14/11; kombinationen "begge kontakter on" (hverken i prod eller i test med atomiske betalinger).

**Rækkefølge:**

1. Ret overgangen: en ny migration, der skiller "atomiske betalinger" fra "beta-afgrænsning", så pengevagten og de fire atomiske veje også gælder, når begge kontakter er on. PGlite-test for "begge on". Uafhængig dommer før merge (penge). Ændrer intet i dag, fordi beta-tilstanden allerede er sand, så den kan merges før tænding.
2. #8016 køberens kort: mockup A/B, dit valg, byg, før/efter-billede, dit "merge".
3. Tekst-PR samme dag som tænding: fjern beta-sætningerne (Hjælp + sælgerhint, 5 sprog), patch note "beta til live", registry til live, TRANSFER_MARKET_RULES §5.1.
4. Tag tallet over åbne forhandlinger på opslag med auto-pris igen (skal være 0 eller set af dig).
5. Dit "kør": `auto_accept_enabled` beta til on. Verificér som konto uden beta: `/api/feature-flags` giver true, Hjælp > Transfers viser afsnittet, auto-prisen ses på et opslag.
6. Krav 8: første auto-auktion med en ikke-beta-deltager set gå igennem. Derefter roadmap-flip og roadbook-opslag.

**Sådan slukkes det igen:** `auto_accept_enabled` tilbage til `beta` (præcis dagens tilstand, beta-vagterne vender tilbage) eller `off`. Auktioner, der allerede er startet, kører færdigt og forbliver offentlige; slukning annullerer intet. Bud-låsen skal blive på on, ellers svarer starten 404.

**Anbefaling: ikke klar endnu.** Pengevejen har virket fejlfrit, men tænding i dag vil (a) fjerne en pengebeskyttelse, som alle hold har nu, (b) vise forkert beta-tekst på fem sprog, og (c) give alle det købskort, du selv fandt uklart. Mangler: trin 1-3 ovenfor. Med dem på plads er der intet i beviset, der taler imod tænding.
