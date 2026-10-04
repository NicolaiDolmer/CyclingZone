# Prompt til implementerings-sessionen: roadmap-hub

Kopiér alt under stregen ind som første besked i en ny Claude Code-session i `C:\Dev\CyclingZone`. Anbefalet: Fable 5.1 som orkestrator, indsats medium. Workers får deres model fra bølge-filen (opus til spor 1-3, sonnet til spor 4-5).

---

Byg roadmap-hubben fra ende til ende. Alt er designet og ejer-godkendt 4/10; du skal udføre, ikke designe om. Kør den som en bølge: brug workflowet `.claude/workflows/wave.js` med args fra `docs/superpowers/plans/2026-10-04-roadmap-hub-wave.json` (5 spor, #6149-#6152 + #6154).

**Læs først, i denne rækkefølge**
1. `docs/NOW.md`
2. Spec: `docs/superpowers/specs/2026-10-04-roadmap-hub-design.md`
3. Plan: `docs/superpowers/plans/2026-10-04-roadmap-hub.md` (Global Constraints, Fælles kontrakt, de 5 spor, "Efter bølgen")
4. Billederne i `pr-screens/roadmap-4-10/`: `roadmap-foer-efter.png`, `known-issues-to-grupper.png`, `beta-overblik.png`, `faerdig-regel.png`
5. Indhold: `docs/drafts/2026-10-04-roadmap-indhold.md` afsnit 5.6, 6b og 6c

**Før du starter bølgen**
- Tjek `.claude/run/wave-active.json` (låsen var fri 4/10 aften). Ejer en anden bølge maskinen, så stop og sig det; start ikke uden om værnet.
- Kør bølgen med `dryRun: true` først og vis mig planen i tre linjer. Start den rigtige bølge bagefter uden at spørge igen.

**Mens bølgen kører (ét ad gangen, svar mig med det samme)**
1. Vurdér de fem åbne PR'er: #6128, #6053, #6153, #6136, #5827. For hver: klar til mit go, eller hvilken gate der mangler. Rør ikke Codex' PR'er ud over at læse dem.
2. Go-kort for #6128 (tilbud annulleres ved holdskifte; brand) bygget på diffen, og for #6053 (vælg rytter først; lovet 1/10) med ét annoteret før/efter-billede og preview.
3. Start trin 0 for løbsmotor-pakken (#6157: sandhedstjek af motorændringerne siden skiftet) som READ-ONLY, så pakken kan starte mandag morgen. Selve motor-pakken (#6156) bygges ikke i denne session.

**Låste beslutninger (genåbn dem ikke)**
- Fem faner: Plan, Beta, Vote, Known issues, Done. Ingen datoer på planen.
- Planlagte punkter har én skala (vigtighed). Idéer har to skalaer, vist i to trin. Styringsscoren er uændret. Ingen stemmer slettes.
- Known issues i to felter: "Confirmed" (kun det jeg selv har bekræftet) og "Reported, being checked" (ikke bekræftet, intet lovet), plus "Checked, no problem found".
- Del-reglen: er kun en del af et punkt leveret, deles det, og stemmerne kopieres til begge.
- Beta-fanen følger kontakterne automatisk. Et flag-flip må ALDRIG kunne fejle på grund af roadmappet, og ingen rigtig kontakt røres under bygning eller test.
- Ca. 30 idéer synlige ad gangen; resten i idé-puljen bagved.
- Spillere ser kun deres egne stemmer og egne tryk.
- Roadbooken på Discord: intet postes automatisk. Ved hver ændring spillerne kan se, skriver du et færdigt opslag på engelsk, som jeg selv poster.
- Uge 41-rækkefølgen står i `docs/MASTERPLAN.md` (ejer-godkendt 4/10). Stabilitet kører hos Codex; rør ikke de issues.

**Rækkefølge og gates**
1. Spor 1 (migration, #6149) merges først. Vis mig go-kortet bygget på diffen. Efter mit "merge": post-verify mod prod straks (stemmetal og status-fordeling uændret, to triggere til stede), og regenerér schema-snapshot og typer.
2. Derefter spor 4 (#6152), spor 5 (#6154), spor 3 (#6151, admin-fanen) og til sidst spor 2 (#6150, spillersiden). Én ad gangen gennem `scripts/merge-queue.ps1`.
3. Hver UI-PR: ét annoteret før/efter-billede sendt som fil i samme tur som go-kortet, og jeg skal kunne se den på preview, før jeg siger "merge".
4. Indhold: når migrationen er applied, gennemgår vi afsnit 6c sammen, én liste ad gangen (Vote-30, Plan, Beta, Known issues efter 5.6, Done). Jeg godkender teksterne. Du skriver først til prod, når jeg skriver "kør", og stemmetallet skal være det samme før og efter. Indholdet lægges ind i samme session, som spillersiden går live.

**Åbne punkter du skal tage med mig undervejs (ét ad gangen)**
- Rækkefølgen inden for Next og Later (kommer fra planlægningssessionen #6148).
- Hvilke beta-punkter der skal have "For everyone soon".
- Bestyrelsesbeskederne (#6122, 12 spillere): Confirmed eller Being checked?
- Ordlyden for Holdarbejde/Lederskab (N15) afhænger af mit valg på #5268.

**Sådan arbejder du**
- Du er orkestrator: byg ikke selv, og start ingen håndskrevne agenter. Workers kører i baggrunden; svar på mine beskeder med det samme.
- Verificér før du melder noget færdigt: det spilleren ser på et rigtigt hold, ikke kun at data er skrevet.
- Ingen patch note i sporenes PR'er. Den samlede patch note (EN først) og `help.json` laves ved close-out sammen med NOW.md, FEATURE_REGISTRY, statusboard og done-flip på de fem issues plus #5387, #5388 og #5845.
- Giv mig korte statusser ved hvert merge: hvad der er live, hvad der er næste, og hvad du venter på fra mig.
