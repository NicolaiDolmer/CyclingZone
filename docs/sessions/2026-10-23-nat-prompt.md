# Natsession 22/10 kl. ca. 23 → 23/10 kl. 08 (PC1) – startprompt

Ejer-designet 22/10 aften (16 spørgsmål, alle svar nedenfor er ejerens). Indsæt alt under stregen i en ny Claude Code-session på NICOLAIPC.

---

Du er natsessionen for CyclingZone på PC1 (NICOLAIPC) fra nu til kl. 08:00 dansk tid. Ejeren sover. Du ejer merge-køen, bølgen og alle fælles dokumenter i natten. Arbejd uden pause i 10 timer med rullende optag; spørg ikke ejeren om noget i natten – saml beslutninger til morgenkortene.

## Trin 0 (kør selv, bart og i forgrunden, meld kun afvigelser)
a. `$env:COMPUTERNAME` skal være NICOLAIPC, ellers STOP. `git rev-parse --show-toplevel` = C:/Dev/CyclingZone. `git switch main; git fetch --prune origin; git pull --ff-only`. Rørte pull'et en `*package-lock.json`: `npm run sync-deps`.
b. `pwsh -File scripts/agent-doctor.ps1` + `pwsh -File scripts/close-out-cleanup.ps1` (-Execute ved fund). Supabase `get_advisors` (security): ny udokumenteret WARN → issue.
c. NOW.md "Working agent" → "Claude Code PC1 nat 22-23/10", commit bag guard-commit-branch.sh, push.
d. Læs: docs/NOW.md → docs/MASTERPLAN.md → docs/runbooks/2026-10-25-s4-s5-drejebog.md → denne fil.

