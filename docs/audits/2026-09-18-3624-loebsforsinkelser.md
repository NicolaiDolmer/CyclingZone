# #3624 — Løb afvikles senere end planlagt: måling til bunds (18/9)

Read-only undersøgelse. Ingen kodeændring, intet rørt i motor, flags eller scheduler.

**Datakilde:** prod (SELECT via Supabase MCP) + kodelæsning. 554 etaper med planlagt tid
i de seneste 14 dage (5/9–18/9), alle med en tilhørende tidslinje.

**Målestok:** `race_stage_schedule.scheduled_at` (den tid spilleren ser på siden) vs.
`race_stage_timelines.created_at` (det øjeblik etapens resultat findes i databasen og
dermed kan vises). Skæringsdato 14/9 = merge af PR #5204 (#5182), der fjernede
board-trinnets sekventielle DB-kald.

---

## 1. Forsinkelsen, før og efter 14/9

| Periode | Etaper | Median | p90 | Værste |
|---|---|---|---|---|
| Før 14/9 | 357 | 4,2 min | 23,0 min | 47,7 min |
| Efter 14/9 | 197 | 4,2 min | **10,3 min** | **17,4 min** |

Antal etaper over 15 min forsinket: 65 af 357 (18 %) før → 7 af 197 (3,6 %) efter.

**#5182-fixet virker.** Halen er skåret ned: p90 mere end halveret, værste tilfælde
fra tre kvarter til et kvarter. **Men medianen er uændret på 4,2 minutter** — den er
ikke en fejl, den er strukturel. Derfor er issuet ikke løst, kun halveret.

## 2. Hvor de 4,2 minutter kommer fra

Forsinkelsen har præcis to komponenter.

**(a) Opsamlings-ventetiden — ca. 2,5 min i median.**
Stage-scheduleren er et `setInterval`-tick der kigger efter forfaldne etaper hvert
5. minut (`backend/cron.js`, stage-scheduler-tikket). En etape der står helt alene i
sin time — ingen kø, intet at vente på — har median 1,8–2,4 min forsinkelse. Det er
den halve tick-periode og intet andet. **Ingen etape kan nogensinde komme hurtigere
frem end det, uanset hvor hurtig afviklingen bliver.**

**(b) Køen inde i tikket — resten.**
Tikket afvikler forfaldne etaper sekventielt, én ad gangen. Jo flere etaper der er
skemalagt til samme klokkeslæt, jo længere bagerst i køen står den sidste:

| Etaper i samme klokkeslæt | Median (efter 14/9) | Værste |
|---|---|---|
| 1 | 1,8 min | 5,1 min |
| 2 | 2,5 min | 5,0 min |
| 5 | 4,9 min | 12,2 min |
| 10 | 4,0 min | 6,0 min |
| 14 | 4,6 min | 17,4 min |

## 3. Hvor tiden går i køen nu (efter 14/9)

Målt som afstanden mellem to på hinanden følgende etapers tidslinje-skrivning inde i
samme klynge:

| Etapetype | Antal | Median | p90 | Værste |
|---|---|---|---|---|
| Mellem-etape (ikke sidste etape i løbet) | 88 | **8 s** | 11 s | 119 s |
| **Sidste etape i et løb** | 54 | **54 s** | 109 s | 427 s |

En mellem-etape koster 8 sekunder. En sidste etape koster 6–7 gange så meget, fordi
hele afslutningen (`board` + `notify`) kun kører dér. Sidste-etaper er 38 % af
etaperne i en klynge, men står for **75 % af den samlede køtid** (3.640 s mod 1.223 s).

### Afslutningen delt op, målt på skrivetidspunkter i databasen

| Trin | Endagsløb | Etapeløb |
|---|---|---|
| Resultat skrevet → første board-række | 6,9 s | 8,5 s |
| Board-trinnet (første → sidste række) | 13,8 s | 12,4 s |
| **Board færdig → resultat-notifikation ude** | **62,3 s** | **25,1 s** (p90 ca. 90 s) |

Board-trinnet er nu ca. 20 sekunder i alt — det stemmer med det #5182 lovede, og
bekræfter at board ikke længere er flaskehalsen. **Den resterende tid er notify-fasen**,
og den er nu det største enkeltbidrag til køen.

### Hvad notify laver (kodelæsning, `backend/lib/raceRunner.js` + `backend/cron.js`)

Notify-trinnet kører fire ting i serie, alle inde i den blokerende afviklingssti:

1. Genlæser **hele løbets** `race_results` fra databasen, sideopdelt.
2. Henter `race_incidents` og slår rytternavne op til dem.
3. Sender Discord-embed til hver webhook-URL for divisionen — sekventielt,
   `for (const url of urls) await sendWebhook(...)`, altså et eksternt HTTP-kald
   med retry og rate-limit pr. URL.
4. Skriver in-app-notifikationerne til de deltagende managere.

Punkt 4 er hurtigt: notifikationsrækkerne for ét løb skrives inden for 1,5 sekund.
Punkt 1–3 er resten. At **endagsløb** er langsommere i notify (62 s) end etapeløb
(25 s), selv om de har færre resultatrækker, peger væk fra databaselæsningen og
mod de eksterne Discord-kald som den dominerende post.

## 4. Fordelinger

