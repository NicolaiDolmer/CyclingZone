# Session-prompt: kalender-kvalitet frem mod fredag 28/8 kl. 11

> Skrevet onsdag 26/8 kl. 15. **Der er cirka 44 timer til sæsonstart.**
>
> Forrige session (26/8, hele dagen) leverede #4239 og kernen af #4236. Denne session skal levere #4272 og få det hele i luften med **én** regenerering.

---

## 0 · Læs dette først, ellers gentager du en fejl der allerede er begået i dag

**Datoen. Det er 26/8.** Forrige session daterede alle beslutninger som 25/8 og måtte rette SSOT bagefter. `date` før du skriver en dato i en SSOT, et issue eller en commit. 25/8 var dagen før, og dér blev #4217 og #4218 besluttet — datoerne afgør hvilken regel der er nyest.

**Mål, gæt ikke.** Fem gange i dag viste en måling det modsatte af hvad issue-teksten sagde. Eksempler: monument-eksklusiviteten var holdt op med at virke uden at nogen havde opdaget det · en "regression" i GT-etapetal var en bevidst komprimering · #4174's krav på 29 ryttere viste sig at være 30, og ingen aktiv D1-manager har over 29.

**Grøn verifikation beviser kun det verifikationen måler.** Den nye pakker var grøn på alle seks #4236-tests mens bindingsspillet var dødt i tre divisioner — hver løbsdag havde ét løb, så en rytter aldrig skulle vælge. Ingen test målte det. Når du ændrer pakkeren: mål overlap-fordelingen bagefter, hver gang.

