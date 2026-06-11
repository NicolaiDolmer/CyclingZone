# Kernesystem-design — marked, kontrakter, udvikling, træning, ungdom, race

Status: Ejer-besluttet i brainstorm-session 2026-06-11 (32 AskUserQuestion-svar), afventer skriftligt spec-review
Dato: 2026-06-11
Scope: Auktioner · Transfers · Kontrakter · Rytterudvikling/stats · Træning · Ungdomsryttere/akademi · Race engine
Relaterer: #1105 (relaunch-epic) · #1136 (progression) · #931 (træning) · #932 (akademi) · #1102/#1021 (race engine) · #1101 (base_value) · [Living World Product Doctrine](2026-06-08-living-world-product-doctrine-design.md)

Dette dokument samler ejerens design-beslutninger for spillets fire motorer, så de kan bygges direkte fra dette grundlag. Hvor doktrinen fra 8/6 siger noget andet, gælder DETTE dokument (afsnit 11 lister doktrin-opdateringerne).

---

## 1. Fundamentale forks (besluttet, runde 0)

| Fork | Beslutning |
|---|---|
| Kontrakter | **Ja — fødes ind i frisk sæson 1 ved relaunch 20/6** (data-seed dag 1; flows kan dryppe, se afsnit 12) |
| Stat-synlighed | **Transparent:** alle current stats er præcise for alle; kun potentiale er skjult/usikkert (L1-ranges). Markedets spænding kommer fra auktionsdynamik, kontrakter og potentiale-usikkerhed — ikke informations-asymmetri |
| Udviklings-kadence | **Dagligt tick** (VMan-inspireret, se afsnit 6-7) |
| Holdudtagelse + træthed | **Begge med i relaunch 20/6** (hellige, se afsnit 12) |

## 2. Auktioner

Eksisterende fundament beholdes (proxy-bud, anti-snipe-forlængelse, garanteret salg til bank, flash-auktioner, max 1 aktiv auktion pr. rytter). Nyt oven på:

1. **System-bølger + manager-listings.** Systemet ruller løbende et kurateret udsnit af frie ryttere på auktion (initial: 10-20 ad gangen, blandet kvalitet, roterende, seeded). Managers kan fortsat selv liste egne OG frie ryttere. Der er altid noget at byde på, og stjerner kommer ud i konkurrence frem for at blive snuppet til gulvpris.
2. **AI-bud, værdi-cappet.** AI-hold byder op til rytterens modelværdi ± lille varians (initial: cap 110 % af `base_value`, aldrig systematisk overpris). Trapper automatisk ned når ≥2 menneskelige bydere er aktive i samme auktion. Lukker "vind en stjerne kl. 03 til startpris"-hullet.
3. **Slut-tider: alle dage kl. 10-22 dansk tid.** Auktioner kan kun slutte i dette bånd (oprettelses-UI snapper `calculated_end` ind i båndet). Ingen midnats-slutninger.
4. **Prisglidning 25 %.** Ved auktions-/transfer-finalization: `base_value += 0.25 × (handelspris − base_value)` (hook fra #1101). Anti-pump-guard: handler mellem samme to hold inden for kort vindue (initial: 7 dage) udløser ikke glidning.

## 3. Kontrakter (nyt system)

Det vigtigste nye økonomiske objekt. I dag: ingen kontrakter, evig binding, løn = generated 10 % af `market_value`.

1. **Løn frosset ved signering.** Løn fastsættes ved kontraktindgåelse (initial: 10 % af `market_value` på signerings-tidspunktet) og står fast til udløb. Skaber guldkontrakter (ung eksploderer → billig ift. niveau) og møllesten (faldende stjerne på høj løn). Den generated `salary`-kolonne erstattes af kontrakt-felter.
2. **Længde 1-3 sæsoner, blandet seed.** Ved signering vælges 1, 2 eller 3 sæsoner. Relaunch-populationen seedes med blandet restløbetid (~1/3 udløber pr. sæson) så free-agent-flowet starter fra sæson 1-slut. Founder-holdenes ryttere starter med 2 sæsoner.
3. **Udløb → forlængelses-vindue → auktion med provenu til klubben.** I rytterens sidste kontrakt-sæson kan klubben tilbyde forlængelse (rytteren kræver løn ift. AKTUEL værdi — en udviklet ung er nu dyr at holde). Forlænges der ikke, ryger rytteren ved sæson-skift på offentlig system-auktion — **og den tidligere klub modtager provenuet**. Ejer-beslutning med begrundelse: inaktive/ferierende managers mister ikke holdets værdi, kun beslutningsmuligheden (anti-punitivt, doktrin-tro). Vinderen signer ny kontrakt (vælger længde; løn = rytterens lønkrav).
4. **Kontrakt følger med ved handel.** Køber overtager restkontrakten som den er (løn + restløbetid). Guldkontrakter bliver dermed handelsvarer. Rytteren nægter aldrig et skifte i v1 — hans eneste "vilje" er lønkravet ved forlængelse/free-agent-signering. Personlighed/utilfredshed er post-launch.
5. **Frigivelse (nødudgang).** Frigiv en rytter før tid mod afståelsesbeløb (initial: 50 % af resterende kontraktløn = rest-sæsoner × sæsonløn × 0,5). Rytteren ryger på system-auktion; den frigivende klub får INTET af provenuet. Afståelsesbeløbet forsvinder ud af økonomien (inflations-dræn).

## 4. Transfers & marked

1. **Altid åbent + Deadline Day.** Ingen transfervinduer (vigtigt ved lille befolkning). Ét stort Deadline Day-event sent i hver sæson (genbruger flash-auktions-mekanikken). `window_pending`-logikken kan pensioneres når vinduer afskaffes.
2. **Uopfordrede bud på alt.** Enhver manager kan byde på enhver kontrakt-rytter — ejeren kan acceptere, afvise, modbyde eller ignorere (bud auto-udløber, initial: 48 timer). Listings bliver "jeg VIL sælge"-signalet; uopfordrede bud skaber manager-til-manager-kontakt.
3. **Swaps og loans beholdes begge.** Ejer-beslutning der overstyrer doktrinens "remove swaps" (doktrin opdateres, afsnit 11). Loans bliver vigtige for akademiet (udlån af unge til spilletid).
4. **Lønkrav** (forlængelse + free-agent-signering): initial formel = 10 % af aktuel `market_value`; kalibreres i sim-harness (afsnit 13). Decline-fase-rabat er et åbent tuning-punkt.

## 5. Rytterudvikling & livscyklus (oven på L0 #1137)

1. **Dagligt udviklings-tick, VMan-form.** Udvikling drives af den daglige træning (afsnit 6): hver rytter får en daglig træningsscore; scoren fylder synlige progress-barer pr. evne (fordelt efter rytterens program); fuld bar → +1 i evnen. Blanding af "chunky events" og XP-bar — synlig fremdrift uden decimal-støj. L0-motorens sæsonvise vækstbudget omlægges til den daglige strøm (potentiale-loft, alders-vægte og determinisme genbruges).
2. **Langsomt tempo: peak efter 9-10 sæsoner.** En 18-årig debutant peaker omkring alder 27-28 (~9-10 måneder realtid). Maksimal tålmodigheds-belønning; akademi-projekter er ægte projekter.
3. **Gennembrud/skuffelser: sjældne og forklarlige.** Initial: 1-2 ryttere pr. hold pr. sæson får et mærkbart hop (+3-5 over kurven) eller en stagnation (sæsonvækst halveret), vægtet af alder/potentiale/spilletid — ALTID med synlig årsag. Aldrig karriere-ødelæggelse.
4. **Livscyklus: fase synlig + peak-interval.** Profilen viser udviklingsfase (vækst/peak/decline) og forventet peak-interval (fx "peaker typisk 26-28"). Eksakt peak-alder pr. rytter forbliver usikker. Retirement varsles mindst én sæson før (L0-mekanikken).

## 6. Træning (den daglige krog)

VMan-inspireret daglig loop, doktrin-forenelig via assistent-fallback:

1. **Programmer pr. rytter/gruppe** (genbruger teaserens fokus-taksonomi fra #1163: vo2max, threshold, sprint, endurance, technique, aero + intensitet). Programmet bestemmer hvordan dagens træningsscore fordeles på evne-barer. Teaserens 3-slots-begrænsning afløses af programmer til hele truppen.
2. **Ét dagligt klik eksekverer alt.** Dagens klik kører ALLE programmer og viser en træningsrapport: dagens score pr. rytter, hvem der over-/underpræsterede. ~10 sekunders handling; dybden ligger i program-designet.
3. **Assistent træner ved fravær, klik giver bonus.** Rytterne følger ALTID deres program (assistenten eksekverer automatisk). Aktivt klik giver bonus (initial: +25 % effekt den dag + mulighed for at justere). Daglige spillere belønnes mærkbart; ferie-spillere taber ikke deres projekt. Misset dag = aldrig tabt træning, kun tabt bonus.
4. **Light Form/Træthed-spine i relaunch.** To tal pr. rytter (Form, Træthed, 0-100): træning og løbsdage bygger træthed, hviledage sænker den; form stiger ved god balance, falder ved overbelastning. Race-motoren læser begge via de eksisterende seams (`formComponent`/`fatigueComponent`); initial vægt: lille (max ±3 % af score), kalibreres i race-gate-harnesset. Fuld CTL/ATL/TSB-matematik + sessions-katalog (#931-epic) bygges post-launch OVEN PÅ samme to tal.
5. **Milde, læsbare skader.** Hård træning + høj træthed øger synlig risiko ("høj skadesrisiko"-badge). Udfald: småskade/sygdom = 1-5 dages pause (ingen træning, ingen løb). Ingen langtidsskader i v1.

## 7. Ungdom & akademi (#932 — MVP til 20/6, ejer-krav)

1. **Intake: kuld + drypvise fund.** Hovedintake ved hver sæsonstart: 3-5 kandidater (1-3 "seriøse"), synlige current stats, usikre potentiale-ranges (L1). Klubbens DNA (nation + historiske styrker) biaser kuldet let. Klubben signer 0-2 (signing fee + løn). Derudover kan drypvise scouting-fund dukke op gennem sæsonen (post-MVP). Afviste kandidater → ungdomsauktion.
2. **Rammer: 8 pladser, alder 16-21, tvunget valg ved 22.** Akademi-trup er separat fra senior-cap'en på 30. Hver plads koster løbende drift (penge-dræn; beløb fastlægges i sim-harness). Ved 22 SKAL rytteren promoveres (kræver senior-plads + kontrakt), sælges på auktion (klubben får provenuet) eller slippes.
3. **Udvikling: samme daglige træning + opgraderbar akademi-facilitet.** Akademiryttere har programmer og indgår i dagens ét-kliks-træning (med ungdoms-multiplikator så akademi-træning FØLES givende). Oven på det: akademiet er en facilitet i niveauer (initial: 1-3) der kan opgraderes løbende — højere niveau = bedre udviklingsmiljø (vækst-multiplikator). Fair-premium-gaten (#1142) gælder: opgradering købes for in-game-penge, aldrig rigtige penge.
4. **Ungdomsauktioner: løbende.** Afviste talenter ryger løbende ind i de normale system-bølger, markeret som ungdom (ingen separat festival-uge). Usolgte bliver free agents og kan signes direkte til minimumsløn.
5. **MVP-snit til 20/6:** intake-kuld ved relaunch-sæsonstart + 8 pladser + akademiryttere i daglig træning + løbende u-auktioner. Facilitet-opgradering og drypvise fund kan komme i uge 1-2.

## 8. Race engine (oven på #1102-light)

1. **Holdudtagelse 6-8 ryttere** pr. løb (kategori-afhængigt), én udtagelse ved etapeløbs start. Assistent-autopick som fallback (vælger du ikke, vælger assistenten fornuftigt — ingen straf for fravær). Erstatter auto-entry af alle.
2. **Kaptajn + hjælpere.** Ved udtagelsen udpeges kaptajn (evt. én pr. mål: GC/spurt); resten er hjælpere. Motorens `teamComponent`-seam aktiveres: hjælperkvalitet + -træthed booster kaptajnens score.
3. **Udbrud: bonus + jæger-rolle (begge).** Light udbruds-bonus: på flad/rolling/medium-bjerg får 1-3 lavere-rangerede ryttere (aggression-vægtet, seeded) en chance-bonus der af og til giver ægte udbrudssejre. Plus aktiv rolle: manageren kan sætte en udbruds-jæger ved udtagelsen → forhøjet chance. Outsider-historier + håb for små hold uden at vente på #1021.
4. **Tekst-recaps fra sim-data.** Motoren udleder 5-10 nøglemomenter af scorings-dataene og fletter dem til en skabelon-baseret fortælling + holdets præstation. Ren præsentation oven på eksisterende data.
5. **Løb spredt over dagen.** Forskellige løb afgøres på forskellige kendte tidspunkter (fx 12/15/19) inden for 10-22-båndet — verden lever hele dagen; auktioner slutter om aftenen.

## 9. Tværgående beslutninger

1. **AI-hold: kun passiv L0-vækst.** AI-ryttere udvikles af den passive motor uden træningsbias eller klik-bonus. Ejer-valgt; kendt risiko: AI-hold sakker systematisk bagud over sæsoner → liga-skævvridning. Måle-trigger: hvis AI-holds gennemsnitlige styrke falder >10 % relativt til menneskehold efter 3 sæsoner (verificeres i progressions-simmen, afsnit 13), genbesøges beslutningen (opgradering til "assistent-niveau" er en lille ændring).
2. **Intet lønloft.** Gældsloft (D1 1,2M / D2 900K / D3 600K) + board-konsekvenser styrer. Ventiler: frigivelse, salg, udløb.
3. **Økonomi-dræn** (mod inflation fra præmier/sponsor): kontraktlønninger, akademi-drift, facilitet-opgraderinger, afståelsesbeløb ved frigivelse. Alle beløb gennem sim-harness før ship (afsnit 13).

## 10. Post-launch-prioritering (juni)

Ejer-besluttet: akademi-MVP er en 20/6-leverance; derefter arbejdes der i juni parallelt/sekventielt på alle tre:
1. **Akademiet** færdiggøres (facilitet-niveauer, drypvise fund, polish).
2. **Fuld trænings-dybde** (#931: sessions-katalog, CTL/ATL, lejre, tests) oven på light-spinen.
3. **Race-dybde** (#1021 fuld simulator + flere roller + bedre udbrud).
Kontrakt-/personligheds-dybde (rytter-vilje, agenter) kommer efter disse.

## 11. Doktrin-opdateringer (Living World Product Doctrine)

Dette design overstyrer/præciserer doktrinen på fire punkter — doktrin-dokumentet skal opdateres:
1. **Swaps beholdes** (doktrin: "remove or strongly deprioritize" → ejer-override 11/6).
2. **Daglig trænings-handling med klik-bonus** tilføjes som spillets daglige krog. Princippet "daily visits rewarding but never mandatory" overholdes via assistent-fallback (kun bonussen er login-gated).
3. **Ungdomsauktion = løbende** i system-bølgerne (ikke et samlet event).
4. **Akademi-MVP flyttes til Now/launch** (var "first playable academy loop kræver selvstændigt design" — designet er hermed lavet).

## 12. 20/6-scope vs fast-follow

**Hellige (må ikke glide):**
- Daglig træning + form/træthed-spine + milde skader (afsnit 6).
- Udtagelse + kaptajn/hjælpere + udbruds-jæger + udbruds-bonus (afsnit 8.1-8.3).
- Akademi-MVP (afsnit 7.5).
- Kontrakt-DATA seedes i relaunch-populationen (længder + frosne lønninger) — billigt i relaunch-orchestratoren (#1103) og umuligt at eftermontere rent.

**Fast-follow uge 1-2 (kan glide uden migrations-smerte):**
- Markeds-pakken: system-bølger, AI-bud, prisglidning, uopfordrede bud, frigivelse. (Bemærk: forlængelses-UI skal blot være klar FØR sæson 1-slut — første udløb sker ved sæson-skiftet, ikke på launch-dagen.)
- Tekst-recaps + spredte race-tider.
- Akademi-facilitet-opgradering + drypvise scouting-fund.

## 13. Balance-gates (sim-før-ship)

Per ejer-accepteret regel (7/6) får ethvert balance-følsomt system et empirisk dry-run-harness mod ægte population + mål-scorecard FØR ship. Gælder her:
- Prisglidning (25 %) + AI-bud-cap → auktions-sim: priser må ikke drive eller crashe over 3 simulerede sæsoner.
- Frosne lønninger + lønkravs-formel → økonomi-sim: et gennemsnitshold skal kunne bære lønmassen; guldkontrakt-fordelen skal være mærkbar men ikke dominerende.
- Form/Træthed-vægte + udbruds-bonus → udvid `npm run race:gate`-scorecardet (favoritter vinder oftest men ikke altid; udbrudssejre forekommer realistisk sjældent).
- Akademi-drift + facilitet-priser + daglig vækst-strøm → progressions-sim over 10 sæsoner (peak efter 9-10 sæsoner verificeres empirisk).

## 14. Åbne punkter (næste design-nedslag, ikke blokerende)

- Lønkravs-formlens detaljer (decline-rabat, ungdoms-præmie).
- Klub-DNA's præcise definition (nation-bias-vægte; kobling til board-identitet).
- Multi-løb samme dag vs. træthed (kan samme rytter udtages til to overlappende løb? Initial: nej).
- U-løb/junior-kalender (#958) — efter akademi-loopet er bevist.
- Recap-skabelonernes sprog (EN-først, DA-sekundært per copy-reglerne).
