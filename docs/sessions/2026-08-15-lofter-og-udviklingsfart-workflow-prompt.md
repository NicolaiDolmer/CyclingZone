# Session-prompt: lofterne op og udviklingsfarten ned (#3709 trin 3, 4, 5)

**Model:** Opus 5 i hovedtråden, sonnet-subagenter til udførelse · **Indsats:** high · **Form:** bygge-session i egen worktree
**Skrevet:** 15/8 · **Ejer-ramme:** *"Vi har jo aftalt at hæve det potentielle loft rytterne kan komme op på i enkelte evner og hvor hurtigt/langsomt de skal udvikle sig opimod de lofter. Det er vigtigt den opdatering snart er færdig."*
**Ejer-valg 15/8:** alle tre trin sigter mod at være **live før 23/8-cutoveren**.

---

## Prompt (kopiér ind som første besked)

> Du bygger trin 3, 4 og 5 af `#3709` — rytterudvikling og træning. Læs i denne rækkefølge:
>
> 1. `docs/superpowers/specs/2026-08-14-3659-rytterudvikling-og-traening-design.md` — hele specen. 16 ejer-beslutninger er truffet 14/8 og **genåbnes ikke**. §6 er leveranceplanen, §4 er hullerne du skal lukke.
> 2. `#3682` — den allerede målte del af trin 3.
> 3. `docs/sessions/2026-08-15-lofter-og-udviklingsfart-workflow-prompt.md` — dette dokument, resten af det.
>
> **Arbejd i en worktree.** `pwsh -File scripts/new-worktree.ps1`. Hoved-checkoutet `C:\Dev\CyclingZone` er optaget af en anden session der arbejder på økonomien og på træningssidens struktur. 14/8 kørte to sessioner uden at vide om hinanden og en commit landede det forkerte sted.
>
> **Rør ikke træningssidens flade.** `frontend/src/pages/TrainingPage.jsx` og rytterprofilens faner ejes af den anden session (`#3721`). Din leverance er motoren. Trin 2's fokusvælger og trin 4's tabel lander bagefter, oven på den struktur der designes derovre.
>
> **Intet muteres i prod uden ejerens go.** Du bygger, måler, dokumenterer og laver PR. Backup-tabel og verificeret rollback FØR du overhovedet foreslår at køre. Ejeren skal se live-tilstand før store destruktive indgreb.
>
> Vær kritisk over for dit eget arbejde. Sig det når du gætter.

---

## Hvad opgaven er, i klar tekst

To knapper der i dag er én. Loftet bestemmer både **hvor højt** en evne kan komme og **hvor hurtigt** den vokser derhen, fordi væksten er gap-proportional. De skilles ad.

**Målt i dag:** forskellen mellem at træne rigtigt og forkert i en hel karriere er **3 point ud af 60**. Intensiteten er 1 point værd. Det eneste valg der flytter noget er "hvil eller lad være". Rytterudviklingen er fuldstændig troværdig — den er bare ikke managerens.

**Årsagen:** hver evne mætter sit loft inden for karrieren under alle indstillinger. Raten bestemmer kun hvornår rytteren ankommer, og ti sæsoner er rigeligt uanset hvad manageren gør. Slutresultatet blev afgjort ved genereringen.

**Dertil to evner ingen kan røre:** `positioning` og `tactics` har positiv vægt hos **nul af otte ryttertyper**, så hver rytter er låst på 0,45 × grundloftet på dem for altid. `tactics` trænes desuden af intet fokus — spillets mest låste evne. `aggression` er baroudeurens tungeste evne (vægt 3) og kan ikke vælges af nogen manager.

## De tre trin

| Trin | Indhold | Motor | Gate |
|---|---|---|---|
| **3** | Håndværks-taget: `positioning` + `tactics`. Indeholder `#3682` (fire roller, allerede målt) | ja | dry-run-diff med absolutte deltaer, ejer-gated |
| **4** | Rolleklasser, rater pr. klasse, `offFocusMult` 0,97 → 0,35 | ja, stor | flow-scorecard + negativ-test + snapshot før mutation |
| **5** | Akademi og senior bliver én model: `INTERIM_RATE_MULT` + `HARD_DAILY_CAP` fjernes | ja | **skal følge trin 4 umiddelbart**; `#3583` lukkes |

