# Verdensklasse-gap-analyse — strategisk memo

> **Status:** Leveret til ejer-review 2026-07-11 (Fable, strategisk produkt-partner-session).
> **Opgave:** Skånselsløs gap-analyse: hvad står mellem CyclingZone og "et af verdens bedste manager-spil" — målt på BÅDE spilkvalitet OG levebrød (ejer-vision 10/7: begge vægter).
> **Evidens:** [Living World-doktrinen](2026-06-08-living-world-product-doctrine-design.md) · [MASTERPLAN](../../MASTERPLAN.md) · [NOW](../../NOW.md) · [GAME_INVARIANTS](../../GAME_INVARIANTS.md) · [CZ Pro-spec](2026-06-26-cz-pro-monetization-design.md) · [race-v3-spec](2026-07-11-race-engine-depth-credibility-design.md) · [træning/ungdom-spec](2026-07-11-training-youth-depth-design.md) · [narrativ-spec](2026-07-11-narrative-systems-design.md) · kode-kortlægning af alle motorer i `backend/lib` (3 dybe sweeps 11/7) · friske prod-tal (Supabase 11/7).
> **Rolle:** Dette memo ANBEFALER. MASTERPLAN er fortsat rækkefølge-SSOT indtil ejeren beslutter (§9-batchen nederst).

## 0. Hovedkonklusion