**De to akser.** `game_day` (løbsdag) er IKKE `scheduled_at` (kalenderdato). En dato bærer flere løbsdage. `game_day := dato − startdato` er afvist tre gange (#4155, #4158, og implicit i dag). Læs `CALENDAR_RULES.md` §0.

---

## 1 · Hvad der står færdigt (verificeret, ikke påstået)

**#4239 — merged.** De fire kalender-dev-scripts kører igen. `calendarDryRunLocal.mjs` og `calendarDiffDump.mjs` er dine måleværktøjer; brug dem.

**#4236 — bygget og grøn, mangler PR.** Branch: `fix/4236-loebsdag-baand-pr-kalenderdato`.

| Målt mod prod-katalog-fixturen | Før | Nu |
|---|--:|--:|
| Løbsdage der spænder flere datoer | 40 | **0** |
| Løb med hul i løbsdagene | 8 | **0** |
| Falske bindinger (spærrer uden at dele dato) | 12 | **0** |
| GT-spænd over loftet på 6 datoer | 2 af 3 | **0** |
| Kalender-scorecard (#4215) | — | **exit 0** |
| Backend-tests | — | **7167/7168** |

`raceCalendarLanePacker.js` gik fra 1483 til ~620 linjer: `layoutStream` og `layoutBanded` er slettet med 17 hjælpefunktioner og 34 forældede tests. Der er nu **én** pakke-metode, og den fejler højlydt frem for at falde tilbage.

---

## 2 · Ejer-beslutninger 26/8 — ordret, så de ikke fortolkes om

**Kronologi:** *"hvis et løb har fire etaper, skal løbsdagene jo ligge i træk. Ligesom i virkeligheden. Løbsdag 4-5-6-7 f.eks. Det er ikke muligt at et løb på 4 dage har løbsdagenumrene 3-5-7-12."*

**Hviledage:** præcis **2** pr. Grand Tour, og en hviledag **ER** en løbsdag GT'en optager uden at køre på. Spændet er `etaper + 2`. Rytteren er bundet henover; løbsdagen bruger ikke en af dagens pladser, så et andet løb kan bruge den.

**Monument-eksklusiviteten er ophævet.** Den leverede intet efter #4217 gjorde bindingen spænd-baseret — målt: 0 delte ryttere i alle 9 monument/etapeløb-kombinationer — men var eneste årsag til hullerne. Monumenter må stadig **gerne** ligge alene; det er nu en præference, ikke en regel.

**Udtagelse (#4174):** *"behandel dem som andre managers, hvis de mangler at udtage den der time før ... så udtager assistenten automatisk."* Ingen særregel for inaktive hold. Virkningsløs i D1 indtil #4236 er ude.

**Enkeltstarter:** 10 % af etaperne i **alle fire** divisioner. Begrundelse: en tempo-specialist i D4 skal have lige så meget at køre efter som en i D1.

**Brosten:** *"Det er ikke okay, at division 1 kun har 3 brostensetaper."* D1 skal fra 3 % op til båndet.

**Bånd for hvordan etaperne slutter** — se #4272, godkendt tal for tal.

---

## 3 · Opgaven: #4272, og den skal ind FØR regenereringen

Fejlen er præcis lokaliseret. Etapernes finale er aldrig blevet håndhævet, kun målt:

| Terræntype | D1 | D2 | D3 | D4 |
|---|--:|--:|--:|--:|
| `mountain` slutter **nedad** | **70 %** | **61 %** | **59 %** | — |
| `mountain` slutter opad | 12 % | 13 % | 6 % | — |
| `hilly` slutter opad | 86 % | 55 % | **33 %** | 79 % |
| `high_mountain` slutter opad | 92 % | 100 % | 89 % | 100 % |

Bjergetaper er reelt nedkørsels-etaper. `high_mountain` og `flat` er derimod sunde — generatoren kan altså godt ramme rigtigt når reglen findes.

De godkendte bånd står i #4272. Den tunge del er bjerg: fra 6-13 % opad til 45-65 %.

**Mål mod kataloget FØR du bygger gaten.** Kan ruterne ikke levere båndet, er det et katalog-problem og ikke et generator-problem — sig det med det samme frem for at tvinge en gate igennem der ikke kan opfyldes.

Med i #4272: mere overlap uden for GT-vinduer · monument-solo som præference · **undersøg hvorfor D2 falder fra 100 % til 70 % overlap** · enkeltstart 10 % (hænger sammen med #4220's gulv for fritstående ITT).

---

## 4 · Rækkefølge

1. **#4272** — bånd pr. terræntype + samlet, som gate pr. division. SSOT i samme PR (hard rule 30).
2. **#4273** — den ene røde test. Fixturet skal skærpes, ikke testen svækkes; tre forsøg er allerede forkastet, se issuet.
3. **Frontend-build, lint, `preflight-pr.ps1`.** Kun backend er kørt indtil nu.
4. **PR** for #4236 + #4272 samlet. Ejerens visuelle godkendelse før merge.
5. **ÉN regenerering.** Dry-run med før/efter-diff til ejeren FØRST. Skrivning kun på hans GO til netop det skridt.
6. **Tænd `stage_scheduler_enabled` + `auto_entry_generator_enabled`** — ejer-only, allersidst.

**To regenereringer er forbudt.** #4218's regenerering 25/8 er selv årsag til flere af de blockers vi rydder op i. Derfor skal #4236 og #4272 i luften sammen.

---

## 5 · Verifikation der faktisk måler noget

```
cd backend && npm test                              # 7167/7168 forventet
node --test lib/raceCalendarLanePackerGameDayBands.test.js
node --test lib/raceCalendarLanePackerInvariants.test.js
node scripts/dev/calendarScorecard4218.mjs          # exit 0 = alle gates
node scripts/dev/calendarDryRunLocal.mjs            # dagsform pr. division
pwsh -File scripts/preflight-pr.ps1                 # før push
```

Efter enhver ændring i pakkeren: mål **overlap-fordelingen** (andel løbsdage med 2+ løb) og **antal løb med hul**. Forventet nu: D1 54 % · D2 70 % · D3 50 % · D4 100 %, og 0 huller.

---

## 6 · Ting der er prøvet og forkastet — foreslå dem ikke igen

- `game_day := dato − startdato`. Flader aksen ud, bryder overlap-cap'en i alle fire divisioner.
- **Bånd-normalisering oven på det gamle stream-layout.** Fjernede straddle, men inflaterede GT-spændet fra 22 til 26 løbsdage og gjorde blokeringen værre (1,50 → 1,75 blokerende løb pr. endagsløb).
- **Binding på kalenderdatoer i stedet for løbsdage.** Måler værst af alle tre: 199 bindings-par mod 128. Det er `game_day := dato` ad bagvejen.
- **Tilpas kompositionen så `layoutBanded` kan bruges.** Ville skubbe D1's endagsløbs-andel fra 61 % til ~68 % mod målet 55 %. Kalenderens indhold skal afgøres af spildesign, ikke af hvad pakkeren kan pakke.
- **Fast antal løbsdage pr. dato** (`K = ceil(D/cap)`). Så kan en GT højst køre 2 etaper om dagen, og tre GT'er kræver 29 datoer ud af 28.

---

## 7 · Løse ender

- To worktrees bærer ucommitted, utrackede filer: `feat/4030-h2h-scorecard` (3 filer) og `fix/3709-signaturfaktor` (1 fil). Sikr eller ryd dem.
- **#4256** — forældreløs branch med 850 linjer #3570-arbejde, inkl. et sikkerhedsfix der måske aldrig landede. Priority:high, urørt.
- **#4274** — et dev-script skrev sin rapport ind i et andet worktree. Årsagen er ikke fundet.
- MASTERPLAN ligger på 1.500 tokens præcis. Næste tilføjelse kræver at noget færdigt trimmes ud.