## Hårde grænser (viger aldrig, heller ikke om natten)
- **Prod: kun læsning.** SELECT og read-only prøvekørsler. Ingen skrivning, ingen flag, ingen migration applied, ingen scripts med `--apply`. Alt der skal skrives, bliver et "kør"-kort til morgenen. Pause/sluk af et live system ved hændelse er tilladt; tænd aldrig.
- **Merge:** tekniske PR'er (ops, docs, tests, interne rettelser, brand-fix uden ny tekst, motor bag slukket revision) merges autonomt ved grøn CI + grøn review-gate + din egen diff-gennemgang. Alt spillervendt (UI, tekst, help.json, patch notes, ny adfærd) bliver en færdig PR med ét annoteret før/efter-billede og venter på ejerens ordrette "merge". Migrationer merges ikke i natten (auto-migrate ville skrive i prod) → morgenkort.
- Ingen mails sendes. Print aldrig secrets. Repoet er offentligt: anonymisér spillernavne/handles. Tal, vægte og tærskler kun i `balance-internals/` (hard rule 17); docs er kvalitative.
- Ingen CronCreate/scheduled tasks. Intet Railway-skifte (ejeren klikker fredag i dagtimerne). Ingen nøglerotation (#7029).

## Kapacitet og arbejdsform
- Al parallel byg som bølge: `Workflow({ name: "wave", args: { lanes: 6, tracks: [...] } })`, rullende optag, tungeste spor først. Ingen håndskrevne Agent-spawns.
- Model eksplicit pr. spor: **opus** på motor, DB, penge, sikkerhed; **sonnet** på UI og ops; **Fable** kun som uafhængig dommer på v3 før tænd-kortet.
- Codex-review på hver PR, maks 2 runder; P2/P3 derefter = opfølger-issue. Claude-review-markør på højrisiko-PR'er (`node scripts/review-gate.mjs post-claude-review --pr N --verdict clean`) først efter du har læst hele diffen.
- AGENTS 36: DB/motor/ydelse = målt baseline + design FØR første kode-PR.
- Én merge-kø-proces ad gangen (`scripts/merge-queue.ps1 -Pr "a,b"`). MERGED ≠ køen færdig.
- Done-flip (`claude:todo` → `claude:done`) straks efter hver merge. Patch notes samles ét sted (7.374-PR), ikke i hver PR.

## Spor (i prioriteret rækkefølge)

### 1. Motor v3 (#6804) – højeste prioritet. Ejer: "hurtigst muligt, før sæsonstart helst" (første S5-etape 28/10 kl. 11)
- Design: `docs/superpowers/specs/2026-10-21-6804-udbrud-pr-loebsgruppe-design.md` (PR #7013) + 17/10-designet. Alle fem valg er låst (A). Byg som **ny revision `s5_profiles_v3`** (v2 tændes fredag ved Railway-skiftet; v3 bygges oven på v2). Alt bag slukket revision.
- Rækkefølge: P0 (testfelt, #7016 ligger klar) og P7 (scorecard) → P1 → mål → P6 → mål → P2 → P3/P4 → P5 → P8. Ét trin pr. commit, testport efter hvert.
- **Ejer-tilvalg i v3 (22/10):** bjergtrøjen vindes for ofte af klassementsvinderen (#6937), for få udgår (#6938), jagtafstand på `gap_update` til løbsfilmen (#6814, designet i `docs/superpowers/specs/2026-10-22-loebsfilm-pakken-design.md` §3A, kræver lokal PG17-baseline før kode), 15-minutters-udbrud (#6912). Plus #6939 (favoritter efter etapens profil, ikke klassementet): mål + design, byg hvis det er rent. Hver: målt baseline + kort design i v3-specen → byg i pakken.
- Migration til CHECK-værdien `s5_profiles_v3`: PR klar, merges ikke i natten.
- **Tænd-gate (ejer 22/10):** G1'-G14 grønne, ikke værre end v2 på noget punkt, Tour-prøvekørsel mod gammel motor, Fable-dommer, 3 udvalgte løbsfilm til ejeren på preview. Mål: tænd-kort klar så hurtigt som muligt; skriv i morgenrapporten hvad der mangler og hvornår det realistisk er klar.

### 2. Stabilitet ved 10x
- #6698 Firefox "too much recursion" på løbssiden: rod-årsag + fix (brand-fix, merges autonomt hvis ingen ny tekst).
- #6765 rangliste inkrementel: byg videre i skygge-tilstand (design #6849). Ingen migration merges.
- #6491 job-kø + #6492 direkte Postgres: målt baseline + design-doc. Ingen kode; aftenafregningen røres ikke før efter 25/10.

### 3. Løbsfilm til endagsløb (#6512)
- Designets del C: `RaceDetailPage.jsx` endagsgren viser `StoryOfTheStageSection` med `oneDayTimeline`. Spillervendt: PR + før/efter-billede, venter på go. Patch note samles.

### 4. Spillerløfter (PR + billede til morgen-go)
- #6979 hjælp-spørgsmål der går igen (form/træthed, nye spillere, frie agenter, manager): help.json EN+DA efter `docs/TONE_OF_VOICE.md` (jeg/I, aldrig vi; kort på fladen, prosa i Hjælp).
- #6683 terræn-ikoner: ét farvet streg-ikon pr. etapetype overalt (TASTE + PAGE_TEMPLATES).
- #6461 Træn nu (kun 4 sessioner): kun undersøgelse + design + valg-kort, ingen kode.

### 5. Fem småvalg – byg efter disse ejer-godkendte defaults, én PR pr. stk med billede og én linje om valget
- #6959: taktik og trup låses samtidig, ved løbets start; under en pause er begge låst. Én regel, én forklaring.
- #6967: rytter-søgningen får ét felt "Kontrakt udløber senest sæson X"; frie agenter med som valgmulighed "Uden kontrakt".
- #6974: hjælpetekst (intake-kandidater spænder; faciliteten hæver niveauet, garanterer ikke en topkandidat). Ingen økonomiændring.
- #6970: banner på løbet pr. pause ("Pauset", ny start vises når kendt); ingen ny løbsstatus.
- #6975: triage først (er præstationen en auktionssejr?); hvis ja, omdøb "Første sejr" → "Første auktionssejr" (EN "First auction win").

### 6. Codex' spor (Claude tager dem; Codex kører ikke parallelt)
- #6965 transferhistorik "Unknown" købspris + paginering (Codex' utestede patch står på issuet; verificér, test, byg).
- #6990 bestyrelsens U25-milepæl tæller ikke ryttere under 23 (sæsonalder ≤ 25 er U25; kun seniortruppen tæller, #5898).
- #6991 milepælstekst: én sætning pr. milepæl + "4 af 6"-fremdrift; lang forklaring til Hjælp. Spillervendt → billede + go.

### 7. Søndagens sæsonskifte – kun læsning
- Prøvekørsel aldring #6499 og "afventer oprykning" #6710 mod prod; tallene som "kør"-kort (B1/B2 i drejebogen).
- Løbsdags-test #5904 (`loadtestRaceDay.mjs`) med S5's gruppetal (6+6 à 24); exit-kode og tal til kort (B5).
- `pwsh -File scripts/preflight-season-cutover.ps1 -FromSeasonNumber 4 -ToSeasonNumber 5` + genmål drejebogens §1; huller → docs-PR (merges autonomt).
- Patch note 7.374 (S5) som PR: akademiets Scouting-fane (#6987), mobilmenu (#7010), S5-ruter/identitet, intet ungdomsklassement i U23/junior (#7031), skadebeskeden (#7042), motor v2. EN først, DA under, kort. Discord-udkast som rå EN-kodeblok i OneDrive-context `drafts/` (ikke git). Ejeren godkender.

### 8. Merge-tog (én kø ad gangen; alt deployes først ved fredagens Railway-skifte)
- Har ejer-go: #7043 (skadebesked), #7045 (intet ungdomsklassement; når review-gaten er grøn), #6988 (form/træthed 2.0, `condition_model_v2` forbliver slukket), #7011 (S5-mail; send ingen mail), #7012 (ops).
- Teknisk, autonomt: #7044 (Codex-guard), #7048 (løbsfilm-design).
- Venter: #6820 v2 og #7021 (deployes med skiftet fredag), #7036 (help-tekst samme dag som #6710-flaget), #6665 (ejeren siger selv til).
- **Kør aldrig** `zeroYouthClassificationPoints7031.mjs --apply` – kun prøvekørslen til morgenkortet (ejer valgte at fjerne S4-point, kræver "kør").

## Ikke i nat
#6739 (ejer: ikke nu) · #6210 · #6924/#6992 (efter 25/10) · #7029 nøgler · Railway-skifte · #6665.

## Stopregler
- Et spor stopper efter 2 CI-fejl på samme symptom → issue med fund, næste spor tages.
- Hele natten stopper ved prod-anomali (Sentry-spike, `/health` ≠ 200 på https://cyclingzone-production.up.railway.app/health, fejlede etape-ticks): kun pause/sluk, notér, vent på ejeren.
- Ingen nye spor efter kl. 07:00. 07:30-08:00: oprydning og rapport.

## Morgenrapport kl. 08:00
1. Opdatér masterplan-artifactet https://claude.ai/artifact/UoZexVskbfA5xmvTnML4Bn (læs → samme url) med en natrapport: merget, venter på ejeren (merge/kør/vælg), v3-status mod tænd-gaten, S5-tal (kvalitativt; tal i balance-internals).
2. NOW.md (≤1.200 tok): 🎯 Next action + nulstil Working agent. MASTERPLAN hvis køen ændrede sig. `node scripts/generate-status-board.mjs`.
3. Close-out: `pwsh -File scripts/check-agent-token-hygiene.ps1`, `pwsh -File scripts/close-out-cleanup.ps1`. Done-flip på alt merget.
4. Når ejeren vågner: kortene ÉT ad gangen via AskUserQuestion på dansk, anbefaling først, billede via SendUserFile i samme tur. Rækkefølge: S5-kørsler (#6499, #6710, #5904-dispensation) → merges af spillervendte PR'er → v3-status → småvalg.
