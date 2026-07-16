# Træning & ungdom — verdensklasse-addendum: tre-tier klubstruktur + 12 satsninger

> Status: ejer-beslutninger låst 2026-07-16 (§2); spec afventer ejer-review af §7-parametre.
> **Addendum til** [`2026-07-11-training-youth-depth-design.md`](2026-07-11-training-youth-depth-design.md) — erstatter den IKKE. Motor-fundamentet (gap-drevet vækst, fokus = ægte budget, 3 lag casual→nørd, scorecard A/B, §11-beslutningerne) består uændret. Dette dokument tilføjer: målbilledet (tre-tier klubstruktur), 12 satsninger oven på motoren, og en revideret faseplan.
> Grundlag: multi-agent kortlægning 16/7 (kode + issues + øvrige specs) + benchmark (FM, OOTP, Hattrick/Trophy Manager, PCM) + 30-idé-katalog → syntese. Ingen prod-mutation i denne spec; alt balancefølsomt går gennem sim + scorecard + ejer-gate.

---

## 0. Kerneindsigten fra benchmarken

To strukturelle muligheder ingen konkurrent har taget, og som CyclingZone kan:

1. **Ingen i genren fortæller udviklingshistorien tilbage til spilleren.** FM's karrierehistorik er en flad tabel; Hattrick har ingen narrativ; PCM glemmer alt. Tilknytning opstår i alle spillene via talenter man har fulgt i årevis — men intet spil giver dig et sted at *se* rejsen.
2. **Ingen har en delt talentpulje mellem menneskelige managere.** FM's intake er privat pr. klub. CyclingZones ungdomsauktion betyder at "talentet du afviste" spiller *videre hos rivalen* — regret og stolthed på tværs af spillere er retention-guld i et lille community.

Verdensklasse = motor-korrekthed (11/7-specen) **+ hukommelse/fortælling + delt talent-mytologi + en rigtig ungdomsscene** (tre-tier, §1).

---

## 1. Målbilledet: tre-tier klubstruktur (ejer-låst 16/7)

Ejer (16/7): *"Jeg vil gerne have, at spillet kommer til at have: Senior løb, U23 løb og Junior løb. Ligesom i virkeligheden. Hvor hvert hold har et akademi med nye årgange der løbende kommer ind. Du skal altså have et Senior hold, U23 hold og et junior hold. Vi kan lige så godt få det planlagt nu, sådan at features til fremtiden passer bedre ind i spillet."*

