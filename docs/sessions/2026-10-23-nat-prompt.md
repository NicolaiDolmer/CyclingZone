# Natsession 22/10 kl. ca. 23 → 23/10 kl. 08 (PC1) – startprompt

Ejer-designet 22/10 aften (20 spørgsmål + 4 til gennemgangen; alle valg nedenfor er ejerens). Indsæt alt under stregen i en ny Claude Code-session på NICOLAIPC.

---

Du er natsessionen for CyclingZone på PC1 (NICOLAIPC) fra nu til kl. 08:00 dansk tid. Ejeren sover. Du ejer merge-køen, bølgen og alle fælles dokumenter. Arbejd uden pause med rullende optag. Spørg ikke ejeren om noget i natten; saml beslutninger til morgenen.

**Ejerens princip for natten (22/10):** bedst mulige arbejde, hurtigst muligt og i høj kvalitet. Tænk ikke i datoer og skær aldrig en gate eller et krav for at nå noget. MASTERPLAN-reglen gælder: gør det lovede færdigt, ældste løfte først.

## Trin 0 (kør selv, bart og i forgrunden, meld kun afvigelser)
a. `$env:COMPUTERNAME` skal være NICOLAIPC, ellers STOP. `git rev-parse --show-toplevel` = C:/Dev/CyclingZone. `git switch main; git fetch --prune origin; git pull --ff-only`. Rørte pull'et en `*package-lock.json`: `npm run sync-deps`.
b. `pwsh -File scripts/agent-doctor.ps1` + `pwsh -File scripts/close-out-cleanup.ps1` (-Execute ved fund). Supabase `get_advisors` (security): ny udokumenteret WARN → issue.
c. NOW.md "Working agent" → "Claude Code PC1 nat 22-23/10", commit bag guard-commit-branch.sh, push.
d. Læs: docs/NOW.md → docs/MASTERPLAN.md → docs/runbooks/2026-10-25-s4-s5-drejebog.md → denne fil.

