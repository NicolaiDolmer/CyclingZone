# Design: en direkte linje til databasen og "hent én gang, regn, gem én gang" (#8143)

Arkitekt-udkast 13/11, valgt af ejeren 13/11 (kort i sessionen): **"A: direkte linje, mål først (Recommended)"**. Trin 1 (måleprøven) er bygget i PR'en, der lægger denne fil ind; afsnittet "Trin 1 som bygget" sidst beskriver valgene i koden.

Tal er mærket **målt** (prod 13/11, kun læsning) eller **regnet** (dagens målte tal ganget op). Ingen navne på spillere, managere eller hold, ingen forbindelsesadresser eller hemmeligheder. De fulde arbejdsfiler (med SQL'en bag målingerne) ligger privat i OneDrive-konteksten, `private-handoffs/2026-11-13-fundament-8143/`.

## Kort

- I dag sender serveren hvert spørgsmål som et web-kald gennem et mellemled. Det koster ca. 75 ms pr. spørgsmål (**målt**), mens databasen selv bruger ca. 0,1 ms (**målt**).
- Forslaget: serveren får **én direkte linje til databasen ved siden af** den nuværende vej. Den bruges kun af de få tunge veje, og de bygges efter ét mønster: **hent alt, hvad vejen skal bruge, i ét hug; regn i serveren; gem alt i ét hug, alt eller intet.**
- De ca. 2.300 steder i serveren, der i dag spørger gennem web-adgangen, bliver, hvor de er. Det er ikke en omskrivning.
- **Nye faste udgifter: 0 kr.** Den direkte linje er med i det abonnement, der allerede betales.
- Det vigtigste ukendte tal er, hvad ét spørgsmål koster på den direkte linje fra serveren. **Regnet:** ca. 10 ms. Derfor er første trin en måleprøve, ikke en flytning.

## Måling: hvor går ventetiden pr. spørgsmål hen?

1. **Serveren ligger i Amsterdam, databasen i Frankfurt.** Det er naboer, og Amsterdam er den nærmeste plads, serverens udbyder har. Afstanden er ikke forklaringen, og en flytning kan ikke hente noget. **Målt** (udbyderens egen status for projektet).
2. **Et helt lille spørgsmål koster ca. 75 ms fra serveren** (typisk 60 til 85). **Målt.**
3. **Databasen bruger selv ca. 0,1 ms på sådan et spørgsmål.** **Målt** i databasens egen statistik.
4. **Resten, ca. 60 til 65 ms pr. spørgsmål, går i mellemleddet** (sikkerhedsporten foran databasen, oversætteren fra web-kald til databasesprog og serverens web-bibliotek). **Regnet** som det, der er tilbage.
5. Det er altså ikke tunge spørgsmål, der koster. Alle spørgsmål betaler den samme faste afgift. Derfor hjælper det at stille færre, og endnu mere at gøre hvert spørgsmål billigere.

### Ét lille spørgsmål fra den rigtige server

Serveren har to åbne kontrol-adresser. Den ene svarer uden at spørge databasen; den anden stiller præcis ét lille spørgsmål (findes der en række i indstillings-tabellen). Forskellen er prisen for ét lille spørgsmål gennem den rigtige vej.

| Måling 13/11 kl. 15:48 | Antal | Midterværdi | Laveste til højeste |
|---|---|---|---|
| Svar uden spørgsmål til databasen | 24 | 66,5 ms | 59 til 92 ms |
| Svar med ét lille spørgsmål til databasen | 25 | 143 ms | 110 til 181 ms |
| **Forskel: prisen for ét lille spørgsmål** | | **ca. 76 ms** | ca. 50 til 115 ms |

Målt udefra, skiftevis de to adresser på samme åbne forbindelse, 25 runder. Målerens egen rejsetid er ens i begge rækker og går ud i forskellen.

### Databasens egen tid (statistik over 119,5 timer, læst 13/11)

| Hvem spørger | Spørgsmål i vinduet | Databasens tid i snit |
|---|---|---|
| Serveren (ca. 3,81 mio. web-kald, hvert pakket ind i en lille indstillings-sætning) | 8,07 mio. sætninger | 1,85 ms |
| Spillernes browsere direkte | 1,17 mio. sætninger | 3,26 ms |
| Databasens "send ændringer live til browseren"-tjeneste | 1,00 mio. | 7,16 ms |

De hyppigste spørgsmål fra serveren er bittesmå: læs én indstilling (ca. 505.000 gange, 0,05 ms), find holdet for en bruger (ca. 267.000, 0,09 ms), læs brugerens rolle, find den aktive sæson, holdets stab og faciliteter (alle 0,04 til 0,05 ms).

De tungeste, hvor databasen faktisk arbejder: "live-ændringer"-tjenestens egen aflæsning (8,6 ms i snit), træningens gemme-funktion (160 ms pr. dag-felt for ét hold, højst 703 ms), browserens læsning af træningshistorik med de store rapporter (239 ms), tre næsten ens opslag i løbsresultater (63 ms), genopfriskning af ranglisten (2,2 til 3,8 s pr. trin).

**Regnet af tallene:** serveren stiller ca. 765.000 spørgsmål i døgnet. Med ca. 75 ms hver er det ca. 16 timers samlet ventetid i døgnet. Databasen bruger ca. 6 procent af én regnekerne i snit; den er langt fra presset. **Gemme-funktionen i træningen koster 160 ms ren databasetid pr. dag-felt**; fem dag-felter er ca. 0,8 s, som ingen genvej i transporten kan fjerne.

### Hvor går de ca. 75 ms hen?

| Del | Tid | Hvor sikkert |
|---|---|---|
| Databasens eget arbejde (lille spørgsmål) | ca. 0,1 ms | **Målt** |
| Rejsen Amsterdam til Frankfurt og tilbage | ca. 7 til 10 ms | Kendt normalværdi, **ikke målt** |
| Mellemleddet (port, oversætter med fire skridt pr. spørgsmål, web-bibliotek) | ca. 60 til 65 ms | **Regnet** (resten) |
| **I alt** | **ca. 75 ms** | **Målt** |

### Sådan er serverens forbindelse sat op i dag (læst i koden)

- Mange små web-klienter, én fælles pulje af forbindelser i Nodes indbyggede web-bibliotek.
- Hvert spørgsmål er sin egen lille handel i databasen: begynd, sæt rolle og indstillinger, spørg, afslut (**målt:** én indstillings-sætning pr. kald).
- Serveren bruger hovednøglen og går uden om række-sikkerheden; sikkerheden ligger i serverens egen kode.
- Ingen tidsgrænse på et spørgsmål i koden, så standarden gælder (op til 300 s). Det passer med de hængende kald på 160 til 300 s i #8101. **Sandsynlig forklaring, ikke bevist.**
- Der er ikke fundet en fejl i opsætningen, som forklarer de 75 ms. Selve afgiften ligger i, at hvert spørgsmål er et web-kald gennem et mellemled.

### Aftenkørslen (tidsstempler 5/11 til 12/11, **målt**)

| Aften | Hold | Varighed | Sekunder mellem to holds start (midten) | Overlap |
|---|---|---|---|---|
| 5/11 | 247 | 41 min | 9,4 | 0 |
| 6/11 | 251 | 58 min | 10,0 | 0 |
| 7/11 | 247 | 47 min | 9,6 | 0 |
| 8/11 | 249 | 3 t 15 min (stod stille 2 t 10 min under databasens nedbrud, #7917) | 10,1 | 0 |
| 9/11 | 244 | 48 min | 9,6 | 0 |
| 10/11 | 245 | 46 min | 10,9 | 0 |
| 11/11 | 248 | 55 min | 10,1 | 0 |
| 12/11 | 247 | 49 min | 11,5 | 0 |

Holdene køres ét ad gangen (nul overlap alle aftener; knappen til flere samtidig er ikke sat i prod). Ca. 10 s pr. hold, heraf ca. 0,8 s databasens eget arbejde; resten er ventetid i mellemleddet.

## Mønstret

For en tung vej (fx et Træn nu-tryk):

1. **Lås** det, vejen arbejder på (holdet for den dato), så to tryk ikke kan ramme hinanden.
2. **Hent** alt i ét hug: ryttere, evner, form, træthed, planer, dagens løb, stab, faciliteter, indstillinger.
3. **Regn** i serveren. Motoren er den samme som i dag (serverens regnearbejde er 0,06 s pr. tryk for et stort hold, **målt**).
4. **Gem** alt i ét hug. Enten bliver alt gemt, eller også bliver intet gemt.

Trin 1, 2 og 4 sker i én samlet handel med databasen. Trin 3 rører ikke databasen.

## Tre veje at gå, sammenlignet

| | A: direkte linje med det gængse bibliotek (`pg`) | B: direkte linje med det nyere bibliotek (`postgres`) | C: bliv på web-adgangen, saml i databasefunktioner |
|---|---|---|---|
| Pris pr. spørgsmål | ca. 10 ms (**regnet**) | ca. 10 ms (**regnet**) | ca. 75 ms (**målt**), men kun 2 til 3 kald pr. handling |
| Alt-eller-intet på tværs af flere skridt | Ja, styret fra serveren | Ja | Kun inde i én funktion ad gangen |
| Hvor bor spillets regler | I serveren, ét sprog, som i dag | I serveren | Mere og mere i databasen, to sprog |
| Nyt, der skal passes | En pulje, en ny adgangskode, en ny databaserolle | Det samme | En håndskrevet databasefunktion og en databaseændring pr. vej |
| Modenhed | Mest brugt til formålet, mange års drift | Færre brugere, kræver en særlig indstilling bag fordeleren | Kendt i repoet |
| Hjælper alle tunge veje på én gang | Ja | Ja | Nej |
| Risiko | Ny fejltype: puljen kan løbe tør, forbindelsen kan falde | Samme, plus mindre erfaring | Lav i driften; høj i bevisbyrden (regler i to sprog) |

**Valgt: A.** Den angriber årsagen (afgiften pr. spørgsmål), spillets regler bliver i serveren, hvor dommerens prøver virker, og biblioteket er det kedelige, gennemprøvede valg. C er nødplanen ("vej B" på ejerens kort), hvis måleprøven viser, at linjen ikke er hurtig nok. En pakke, der skriver databasesproget for én (ORM), er fravalgt.

## Forbindelsen: pulje, fordeler og loftet på 160

- **Indgang:** databasens fælles fordeler i Frankfurt, i den tilstand, der er beregnet til servere, som kører hele tiden. Virker fra serverens net uden tilkøb.
- **Pulje i serveren:** højst 8 forbindelser, mindst 0, ledige lukkes efter 30 s. Databasen har ca. 2 regnekerner (**regnet**), så flere end ca. 8 tunge handler på én gang gør intet hurtigere.
- **Regnestykket mod loftet:** ca. 50 af 160 pladser i brug, heraf 26 til web-adgangen (**målt** 13/11). Med højst 8 fra serveren og en rolle, der selv er låst til 10, er der ca. 100 fri.
- **Når der bliver flere server-kopier:** skift til fordelerens anden tilstand, hvor mange forbindelser deler få pladser. Det kræver, at koden kun bruger indstillinger og låse, der gælder for én handel ad gangen. **Det er regel fra dag ét**, så skiftet senere er en indstilling.
- **Tidsgrænser på alt:** højst 3 s for at få en forbindelse, 15 s for ét spørgsmål, 3 s for at vente på en lås, og en handel, der står stille i 10 s, afbrydes af databasen.

## Alt-eller-intet og låse

- Én handel pr. tung handling. Ingen kald til andre tjenester (mail, beskeder, betaling) inde i handlen; de sendes bagefter.
- Mål for varighed: under 2 s for en handel. Overskrides det, er det et fund til dommeren.
- **Låse i fast rækkefølge:** først holdet, så rytterne i stigende id-orden.
- **Samme sikkerhedsnet som i dag:** de unikke nøgler (ét dag-felt pr. hold pr. løbsdag) og Træn nu-låsen bliver. Uanset hvilken vej der skriver, afviser databasen en dublet.
- Gemme-funktioner, der allerede er bevist, **genbruges** inde i handlen. Ingen ny skrive-funktion i første omgang.

## Sikkerhed

- **Egen rolle til serveren** efter opskriften fra overvågnings-rollen (#6994): kan logge ind, er ikke administrator, har loft på forbindelser, egne tidsgrænser og kun de rettigheder, den har brug for.
- **Rettigheder: hverken flere eller færre end i dag** for de veje, der flyttes. Førstevalg: udtrykkelige rettigheder tabel for tabel og funktion for funktion. Andetvalg: rollen låner server-rollens rettigheder inde i hver handel (**uefterprøvet**, prøves på prøve-databasen).
- **Række-sikkerheden for spillerne ændres ikke.**
- **Hemmeligheder:** én ny adgangskode, kun i Infisical og hos serverens udbyder. Aldrig i repo, logs eller fejlbeskeder (fejltekster renses for forbindelsesadresser).
- **Krypteret forbindelse med tjek af modpartens bevis.** Ingen genvej, der slår tjekket fra.
- Rollen oprettes med en databaseændring, der kun lægger til, og køres efter merge (#2642).

## Fejl og genforsøg, når databasen falder ud (#7917)

- **Læsninger** prøves igen højst to gange med kort pause, hvis forbindelsen faldt.
- **En handel** prøves kun igen, hvis den er sikker at gentage (den fejlede, før noget blev gemt, eller unikke nøgler afviser en dublet). Er udfaldet ukendt, læses der først efter, om det blev gemt.
- **Hurtig fejl i stedet for kø:** kan puljen ikke få en forbindelse inden for 3 s, svarer handlingen "prøv igen om lidt", og baggrundsjob holder pause.
- **En tabt forbindelse må aldrig vælte serveren.** Puljen får sin egen fejlmodtager.
- **Ved udrulning** lukkes puljen pænt, efter baggrundsjobbene er færdige.
- **Automatisk tilbagefald:** falder linjen, før noget er gemt, kan handlingen i samme kald gå den gamle vej.

## De to veje side om side

- Den direkte linje bor i **ét lille modul** med to indgange: "stil ét spørgsmål" og "kør en handel". En vagt i kodetjekket tillader kun, at de udpegede veje bruger det.
- Hver tung vej får **sin egen kontakt**: "gammel vej" eller "direkte vej", skiftes på sekunder uden udrulning.
- Den gamle vej bliver i koden, til den nye har kørt grønt i en aftalt periode (forslag: 14 dage), og fjernes så i samme omgang.

## Sådan bevises og måles hver flytning

1. **Samme resultat mod en rigtig database:** gammel og ny vej på to ens kopier, alt, der blev skrevet, sammenlignet tabel for tabel.
2. **Prøvekørsel i prod uden at gemme:** hele den nye vej inde i en handel, der fortrydes til sidst; resultatet sammenlignes med det, den gamle vej gemte.
3. **Før og efter på samme måler** (måleren fra #8101, udvidet med antal spørgsmål og ventetid pr. handling). Dommeren sætter loftet før hver flytning.
4. **Uafhængig dommer før merge** for alt, der rører motor, træning eller penge. Tænding af en spillervendt vej er ejerens go.

## Sådan rulles det tilbage

- Kontakten skiftes tilbage til "gammel vej". Sekunder, ingen udrulning.
- Rollen og adgangskoden kan blive stående ubrugt eller fjernes; ingen spillerdata hænger på dem.
- Ingen af flytningerne ændrer tabellerne; der er ingen data at føre tilbage.

## Drift pr. måned

| Post | Pris |
|---|---|
| Direkte linje gennem den fælles fordeler | **0 kr.** (med i det nuværende abonnement) |
| Biblioteket | 0 kr. |
| Serveren | 0 kr. ekstra |
| Tilkøb af fast adresse til databasen | Ikke nødvendigt |

## De tunge veje, rangeret efter gevinst

| # | Vej | I dag (målt) | Med mønstret (regnet) |
|---|---|---|---|
| 1 | **Træn nu** | 7 til 10 s for et stort hold | ca. 1,2 til 1,8 s |
| 2 | **Aftenkørslen** | 41 til 58 min, ca. 10 s pr. hold, ét ad gangen | ca. 4 til 6 min |
| 3 | **Opret hold** | 6 til 19 s (#8101) | under 1 s |
| 4 | **Åbn og gem udtagelse, gem taktik** | 1,3 til 1,4 s i midten, toppe til 4,5 s | 0,3 til 0,5 s |
| 5 | **Bud og sæt til salg** | 1,0 til 1,5 s | 0,3 til 0,5 s |
| 6 | **Løbsafviklingen** | ca. 14 s mellem etaper i samme time | ikke regnet |

Regnestykket for Træn nu, et stort hold (**regnet**): regnearbejde 0,06 s; fem gem a 0,15 til 0,19 s er 0,75 til 0,95 s (**målt** pr. gem); hent alt i ét hug 0,1 til 0,2 s (skøn); ca. 25 ture a ca. 10 ms er 0,25 s. I alt ca. 1,2 til 1,8 s. "Under et halvt sekund" kræver, at gemme-funktionen selv gøres lettere; det er en senere forbedring.

## Forholdet til Træn nu trin 4a, 4b og 5b (#7982)

| Trin | Skæbne |
|---|---|
| **4a** (hent én gang, regn fem dag-felter i serveren) | Genbruges fuldt; bygges i tre adskilte dele: hent, regn, gem |
| **5a** (færre ventetider før træningen) | Kan bygges, hvis billig |
| **6** (dag-felt 1 slankes) | Vent |
| **5b** (ny læse-funktion i databasen) | Overflødig med A; venter som nødplan |
| **4b** (ny gemme-funktion for fem dag-felter) | Overflødig med A; venter som nødplan |

## Rækkefølge

| Trin | Hvad | Rører spillere | Bevis for at gå videre |
|---|---|---|---|
| 0 | Måleren ind i sporet for #8101 | Nej | Tallene kan læses pr. handling pr. time |
| 1 | **Måleprøve:** rolle, adgangskode, pulje og modul; den eneste bruger er prøven, der hvert minut stiller ét lille spørgsmål ad begge veje | Nej | **Den direkte linje er mindst tre gange hurtigere pr. spørgsmål end web-vejen og stabil i syv dage. Ellers stop, og gå til vej B (saml spørgsmålene i databasen).** |
| 2 | Træn nu: "hent" over den direkte linje (kun læsning) | Kun fart | Samme resultat, og dommerens loft er ramt |
| 3 | Træn nu: "gem" i én handel | Ja | Samme resultat mod rigtig database, prøvekørsel uden at gemme, ejerens go |
| 4 | Aftenkørslen på samme kerne | Indirekte | Samme resultat for en hel aften, prøvekørt uden at gemme |
| 5 | Opret hold, udtagelse, taktik, bud | Ja | Én ad gangen, samme opskrift |
| 6 | Løbsafviklingen | Ja | Eget design og ejerens go |

## Skalering: hvad holder til 10 og 100 gange så mange?

Udgangspunkt (**målt** 13/11): 313 menneskehold, 354 computerhold, ca. 14.300 aktive ryttere, ca. 247 hold trænet hver aften, 38 til 49 etaper i døgnet, database 9,3 GB, ca. 50 af 160 forbindelser i brug, serveren én proces. "100 gange" er ca. 31.000 menneskehold og ca. 25.000 hold trænet hver aften.

| Del | I dag (målt) | 10 gange (regnet) | 100 gange (regnet) | Hvad knækker først | Hvad der skal til |
|---|---|---|---|---|---|
| **Aftenkørslen** | 41 til 58 min for ca. 247 hold, ét ad gangen | Ca. 7 timer; ikke færdig før midnat | Ca. 69 timer | **Den, og tidligt:** ved ca. 5 gange er den ikke færdig før midnat | Den direkte linje og "hent, regn, gem" (ca. 1 til 1,5 s pr. hold). Ved 100 gange også flere hold samtidig og en større database |
| **Løbsafviklingen** | Ca. 8 etaper pr. time-plads, ca. 14 s mellem dem | 19 til 40 min pr. time-plads | Over 3 timer for én times løb | Etaperne køres efter hinanden i samme proces som spillernes kald | Divisioner samtidig i egne arbejds-processer; gem resultater i ét hug. Motorens regnetid pr. etape er ikke målt |
| **Serveren** | Én proces til alt; tiden går med at vente | Spillernes kald holder | Holder ikke som én proces | Kun én kopi mulig (ting huskes i processen) | Del i spillerkald og baggrundsjob; flyt det, der huskes, til databasen (flere kopier koster; ejerens beslutning) |
| **Mellemleddet** | Ca. 9 spørgsmål i sekundet fra serveren | Ca. 100 i sekundet | Ca. 1.000 i sekundet | Deler maskine med databasen | Tunge veje over på den direkte linje; husk indstillinger i serveren i 30 til 60 s |
| **Databasen: regnekraft** | Ca. 6 % af én kerne | Ca. 60 % af én kerne | Ca. 6 kerner; maskinen har 2 | "Live-ændringer" og aftenens spids | Større maskine (ejerens beslutning), ryd op i "live-ændringer", læse-kopi ved 100 gange |
| **Databasen: størrelse** | 9,3 GB; ca. 3,9 GB pr. sæson | Ca. 39 GB pr. sæson | Ca. 390 GB pr. sæson | Tabeller med én række pr. rytter pr. dag | Udløbsregel for historik, opdeling pr. sæson, slankere træningsrapporter |
| **Forbindelsesloftet (160)** | Ca. 50 i brug | Holder (linjen bruger højst 8 til 10) | Holder, hvis alle kopier går gennem fordeleren i den delte tilstand | Hvis hver kopi holder egne faste pladser | Reglen om kun at bruge indstillinger og låse for én handel |
| **Siderne** | De fleste læsninger 3 ms; enkelte 223 til 876 ms | Holder, hvis de tunge slankes | Holder ikke på dagens maskine | Store rækker og lange lister med række-sikkerhed | Færdige oversigts-tabeller, blade, kort mellemlager hos web-udbyderen |
| **Brugere og login** | Login-tjek i serveren uden kald (#7663) | Holder | Holder; mail-loftet skal hæves | Mail-loftet ved en stor tilmeldingsbølge | En indstilling hos udbyderne |

Det, der holder hele vejen: valget af database og sprog. Postgres og Node klarer 100 gange, når mønstret er rigtigt.

## Uefterprøvet i dette design

- Prisen pr. spørgsmål på den direkte linje fra serveren (**regnet** ca. 10 ms). Afgøres af trin 1.
- At fordeleren og biblioteket spiller sammen uden særlige indstillinger i den valgte tilstand. Afgøres af trin 1.
- Hvordan rollen bedst får "samme rettigheder som i dag" (trin 2 og frem).
- Skønnet på 0,1 til 0,2 s for at hente alt til et Træn nu-tryk i ét hug.
- Alle tal "med mønstret" og alle 10x- og 100x-tal er regnet, ikke målt.

## Trin 1 som bygget

**Filer:** `backend/lib/directDb.ts` (linjen), `backend/lib/directDbProbe.ts` (prøven), `database/2026-11-13-8143-direct-db-role.sql` (rollen `cz_direct`), `database/2026-11-13-8143-direct-db-probe.sql` (prøvens tabel og kontakt), tests i `backend/lib/directDb*.test.js`, driftsvejledning i `docs/AI_OPS_REFERENCE.md`.

- **Slukket som standard, to gange:** uden miljøvariablen `DIRECT_DB_URL` gør modulet ingenting (ingen pulje, ingen log), og prøvens timer startes slet ikke. Med variablen måler prøven først, når kontakten `direct_db_probe_8143` står på `"on"` (ingen række, `"off"` eller fejl = slukket).
- **Biblioteket `pg`** indlæses først, når linjen bruges, så serverens opstart ikke afhænger af det, mens linjen er slukket.
- **Adressen skilles ad i felter**, før `pg` ser den, så et `sslmode` i adressen aldrig kan slå tjekket af modpartens bevis fra. Er udbyderens rod-certifikat ikke i Nodes standardliste, sættes det (offentligt, ikke hemmeligt) i `DIRECT_DB_CA_PEM`. Fordelerens brugernavn har udbyderens format (rollenavnet efterfulgt af projektets kendetegn).
- **Tidsgrænser tre steder:** puljen (3 s for en forbindelse, 15 s klientside pr. spørgsmål), hver handel (`set_config(..., true)` for 15 s, 3 s og 10 s, så de kun gælder handlen) og rollen selv (samme værdier som sikkerhedsnet).
- **Reglen om én handel ad gangen** håndhæves i koden: `SET` uden `LOCAL`, `RESET`, session-låse, `LISTEN`, `PREPARE`, `DISCARD`, midlertidige tabeller og `set_config(..., false)` afvises, før der lånes en forbindelse. Der bruges aldrig navngivne forberedte spørgsmål.
- **Prøvens to spørgsmål:** web-vejen læser én indstilling (det hyppigste spørgsmål, serveren stiller i dag); den direkte vej stiller `SELECT 1`, som kræver ingen rettigheder. Databasens egen tid er under 0,1 ms for begge (**målt**), så forskellen er vejen. Tiden for at få en forbindelse (`acquire_ms`) måles for sig, så en ny forbindelse ikke forveksles med prisen pr. spørgsmål. Rækkefølgen skifter hvert minut.
- **Lagring:** måleren fra #8101 er ikke merget, så prøven bruger sin egen lille tabel (to rækker i minuttet, kun serveren). Prøven sletter selv rækker ældre end 14 dage, én gang i timen; der er ingen ny planlagt databaseopgave. Opgørelsen er én SELECT (`DIRECT_DB_PROBE_READOUT_SQL`).
- **Rollen:** oprettet som `LOGIN PASSWORD NULL` (samme som #6994), så den ikke kan logge ind, før ejeren sætter en adgangskode, og så en gen-kørsel ikke slår login fra igen. Loft på 10 forbindelser, egne tidsgrænser, `default_transaction_read_only = on` i trin 1, ingen tabel-, sekvens- eller funktionsrettigheder; verify-blokken fælder migrationen ellers.
- **Alt eller intet, også når kalderen fanger en fejl:** fejler et spørgsmål i handlen, rulles hele handlen tilbage og afvises, selv om kalderen fangede fejlen; svarer databasen "ROLLBACK" på COMMIT, afvises handlen også. En forbindelse, hvis handel ikke blev afsluttet rent, lukkes i stedet for at blive genbrugt. (Delvise genstarter med savepoints er ikke med i trin 1.)
- **Genforsøg** er ikke med i trin 1: prøven skal måle linjen, som den er. De kommer med den første rigtige vej.
- **Vagten:** `directDb.test.js` tillader kun `directDbProbe.ts` (og modulets egne tests) at importere linjen. Listen udvides bevidst, én vej ad gangen.
- **Pæn lukning:** ved udrulning stopper prøvens timer sammen med baggrundsjobbene; efter baggrundsjobbene venter serveren højst 5 s på en igangværende runde og højst 5 s på at lukke puljen.