**Time på dagen (dansk tid), median / p90 / værste:**

| Time | Før 14/9 | Efter 14/9 |
|---|---|---|
| 12 | 10,4 / 28,2 / 47,7 min | 4,3 / 12,2 / 17,4 min |
| 15 | 5,9 / 16,9 / 29,6 min | 4,9 / 8,7 / 12,2 min |
| 18 | 2,8 / 5,6 / 18,1 min | 5,1 / 10,2 / 17,3 min |
| Øvrige (11, 13, 14, 16, 17, 19) | 1,8–4,3 min median | 0,8–3,2 min median |

De to store klokkeslæt er 12 og 18. **18-tiden ser ud til at være blevet værre efter
14/9 — det er den ikke.** Antallet af *sidste* etaper i den klynge gik fra 4 til 12;
kø-omkostningen følger antallet af afslutninger, ikke datoen. Det bekræfter mekanismen
i afsnit 3 frem for at modsige den.

**Division:**

| Division | Før (median / p90 / værste) | Efter |
|---|---|---|
| Tier 1 | 2,4 / 4,3 / 8,1 min | 2,0 / 5,0 / 5,1 min |
| Tier 2 | 2,8 / 6,6 / 11,0 min | 2,5 / 5,0 / 5,2 min |
| Tier 3 | 5,8 / 17,5 / 29,6 min | 4,7 / 7,5 / 12,2 min |
| Tier 4 | 5,4 / 27,4 / 47,7 min | 5,5 / 14,7 / 17,4 min |

De lave divisioner rammes hårdest — ikke fordi de behandles anderledes, men fordi de
har flest løb og derfor står bagest i køen. Det er også dem der har flest nye managere.

**Løbstype:**

| Type | Før (median / p90 / værste) | Efter |
|---|---|---|
| Endagsløb | 5,2 / 18,0 / 29,6 min | 4,4 / 7,4 / 8,6 min |
| Etapeløb | 4,2 / 25,1 / 47,7 min | 4,2 / 10,5 / 17,4 min |
| Grand tour | 1,4 / 3,8 / 5,2 min | 1,8 / 5,0 / 5,0 min |

Grand tours ser hurtige ud, fordi næsten alle deres etaper er mellem-etaper (8 s-typen).
Prisen betales på deres sidste etape, som falder i samme klynge som alt det andet.

---

## 5. Anbefaling — én permanent løsning

**Flyt notify-fasen ud af den blokerende afviklingssti.**

I dag venter hele køen på at Discord-beskeden er sendt, før den næste etape
overhovedet begynder. Det er den eneste del af afslutningen der hverken skriver
spildata eller er nødvendig for at resultatet kan vises på siden — den fortæller bare
omverdenen at løbet er kørt. Den skal derfor ikke stå forrest i køen.

Konkret: notify-trinnet skrives til en lille udgående kø (en tabel med "denne besked
mangler at blive sendt") og afsendes af sit eget tick. Trin-markeringen i
`races.finalize_state` findes allerede (#4147), så trinnet kan markeres udført uden
at afsendelsen er sket endnu — den flytter blot fra det blokerende tick til
udsenderens.

**Forventet effekt** (regnet på de målte tal, en 14-etape-klynge med 12 afslutninger):

| | I dag | Efter |
|---|---|---|
| Kø pr. sidste etape | ca. 54 s | ca. 20 s |
| Værste etape i klyngen | ca. 17 min | **ca. 7–8 min** |
| p90 over alle etaper | 10,3 min | **ca. 5–6 min** |
| Median | 4,2 min | ca. 3,5 min |

Medianen flytter sig kun lidt, fordi den domineres af den 5-minutters opsamling
(afsnit 2a). **Halen — det spillerne faktisk klager over — halveres.**

**Hvad det koster:** én ny tabel til udgående beskeder, ét nyt afsender-tick, og at
Discord-beskeden kan komme op til et minut efter at resultatet står på siden. Det er
den rigtige rækkefølge: siden skal være først.

**Hvad det rører:** `backend/lib/raceRunner.js` (notify-trinnet), `backend/cron.js`
(nyt afsender-tick), én migration. Motoren, simuleringen og selve resultatskrivningen
røres ikke.

**Bag flag: ja.** Samme mønster som `race_finalize_resumable_enabled`: flag OFF →
notify sendes synkront som i dag, bit-identisk adfærd. Så kan det slås til og måles på
en 14-etape-klynge, og slås fra igen uden deploy hvis en besked udebliver.

**Bevidst fravalgt:** at sætte tick-kadencen ned fra 5 til 1 minut. Det ville flytte
medianen fra 4,2 til ca. 2,7 min, men gør intet ved halen, og det femdobler antallet
af opslag mod databasen døgnet rundt for at vinde halvandet minut på medianen. Tag
den først når notify er ude af køen — så er den billig og let at måle.

---

## Dom

**Bekræftet.** Forsinkelsen er reel og målt: median 4,2 min, p90 10,3 min, værste
17,4 min efter 14/9. #5182 fjernede board-flaskehalsen som lovet, men flyttede kun
problemet: notify-fasen er nu det største bidrag til køen, og den 5-minutters
opsamling er et gulv ingen optimering kan komme under.

Refs #3624, #5182, #5204, #2090, #4147