## Hårde grænser (viger aldrig)
- **Prod: kun læsning.** SELECT og read-only prøvekørsler. Ingen skrivning, ingen flag, ingen migration applied, ingen `--apply`. Det der skal skrives, bliver et "kør"-kort. Pause/sluk af et live system ved hændelse er tilladt; tænd aldrig.
- **Merge:** tekniske PR'er (ops, docs, tests, interne rettelser, brand-fix uden ny tekst, motor bag slukket revision) merges autonomt ved grøn CI + grøn review-gate + din egen gennemlæsning af hele diffen. Alt spillervendt (UI, tekst, help.json, patch notes, ny adfærd) bliver en færdig PR med ét annoteret før/efter-billede og venter på ejerens ordrette "merge". Migrationer merges ikke i natten (auto-migrate ville skrive i prod) → morgenkort.
- Ingen mails. Print aldrig secrets. Repoet er offentligt: anonymisér spillernavne/handles. Tal, vægte, tærskler og målte andele/hyppigheder kun i `balance-internals/` (hard rule 17); docs er kvalitative.
- Ingen CronCreate/scheduled tasks. Intet Railway-skifte (ejeren klikker fredag). Ingen nøglerotation (#7029).

## Arbejdsform
- Al parallel byg som bølge: `Workflow({ name: "wave", args: { lanes: 6, tracks: [...] } })`, rullende optag, tungeste spor først. Ingen håndskrevne Agent-spawns.
- Model eksplicit pr. spor: **opus** på motor, DB, penge, sikkerhed; **sonnet** på UI og ops; **Fable** kun som uafhængig dommer på v3.
- **Egen review før PR (ejer 22/10):** hvert spor kører `/code-review high` på sin diff og retter alt, FØR PR'en åbnes. Rettelser efter review samles i ÉT push. Codex maks 2 runder pr. PR; derefter bliver P2/P3 et opfølger-issue. Claude-review-markør på højrisiko-PR'er først efter fuld diff-gennemlæsning.
- **Filer med flere spor tages i rækkefølge (ejer 22/10):** løbssiden (`RaceDetailPage.jsx` og dens komponenter) deles af #6512, #6683, #6939 og #6970 → ét ad gangen via `touches`/ownership; samme regel for andre delte filer.
- Preflight og tests kører i FORGRUNDEN i hvert spor (workers der venter på baggrundsjob går i stå). Push mindst hvert 15. min.
- AGENTS 36: DB/motor/ydelse = målt baseline + design FØR første kode-PR.
- Én merge-kø-proces ad gangen (`scripts/merge-queue.ps1 -Pr "a,b"`). MERGED ≠ køen færdig.
- Done-flip straks efter hver merge. Patch notes samles i én PR (7.374), ikke pr. spor.

## Spor (prioriteret)

### 1. Motor v3 (#6804) – højeste prioritet, uden datopres
- Design: `docs/superpowers/specs/2026-10-21-6804-udbrud-pr-loebsgruppe-design.md` (PR #7013) + 17/10-designet. Fem valg låst (A). Byg som **ny revision `s5_profiles_v3`** oven på v2. Alt bag slukket revision.
- Rækkefølge: P0 (testfelt, #7016 ligger klar) og P7 (scorecard) → P1 → mål → P6 → mål → P2 → P3/P4 → P5 → P8. Ét trin pr. commit, testport efter hvert.
- **Ejer-tilvalg (22/10), hver med målt baseline + kort design i v3-specen før kode:** bjergtrøjen vindes for ofte af klassementsvinderen (#6937) · for få udgår (#6938) · jagtafstand på `gap_update` til løbsfilmen (#6814; `docs/superpowers/specs/2026-10-22-loebsfilm-pakken-design.md` §3A; lokal PG17-baseline før kode) · 15-minutters-udbrud (#6912) · pointtrøjen: sprintpoint på bakke/bjerg vægter for højt (#2757, ældste motorløfte) · favoritter efter etapens profil, ikke klassementet (#6939, byg hvis rent).
- D3-ruten (#6486, bjergetape uden topankomst): undersøg om den løses af v3 eller rute-generatoren; byg det rigtige sted.
- Migration til CHECK-værdien `s5_profiles_v3`: PR klar, merges ikke i natten.
- **Tænd-gate (ejer 22/10, skæres aldrig):** G1'-G14 grønne, ikke værre end v2 på noget punkt, Tour-prøvekørsel mod gammel motor, Fable-dommer, 3 udvalgte løbsfilm til ejeren på preview. Morgenrapporten siger ærligt hvad der mangler; ingen datoløfter.

### 2. Ældste løfter først (#6947; MASTERPLAN Nu 4)
- #6210 maks +1 pr. evne pr. dag (PR #6248 findes): rebase, verificér, test, gør klar (træningsfejl, high).
- #5965 træningsudviklingen opleves lavere efter trætheds-rettelsen: read-only undersøgelse mod prod, fund + forslag.
- #3984 samlet indstillings-område (lovet 19/8 + 15/9) og #4714 auktion 12-timers minimum for fri agenter (4/10): begge `needs-decision` → valg-kort med prototype/billede, så de kan bygges samme dag ejeren vælger.

### 3. Pro-sporet #2806 (Forretning, lovet denne uge)
- /pro linkes fra appen, og `isPro()` gater rigtig funktionalitet (rytterhistorik, gemte filtre). Læs `docs/GROWTH_STACK.md` og eksisterende Pro-planer først. Spillervendt + penge → PR med billede, ejer-go. Priser inkl. moms (#5215).

### 4. Stabilitet ved 10x
- #6698 Firefox "too much recursion" på løbssiden: rod-årsag + fix (brand-fix; autonomt hvis ingen ny tekst).
- #6765 rangliste inkrementel: byg videre i skygge-tilstand (design #6849). Ingen migration merges.
- #6491 job-kø + #6492 direkte Postgres: målt baseline + design-doc, ingen kode; aftenafregningen røres ikke før efter 25/10.

### 5. Udvikling 2.0 del 2 + catch-up (#6110, #6950; MASTERPLAN Nu 3)
- Målt baseline + design for del 2 (udvikling via løb, "Udviklingsscore") og catch-up-mekanikken mellem rige og fattige hold. Læs `TRAINING_RULES.md`, #6110's låste valg og #6984-specen først. Valg-kort til ejeren, ingen kode før design-go.

### 6. Beta → live (MASTERPLAN Nu 5)
- Gennemtest løbsbiblioteket (`race_library_v2`) med Kalender | Tabel, etapeside v2, træning for flere ryttere og push som i prod (preview-mock + read-only prod-data). Fejl → issues/rettelser. Klar → tænd-kort med billeder (flag-tænding = ejer-go).
- #6683 terræn-ikoner: ét farvet streg-ikon pr. etapetype overalt (del af løbsbibliotekets tænding). PR + billede.

### 7. Løbsfilm til endagsløb (#6512)
- Designets del C: endagsgrenen i `RaceDetailPage.jsx` viser `StoryOfTheStageSection` med `oneDayTimeline`. PR + billede.

### 8. Spillerløfter og småvalg (PR + billede, ejer-go)
- #6979 hjælp-spørgsmål der går igen: help.json EN+DA efter `docs/TONE_OF_VOICE.md` (jeg/I, aldrig vi; kort på fladen, prosa i Hjælp).
- #6461 Træn nu (kun 4 sessioner): undersøgelse + design + valg-kort, ingen kode.
- Fem småvalg, byg efter disse ejer-godkendte defaults (én PR pr. stk, én linje om valget):
  - #6959 taktik og trup låses samtidig, ved løbets start; under en pause er begge låst.
  - #6967 rytter-søgningen: ét felt "Kontrakt udløber senest sæson X"; frie agenter som valgmulighed "Uden kontrakt".
  - #6974 hjælpetekst: intake-kandidater spænder; faciliteten hæver niveauet, garanterer ikke en topkandidat. Ingen økonomiændring.
  - #6970 banner på løbet pr. pause ("Pauset", ny start når kendt); ingen ny løbsstatus.
  - #6975 triage først (er præstationen en auktionssejr?); hvis ja: "Første sejr" → "Første auktionssejr" (EN "First auction win").
- Codex' spor (Claude tager dem): #6965 transferhistorik "Unknown" + paginering (Codex' utestede patch på issuet) · #6990 U25-milepælen tæller ikke ryttere under 23 · #6991 milepælstekst + "4 af 6"-fremdrift.

### 9. Søndagens sæsonskifte – kun læsning
- Prøvekørsel aldring #6499 og "afventer oprykning" #6710 mod prod → "kør"-kort (drejebog B1/B2).
- Løbsdags-test #5904 (`loadtestRaceDay.mjs`) med S5's gruppetal (6+6 à 24) → kort (B5).
- `pwsh -File scripts/preflight-season-cutover.ps1 -FromSeasonNumber 4 -ToSeasonNumber 5` + genmål drejebogens §1; huller → docs-PR.
- Verificér i kode og tests at de leverede skift-rettelser holder: #6771 (D3→D4), #6964 (19-årige på juniorholdet), #6946 (bestyrelsesbeskeder), #6773 (S3-mandater). Fund → issue + fix før søndag.
- Patch note 7.374 (S5) som PR: Scouting-fanen (#6987), mobilmenu (#7010), S5-ruter/identitet, intet ungdomsklassement i U23/junior (#7031), skadebeskeden (#7042), motor v2. EN først, DA under, kort. Discord-udkast som rå EN-kodeblok i OneDrive-context `drafts/` (ikke git).

### 10. Merge-tog og fredagens deploy i to trin (ejer 22/10)
- Har ejer-go, kør gennem køen: #7043, #7045 (når review-gaten er grøn), #6988 (`condition_model_v2` forbliver slukket), #7011 (send ingen mail), #7012.
- Teknisk, autonomt: #7044, #7048.
- **Merges IKKE i natten:** #6820 v2 og #7021. Fredag er trin 1 = Railway skifter til image af main (uden v2) og verificeres; trin 2 = #6820 + #7021 merges, nyt image, verificér. Forbered en kort trin-for-trin-liste til ejeren (runbook `docs/runbooks/RAILWAY_IMAGE_DEPLOY.md`).
- Venter også: #7036 (help-tekst samme dag som #6710-flaget), #6665 (ejeren siger selv til).
- Kør aldrig `zeroYouthClassificationPoints7031.mjs --apply`; kun prøvekørslen til morgenkortet (ejer valgte at fjerne S4-point, kræver "kør").

## Ikke i nat
#6739 (ejer: ikke nu) · #6924/#6992 (efter 25/10) · #7029 nøgler · Railway-skifte · #6665.

## Stopregler
- Et spor stopper efter 2 CI-fejl på samme symptom → issue med fund, næste spor tages.
- Hele natten stopper ved prod-anomali (Sentry-spike, `/health` ≠ 200 på https://cyclingzone-production.up.railway.app/health, fejlede etape-ticks): kun pause/sluk, notér, vent på ejeren.
- Ingen nye spor efter kl. 07:00. 07:30-08:00: oprydning og rapport.

## Morgen kl. 08:00
1. **Morgengalleri (ejer 22/10):** masterplan-artifactet https://claude.ai/artifact/UoZexVskbfA5xmvTnML4Bn (læs → samme url) får en natrapport: merget; venter på ejeren; v3-status mod tænd-gaten; S5-tal (kvalitativt); og ALLE spillervendte PR'er med før/efter-billede + preview-link, så ejeren kan se dem på Android før kortene.
2. NOW.md (≤1.200 tok): 🎯 Next action + nulstil Working agent. MASTERPLAN hvis køen ændrede sig. `node scripts/generate-status-board.mjs`.
3. Close-out: `pwsh -File scripts/check-agent-token-hygiene.ps1`, `pwsh -File scripts/close-out-cleanup.ps1`. Done-flip på alt merget.
4. **Maks 8 morgenkort (ejer 22/10)**, ÉT ad gangen via AskUserQuestion på dansk, anbefaling først, billede via SendUserFile i samme tur. De 8 vigtigste efter spillereffekt: S5-kørsler (#6499, #6710, #5904) → fredagens deploy-trin → merge af de vigtigste spillervendte PR'er → v3. Resten står som liste i galleriet.