**Rækkefølgen mellem 3 og 4 er ikke forhandlelig.** Trin 3 kan kun måles isoleret mod `#3682`s eksisterende tal så længe trin 4 ikke har flyttet noget andet.

**Trin 5 kan ikke udskydes efter trin 4.** Attributionen er målt: beholdes akademiets 1/3-dæmpning, falder kandidatens rating-median til 22 mod dagens 27 — altså et midlertidigt fald der rammer spillerne. Trin 4 og 5 er ét ship.

### Parametrene (besluttet, skal ikke genopfindes)

| Klasse | Tag (× `loftByPotential`) | Rate |
|---|---:|---:|
| `signatur` | 1,30 | 0,45 |
| `sekundaer` | 1,10 | 0,36 |
| `haandvaerk` | 0,95 | 0,22 |
| `andenRolle` | 0,70 | 0,15 |
| `svaghed` | 0,20 | 0,05 |

`offFocusMult`: 0,97 → 0,35. Klasserne udledes af `capsShapingWeights.js`.

## Beslutninger der IKKE genåbnes

De 16 står i specens §8. De fire der oftest bliver fristende at pille ved:

- **Nr. 14 — ankeret er rating, ikke spidsen.** Signatur-rate 0,45 er valgt fordi rating er dét spilleren ser og økonomien prissætter. Sænkes raten til 0,30 lander spidsen tættere på dagens, men rating falder til 24 for alle, også dem der spiller godt. Målt, afgjort.
- **Nr. 13 — akademi og senior er én model.**
- **Nr. 6 — ryttere skal holde op med at nå deres lofter.** Andelen af taget nået falder fra median 1,00 til 0,82. Det er meningen.
- **Nr. 3 — håndværk er kun `positioning` og `tactics`.** Ikke flere.

## Hvad der allerede er målt — verificér, men mål ikke om

Flow-scorecardet er kørt 14/8 på 1.200 friskgenererede ryttere gennem produktionens egen intake-sti, simuleret fra 16 til 30 år. Selvtesten er bit-identisk med `applyDailyTick` over 9 sæsoner.

| Mål | i dag | kandidat | negativ-test |
|---|---:|---:|---:|
| Rating ved 30 (spids / forkert) | 27 / 25 | **28 / 18** | 33 / 30 |
| Agens-spænd på rating | 2 | **10** | 3 |
| Arketype-spænd | 0,00 | **0,13** | 0,00 |
| Feltets forskellighed | 0,42 | **0,77** | 0,56 |
| Bedste evne ved 30 | 36 | **44** | 44 |

Negativ-testen (kun `offFocusMult` uændret) fejler beviseligt. Begge håndtag skal drejes, og målingen kan se forskellen. **Kør scorecardet igen på din egen implementering** — hvis dine tal afviger fra ovenstående, er implementeringen ikke specen.

## Huller du SKAL lukke før noget shipper

Specens §4 lister dem. Fire er stadig åbne, og tre af dem er blokerende:

1. **Arvede ryttere over deres formel-loft** (hul 4, blokerende). `buildCapsForRider` returnerer `max(tapered, current)`, så forholdet er 1,00 per konstruktion for dem. Snapshottet har fx en rytter med `tactics: 61` mod et formel-loft på 24. Beslutning 6 gælder ikke for dem uden en særskilt regel. **Skriv reglen, mål hvor mange det rammer, og få den godkendt.**
2. **Race-balancen i toppen** (følge af beslutning 14, blokerende for trin 4). Spidsen går fra 36 til 44 ved bedste spil. Race-balancen er kalibreret mod 36. **Mål den om mod 44 før trin 4 mutteres.** Stående balance-punkt `#2731` siger allerede at `maxRiderWinRate` er 0,67-0,75 mod et mål på 0,45 — det bliver ikke bedre af en højere top.
3. **Markedsværdien er ikke målt direkte** (hul 6, blokerende — se næste afsnit).
4. **Staff-stien er uverificeret** (hul 7, ikke blokerende). `facilityTrainingMultiplier` målt til maks +8,3 % ved tier 5; `staffTrainingBonus` gav 1,0 mod en syntetisk profil, hvilket lige så godt kan være forkert input. Verificér mod en ægte profil.