1. **Diagnosen er asymmetrisk.** Markedet/auktionerne er ægte differentiering — intet af genrens topspil (FM, OOTP, PCM er alle single-player) har live menneske-mod-menneske-auktioner, og de bliver beviseligt brugt (1.572 rigtige bud på 14 dage af ~75 ugentligt aktive). Race-motoren — spillets vigtigste søjle per ejer-prioritering — er derimod mekanisk tynd: én score-formel pr. etape, favoritter vinder 82-88 % (IRL ~35-40 %), hjælperarbejde er gratis, form er reelt død vægt. Spillet har i dag et troværdigt marked oven på et utroværdigt sportsresultat.
2. **Planerne der lukker kernegabet findes allerede og er gode** (race-v3 + træning/ungdom-spec, begge ejer-låste 11/7) — men de er **0 % implementeret**, inklusive salt-PR'en som ejeren besluttede skulle ske "omgående". Risikoen er ikke forkert retning; det er at eksekveringen fortrænges af småopgaver, som den er blevet det siden 5/7-MASTERPLANEN.
3. **Historik/palmarès findes ikke** — ingen palmarès-tabel, intet klubmuseum, HoF-siden læser en tom tabel. For et spil hvis kernefantasi er "følg ryttere over generationer" er det ilt der mangler. Det er samtidig det billigste store løft (data ligger i `race_results`; narrativ-spec'en er skrevet).
4. **Levebrød: omsætningen er 0 kr, og det skyldes én times ejer-arbejde, ikke manglende byggeri.** CZ Pro (checkout, entitlement, badge, /pro-side) blev merged 2/7; kun Alunta-plan + tokens + testkøb udestår — deadline 6/7 er overskredet. Samtidig skal regnestykket siges højt: 49 kr/md × 4-6 % konvertering betyder at første forretningsmilepæl (~14k DKK/md gross) kræver ~5-7.000 MAU. Vi har ~119. Spillet betaler ingen løn i 2026 uanset eksekvering; 2026-jobbet er at bevise retention og tænde de kompounderende vækst-loops, så 2027-28-matematikken kan indfries.
5. **Korteste vej (rækkefølgen i §4):** (1) beskyt race-v3-eksekveringen som ufravigeligt hovedspor, (2) palmarès + recap v2 som billigt parallelspor, (3) træning/ungdom-spec'en så udvikling og form får mening i løbene, (4) sæsonskiftet som ritual med op/nedrykning, (5) CZ Pro live + retention-måling nu. Og skær: lån-UI, swaps-flade, HoF, staff/facilitets-dybde, board-målstøj (§5).

## 1. Nøgletal (prod, 11/7)

| Metrik | Værdi | Kommentar |
|---|---|---|
| Registrerede brugere | **130** (+105/30d, +25/7d) | 42 → 96 → 130 på 15 dage; TdF-vinduet virker |
| Ugentligt aktive (WAU) | **75** (58 % af basen) | Meget høj andel for en beta |
| Rigtige hold (ikke-AI/test/frosne) | 120 | AI-fyld: 373 hold i alt |
| TdF-kohorte (siden 4/7) | 28 signups, **18 aktive sidste 3 dage** | Tidlig fastholdelse OK; D30 kendes først i august |
| Pre-TdF-kohorte aktiv/7d | 48 af 102 (47 %) | Reel WAU-retention på den gamle base |
| Rigtige auktionsbud /14d | **1.572** | Markedet er den beviste motor |
| Hold med manuelt trænings-klik /7d | 52 (~70 % af WAU) | Daglig-hook'et bruges |
| NPS | +50 (n=6) | For lille n; retning fin |
| Betalende / MRR | **0 / 0 kr** | CZ Pro bygget, ikke åbnet (#1903) |

Læsning: problemet er ikke kærlighed (engagement-dybden er usædvanlig), det er **volumen** (130 brugere) og **troværdighed i kernen** (racemotoren). Begge er løsbare; kun én af dem er en kodeopgave.

## 2. Benchmark-ramme: hvad "verdensklasse" konkret betyder

De bedste dynasty-sims vinder på fem ting — det er målestokken i §3:

1. **Emergent sandhed:** udfald kan spores til legible årsager (FM's kampmotor + analytiker-rapporter; OOTP's box scores + tekst-play-by-play). Vigtigt: **OOTP beviser at tekst + data er nok** — verdensklasse kræver ikke 3D. Det er CZ's rigtige ambitionsniveau.
2. **Tid der stakker:** sæsoner bliver til æraer — almanak, rekorder, palmarès, generationsskifte (OOTP's almanak er guldstandarden; FM's newgen-mytologi "wonderkids").
3. **Knaphed der gør ondt:** budgetter og trade-offs tvinger identitet (FM's lønstruktur; OOTP's kontrakter). Beslutninger uden opportunity cost er ikke beslutninger.
4. **Cykel-specifikt (PCM):** sæsonplanlægning omkring **form-peaks pr. rytter** + etaperoller/kraftforvaltning. PCM's svagheder (stagneret AI, elendig multiplayer, klodset UX) er præcis CZ's åbning.
5. **Forretningsmodellen (Hattrick):** gratis browser-multiplayer, 25+ år finansieret af valgfrit supporter-abonnement uden pay-to-win. Modellen er bevist; CZ Pro-spec'en følger den korrekt.

## 3. (a) Motor-for-motor: CZ vs. genrens bedste

Kort dom først, detaljer under:

| Motor | Genre-bar (bedste) | CZ i dag | Gab | Plan findes? |
|---|---|---|---|---|
| **Race** | FM/PCM: legible udfald, roller, form-timing, drama | Én score-formel; 82-88 % favorit-sejre; intet "hvorfor" | **Stort — DEN kritiske** | Ja, v3-spec låst, 0 % bygget |
| **Træning** | FM/Hattrick: ægte trade-offs, synlig rejse | Mekanik shipped; vækst alders-domineret; valg er pseudo | Stort | Ja, spec låst, 0 % bygget |
| **Ungdom/akademi** | FM newgens + fog + mytologi | Fog + graduation shipped; ingen bue/influx | Mellem | Ja (samme spec) |
| **Marked/auktion** | FM forhandlings-drama; OOTP trade-AI | Live auktioner i særklasse; ingen AI-likviditet, ingen forhandling | **Lille — styrken** | Delvist (#1310, #1150) |
| **Økonomi/klub** | FM/OOTP: budget-identitet | Moden sink/source-disciplin; løn = formel | Lille-mellem | #1441 kører |
| **Historik/præsentation** | OOTP-almanak | Findes ikke (ingen palmarès-tabel) | **Stort — men billigt** | Ja, narrativ-spec, 0 % bygget |

### 3.1 Race-motoren — kernegabet

**Shipped (v2):** `finalScore = terrain + noise + form − fatigue + team + breakaway + finale` — ét deterministisk kald pr. etape (`backend/lib/raceSimulator.js`, 415 linjer). Ingen simulering over tid, ingen positionering, ingen vind, ingen styrt/DNF, ingen mellemsprints, ingen kraftforvaltning. Roller er pr. løb (ikke pr. etape), kun kaptajnen får team-boost — hjælpere koster intet og bidrager med alt, hvorfor 4+ ryttere fra samme hold ender i top-10 i 25 % af løbene (IRL: nærmest aldrig). Form-vægten er 0.012 — reelt usynlig — så spillerens vigtigste cykel-manager-våben (form-timing) eksisterer ikke. Score-dekomponeringen `{terrain, noise, form, fatigue, team, breakaway, finale}` beregnes men smides væk (in-memory; kun to udbruds-booleans persisteres) — motoren ved hvorfor, men fortæller det aldrig.

**Mod genre-bar:** FM sælger fantasien "min taktik gjorde det der" via highlights og forklaringer; PCM sælger etape-dramaet via kraft/positionering; OOTP sælger troværdige box scores. CZ leverer i dag en resultatliste hvor det på forhånd stærkeste hold næsten altid vinder — det er en regnearks-facitliste, ikke sport. Doktrinens eget princip ("No single solved spreadsheet answer") brydes af motoren selv.

**Det positive:** determinisme, idempotens, 49 test-filer og en stærk dry-run-harness (`simulateSeasonDryRun.js` + oracles) er et fundament de færreste indie-sims har. v3-spec'en (work-cost, dagsform/jour sans, styrt, peaks, per-etape-roller, why-rapport, story-tags, salt) rammer præcis de fem huller. **Manglen er ren eksekvering** — selv salt-PR'en (ejer-beslutning: "omgående") er ikke lavet, og `ENGINE_VERSION` står stadig på 1.

### 3.2 Træning — mekanik uden mening

**Shipped:** daglig træning m. assistent-sweep, fokus/intensitet/planer pr. rytter, ugerytme (#1895, 11/7), smart default (#1894), form/fatigue-system m. skadesrisiko, aldring/decline/retirement. Meget af overfladen er på plads og bruges (52 hold klikker træning ugentligt).

**Men modellen bag er forkert:** vækst er alders-domineret (growthFraction 0.35→0.10 efter alder), ikke afstand-til-loft-drevet → 19-20-årige føles dødfødte (#2262). Off-focus-multiplikatoren er 0.97 (≈ ingen straf) og slots er ubegrænsede → fokus-valget er et pseudo-valg uden opportunity cost (#1922), og kun signatur-stats flytter sig reelt (#1974). Form påvirker løb med ~nul (0.012) → hele form/fatigue-systemet er kosmetik i praksis. FM/Hattrick-baren er: hvert træningsvalg har en pris, og rejsen er synlig. Spec'en (gap-drevet vækst, fokus som budget, form 8-12 % i race, låst §11) fixer det som ét problem — igen: 0 % bygget, men harness-infrastrukturen (progressionSimHarness m.fl.) er klar, så det er rate-matematik + kalibrering, ikke greenfield.

### 3.3 Ungdom/akademi — usikkerheden er der, rejsen mangler

**Shipped og reelt godt:** potentiale-fog m. spejder-niveauer (bånd [12,8,5,3], rå potentiale server-skjult), talentspejder fase 1-3 i prod, intake-kuld m. 1-3 seriøse kandidater, 8-plads-akademi, tvungen graduation ved 22, ungdomsauktioner som sink. Det matcher FM's scouting-usikkerhed strukturelt.

**Gabet:** ingen generationsbue (16→U19→U23→senior er ikke synlig som rejse), ingen milestone-fortælling (debut, første sejr, gennembrud), ingen wonderkid-mytologi — og **ingen løbende rytter-influx** (#2064): retirement kører, men verden fødes ikke løbende, så puljen tørrer ud over sæsoner. FM's newgens er kulturbærende netop fordi generationsskiftet er verdens puls. Spec'en dækker det; prioritet efter trænings-faserne.

### 3.4 Marked/auktion — styrken, med to huller

**Shipped:** aktiv-tids-auktionsmodel (16-22/8-23 CET), anti-sniping der kun forlænger ved reelt førerskifte, fuld proxy-kaskade m. balance-gated worst-case-commitment, ungdomsauktioner, bank-garantisalg som sælger-gulv, transfer-tilbud + swaps + leje. Det er mere multiplayer-markedsmekanik end noget af benchmark-spillene har.

**Hul 1 — ingen AI-markedsaktør.** Doktrinen lover eksplicit "AI provides liquidity … while population is low", men AI-hold byder aldrig, sælger aldrig, giver aldrig tilbud, og AI-ejede ryttere kan ikke købes (lukket AI-økosystem siden 30/6). Værdimodellen fra #1101 (log-lineær, 26 ankre, r²=0.96) er velbygget og **forbrugerløs** — den er klar til at drive AI-bud i tynde auktioner. Ved 120 rigtige hold bærer menneskene likviditeten i primetime, men D4-nykommere og skæve tidspunkter er tynde.
**Hul 2 — ingen forhandling.** Løn = frossen formel (market_value × 0.067); ingen lønkrav, agenter, moral eller kontrakt-drama. FM's transfer-teater er halvdelen af spillet for mange; CZ har kun auktions-halvdelen (til gengæld ægte multiplayer).

### 3.5 Økonomi/klub — bedre end genren forventer, lad den hvile

Division-skaleret sponsor-base + performance-pulje + rigtige sponsorkontrakter i 3 varianter, upkeep-sinks, akademi-drift, gældslofter m. eskalerende håndhævelse, frikøbsgebyrer — og et money-supply-scorecard der granit-låser net-kurverne. Det er mere inflations-disciplin end de fleste live multiplayer-økonomier. Manglerne (lønforhandling, sponsor-mål med identitet, facilitets-dybde) er reelle men **ikke** det der afgør verdensklasse nu. Faciliteter/staff (Fase 3) er bygget og gated — flip den minimale version, og lad dybden ligge (§5).

### 3.6 Tværsøjlen: historik, forklarbarhed, præsentation

- **Ingen palmarès-tabel, intet klubmuseum, ingen sæson-almanak.** Karrierehistorik kan kun udledes ad hoc; team-attribution forvitrer allerede (#1993 team_name-snapshot mangler). OOTP's almanak er dét der gør 20 sæsoner meningsfulde; CZ smider sin historie væk mens den skabes. Narrativ-spec'en (recap v2, palmarès, verdenshistorik, feed) er skrevet og korrekt scoped (determinisme, ingen opdigtede events).
- **Forklarbarhed:** doktrinkravet "explainable simulation" er ubetjent i motoren (why-laget kommer først i v3 S6).
- **Præsentation:** RaceDetail er statiske tabeller + recap v1 (3-5 tørre sætninger). Fint substrat; recap v2 + palmarès er dér præsentationen skal løftes — ikke i replay/3D (doktrinen har korrekt parkeret det som research).

## 4. (b) Den korteste vej: 5 løft i rækkefølge

**Løft 1 — Race-v3-eksekvering som beskyttet hovedspor (nu → ~6 uger).**
Salt-PR → S0 harness/dominans-baseline → S1 work-cost (hjælpere koster) → S2 dagsform → S3 per-etape-roller (#2034) → S4 styrt → S5 peaks → S6 why-rapport. Alt bag `race_engine_v3_scoring`-flag med scorecard-gates (simulér-før-ship-reglen). **Flytter mest af alt:** dræber 82-88 %-dominansen (troværdighed), skaber fortælle-råstof (styrt, jour sans, ofret hjælper), og gør taktik + form til rigtige beslutninger. Uden dette er alle andre løft læbestift.
*Disciplin-forslag: minimum 2 af ugens Claude-sessioner er v3-slices indtil S3 er live; småopgaver må ikke fortrænge dem.*

**Løft 2 — Historik-fundamentet: palmarès + recap v2 (parallelt, billigt).**
Narrativ-spec S1 (palmarès/verdenshistorik) + S2 (recap v2 m. persisterede momenter). Berører andre filer end v3 → kan køre i parallelle worktree-sessions (sonnet-subagenter, Fable som arkitekt — ejerens 10/7-arbejdsform). Hver uges forsinkelse koster historik-kvalitet (attribution forvitrer). Dynasty-følelsen pr. investeret time er uslåelig her.

**Løft 3 — Træning/ungdom-spec'en fase 1-3 (efter v3 S2).**
Gap-drevet vækst + fokus-som-budget + form-race-vægt 8-12 %. Skal ligge EFTER v3 S2 fordi form-vægten deles med motoren (spec'erne koordinerer allerede). Flytter: den daglige hook får konsekvens, #2262/#1974/#1922 dør ved roden, og træningsvalg bliver synlige i søndagens løb — loopet "beslutning → løbsresultat → historie" lukker.

**Løft 4 — Sæsonskiftet som ritual (før næste sæsongrænse).**
Op/nedrykning live (#1152, afventer godkendelse) + sæson-recap/årbog pr. hold (genbrug narrativ-momenter) + ny-spiller-catch-up-tjek. Sæsoner der stakker er dynasty-spillets hjerteslag, og op/nedrykning er multiplayer-indsatsen der gør de sidste sæsonuger spændende for midterfeltet. (Bemærk: `SEASON_AUTO_TRANSITION_ENABLED=false` — skiftet er stadig manuelt; ritualet bør automatiseres med ejer-godkendt checkpoint.)

**Løft 5 — Kommerciel åbning + måling (denne uge, mest ejer-klik).**
CZ Pro live (Alunta-plan + tokens + testkøb — ~1 time) + retention-scorecard #135 (D1/D7/D30 pr. kohorte i admin) + attribution-verify (#2079/#2041). Ikke et spilkvalitets-løft, men visionen vægter levebrød eksplicit, og uden måling er GO/NO-GO på betalt marketing (#1279) og alle fremtidige argumenter gætværk.

*Bevidst IKKE i top 5:* AI-markedsaktør (vigtig, men markedet er den stærkeste motor — den kan vente til 6-mdr-båndet), lønforhandling, faciliteter-dybde, live-taktik, replay.

## 5. (c) Skær eller forenkl — udfordring af doktrinens liste + nye kandidater

Doktrinens "remove or reduce" — status og dom:

| Punkt | Status i dag | Dom |
|---|---|---|
| Login-streak-pres | Kolonne findes; UI væk (kun mock/types refererer) | ✅ Reelt fjernet — drop kolonnen ved lejlighed |
| Manager-XP som magt | Vises kun på HoF-siden; xp_log skriver stadig | **Fjern visning helt** sammen med HoF-udskiftning; behold data-kolonner |
| Nuværende Hall of Fame | Siden læser en tom tabel (0 rækker) + XP-leaderboard | **Fjern fra nav NU**; erstat med narrativ S1 verdenshistorik. En død flade i produktet er anti-verdensklasse |
| Swap-kompleksitet | Ejer-amendment beholdt swaps. Prod-data: **10 swap-tilbud i alt, nogensinde** | Data siger: ejer-beslutningen bør genbesøges. Anbefaling: behold backend, demotér UI til en handling på rytterprofilen, byg intet nyt. Genvurdér ved 500 brugere |
| For mange samtidige board-mål | 35.282 satisfaction-events for ~120 spillere; mål-støj kendt (#2022, #1240) | Forenkl ved #955-reworket: færre, klarere mål. Byg IKKE mere board-dybde før da |
| Detaljeret travel/staff/trænings-admin før kernen er sjov | Faciliteter/staff bygget, gated off; #2217/#2218 (staff-kontrakter, pension→staff) ligger som opfølgninger | **Hold linjen:** flip den nuværende minimale version (gate er grøn, UX-arbejdet er gjort), men FRYS al ny staff/empire-dybde indtil v3 + træningsfaserne er live. Doktrinen har ret her — koden var ved at løbe foran den |

Nye skære-kandidater (prod-evidens):

1. **Rytter-leje/lån-UI:** 2 aftaler nogensinde. #1994 foreslår allerede fjernelse — gør det. (Doktrinens udviklings-lån hører til en fremtidig junior/U23-verden.)
2. **"Min Aktivitet" som selvstændig side** (#976): fold ind i inbox/notifikationer. Én flade mindre at vedligeholde.
3. **Transfersidens 6 faner** (#58): 3 handlings-modes. Overvældelses-reduktion for nye spillere.
4. **#1712 (150 løbsdage/5 pr. dag-rekalibrering):** forbliver parkeret til ≥~300 rigtige managere. Kalender-tætheden er allerede høj for 120 mennesker fordelt på 4 divisioner.
5. **Død transfervindue-kode** (#1996): fjern — den kan vise "vindue lukket"-løgn.
6. **Research-spanden respekteres:** ingen live-taktik, ingen alliancer, ingen replay/broadcast-ambitioner, ingen ny 5. motor før de 4 er bevist. OOTP-lektien igen: tekst + data + historik ER verdensklasse i denne genre.

## 6. (d) Levebrød uden at bryde fairness-doktrinen

**Rammen ligger fast og er rigtig** (CZ Pro-spec + doktrin): penge køber kosmetik, status, analyse-dybde, komfort og automation-bekvemmelighed — aldrig sportslig fordel, aldrig eksklusiv information, aldrig auktions-magt. Hattrick beviser modellen i 25+ år. Annoncer er ejer-afvist (korrekt: brand-skade + ussel CPM ved denne skala).

**Vektorer i rækkefølge (v1 → senere):**

1. **CZ Pro v1 (bygget, 49 kr/md / 265 kr/6 md):** Founder-badge, kit/logo-designer, Pro-analytics (rigere visning af data alle har), komfort (watchlist-pladser, gemte filtre, eksport), early access + roadmap-stemme. **Eneste blokering er ejer-klik i Alunta.**
2. **Pro Analyst-lag (Fase 2, ~89 kr):** udviklings-grafer, sæson-sammenligninger, scouting-DASHBOARDS (præsentation af samme fog-data — præcisionen røres aldrig, jf. #1791-grænsen), CSV/API-eksport. Passer et data-tungt publikum som cykel-nørder faktisk er.
3. **Årsplan (490 kr)** når fornyelses-data findes (Fase 2, trivielt i Alunta).
4. **Private ligaer** (senere, stærkeste nye vektor): en klub/vennegruppe betaler for at oprette egen liga/division med custom settings; deltagelse gratis. Separat konkurrencerum → ingen fairness-konflikt. Hattrick/kick-off-genren har tjent på det i årtier.
5. **Kosmetik-dybde:** trøje-/kit-designer er allerede v1; senere sæson-kits, klubmuseums-udsmykning, profilrammer fra achievements (doktrinen tillader eksplicit kosmetiske titler/rammer).
6. **Årbog/recap-eksport:** "din sæson som delbar side/PDF" — kosmetik + marketing i ét (delbare artefakter er også et akkvisitions-loop).

**Matematikken (ærlig version):** Første milepæl 14k DKK/md gross (BUSINESS_STRATEGY §4) = ~285 betalende ved 49 kr eller ~200 ved 69 kr blended. Ved 4-6 % konvertering kræver det ~5-7.000 MAU — vi har ~119. Netto er 50-65 % af gross (moms, fees, infra, regnskab) — og reelt lavere når AI-tooling-omkostninger regnes med (antagelse, ikke målt: AI-abonnementer er i dag den største faste driftspost). Konklusioner:
- **Monetiserings-featuren der flytter mest i 2026 er ikke en feature — det er D30-retention + akkvisition.** Ved 4 % konvertering er 1 procentpoint bedre D30 mere værd end noget nyt Pro-perk.
- Kompounderende kanaler frem for betalte: SEO ("cycling manager game"-nichen i browser er reelt svag — PCM er desktop, ingen stærk browser-konkurrent), sæson-beats (Vuelta aug-sep, forårsklassikere, TdF-årsdag), referral (#1173), delbare recap/OG-billeder (#1299), creator-program. Betalt (ejer-ramme: 10k DKK juli, maks 25-50k 2026) kun mens attribution beviser effekt (#1279-gaten).
- **Sig det højt:** spillet betaler ingen løn i 2026. Realistisk 12-mdr-mål er 150-300 betalende (~7-15k DKK/md gross) HVIS retention holder og loops tændes. Fuldt levebrød (25-35k) er en 2028-horisont ved organisk niche-vækst. Det er ikke pessimisme — det er Hattrick-kurven, og den kræver at produktet bliver verdensklasse FØRST. Kvalitet og levebrød er ikke i konflikt: retention ER begge dele.

## 7. (e) 3/6/12-måneders bue

**0-3 mdr (jul → medio okt) — "Troværdighed + åben kasse"**
- Uge 1: CZ Pro live (ejer: Alunta ~1 time + testkøb) · salt-PR · v3 S0 (harness + dominans-baseline) · #135 retention-scorecard minimal.
- Uge 2-6: v3 S1-S3 bag flag m. scorecard-gates · narrativ S1 palmarès + S2 recap v2 i parallelle worktrees · Founder-tilbud til de første ~130 (status-hook).
- Uge 6-12: v3 S4-S6 · træning/ungdom fase 1-2 · sæsonskifte-ritual + op/nedrykning #1152 · Vuelta-beat (aug-sep) + referral #1173 + delbare recaps.
- **Gates (målbart):** favorit-vinderrate i 45-60 %-båndet · 4+ samme-hold-top-10 < 5 % · D30 ≥ 25 % målt pr. kohorte · 300-500 registrerede · 15-40 betalende (1-2k DKK MRR) · 0 P0-incidents ved sæsonskifte.

**3-6 mdr (okt → medio jan) — "Dybde + generation"**
- Træning/ungdom fase 3-6 (form 8-12 % i race, generationsbue, ongoing influx #2064, pensions-transparens).
- AI-markedsaktør v1: AI-bud i tynde auktioner drevet af værdimodellen (doktrin-løftet om likviditet indfries) — gated af likviditets-måling, ikke bygget i blinde.
- Kontrakt-liv v1 (#1150/#1310-rest): udløb, fornyelses-beslutninger, fri-agent-oprydning. Forhandlings-drama venter.
- Pro Analyst-tier + årsplan · private ligaer beta · vinter/transfer-vindue-beat.
- **Gates:** 800-1.500 registrerede · 250-450 WAU · 50-100 betalende (2,5-5k DKK MRR) · D30 ≥ 30 % · trænings-NPS-tema forsvinder fra Discord-klager.

**6-12 mdr (jan → jul 2027, TdF-årsdagen) — "Æra + skala"**
- Verdenshistorik/klubmuseum fuldt (narrativ S3-S4) · rytterpersonlighed light (#1154: rolleønsker, utilfredshed — beslutninger, ikke dialog-sim) · landshold/mesterskaber (#934) som event-beat.
- SEO-compounding + creator-program + 3. sprog hvis survey siger det · PWA/mobil-polish (ingen native rewrite — bekræftet arkitektur-beslutning).
- Skalerings-tærskler efter behov (#330 cron-udskillelse >100 aktive, Supabase Pro, #331 loadtest før kampagne-spikes).
- TdF 2027 som "år 1"-kampagne med et spil der nu HAR troværdige løb, historik og generationer.
- **Gates:** 3-6.000 registrerede · 1-2.000 MAU · 150-300 betalende (7-15k DKK/md gross) · ApS/MoR-beslutning truffet · churn < 8 %/md på betalende.

Buen maksimerer begge visionsben i rækkefølgen: kvalitet (mdr 0-6 er næsten ren produkt-dybde) → levebrød (mdr 6-12 høster den via loops der allerede er tændt). At bytte om — vækst-push før troværdig kerne — brænder TdF/Vuelta-kohorterne af på et spil hvor favoritten vinder 85 % af løbene.

## 8. Det der er forkert i prioriteringen i dag (direkte)

1. **CZ Pro-stallet er den dyreste ikke-beslutning i firmaet.** Bygget 2/7, ejer-deadline 6/7, stadig 0 kr 11/7. En time i Alunta står mellem projektet og dets første omsætnings-datapunkt. Alt andet i dette memo er sværere end det her.
2. **MASTERPLAN'ens kø er overhalet af 11/7-spec'erne og bør skrives om.** Punkt 11 (#2034) er nu v3 S3; punkt 12 (#1922) og 13 (#932/#2064) er træning/ungdom-spec'en; efterårs-punkt 18 (#1021/#1176) ER v3. At holde dem som separate kø-punkter inviterer til dobbeltarbejde og forkert rækkefølge. Anbefalet ny kø: (1) v3-slices, (2) narrativ S1-S2, (3) træning/ungdom-faser, (4) sæsonritual/#1152 — plus det stående stabilitetsspor uændret.
3. **Småopgave-tyngdekraften er reel.** Siden 5/7 er der shippet ~15 gode UX/QoL-PR'er — og 0 % af de to motor-specs der afgør verdensklasse. Hver enkelt var fornuftig; summen er en uge uden fremdrift på det vigtigste. Arbejdsformen (Fable som arkitekt, sonnet-workers i worktrees) er svaret: kør QoL-strømmen som sideløbende subagent-arbejde, aldrig som hovedsporet.
4. **Retention-måling (#135) ligger i "1 md"-spanden men gater beslutninger NU** — GO/NO-GO betalt marketing (#1279) var sat til i dag, og Clarity-målingen er kendt upålidelig (#2041). Uden D7/D30 pr. kohorte flyver både marketing- og monetiserings-beslutninger i blinde.
5. **Facilitets-sporet var ved at løbe foran doktrinen.** Gate-arbejdet og klub-UX'en er godt håndværk, men staff-kontrakter/pension-dybde (#2217/#2218) hører til EFTER at kernemotorerne er troværdige. Doktrinens egen regel ("detailed operational capacity ships last") skal håndhæves mod backloggen.
6. **Ejer-verify-køen vokser** (NOW.md lister 8+ punkter). Hver uverificeret feature er skjult risiko og blokeret lukning. Forslag: fast 20-minutters ejer-verify-ritual 2× ugentligt, dagsorden genereret af Claude.

## 9. Ejer-beslutninger (én batch, A/B + anbefaling)

| # | Beslutning | A | B | Anbefaling |
|---|---|---|---|---|
| 1 | CZ Pro go-live | Alunta-setup + testkøb denne uge → åbn for de 130 | Vent til efter v3 S1-S3 | **A** — læring + første kroner; Founder-vinduet er nu, mens basen er varm |
| 2 | MASTERPLAN-omskrivning | Omskriv køen til spec-sporene (jf. §8.2) | Behold nuværende kø, spec-arbejde presses ind ad hoc | **A** — ellers vinder småopgave-tyngdekraften igen |
| 3 | Session-disciplin | ≥2 ugentlige sessions reserveret v3-slices indtil S3 live | Fri prioritering session-for-session | **A** — 0 % efter 0 dage er fint; 0 % efter 14 dage er et mønster |
| 4 | Narrativ-slices | Commit S1 palmarès + S2 recap v2 som parallelspor nu | Vent på "ejer vælger slices" senere | **A** — billigst pr. dynasty-værdi; historik-data forvitrer imens |
| 5 | Swaps | Demotér UI (rytterprofil-handling), frys videre arbejde, genvurdér ved 500 brugere | Behold fuld flade som i dag | **A** — 10 tilbud nogensinde; amendment-beslutningen fortjener data-genbesøg |
| 6 | HoF + lån-UI | Fjern HoF fra nav + fjern leje/lån-UI nu (#1994) | Lad dem stå til reworks lander | **A** — døde flader koster troværdighed hver dag de vises |
| 7 | Staff/empire-dybde | Frys #2217/#2218 til efter v3 + træningsfaser | Fortsæt som planlagte opfølgninger | **A** — doktrinens egen sekvens-regel |

---

*Metode-note: kode-tilstande er verificeret ved læsning af `backend/lib` 11/7 (raceSimulator/raceRunner/dailyTraining/riderProgression/academy*/auction*/economy*-familierne + tests/harnesses); prod-tal via Supabase samme dag; alle issue-referencer slået op i NOW/MASTERPLAN/dashboard. Hvor noget er antagelse (fx AI-tooling-omkostninger) står det eksplicit.*
