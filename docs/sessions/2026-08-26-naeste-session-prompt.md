# Prompt til næste session (26/8) — workflow-session

Kopiér alt under linjen ind som din første besked.

---

Kør denne session som en **workflow-session**. Brug `Workflow`-værktøjet til fan-out; du er orkestrator og holder mig i loopet mellem faserne. Byg ikke noget, og rør ikke prod, før jeg har set fase 1's resultat.

## Hvor vi står

Læs `docs/NOW.md` og `docs/MASTERPLAN.md` først.

**Sæson 3 starter fredag 28/8 kl. 11.** Den skulle være startet tirsdag 25/8, men jeg udskød den (#4218), fordi holdudtagelsen ikke virkede. Kalenderen er genereret forfra: 28/8 → søn 27/9, 31 løbsdage, løb hver dag i alle fire divisioner, 531 løb. `stage_scheduler_enabled` og `auto_entry_generator_enabled` står **`off`** i prod. Alle spillere udtager forfra.

Alt arbejde de næste dage skal tjene fredag. Rækkefølgen er låst:

1. **Holdudtagelsen skal virke** — #4200 (assistenten overskriver trupper spilleren har ryddet og gemt), #4201 (min beslutning: opt-in eller sen-udfyldning?), #4217 (rytter kan forlade et etapeløb midtvejs)
2. **Nye spillere kan lande** — #4183 + #4233 (FK'en på `transfer_offers` gør 16 AI-hold utrimbare)
3. **#4174** — ét svar fra mig: hvor højt fyldes inaktive trupper op
4. **Vagterne skal fange DATA-fejl** — #4229, #4215, #4219, #4123
5. **#4211** (6 brud) og **#4236** (løbsdags-kollisionen)
6. **Tænd scheduler + entry-generator** — sidste skridt, kun på mit eksplicitte GO

**Udskudt, rør dem ikke:** v4 live-flip · #4203/#4209 · Planning Center P1-P3-resten · backlog-bølgerne.

## Hard rule 30 — læs områdets SSOT først

Ejer-mandat 25/8 (#4221). Læs SSOT'en FØR du rører noget · ethvert nyt design citerer sin SSOT eksplicit · ændrer du en regel eller konstant, opdaterer du SSOT'en i SAMME PR.

`docs/CALENDAR_RULES.md` · `docs/RACE_ENGINE_RULES.md` · `docs/PLANNING_CENTER_RULES.md` · `docs/ECONOMY_RULES.md` · `docs/PROGRESSION_RULES.md` · `docs/RIDER_GENERATION.md` · `docs/GAME_INVARIANTS.md`

**Et gulv er aldrig en godkendelse.** Rapporterer du et tal som OK, skal det stå hvilken regel det måles mod, og om det er et ejer-godkendt MÅL eller et regressions-GULV. Findes der intet godkendt mål: spørg. Rapportér aldrig grønt.

## Workflowet

**Fase 1 — diagnose, parallelt (én agent pr. blocker: #4200, #4217, #4183, #4233, #4174, #4229, #4215, #4219, #4123, #4211, #4236).**

Hver agent får præcis ét issue og skal returnere struktureret:

- Er problemet stadig virkeligt? Mål mod prod eller kode — citér ikke issue-teksten. Flere af issuerne er skrevet FØR kalenderen blev genereret forfra 25/8, så deres tal kan være forældede.
- Rodårsag i én sætning, med fil og linje.
- Mindste fix der løser den, ikke det pæneste.
- Afhænger den af et andet issue på listen?
- Hvilken SSOT dækker området, og siger den noget der modsiger issuet?
- Kræver fixet en beslutning fra mig? Så formulér spørgsmålet, træf det ikke.

Ingen agent må ændre kode, data eller prod i fase 1. Read-only.

**Barriere her.** Saml resultaterne, dedupliker afhængigheder på tværs, og vis mig ét samlet billede: hvad er stadig virkeligt, hvad er faldet bort af sig selv, hvad hænger sammen, og hvad kræver mig. Vis det visuelt — tegn det, ikke kasser med prosa i.

**Fase 2 — adversarisk verifikation, kun på de fix-forslag der overlever fase 1.** To skeptikere pr. forslag: én der prøver at afvise rodårsagen mod koden, én der tjekker forslaget mod områdets SSOT for en regel det bryder. Afvis ved tvivl — vi er tre dage fra sæsonstart, og et forkert fix koster mere end et udskudt.

**Fase 3 — én agent syntetiserer** den endelige byggerækkefølge med afhængigheder, hvad der kan køre parallelt, og hvad der kræver mit GO undervejs.

Sæt et token-budget på workflowet og skriv `budget.remaining()`-guards ind, så det ikke løber løbsk.

## Sådan arbejder du med mig

- **Ét spørgsmål ad gangen**, med din anbefaling. Kontekst og tal skal stå inde i selve spørgsmålet — jeg ser ikke altid prosaen omkring det.
- **Vis det visuelt når det er et valg.** Tegn skærmene eller tallene. Tekst i kasser er ikke en visualisering.
- **Verificér før du påstår.** Slå issue-numre op før du bruger dem. Genmål tal ældre end en uge.
- **Ingen prod-mutation uden mit GO på netop det skridt.** Ikke "vi tager den efter X" — et konkret ja til det konkrete tal. At slukke et live-system for at stoppe noget er fint; at tænde det igen er mit kald alene.
- **Commit kun bag `bash scripts/guard-commit-branch.sh <branch>`**, og brug `git commit -F <fil>`, aldrig heredoc.
- Svar på dansk. Konkret anbefaling frem for optionslister. Sig klart til når du har brug for mig.

## Det du skal vide inden du starter

**#4236 er det vigtigste enkeltfund.** Samme løbsdag dækker flere kalenderdatoer: D1 25 af 89, D3 21 af 47; D2 og D4 er rene. Da bindingen er pr. løbsdag, kan et endagsløb være spærret af et etapeløb der er **kørt færdig dage forinden**. Le Mur de Huy (16 ryttere mod 101-128 for sammenlignelige løb) deler løbsdag 29 med Tour des Émirats, der sluttede dagen før.

Feltet er ikke lovligt at fylde. At rydde auto-udtagelserne og lade generatoren fordele forfra giver derfor samme resultat igen. Og målingen er taget på den NYE kalender — regenereringen 25/8 løste det ikke, den flyttede det.

Retningen er låst af vores egen SSOT: `CALENDAR_RULES.md` §0 siger at pakkeren lægger flere hele løbsdage **inde i** hver kalenderdag. En løbsdag der spænder over to datoer er en fejl, ikke slot-designet.

**Start fase 1 med det samme.** #4201 er den eneste der venter på mig, og den kan jeg svare på mens de andre agenter kører.
