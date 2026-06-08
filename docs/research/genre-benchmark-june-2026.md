# Genre-benchmark — Cycling Zone vs. virkelig cykelsport & cykel-manager-genren

> Etableret 2026-06-08. Deep-research-harness (Claude Code): 5 søge-vinkler · 20 kilder hentet · 93 påstande udtrukket · 25 fact-checket adversarielt (17 bekræftet, 8 afkræftet). Kun bekræftede påstande er brugt nedenfor; afkræftede er listet eksplicit under "Afkræftet — brug ikke".
> Refs [#1102](https://github.com/NicolaiDolmer/CyclingZone/issues/1102) (race-motor/mål), [#1136](https://github.com/NicolaiDolmer/CyclingZone/issues/1136) (progression), [#669](https://github.com/NicolaiDolmer/CyclingZone/issues/669) (population), [#1101](https://github.com/NicolaiDolmer/CyclingZone/issues/1101) (værdi), [#49](https://github.com/NicolaiDolmer/CyclingZone/issues/49) (typer), [#1021](https://github.com/NicolaiDolmer/CyclingZone/issues/1021) (fuld motor).

Evidens-skala brugt gennemgående: 🟢 **stærk** (peer-reviewed / primær kilde / 3-0 verifikation) · 🟡 **medium** (secondary kilde / 2-1) · ⚪ **skøn** (ingen ekstern data fundet).

## TL;DR

1. **Dine vinder-mål er stort set rigtige — motoren rammer dem bare ikke endnu.** Flat (62%), itt (50%), cobbles (61%) og hilly (19%) ligger alle langt under mål. Vejen er at *skærpe* vægtene/sænke støjen, ikke at sænke målene. Cobbles ≥90% er det eneste mål forskningen antyder kunne være for højt.
2. **Bjerg-bucket'en (≥85%) er kun realistisk fordi baroudeur tæller med** — udbrud vinder 40%+ af bjergetaperne i virkeligheden. Verificér at baroudeurer reelt vinder en andel af jeres 91%, ellers er motoren for deterministisk på "favoritten vinder".
3. **Lead-out-typen er pt. mekanisk død** (`teamComponent` returnerer 0). Den giver kun mening hvis motoren modellerer lead-out-tog.
4. **Jeres progressions-arkitektur (caps + abilities) er allerede Football Managers CA/PA-model.** Tre evidensbaserede kalibreringer venter: sænk peak-alder ~1-2 år + tænd type-variation, hold decline blødt, skjul youth-potentiale.
5. **Light "weighted-sum + noise"-motoren er genre-standard** — PCM brugte præcis den tilgang i 10+ år. De tre forbedringer forskningen peger på (lead-out, dagsform, udmattelse) er præcis de tre tomme seams der allerede står i `raceSimulator.js`.

---

## Akse 1 — Vinder-fordeling & determinisme

### Mål vs. motor vs. virkelighed

| Terræn → type | Ejer-mål | Motor-baseline | Virkelighed/genre | Evidens | Dom |
|---|---|---|---|---|---|
| Flat → sprinter | ≥90% | 62% | ~98% peloton, breakaway ~2% (1-in-200/rytter) | 🟢 | Mål korrekt, evt. → 92-95%. Motor for tilfældig. |
| ITT → tt | ≥85% | 50% | Ingen data fundet | ⚪ | Behold (TT intuitivt mest forudsigeligt). Motor for tilfældig. |
| Cobbles → brosten | ≥90% | 61% | Ingen data; cobbles kaotisk irl (styrt/punktering/positionering) | ⚪ | Overvej 75-85% i stedet for 90%. Motor for tilfældig. |
| Hilly → puncheur | ≥50% | 19% | Mest kontesterede terræn | 🟡 | Mål rigtigt. Motor *meget* for tilfældig. |
| Bjerg → gc+climber+baroudeur | ≥85% | 91% / 95% ✓ | Breakaway 40%+ af høj/mellem-bjerg; 27% af alle vejetaper | 🟡 (2-1) | Bucket OK *fordi* baroudeur tæller. Verificér intern fordeling. |

### Nøgle-fund

- **Flade etaper er overvældende peloton-afgjorte.** Frontier Economics (114 etaper, 6 nylige Tours): "just 2% of flat stages were won by breakaways", per-rytter vinder-sandsynlighed ~1-in-200. Uafhængigt bekræftet (Cyclist: 0% rene flade breakaway-sejre gennem 17 etaper af TdF 2024). 🟢 → Mål ≥90% er realistisk, endda konservativt.
- **Udbrud vinder langt mere bjerg end intuitionen siger.** Frontier Economics: "More than four out of 10 high or medium mountain stages were won by a breakaway" (gns. udbrud-størrelse 19); 31 af 114 vejetaper (27%) til udbruddet. 🟡 *Caveat:* 40%+ bundter høj OG mellem-bjerg — det er IKKE "40%+ af bjergtops-finishes". Behandl som retningsgivende, ikke præcist (2-1-vote).
- **Rute-designere skærer bevidst flade etaper væk.** TdF-rutechef Thierry Gouvenou: "In the past, we had eight or nine of those flat, predictable stages. Now it's five or six … in the long run, there may no longer be any stages designed for the sprinters." 🟡 Trenden er retningsgivende, ikke monoton (2026 rebound'ede til ~7). → Kalender-design-løftestang: bias stage-mix mod færre rene flade, flere selektive.
- **PCM = genre-bevis for light-motoren.** PCM brugte abstrakt "instant"-simulation til ikke-spillede etaper indtil PCM 25; PCM 26 (juni 2026) tilføjede headless fuld-3D "Detailed Simulation" (5-15s/løb). 🟢 → "Weighted-sum + noise" er det genrens leder kørte på i 10+ år.

### Implikation for Cycling Zone

Determinisme-vs-upset balancen er **terræn-afhængig — og det er en feature.** Flat/itt skal belønne squad-building hårdt (forudsigelige); hilly skal være lotteri. Motoren kan allerede tune dette per terræn via `demand_vector.randomness` + `NOISE_SD_SCALE` ([raceSimulator.js:42](../../backend/lib/raceSimulator.js)). Målstrategien er derfor **"skærp vægtene", ikke "sænk målene"** — komplementært med population-berigelse (#669), ikke et enten-eller.

---

## Akse 2 — Rytter-type-taksonomi

| Reference | Antal typer | Kategorier |
|---|---|---|
| **Cycling Zone** | 9 | Sprinter, Lead-out, Time-trialist, Climber, Puncheur, Cobbles-specialist, Baroudeur, Rouleur, GC |
| PCM 25 (Cyanide) | 7 | Time-trial, Climber, Puncher, Northern classics (flat+cobbles), Baroudeur, Stage races (=GC/all-rounder), Sprinter |
| BikeTips (real cykling) | 8 | GC, grimpeur, TT-specialist, sprinter, rouleur, puncheur, lead-out, domestique |
| Velogames (fantasy) | 4 | All-Rounder, Climber, Sprinter, Unclassed (+ fast 9-rytter holdkomposition) |

🟢 Alle tre kilde-taksonomier 3-0-bekræftet.

### Nøgle-fund

- **9 typer er i den høje ende, men forsvarligt.** Samme familie som PCM (7) og BikeTips (8); kun fantasy-spil går så grovt som 4.
- **Fjernelsen af all-rounder/domestique/goat er korrekt.** De beskriver *holdfunktion*, ikke noget interessant at drafte. Real-taksonomier beholder dem kun for at beskrive støtteroller.
- **Lead-out er det ene valg at granske.** Ægte rolle (BikeTips: "Last Lead-Out Rider" distinkt), men værdien er 100% instrumentel for sprinteren. Som draftable type virker den **kun hvis motoren modellerer lead-out-tog** — hvilket den ikke gør (`teamComponent = 0`, [raceSimulator.js:71](../../backend/lib/raceSimulator.js)). Pt. er en lead-out-rytter mekanisk bare "en svagere sprinter".
- **Cobbles vs. puncheur-split:** PCM folder cobbles ind i "Northern classics"; vi splitter. Forsvarligt dybde-valg, men den eksterne påstand om at de er klart adskilte blev *afkræftet* (0-3) — hold øje med spiller-forståelsen.
- **Velogames-idé værd at stjæle:** tvungen holdkomposition forhindrer mono-type-drafts. For os = auktions-design-løftestang (separat spor).

---

## Akse 3 — Progression & udvikling

🟢 **Jeres caps/abilities-split *er* Football Managers CA/PA-model.** `ability_caps` = fast skjult loft (Potential Ability), current abilities = dynamisk (Current Ability). Arkitekturen er valideret af genrens guldstandard.

### Nøgle-fund

- **Peak-alder per type (Kholkine et al. 2023, J. Sports Sciences, n=1.864 mandlige PCS-top-500-ryttere 1993-2021):** sprintere **26,3** · one-day **26,2** · all-rounders **26,5** · GC **27,5**. GC peaker statistisk signifikant ældre (p<0,05). 🟢 *Caveat:* studiet isolerer IKKE rene climbers eller time-trialists — peak for de to typer er ⚪ skøn. Effekt-størrelse er beskeden (~1,2 år) → over-separer ikke kurverne.
- **Decline:** VO2max falder ~0,65 ml/kg/min/år (mænd; Brown et al. 2007, n=56). 🟢 Glidende kurve, ikke en klippe. Da pros sjældent kører efter ~38, bør in-game-decline-vinduet (28-38) være blødt for at holde veteraner draftable.
- **FM Current/Potential Ability:** 0-200-skala; PA er fast skjult loft sat ved save-start (ændrer sig aldrig); CA er dynamisk (op med træning, ned med alder). 🟢
- **FM skjult youth-potentiale via negative PA-koder** (-1 til -10, hver = randomiseret ~30-point-bånd, fx -10 = 170-200): en ung rytters sande loft afgøres først per save → wonderkids, fiaskoer, scouting-spænding. 🟢

### Implikation — konkret kalibrering af L0-motoren (#1137)

1. **Peak-alder:** sænk `peakAge: 28` ([riderProgression.js:28](../../backend/lib/riderProgression.js)) til center ~27; tænd `peakAgeByType` (GC ~28, sprinter/lead-out ~26, resten ~26-27). 🟢 stærk for sprinter↔GC-spændet, ⚪ skøn for climber/tt.
2. **Decline:** behold accelererende form, men overvej at dæmpe `declineByYearsPastPeak` 2,6 → ~2,0 så veteraner ikke bliver for hurtigt udraftable. 🟡
3. **Skjult youth-potentiale:** i dag synligt 1-6. Gør det til et uskarpt *bånd* for unge ryttere (FM negative-PA-mekanik), afklaret over tid → den enkeltstående stærkeste retention-forbedring for #1136. 🟢 for mekanikken (design-valg om vi vil have skjult potentiale).

---

## Akse 4 — Race-motor / etape-resolution

🟢 **Validering:** PCM — genrens leder — brugte præcis "weighted-sum + noise" ("Instant Result") i 10+ år; først PCM 26 tilføjede fuld 3D. En light browser-motor er ikke en genvej, men det genren beviseligt kører på. Diminishing returns ligger ved fuld segment/3D-simulation — unødvendigt for os.

### De tre forbedringer = de tre tomme seams

Forskningen peger uafhængigt på præcis de tre neutrale seams i [raceSimulator.js:69-71](../../backend/lib/raceSimulator.js):

| Seam (nu = 0) | Låser op | Hvorfor |
|---|---|---|
| `teamComponent` | Lead-out-tog + holdtaktik | Gør Lead-out-typen ægte; belønner holdsammensætning |
| `formComponent` | Dagsform | Billig realisme; forklarer upsets narrativt |
| `fatigueComponent` | Udmattelse over etapeløb | Tunge løb favoriserer endurance/recovery → GC-strategi |

Kontrakten er frossen (#1021 fylder seams ud uden at ændre signaturen) → **depth-udfyldning, ikke omskrivning.**

---

## Anbefalinger (prioriteret)

1. **Målstrategi = skærp motoren, behold målene** (#1102). Skærp demand-vægtene + sænk støjen til flat→90%, itt→85%, hilly→50%. Eneste kandidat til sænkning: cobbles 90% → ~80%. Komplementært med #669-berigelse.
2. **Verificér bjerg-fordelingen** (#1102): vinder baroudeurer reelt en andel af de 91%, eller er det ren klatrer-dominans? Cockpit-rapporten kan svare.
3. **Beslut Lead-out-typen** (#49/#669/#1101): fjern indtil motoren understøtter tog (launch-kvalitet > feature-bredde) ELLER prioritér `teamComponent`-seam'en før launch.
4. **Progression-kalibrering** (#1136/#1137): tænd `peakAgeByType` + skjult youth-potentiale som tidlige slices.
5. **Race-engine-roadmap** (#1021): fyld seams i rækkefølge team → form → fatigue.

## Afkræftet — brug ikke

Disse påstande blev fact-checket og forkastet; tallene må ikke citeres:
- cyclingbeginner.com's breakaway-tal (flat 4%, bjerg 61%, hilly 44%) — afkræftet (0-3 / 1-2). Brug Frontier Economics i stedet.
- cyclist.co.uk: peak ~27 + flest point ved 28 + "sprintere peaker yngre pga. fast-twitch-fibre" — mekanismen afkræftet (1-2). Brug Kholkine.
- Cavendish-æra "4 etaper/Grand Tour"-baseline — afkræftet (0-3).
- "Real cykling = 6 hovedkategorier" — afkræftet (0-3).
- "Puncheur subdividerer i cobbled vs. Ardennes" — afkræftet (0-3).

## Åbne spørgsmål (ingen ekstern data — skøn)

- Empiriske win-rate-splits for **ITT** og **cobbles** specifikt (ingen data → målene ≥85%/≥90% er skøn).
- Præcis peak-alder/decline for **rene climbers og time-trialists** (ikke isoleret i studiet).
- PCM's interne **form/fatigue-formler** (kun resolution-arkitekturen blev bekræftet).
- Faktisk **forudsigelighed per terræn i PCM** (direkte sim-benchmark mangler).
- Om **Lead-out som draftable type** forbedrer spiloplevelsen (kræver playtest).

## Centrale kilder

- Frontier Economics — "Breaking down the breakaway" (114 etaper, 6 Tours): https://www.frontier-economics.com/uk/en/news-and-insights/articles/article-i6444-breaking-down-the-breakaway/
- Rouleur — "The disappearing sprinter" (Gouvenou rute-trend): https://www.rouleur.cc/blogs/the-rouleur-journal/the-disappearing-sprinter-why-the-grand-tours-fastest-finishers-are-losing-their-race
- Cyanide PCM 25 spec-guide (7 typer): https://web.cyanide-studio.com/games/cycling/2025/pcm/guide/?page=basics-specialisations
- PCM 26 DevBlog (instant vs. detailed simulation): https://store.steampowered.com/news/app/3936530/view/687504475423768911
- Velogames 2025-regler (4 klasser + komposition): https://www.velogames.com/velogame/2025/rules.php
- BikeTips — "8 Key Types of Cyclists": https://biketips.com/types-of-cyclists-in-road-cycling-explained/
- Kholkine et al. 2023, J. Sports Sciences (peak-alder per type): https://www.tandfonline.com/doi/abs/10.1080/02640414.2023.2208998
- Brown, Ryan & Brown 2007 (VO2max-decline): https://pmc.ncbi.nlm.nih.gov/articles/PMC3794488/
- FMInside — Current/Potential Ability (FM CA/PA + negative-PA-koder): https://fminside.net/guides/basic-guides/76-current-potential-ability
