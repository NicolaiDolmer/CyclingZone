# Glemt planlagt arbejde: fund og rangering (16/11)

> Undersøgelse til #7911, kun læsning. Kilder læst 16/11 kl. ca. 11-12: `docs/MASTERPLAN.md`, `docs/I_GANG.md`, `docs/NOW.md`, `roadmap_items` + `roadmap_item_scores` (SELECT), 1.011 åbne issues, 134 issues lukket som "not planned" siden 17/9, git-historik for MASTERPLAN og NOW 60 dage, `FEATURE_REGISTRY.yml`, `app_config` (kontakter off), `docs/superpowers/specs|plans`, `pr-screens/`, åbne PR'er, OneDrive `private-handoffs/spillerprioriteter-2026-11-06.md`, memory, Discord #build-a-feature (seneste 100 beskeder, 7-9/11). Ingen spillernavne.
>
> "Planlagt" betyder her: står i MASTERPLAN, I_GANG eller NOW, eller har en roadmap-række med horisont this_week, next_week, season_5, season_6 eller q1_2027.

## Kort fortalt

- **Problemet er reelt.** 315 åbne issues har stået i MASTERPLAN eller NOW inden for 60 dage og er fjernet igen uden at være lukket. Flere har ejerens løfte eller dato i titlen.
- Af ejerens 8 navngivne eksempler står kun 2 i planen (app i masterplanen uden roadmap-række, ansigter i q1_2027). 5 har issues, men ingen plads i hverken roadmap eller masterplan (roadmap-funktionen kun delvist via #7971). Prompt doctor står kun i NOW.md.
- Det mest tidskritiske, der mangler: **#6950** (rige og fattige hold, ejer 6/11: "besluttes 15-18/11"), **#5841** (næste sæsons kalender synlig før skiftet, skal nås før S6) og to spillerfejl uden plads (**#7692**, **#5912**).

## 1. Ejerens 9 eksempler

| # | Eksempel | Hvor det er planlagt (aftale, dato) | Status 16/11 | Roadmap | Masterplan | Forslag |
|---|---|---|---|---|---|---|
| 1 | Ny patch notes-side | #8049, ejerens ord og valg 12/11: efter område, uge for uge, arkiv pr. måned, "set" husket på brugeren. Spillerfejl #6515 (prikker huskes pr. enhed, 15/11) hører med. Epic #954 | Intet bygget | Nej | Nej | **next_week**, #6515 med som fejl |
| 2 | Forbedringer til roadmap-funktionen | #7793 (ugens tekst øverst, ejer 6/11), #7791, #7794, #7795, #7796 (6/11), #6204 admin-faner, #6923, #8065 (sync laver dubletter, fejl), #7630, #6205. #7971 står i masterplanens Kø | #7971 delvist, resten ikke startet | Nej | Kun #7971 | #8065 **this_week** (fejl), #7793 **next_week**, resten **idé på roadmappet** |
| 3 | Gennemgang af alle mobilsider | #8073 (10 mest besøgte sider mod TASTE, 12/11), #7886 tabeller på telefon (ejer 7/11), #8071 design-session (kun i NOW.md), #6916 Mobil 10x. Spilleranalysen 6/11: "Mobil er det største hul ... står ikke i MASTERPLAN" | Ikke startet | #6916 kun unscheduled (12 stemmer) | Nej | **season_5** som "designløftet", #8071 som næste skridt |
| 4 | En app | #6584, ejer-go 13/10 (PWA + Google Play/TWA), plan `2026-11-12-6584-pwa-hardening.md` | I gang (PWA-hærdning) | Ingen række | Ja, "Google Play #6584" | **season_6** på roadmappet (samme tid som Pro 2.0 og udgivelsen) |
| 5 | Gennemgang af designsystem og TASTE | #8069 samleopgave (ejer 12/11: "ét udseende på web, mobil og app"), #8070 (dagens regler ind i TASTE, ejeren godkender ordlyd), #8076, epic #4622, #7993. Discord 9/11: ejeren bad om "et tjek på hele siden" mod TASTE; #7877 blev lukket 8/11 og afløst af #8073 | TASTE-tilføjelser 9/11 skrevet ind; resten ikke startet | Nej | Nej | #8070 **this_week** (lille, kun ejerens ordlyd), resten **kun masterplan** (internt) + #6916 på roadmap |
| 6 | Design af cykler, ansigter og personale | Epic #5113 (3D-ryttere, livery, sponsor-univers, køretøjer, staff), #5118, #5115, #4100 portrætter. #6193 udstyr og holdbiler blev arkiveret på roadmappet 12/11 | Ikke startet | #5113 q1_2027 ("logo, team colours and rider faces") | Ja, Q1 2027 | **Behold q1_2027**. Personale-udseende og cykler står ikke i roadmap-teksten: tilføj til #5113's række |
| 7 | Forbedringer til sponsor, bestyrelse, akademi, talentspejdere og personale | Sponsor #1441 (15 stemmer, vigtighed 4,3), bestyrelse #1239 (14 st., 4,3) og #7167 (gennemgang med ejeren "S5 uge 1", passeret), akademi #8081 (ét samlet designvalg, ejer 12/11) + #8036 + #7932, spejdere #5625 (masterplan S6+), personale #2887 + #6192 + #7695 (ejer-direktiv 4/11: forslag fra 14 dages #staff-chat, aldrig lavet). Overblik #7928 (spiller 8/11) | Kun rettelser (#7963, #8116, #8118, #8060) er planlagt | #1441, #1239, #5625, #2887, #6192, #7928 kun unscheduled | Kun #5625 og rettelserne | #8081 **next_week** sammen med #6944, #7695 **this_week** (ren læsning), #7928 + #7167 **season_5**, resten **idé på roadmappet** |
| 8 | Prompt doctor-audit-session | #8162, ejer 14/11, frist 16/11. Trin 1-2 kræver ejeren i en almindelig terminal | Ikke kørt | Nej (internt) | Nej, kun NOW.md | **Kun masterplan**, i dag |


Briefen nævner 9 eksempler; listen indeholder 8 navngivne (designsystem og TASTE er taget samlet i række 5). Fællesnævneren står i #8069, hvor ejeren 12/11 siger: "Det er meget vigtigt, at vi udfører de store planlagte forbedringer."

## 2. Rangeret liste over glemt arbejde

Dubletter er slået sammen under ét nummer. Alt, der allerede står i planen (se definition), er sorteret fra. Rækkefølge: fejl hos spillerne først, så ejer-aftalt med dato, så værdi for spillere og forretning. Motor kommer efter træning, udvikling, taktik og planlægning.

### A. Fejl hos spillerne (uden go, foran alt)

| Rang | Issue | Hvad | Placering | Begrundelse | Kilde |
|---|---|---|---|---|---|
| 1 | #7692 | Solgt rytter stopper med at træne; solgt U23-rytter falder ud af etapeløbet i stedet for at køre det færdigt | this_week | Live fejl, label sat tilbage til todo 8/11, ingen plads siden | issue, NOW-historik |
| 2 | #5912 | 1.759 tabte træningsdage fra 28/9: script findes, men udført genopretning og besked er aldrig bevist | this_week (prod-tjek først) | Fejl, der rammer spillernes ryttere; 42 gange i MASTERPLAN/NOW, så fjernet | backlog-sweep 2/11 |
| 3 | #8097, #8108 | Dashboard skriver forkert om samlet stilling; Hjælp nævner stadig "loft" | this_week | Forkert info må bygges uden liste | issues |
| 4 | #8026, #7962, #7987, #8215 | Træningsprogram overstyrer dagens valg uden besked; TWK/LDR vises som "-"; "Needs a day" misforstås; forsidens top 5 for langsom | this_week/next_week | triage:new uden plads | issues |
| 5 | #8065 | Roadmap-sync laver dubletter | this_week | Gør roadmappet forkert for spillerne | issue |

### B. Aftalt med ejeren, med dato eller valg truffet

| Rang | Issue | Hvad | Placering | Begrundelse | Kilde |
|---|---|---|---|---|---|
| 6 | #6950 | Rige og fattige hold: catch-up (ejer-løfte 28/9 og 1/10) | this_week: beslutningskort; byg season_6 | Ejer 6/11: "besluttes 15-18/11"; 16 stemmer, vigtighed 4,1 | issue, roadmap_item_scores |
| 7 | #5841 (+#3900 samlet heri) | Næste sæsons kalender og divisionsvalg synlige før skiftet (ejer-direktiv 27/9) | next_week | Skal virke før S6-skiftet i december | lukket #3900 → #5841 |
| 8 | #8049 (+#6515, #954) | Ny patch notes-side | next_week | Ejerens valg truffet 12/11 | issue |
| 9 | #8081 (+#8036, dele af #7932) | Akademiet som ét designvalg | next_week, sammen med #6944 | Ejer 12/11; 60 hold bruger akademiet | issue |
| 10 | #8070 | Dagens designregler ind i TASTE og PAGE_TEMPLATES | this_week | Lille; alle nye sider bygges ellers efter forældede regler | issue |
| 11 | #7695 | Forslagsliste fra 14 dages #staff-chat | this_week | Ejer-direktiv 4/11, ren læsning, aldrig lavet | issue |
| 12 | #7167 | Gennemgang af bestyrelsen med ejeren | season_5 (uge 48) | Ugen er passeret; bestyrelsen har 3 åbne fejl | backlog-sweep 2/11 |
| 13 | #8162 | /doctor prompt-audit og /skill-doctor | kun masterplan, i dag | Frist 16/11; budgetvagten er ved loftet | NOW.md |

### C. Værdi for spillere og forretning (ikke aftalt med dato)

| Rang | Issue | Hvad | Placering | Begrundelse | Kilde |
|---|---|---|---|---|---|
| 14 | #8069 (+#8073, #8076, #4622, #7886, #8071, #6916) | Designløftet: ét udseende på web, mobil og app; 10 mest besøgte sider | season_5 (mobil som roadmap-punkt #6916) | Mobil er spillernes største klage (11 af 34 aktive i sept.) og skal være klar før appen | #8069, spillerprioriteter 6/11 |
| 15 | #6584 | App (PWA + Google Play) | season_6 | Står i masterplanen, men spillerne kan ikke se den | masterplan, roadmap |
| 16 | #7928 | Ét overblik over bestyrelse, sponsor, økonomi, akademi og klub | season_5 | Daglig spiller: "uoverskueligt"; gavner nye spillere (#8084) | issue, roadmap unscheduled |
| 17 | #5865 | Skader nulstilles ved sæsonskiftet | season_5 | 18 stemmer, vigtighed 4,3; lille, skal nås før S6-skiftet | roadmap_item_scores |
| 18 | `winback_send_enabled` | Win-back-mail nr. 2 før S6 | kun masterplan (forretning) | Bygget og sendt én gang 22/9; S6-start er den naturlige krog | GROWTH_STACK §8, app_config |
| 19 | #6190 | Ro under pres og træningsdisciplin | season_6 | Titlen siger "planlagt uge 43-46"; hører efter XP | issue |
| 20 | #5348, #5349 | Holdarbejde i motoren og mentorpar (data bygget i #5268) | season_6 (hører til #1177) | Registry "building" uden plan; #1177 står allerede i S6 | FEATURE_REGISTRY |
| 21 | #1441, #1239, #2887, #6192 | Sponsor-rework, klubfokus for bestyrelsen, sportsdirektør, flere personaleroller | idé på roadmappet til afstemning (står der allerede, giv dem en kategori) | Høj vigtighed (4,3) men få stemmer; design først | roadmap_item_scores |
| 22 | #8030 | Antal udgåede pr. løbstype (ejer-løfte 15/10 via #6938 → #7713) | season_5 (motor) | Løftet blev samlet ind i et lukket issue og står nu ingen steder | lukkede issues |
| 23 | #1148, #6024, #1147, #935 | Klubmuseum, større handler, flere rygter, følg/inviter | idé til afstemning; #935 season_6 efter Pro 2.0 | Mest stemte punkter (37-39 st.), ingen horisont | roadmap_item_scores, masterplan "inviter en ven efter Pro 2.0" |
| 24 | #2768 | Bjergetaper med lang dal før sidste stigning | season_6 (motor) | 28 stemmer, vigtighed 3,6 | roadmap_item_scores |
| 25 | `survey_banner_enabled` | Nyt spørgeskema til spillerne | kun masterplan | Eneste skema er fra september; prioriteringen hviler på gamle svar | spillerprioriteter 6/11 |

### D. Drop eller luk med grund

| Issue | Grund |
|---|---|
| #5833 sæsonpause | Arkiveret på roadmappet 11/10, men issuet er åbent med 34 kommentarer og låste valg. Ejeren afgør: før S6-skiftet eller luk |
| #5443 værdisystem | Roadmap siger leveret; issuet er åbent. Luk med bevis eller del resten ud |
| `season_documentary_llm_enabled`, `rider_primary_type_from_distribution`, `market_value_sweep_enabled` | Bygget og slukket siden aug-sept uden plan. Tænd-kort eller fjern (gammelt væk) |
| #6193 udstyr og holdbiler | Arkiveret 12/11. Bekræft, at det er en ejer-beslutning, og luk issuet |

## 3. Hvor glemt arbejde gemmer sig

1. **Trimning af MASTERPLAN og NOW.** Budgettet på ~1.200-1.500 tokens tvinger punkter ud. 315 åbne issues er fjernet de sidste 60 dage uden at være lukket eller flyttet til roadmappet.
2. **Samleopgaver fra storsessioner** (#8069, #7932, #7971, #7911's 253 kommentarer). Ejerens valg står i kommentarer, ikke i planen.
3. **"Samlet i" og dubletter.** Et ejer-løfte lukkes som dublet ind i et issue, der så lukkes eller aldrig planlægges (#6938 → #7713 → #8030; #3900 → #5841).
4. **Roadmap arkiveret uden levering** (44 rækker), fx #5833.
5. **Kontakter, der står off for bygget arbejde** (31 rækker i `app_config`, flere fra juli-sept) og registry-poster i "building" eller "dormant" uden plan.
6. **Kun i NOW.md** (#8071, #8162): forsvinder ved næste trim.
7. **Discord #build-a-feature.** Ejeren bad 7-9/11 selv om at "sikre dig, at der er oprettet issues til de aftalte punkter og at de er planlagt ind i roadmap og masterplanen". Issues blev oprettet; planen blev ikke opdateret.
8. **Backlog-sweepet 2/11** markerede mange issues "gyldig" (fx #5865, #6190, #7167), men uden at give dem plads.

## 4. Anbefalet fast rutine

**Hver mandag før "This week" skæres (10 min, ét kort til ejeren, højst 10 punkter):**

1. Kør et plan-hul-tjek (foreslået script `scripts/plan-gap-audit.mjs`, kun læsning), som lister:
   - åbne issues med `ejer`, `løfte`, `aftalt` eller `ejervalg` i titel eller seneste kommentar, eller med `needs-design`/`needs-decision`/`priority:high`, som hverken står i MASTERPLAN/I_GANG eller har en roadmap-række med horisont;
   - issue-numre fjernet fra MASTERPLAN/NOW i ugens git-log, som stadig er åbne;
   - roadmap-rækker arkiveret i ugen uden `shipped_at`;
   - `app_config`-kontakter off over 14 dage, hvor registry siger `building`;
   - issues lukket som dublet eller "samlet i", hvor målissuet er lukket eller uplanlagt.
2. Ejeren vælger for hvert punkt: horisont, kun masterplan eller drop med grund.
3. **Regel:** når ejeren træffer et valg på et issue, får det i samme session en roadmap-række eller en masterplan-linje, eller labelen `icebox` med dato og grund. Et punkt må kun fjernes fra MASTERPLAN, hvis det samtidig står et andet sted (roadmap, I_GANG eller lukket med bevis).