Dette **ophæver** 11/7-specens §5.4-gate (og #958's evidens-gate): separate ungdomshold + kalendere er ikke længere "måske, hvis data viser brug" — det er målbilledet. Det bygges stadig i slices (U23 før Junior, §4), men **alle slices fra Fase 0 og frem designes mod denne struktur**, så intet skal bygges om senere.

### 1.1 Strukturen

```
Junior-hold (16-18)  →  U23-hold (19-22)  →  Senior-hold (23+)
   Junior-løb              U23-løb               Senior-løb
        ↑ sæsonligt intake (nye årgange, hvert år)
```

- **En rytter tilhører ét tier ad gangen.** Reglen "1 rytter = 1 løb pr. løbsdag" gælder uændret; kalender-overlap-designet røres ikke (begge ejer-låst).
- **Tier-overgange er ritualer, ikke tavse DB-transitions** (§3, "Graduation Day" generaliseres til begge overgange: Junior→U23 og U23→Senior).
- **To-vejs flyt** (#932): en U23-rytter kan køre senior-løb ved oprykning, og en ung senior kan sendes ned i beskyttet udvikling. Flyt = tier-skifte, samme mekanik begge steder.
- **Ungdomsauktionen består som markedet mellem klubber** (#2456-scope uændret: ingen fri-agent-butik, usolgt = slettet). Auktionen bliver naturligt tier-mærket (junior-/U23-ryttere).
- **AI-hold skal også have Junior/U23-rosters** — tynde felter fyldes med AI (ejer-låst princip). Det kobler tre-tier direkte til influx-arbejdet (#2064): AI-ungdomsgenerering er samme maskine som verdens fornyelse.
- **#2454-kontrakten** (15/7) er potentiale-visningen i alle tiers: eksakt 1-99 i databasen (forlader aldrig serveren, #1162), spilleren ser kun talentspejderens interval — som må være både upræcist og *forskudt* (sandt 77 → "75-85" eller "71-77" er legitime), deterministisk pr. observation.

### 1.2 Hvad det amenderer i eksisterende låste dokumenter

| Låst regel | Amendering | Hvorfor OK |
|---|---|---|
| 11/7-spec §5.4: U23-kalendere gated bag evidens | Ophævet — planlagt nu, bygget i slices | Eksplicit ejer-beslutning 16/7 |
| 11/7-spec §6: akademi-caps (8 pladser) uændret | Caps bliver **pr. tier** (§7-parameter); drift-sink-*princippet* består | Tre-tier kræver det; økonomi-sim gates det |
| "Intake-DNA-bias rører kun nation, ikke type" | Akademi-filosofi (beslutning 1) må farve type-profil | Eksplicit ejer-go 16/7; fairness-sim obligatorisk (§5 C4) |

---

## 2. Ejer-beslutninger 16/7 (låst)

| # | Spørgsmål | Beslutning |
|---|---|---|
| 1 | Akademi-filosofi (Klub-DNA 2.0) | **JA, valgbar filosofi** (skoler med hårde trade-offs; skift = cooldown + omstillings-malus). Amenderer type-bias-reglen. Emergent aftryk kan lægges ovenpå senere som lag 2 |
| 2 | Potentiale-skala | Afgjort 15/7 på #2454: **eksakt 1-99 i DB, spilleren ser kun scout-interval** (upræcist + forskydning tilladt, aldrig håbløst forkert, stabilt pr. observation) |
| 3 | U23/Junior-løb | **Fuld tre-tier planlægges NU** (§1). #958-gaten ophævet. Byggerækkefølge: U23 (Fase 5) → Junior (Fase 6) |
| 4 | Udviklings-royalties | **Parkeret** — ingen penge-mekanik nu. Kun det gratis `developed_by_team_id`-datastempel + alumni-visning (krøniken/Graduation Day skal alligevel bruge det) |
| 5 | Træningslejre | **Venter på facilitets-sporet** (#1441), jf. 11/7-spec §10. Ingen event-form i mellemtiden |
| 6 | Årgangs-kvalitetsvariation | **JA** — seeded ±10 % pr. årgang, ens for alle klubber, transparent kommunikeret i UI ("en stærk årgang i år"). Sim-gate mod kompounding |

---

## 3. De 12 satsninger

Motor-numrene (M1-M4) er 11/7-specens faser gjort færdige; resten er nye lag ovenpå.

### A. Motoren (= 11/7-specen eksekveret)

**M1 · Gap-drevet vækst + fokus som ægte budget** *(L; = spec Fase 1-2)*
Afstand-til-loft driver væksten, alder modulerer kun mildt; fokus flytter reelt budget (off-focus ~0, ikke ×0,97). Løser #2262 ("19-20-årige dødfødte"), #1974 ("kun nogle stats stiger"), #1922 ("fokus er ligegyldigt") i ét hug. **Interim-fixet rate/3 (#2437) SKAL fjernes af denne fase** — det må ikke overleve som de facto-løsning. Forudsætning: 11/7-specens §3.2 (sæson-loft) er ejer-afvist 15/7 og omskrives til daglig-strøm-model (forliget med kernesystemer §5.1) som del af Fase 1-spec'en.

**M2 · Gennembruds-vinduer & stagnations-diagnoser** *(M; implementerer kernesystemer §5.3)*
De sjældne store hop/skuffelses-sæsoner opgraderes fra lodtrækning til beslutning: synlig årsag ("svarer usædvanligt godt på bjergblokken") + handlingsvindue. Casual-gulv: halv høst passivt. Direkte modsvar på FM-kritikkens kerne (uklar årsag-virkning). Gate: må ikke dobbelt-tælle mod potentiale-raten; hop respekterer absolut loft (#2472-model).

**M3 · Projekt-ryttere** *(M-L; indfrier #931 lag 1, ejer-godkendt 8/6)*
Maks 3 ryttere med navngiven flersæsons-udviklingsplan + commitment + opfølgning. Koncentreret dybde uden truppbred micromanagement; casual lader slots stå tomme uden tab. Netto-neutral vækst (anden *form*, ikke mere output) = fair-premium.

**M4 · Sæsonkortet + træningsblokke (Lag 2)** *(XL; = spec Fase 3 gjort verdensklasse)*
Én mobil-first planlægningsflade: sæsonens løb + base/byg/peak/restitution-blokke + forenklet form/belastnings-gauge. IKKE fuld CTL/ATL/TSB (spec §10 står). Gør den låste form-vægt (+8-12 % i løb, §11-beslutning 2) spilbar: nørden vinder på timing, aldrig råstyrke. Ejer tester på preview FØR ship.

### B. Hukommelsen (akademiet som følelsesmotor)

**H1 · Rytter-krøniken** *(L)*
Auto-genereret livshistorie pr. rytter: opdaget, gennembrud, tier-overgange, første sejr, peak, pension. Event-sourcing (`rider_career_events`) af ting motoren allerede gør — deler infrastruktur med narrativ-sporet (#1997 palmarès, #2356 recap), bygges én gang. Indeholder `developed_by`-datastemplet (beslutning 4). Kvalitetskrav: templates med smag (anti-AI-slop), fog-gate på al tekst ("nåede sit loft" er forbudt sprog).

**H2 · Graduation Day → tier-overgangs-ritualet** *(M)*
Sæsonens iscenesatte dag hvor årgangen skifter tier: trænerens vurdering, promovér/sælg/slip-beslutninger, krønike-øjeblikke. Genbruger `detectGraduates`/`resolveGraduation`; generaliseres til begge overgange (Junior→U23, U23→Senior). Cykel-autentisk (neo-pro-øjeblikket). Afklar audit-edge-case E2 (pending graduates trænes som senior) i samme slice.

**H3 · Udviklings-momentet** *(S; quick win)*
Dagligt check-in viser ÉN kurateret historie fra gårsdagens træning i stedet for rå tal-liste. Al data findes i `trainingReport.js`. Billigste følelse pr. udviklingstime; beviser narrativ-retningen før de store investeringer. Koordineres med #2446-layoutfix. Senere: ugentligt "trænerens ugebrev" på samme template-infrastruktur.

### C. Verden og markedet (den delte talentpulje som våben)

**V1 · Årgangs-cyklussen** *(L)*
Hvert intake-kuld = navngiven generation ("Klassen af sæson 3") med tværgående leaderboard (kun *realiseret* udvikling, aldrig potentiale), "Årgangens rytter"-award og regret-mekanik (afvist kandidat vinder hos rivalen → dit feed). Med beslutning 6: seeded ±10 % årgangs-kvalitet, transparent. Forudsætning: sæsonligt tilbagevendende intake (i dag reelt engangs-kuld pr. hold) — bygges med #2064-influx.

**V2 · Informations-derbyet** *(M)*
24 timers scout-vindue før hver ungdomsauktion: hvem du scouter, og hvornår, bliver et våben. Kobler auktionen (#2456, bevaret) og talentspejder-fog (#1543/#2454) uden nye systemer. Informations-asymmetri som færdighed, ikke køb — reneste udtryk for fair-premium. Senere XL-udvidelse: scouting-radar/delt talent-feed.

**V3 · Akademi-regnskabet** *(S; quick win)*
P&L-flade pr. akademi: drift + løn ind, salgssummer + værdiskabelse ud. Gør udvikl-og-sælg læsbart som strategi og bliver måle-instrumentet når ungdoms-økonomien senere tunes. Kun realiseret markedsværdi, aldrig projektion.

**V4 · Akademi-filosofi (Klub-DNA 2.0)** *(L; beslutning 1 = valgbar)*
Klubben vælger en træningsfilosofi/skole (fx bjerg, klassiker, sprint, allround, tidskørsel) der farver kuldenes type-profil over tid — to klubbers akademier skal føles forskellige. Skift = 1 sæsons cooldown + omstillings-malus. Fairness-gate: samme forventede kuld-*værdi* på tværs af skoler (kun profilen flyttes), kalender-vægtet meta-check mod dominant skole.

### D. Strukturen

**S1 · Tre-tier klubstruktur** *(XL; §1 — paraplyen alt andet bygger mod)*
Datamodel (tier-felt, årgangs-tag, tier-flyt) i Fase 4; U23-hold + U23-kalender v1 i Fase 5; Junior-tier i Fase 6. Youth-løb simuleres af samme race-motor med letvægts-præsentation: auto-udtagelse default (Lag 0), manuel opt-in, resultater føder krønike + årgangs-side. Youth-løb v1 = prestige + udvikling, ingen/minimale præmier (ingen ny guld-kilde uden økonomi-sim).

---

## 4. Revideret faseplan

Ændrer IKKE MASTERPLANs rækkefølge — fylder punkt 11 og 13 ud og skyder små sidestrøms-slices ind nu. Kun Fase 0 kører før v3-sporet er færdigt, og kun som sidestrøm (session-disciplinen består). Hver fase = egne PR'er + sim/scorecard-gates; ingen fase un-gater sig selv.

| Fase | Hvornår | Indhold | Gates |
|---|---|---|---|
| **0 · Quick wins** (sidestrøm) | uge 30-31 | §3.2-omskrivning i 11/7-specen (docs) · #2456-kodeoprydning (fri-agent-butik væk, usolgt=slet — koden er stadig urørt) · V3 akademi-regnskab · H3 udviklings-moment (+#2446) · #2472 rebases + sim-genkøres → ejer merger | Læse-flader + docs; fog-gate på tekst; #2472: careerCurveSimulation på kombineret tilstand |
| **1 · Motoren** (hovedspor efter v3 S4) | aug | M1: gap-drevet + fokus=budget; rate/3 fjernes; #2082-nerf foldes ind; help/FAQ-oprydning | Scorecard A + B1/B2 mod prod-klon, cross-seed + sæsonlængde-sweep (28/60/90/120); ejer-review før merge |
| **2 · Beslutningslaget** | aug-sep | M2 gennembruds-vinduer · M3 projekt-ryttere · H1 krønike-events begynder at logges (koord. #1997/#2356) · **#2454-migrationen** (1-6 → 1-99 + estimat-generator; bundlet, ejer merger) | Ingen dobbelt-tælling mod potentiale-rate; #1162-inverterbarhedsgate på estimat-generator; sim på plan-adhærens |
| **3 · Form + Sæsonkortet** (koord. v3 S5 #2354) | sep | M4: form-vægt +8-12 % i løb (konstanter udledes empirisk) + Lag 2-fladen mobil-first | Scorecard B3/B4/B5 + resultat-stabilitet; evne dominerer altid; form synlig FØR løb; ejer tester på preview |
| **4 · Buen + tier-fundament** | sep-okt | Spec Fase 4 (motor-reconciliation + pension-transparens) · H2 Graduation/tier-ritual v1 · `developed_by`-stempel + alumni-visning · **tier-datamodel** (tier-felt, årgangs-tag, to-vejs flyt #932) · instrumentering (§7.3) live | A5 (unified peak 27-28), idempotens, ingen double-dip; E2-gråzone afklares m. ejer; fog-gate på trænervurdering |
| **5 · Verden** | okt-nov | #2064-influx + sæsonligt intake → V1 årgangs-cyklus · **S1: U23-hold + U23-kalender v1** (1-2 løb/uge, auto-udtagelse, AI-fill) · V2 informations-derby · V4 akademi-filosofi v1 | Scorecard C (§5): 12-sæsoners pool-sim, felt-sim, økonomi-neutralitet, fairness-sim, inverterbarhed. Ét delspor ad gangen |
| **6 · Fuld tre-tier + vision** | dec+ | S1: Junior-hold + Junior-kalender → fuld tre-tier · wonderkid-mytologi (kræver nyhedsfeed) · scouting-radar · klubmuseum (narrativ S3-S4) · mentor-bånd (m. #1154) · talent-børs (efter AI-markedsaktør) | Genbesøges mod da-aktuel population + instrumenterings-evidens; intet startes før Fase 5 er FÆRDIG |

---

## 5. Nye scorecard-gates (Scorecard C — ud over 11/7-specens A/B)

| # | Metrik | Mål/gate |
|---|---|---|
| C1 | **Felt-størrelse youth-løb.** Hvert U23-/Junior-løb har et køreligt felt via AI-fill | Min-felt opfyldt i 100 % af simulerede løbsdage ved nuværende population |
| C2 | **Pool-stabilitet.** Population + alders-fordeling over 12 sæsoner (influx ≈ pensions-churn) | Stabil; ingen udtørring eller eksplosion (fra 11/7 §5.3) |
| C3 | **Økonomi-neutralitet.** Tier-drift + youth-løb tilføjer ingen ny guld-KILDE; sinks bevarer division-balancen | Δ lønbyrde/division ≤ tolerance; ingen auto-eskalerende feedback |
| C4 | **Filosofi-fairness (#1142).** Forventet kuld-værdi ens på tværs af skoler; ingen skole dominant på kalender-vægtet race-EV | Værdi-Δ ≈ 0; max-skole-andel ≤ 60 % af parcours-typer |
| C5 | **Årgangs-variation.** ±10 % seeded, identisk for alle klubber samme sæson, ingen kompounding over generationer | Verificeret i 12-sæsoners sim; UI kommunikerer variationen eksplicit |
| C6 | **Inverterbarhed (#1162).** Scout-estimater (interval + forskydning), konsensus-/årgangs-bånd | Består `potentialeHiding`-gaten; estimat stabilt pr. observation (ingen reroll-til-facit) |
| C7 | **Casual-gulv.** Auto-udtagelse: 0 ekstra obligatoriske klik fra tre-tier; D7/D30 for ren casual-kohorte | Falder ikke (11/7 §9.3 udvidet til tiers) |

---

## 6. Bevidst parkeret (med årsag)

- **Royalty-payouts** (beslutning 4): ingen penge-mekanik; genbesøg tidligst efter Fase 5-økonomidata.
- **Talent-børs & lejesystem:** markedslikviditet for tynd ved nuværende population; lånekode netop ryddet op (#1994). Efter AI-markedsaktør (MASTERPLAN punkt 14) + population.
- **Mentor-bånd:** endnu en multiplikator oven på en netop re-kalibreret motor (#1938→#2262-pendulet); genbesøg med #1154 (personlighed) efter Fase 1-3.
- **Træningslejre** (beslutning 5): facilities-sporet (#1441).
- **Fuld CTL/ATL/TSB-fysiologimodel:** forenklet gauge er nok (11/7 §10 står).
- **Empirisk trænbarhed som separat system:** potentiale-raten ER allerede den skjulte respons-profil; et ekstra skjult lag dobbelt-tæller og øger inverterbarhedsrisiko.
- **Akademi-omdømme:** badge uden scene indtil alumni + derby er live.
- **Staff-dybde (#2217/#2218):** forbliver frosset per MASTERPLAN; mentor/alumni-til-træner må kun spec'es, ikke bygges.

---

## 7. Åbne parametre til ejer-review (forslag — ejer nikker eller retter)

1. **Aldersbånd:** Junior 16-18 · U23 19-22 · Senior 23+. Tidlig oprykning muligt fra 21 (wonderkid-undtagelse: ejer-beslutning i U23-slicen).
2. **Trupstørrelser/caps pr. tier + drift pr. plads:** afgøres i U23-slice-spec via økonomi-sim (erstatter den flade 8-plads-cap; drift-sink-princippet består).
3. **Youth-løbsfrekvens v1:** U23 1-2 løb/uge · Junior 1 løb/uge (Fase 6).
4. **Auto-udtagelse default på** (Lag 0); manuel udtagelse opt-in. Ingen taktik-cockpit for youth-løb i v1.
5. **Youth-løb giver prestige + udvikling, ikke præmier** i v1 (ingen ny guld-kilde uden sim).
6. **Filosofi-skoler v1:** 5 skoler (bjerg/klassiker/sprint/allround/TT); skift = 1 sæsons cooldown + omstillings-malus på igangværende kuld.

---

## Referencer

- Fundament: [`2026-07-11-training-youth-depth-design.md`](2026-07-11-training-youth-depth-design.md) (motor, scorecards A/B, §11-beslutninger)
- Doktrin: [`2026-06-08-living-world-product-doctrine-design.md`](2026-06-08-living-world-product-doctrine-design.md) · Kernesystemer §5: [`2026-06-11-kernesystemer-design.md`](2026-06-11-kernesystemer-design.md)
- Potentiale-kontrakt: #2454 (ejer-kommentar 15/7) · talentspejder: [`2026-07-07-talentspejder-design.md`](2026-07-07-talentspejder-design.md)
- Issues: #931 #932 #958 #1145 #1922 #2262 #1974 #2064 #2437 #2454 #2456 #1543 #1162 #1142 #2446 #2472
- Rækkefølge-SSOT: [`../../MASTERPLAN.md`](../../MASTERPLAN.md) (punkt 11 + 13 fyldes ud af §4)