## Den vigtigste sammenhæng med den anden session

**Trin 4 flytter markedsværdier.** Kæden er verificeret i koden 15/8:

```
abilities → outputScore()          (backend/lib/riderValuation.js:46)
          → predictBaseValue()     → market_value
          → lønnen                 (#3393 prissætter løn efter markedsværdi)
```

Evnesummen ved 30 år falder fra 276 til 214 på flow-målingen. Det er inputtet til værdimodellen. Ingen har målt hvad der kommer ud i den anden ende.

Samtidig sidder den anden session og designer værdi- og lønfundamentet, hvor `#3393` er i draft netop fordi lønnens grundlag var usikkert. **Mål `predictBaseValue`-outputtet før og efter din ændring, på hele populationen, og skriv deltaerne ind i PR-body'en.** Hvis værdierne flytter sig mærkbart, skal de to sessioner tale sammen før noget merges — ikke bagefter.

Bemærk at `#3682`s gate B3 kun beviser at *positionering* ikke er blandt værdimodellens 13 evner. Det er ikke det samme som at trin 4 lader værdierne stå.

## Gates der skal stå i PR-body

Fra `#3682` (trin 3):

| # | Kriterium | Mål |
|---|---|---|
| B1 | Intet evne-loft falder for nogen rytter | 100 %, diff mod snapshot |
| B2 | `primary_type` + `secondary_type` uændret | 100 %, verificér, antag ikke |
| B3 | Markedsværdier uændret | 100 %, verificér |
| B4 | `potentiale`-feltet urørt | felt ikke skrevet |
| B5 | Backup-tabel + verificeret rollback FØR mutationen | dokumenteret |

For trin 4 og 5 derudover: flow-scorecard mod tabellen ovenfor, negativ-test der fejler, snapshot før mutation, og markedsværdi-deltaerne.

**`weightTableSplit.test.js` fejler med vilje** når du rører `capsShapingWeights`: fjern den fra `IDENTICAL_AT_SPLIT` og skriv hvorfor i samme commit. **Rør ikke `classifierWeights`' hash-test** — den er frosset.

## Spillerkommunikation

Tre ting skal frem, i denne rækkefølge (specens §7):

1. **Hvad du får:** din træning afgør nu hvad rytteren bliver. To identiske talenter under to managere ender forskelligt.
2. **Hvad du mister:** ryttere udvikler sig langsommere hvis du ikke vælger. Ingen mister noget de allerede har — men det der før kom gratis skal nu vælges.
3. **Hvad der forsvinder:** beskeden om at en evne aldrig stiger igen. Den var sand under den gamle model og bliver usand under den nye. `focusOptionCapped`, `focusCappedTitle` og `focusPartiallyCappedTitle` slettes.

EN først, DA under. Kort patch note — de nuværende er for lange. Udkast skrives til copy-paste; **ejeren poster selv.**

## Rammer

- **Worktree, ikke hoved-checkoutet.** `scripts/new-worktree.ps1`. Branch fra `origin/main`.
- **Branch-guard i selve commit-kæden**, ikke som print: `B=$(git branch --show-current); [ "$B" = "main" ] && exit 1`
- Sekventiel implementering i én worktree. Workflow-fan-out er fint til *målinger* (scorecard-kørsler er ægte parallelle), ikke til kode i samme filer.
- `gh` gennem `scripts/lib/gh-retry.sh` · PR-body med `## Brugerverifikation` og mindst ét `[x]` · kun ÉN fuld e2e-suite ad gangen.
- `pwsh -File scripts/preflight-pr.ps1` før push. Backend-ændringer er TIER FULL: hele suiten lokalt.
- **Sæt dig som Working agent i `docs/NOW.md`** — men feltet kan kun rumme én, og den anden session står der allerede. Skriv dig ind som anden linje og navngiv begge, så `#3712` ikke gentager sig.
- Population til simulering: `docs/snapshots/3591/riders_full.json` (13/8). **Aldrig den levende DB.**

## Kilder

`#3709` · `#3682` · `#3592` · `#3659` · `#3583` · `#2731` · `#3645` · specen fra 14/8 · `backend/lib/riderProgression.js` · `backend/lib/dailyTraining.js` · `backend/lib/weights/capsShapingWeights.js` · `backend/lib/riderValuation.js`
