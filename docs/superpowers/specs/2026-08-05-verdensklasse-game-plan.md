# Verdensklasse-planen 2026-08 — fra database med cykelløb til levende cykelsport

> **Status:** Ejer-godkendt 2026-08-05 ("Det er i orden" til bølge 1 + issues + denne doc).
> **Kilde:** 12-agent workflow-sweep 5/8 (5 kode/prod-audits, 3 markeds-research, 4 visions-linser; 1,7M tokens, alle fund evidens-grundet). Fuld leverance i chat-transcript 5/8.
> **Ejer-gate der IKKE er givet endnu:** mail-loop-flip i prod (#2853 — afventer Resend-nøgle + copy-godkendelse).

## Kernediagnose (målt, ikke gættet)

**Indholdet findes, leveringen mangler.** De største løft er præsentation/levering oven på data der allerede er persisteret — ikke nye simulationssystemer.

1. **Spillets hjerte er et batch-job.** Etaper simuleres på 5-min-cron; hele resultatet materialiserer på ét sekund. 25.742 story-moment-rækker (371/562 løb) når aldrig spilleren. `ConfettiModal` fejrer auktionskøb/transfers — fyres ALDRIG ved løbssejre.
2. **Retention er et leveringsproblem.** 8.953 resultat-notifikationer → 21 % læst; kun 34 % af modtagere har læst én. Mail-loop bygget men slukket; Discord-DM dækker 3/36 typer og udelader race/stage_result (57 % af volumen). 100 % af nye hold får et resultat (median 14 t); ~34 % ser det.
3. **Multiplayeren er ansigtsløs.** Budfeed/outbid-toast stripper rivalens navn (cachen `teamNameCacheRef` findes, bruges ikke). ManagerProfilePage kun linket for én selv; alle rival-links → holdside uden identitet. Rivaliserings-spec (2026-07-11) har 0 linjer shippet kode.
4. **UI-investering fejlplaceret.** Bedste viz (StageProfileGraph, radar, udviklingsprojektion) gemt på sekundære faner; Dashboard (højeste trafik) har 0 SVG; holdsider 0 viz; recap-deling = URL-kopi.
5. **Aktiveringshul.** 68 rigtige hold har aldrig budt; 63 %→38 % squad→første bud (#1140 åben). Startertrup bevidst svag uden forklarende copy. Onboarding-kort kan dræbes permanent ved ét fejltryk (P1 fra juni-audit, aldrig implementeret — #1569).

*Måle-note:* to dag-1-retention-metoder uenige (last_seen ~31 % vs. growth-snapshot 46-51 %) — afklar styringsmetode.

## Markedsposition (research-konklusion)

Genren = 3 lejre der aldrig overlapper: premium single-player (PCM; **Velo Victory 2026 bekræftet uden multiplayer**), draft-fantasy uden drama (Velogames 30k spillere, solo-bygget), dateret browser-hale. **Ingen ejer midten: moderne, browser-native, persistent multiplayer-cykelverden.** PCM.daily (55k medlemmer) håndbygger CZ's kerneloop i forumtråde. Armada-backlash validerer no-pay-to-win. Transplanterbare mekanismer: mini-leagues (FPL), ungdoms-loyalitet (Hattrick), stats-som-indhold (OOTP), delbare recap-kort (Wrapped/Wordle), liveblog-psykologi (tekst slår video for stats-nicher; kan afspilles over allerede-beregnede resultater), PWA-økonomi (Pro uden 30 % store-snit).

## De 7 programmer (47 forslag)

### A — Løbsdagen som teater
Genåbner "live-taktik/replay parkeret" som *broadcast-teater uden taktik* (deterministisk playback af persisterede rækker, ingen websockets-tunge systemer).
1. **Stage Finale Broadcast (L/kvartal):** resultat embargoes ~20 min; løbssiden afspiller ticker i fælles takt (afledt af `scheduled_at`+forløbet tid). Appointment-TV.
2. **The Final Kilometre (M/nu):** 90 s finale-afspilning af sidste 3 km fra eksisterende data (finish-deltaer, breakaway-flag, moments). Hvert resultat får et dramamoment, uanset login-tid.
3. **Race Centre (M/kvartal):** én kanonisk "i dag"-side: dagens etaper som sendeflade, LIVE-badge, nedtælling, resultat+reportage samme sted.
4. **Hero & Agony Cards (S/nu):** ét personligt moment-kort pr. etape (drama-score over race_stage_moments); agony vægtes som triumf; ét klik → editorial PNG.
5. **Call the Race (M/kvartal):** ét-tryks vindertip for alle, "12 of 31 called it", sæson-leaderboard. Gratis/kosmetisk.
6. **Watching Now (M/kvartal):** Realtime-presence + kuraterede reaktioner under broadcast. Socialt lag nul før forum.
7. **Championship Sunday (L/halvår):** sæsonfinalen som koordineret event: tidsforskudte afgørelser, live op/nedryknings-streger, countdown-uge.
8. **The Race Graph (L/halvår):** scrubbable post-race gap-graf; kræver lille deterministisk engine-tilføjelse (gap-kurve pr. checkpoint, backfill via re-sim). Fundament: #2410.
9. **Directeur Sportif Live (XL/2027):** én præ-simuleret branch-beslutning pr. etape i realtid.

### B — Den levende presse (AI-native unfair advantage)
LLM må kun FORTÆLLE verificerede sim-rækker, aldrig afgøre (EA-mønstret). Én cachet artikel pr. løb → pris skalerer med løb, ikke brugere.
10. **The Peloton Post (M/nu):** redaktionel reportage pr. etape; genbruges i digest-mail.
11. **Divisionens sladderspalte (S/nu):** ugentlig klumme pr. division med rigtige managernavne (budkrige, stimer, nedrykningsangst). Social tekstur FØR forum.
12. **Maiden Win Engine (S/nu):** career-firsts detekteres ved finalization → moment-kort + palmarès-linje + confetti for løbssejre. Delt eventmodel med #2490/#1997.
13. **Rytterstemmer (S/kvartal):** 1-2 grounded interview-citater pr. løb; personligheds-seed pr. rytter; deler pipeline med Peloton Post.
14. **Sæsondokumentaren (M/nu, mål 23/8):** narrativ årbog oven på #2752-recappen (signings, vendepunkt, rival) + delbart kort; batch-natkørsel.
15. **Sportsdirektøren (M/kvartal):** AI-assistent forklarer DINE taktiske trade-offs pre-race + debrief post-race; cachet pr. (opstilling, løb); Pro-perk-kandidat (indsigt ≠ fordel).

### C — Mennesker, ikke tabeller
16. **Auktioner med ansigter (S/nu):** post-hammerslag-reveal af budkrigen m. navne + taber-notifikation; anonymt UNDER auktionen (proxy-beskyttelse). + fix: budfeed/toast bruger den eksisterende navne-cache.
17. **Rival-identitet (S/nu):** alle rival-links → side MED identitet (achievements/level/historik); HoF linker i dag til nøgen holdside.
18. **Divisions-klubhuset (M/kvartal):** divisionen som forum-enhed (ikke ét globalt rum, jf. #3199-design); resultater auto-poster talking points.
19. **Rivaliserings-motoren (M/kvartal):** auto-detektér + selverklær rival; head-to-head-widget; sæson-verdikt + badge. Indsats = ære, aldrig ressourcer. Spec: narrative-systems B3.
20. **Ram podiet (M/kvartal):** divisions-scoped predictions m. eget leaderboard.
21. **Private cups & miniligaer (L/halvår):** invite-kode, 4-16 venner på tværs af divisioner, scoring-overlay på EKSISTERENDE resultater. FPL-lektien.
22. **Inviter en rival (M/kvartal):** invite placerer ven i din division (friend-placement-undtagelse i indplacering), derby-flag dag 1.
23. **Rekordbogen + verdensøjeblikke (M/kvartal):** global rekordbog fra engine-output; rekordfald = banner til hele spillet + avisforside; "record watch"-strip. Styrke belønnes med udødelighed.
24. **Føderationer (XL/2027):** klaner på tværs af divisioner; kun identitet + aggregeret scoring, ingen ressourcedeling.

### D — Arv og attachment
25. **Palmarès-first rytterprofiler (M/kvartal):** karrieren à la ProCyclingStats (sæson-palmarès, holdhistorik m. beløb, karriere-kurve). Substrat for alle moments. Jf. #1997.
26. **Akademi-dossierer (S/kvartal):** hvert søndags-intake ankommer med éngangs-scoutingdossier (data-grounded, frosset).
27. **The Farewell Season (M/kvartal):** pension annonceres FØR sidste sæson; sidste løb → retrospektiv + farvel-kort.
28. **One That Got Away (S/kvartal):** feed når din tidligere akademirytter vinder for anden klub; "developed here" i museet. Forstærker økonomi-reworken emotionelt.
29. **Klubmuseet (L/halvår):** trofæskab, levende rekordtavle, æra-tidslinje, pensionerede trøjer. Sunk narrative capital.
30. **Karaktertræk narrativ-only (M/halvår):** 1-2 redaktionelle træk pr. rytter, biased af stats, NUL engine-effekt.

### E — Nå spilleren hvor de er (levering — billigste kritiske program)
31. **Mail-loop-go (ejer-gate, #2853):** audits' største enkelthåndtag; bygget/testet/slukket. Minimal scope: dag-1 + resultat-digest.
32. **Discord-DM for løbsresultater (S/nu):** eneste levende eksterne kanal udelader i dag vigtigste event-type.
33. **Narrative notifikationer (S/nu):** genbrug raceReport-rubrikken i notifikation + digest ("KROGH SPRINTS TO MAIDEN WIN — you placed 2nd").
34. **PWA (M/kvartal):** manifest + service worker + web push + in-browser Pro-checkout (0 % store-snit).
35. **Delbare løbskort/OG-images (M/kvartal):** hvert resultat/rekord/sæsonafslutning → typografisk delekort. Jf. #1299.
36. **Onboarding-fixes (S/nu):** dismiss-tærskel på onboarding-kort (P1 fra #1569, uimplementeret) · copy om bevidst svag startertrup · #1140 first-bid-designsession prioriteres.

### F — Craft: dashboard og dataglæde
37. **Dashboard som sportsforside (L/kvartal):** 0 SVG i dag på højest-trafikerede side; løft med komponenter der allerede findes.
38. **Holdside-visualisering (M/kvartal):** promover sæson-kurven (findes som 60×24px Standings-celle) til holdsiden.
39. **Auktions-mobilfoldning (M/kvartal):** 13 kolonner, kun 2 folder på mobil — på T2-spec i spillets mest tidspressede interaktion.
40. **Radar i sammenligneren (S/kvartal):** RiderComparePage genbruger radaren der er bygget til jobbet.
41. **Sæson-arc-tidslinje (M/halvår):** én horisontal fortælling af sæsonen (rank/point over tid).

### G — AI-native ops
42. **Balance-observatoriet (M/kvartal):** ugentlig brief + auto-filede evidens-issues (pengemængde, point/CZ$ pr. type, sejrskoncentration). Simulér-EFTER-ship som standing infra.
43. **Syntetisk playtest-flåde (XL/halvår):** natlige agent-managere spiller det ægte spil mod staging-spejl (personaer: grinder, hoarder, exploit-jæger).
44. **Onboarding-conciergen (M/kvartal):** telemetri-afgjort kontekstuelt nudge i stedet for generisk tour.
45. **Stats-desken (L/halvår):** NL→SQL over egne data via RLS-sikre views. Pro-kandidat.
46. **D1 som karakter-peloton (L/halvår):** navngivne AI-hold m. filosofi + pressedækning; "D1 = kun AI" fra placeholder til designet endgame.
47. **Procedurel løbsdesigner (M/halvår):** kalender som sæsonens content-drop m. lore + akkumuleret løbshistorik.

## Regler der genåbnes (ejer-godkendt retning 5/8)

1. "Live-taktik/replay parkeret" → un-parkes som broadcast-teater uden taktik (A1/A2).
2. Auktions-anonymitet → anonym indtil hammerslag, derefter reveal (16).
3. "Socialt = forum først" → presence/predictions/presse-skabt rivalisering før kanaler (6, 11, 19).
4. Mail-loop slukket → tænd med minimal scope (31; gate: Resend-nøgle + copy).
5. D1 = kun AI som midlertidighed → designet endgame med ansigter (46).
6. Indplacering = ren strukturbalance → friend-placement-undtagelse (22).
7. Sæsonskifte som logistik → spillets største følelsesmæssige øjeblik (7, 14).
8. Streak fjernet (korrekt) → tomrum fyldes af appointment (sendetider/søndag/monument), ikke ingenting.
9. Kalender statisk → procedurel designer nu; 2027: legender omdøber løb.
10. Deling som URL-kopi → alle stolthedsøjeblikke producerer screenshot-værdigt artefakt.

## Bølgeplan

- **Bølge 1 (nu → 23/8), ejer-godkendt:** 16 auktions-reveal · 12 Maiden Win · 4 Hero & Agony · 33 narrative notifikationer · 32 Discord-resultat-DM · 2 Final Kilometre · 14 sæsondokumentar (mål 23/8) · 36 onboarding-fixes · 31 mail-loop (ejer-gate). Mål: 23/8-sæsonskiftet FØLES som noget.
- **Bølge 2 (efterår):** 3+1+5 Race Centre/Broadcast/predictions · 10+11 presse · 18+19 klubhus/rivaler · 25+26 palmarès/dossierer · 37 dashboard · 34 PWA · 42 observatorium.
- **Bølge 3 (halvår):** 21+22 miniligaer/invites · 29+27+23 museum/farewell/rekordbog · 7 Championship Sunday · 8 Race Graph · 15 sportsdirektør · 45 stats-desk · 46 D1-karakterer · 43 flåde.
- **2027-moonshots:** 9 DS Live · 24 føderationer · verdensbegivenheder · legender omdøber kalenderen.

## Mapping til eksisterende issues (dedup 5/8)

| Forslag | Eksisterende |
|---|---|
| 1/3 Broadcast/Race Centre | #91 (live-ticker), #2410 (løbsfilmen — engine-fundament), #936 (3D, 2027) |
| 2/8 Final Km / Race Graph | #2410 er fundament; Final Km bruger KUN eksisterende data |
| 12 Maiden Win | #2490 (rytter-krøniken, delt eventmodel), #1997 (palmarès) |
| 14 Sæsondokumentar | #2752 (recap-UI, done-flagget), #2361 |
| 25 Palmarès-profiler | #1997 |
| 31 Mail-loop | #2853 |
| 35 Share-kort | #1299 (@vercel/og) |
| 36 Onboarding | #1569 (handlingsplan m. dismiss-fix), #1140 (first bid) |
| 18 Klubhus | #3199/#3200 (forum-direktiv), #2209 (manager-DM) |
| 19 Rivaler | narrative-systems-design B3, gap-review Gap 3c |
| 32 Discord-DM | #2153 (kanal-routing, adjacent) |
| 21 Private cups | #3050 (venskabsløb — beslægtet, cups er scoring-overlay uden ny sim) |

## Beslutningslog

- 2026-08-05: Ejer godkendte planen + bølge 1 + at "løbsdagen som teater"-kernen går forrest. Mail-loop-flip forbliver separat ejer-gate (#2853). Denne doc må aldrig slettes (design-plan-regel); opdatér status-linjer ved bølge-afslutning.
