# Natbølge 2026-08-05

| Metrik | Værdi |
|---|---|
| Start/slut (lokal tid) | 23:20 → 05:50 (6t30) |
| Spor launched / fuldført / døde | 22 / 13 / 1 (reddet) — 8 kørte stadig ved close-out |
| PR'er åbnet / merged | **16** / **0 — merge kræver ejer-go** (runbook trin 5) |
| Issues → claude:done | Ingen (ingen merges) |
| Recoveries | 1 (uncommitted arbejde reddet af orkestrator) |
| Preflight | GO kl. 23:22 (`.codex.local/night-wave-preflight.json`) |
| Nye issues | #3347, #3349, #3350, #3353, #3360 |

## Merge-rækkefølge (anbefalet)

**1 · Backend-only, grøn CI, ingen design-gate** — kan merges i rækkefølge uden ejer-diskussion:
`#3352` (security: JWT til stdout) → `#3355` (akademi-kontrakt, **tidskritisk**) → `#3354` (etape-berigelse) → `#3356` (dagsløn-label) → `#3358` (scorecard-guard) → `#3359` (race_results-integritet) → `#3351` (cron-registry)

**2 · Ryttertype-kæden — merges som ÉN enhed, i rækkefølge:**
`#3343` → `#3348` → `#3357`. Kræver først at #3343's patchNotes-konflikt løses og #3357's `frontend-smoke` er grøn. Migration `valuation_type` applies efter merge.

**3 · Kalenderen — før S3 bygges (deadline 23/8):**
`#3344` (+ katalog-migration, ejer-godkendt) → `#3346`

**4 · Kræver ejerens øjne (synlig UI):**
`#3341` (Resultat-hub, #3102-IA) · `#3339` (finance-guard) · `#3361` (sæsonskifte) · `#3362` (kontraktudløb)

**Konflikter:** #3339, #3341, #3343 er CONFLICTING i `patchNotes.js`. `gh pr update-branch` afviser dem (kræver manuel opløsning). **Rebase udefra i et agent-worktree virker ikke** — forsøgt, git ville genafspille hele historikken fra "Initial commit"; afbrudt uden skade, branches verificeret uændrede. Løs i en frisk worktree eller lad PR-ejeren gøre det.

## Migrationer klar, ingen kørt

| Fil | PR | Gate |
|---|---|---|
| Akademi-kontrakt-reparation (2 filer) | #3355 | **Tidskritisk** — uden den frigives 22 ryttere fejlagtigt ved S2→S3 |
| `valuation_type`-kolonne | #3357 | Additiv, efter kæde-merge |
| `entrant_key` + unique constraint | #3359 | Har indbygget pre-flight `RAISE EXCEPTION` mod data-drift |
| `apply_race_results_batch`-RPC | #3359 | Efter constraint |
| Katalog-udvidelse (15 race_pool-rækker) | #3344 | Ejer-godkendt 4/8 |

**Ejer-go:** "vælg 15-30 opgaver mere … fortsæt i omkring 7 timer … vær grundig og lav nogle fede ting … find ting i de nuværende planer, eller vær proaktiv og foreslå nye fantastiske ting, der udfordrer status quo."

## Afvigelse fra runbook: ingen barrierer

Bølgen blev kørt med **individuelle Agent-kald frem for Workflow-`parallel()`**. Hver agent notificerer selvstændigt, så et hængende spor kan ikke blokere de øvrige — netop den fejlmode der dræbte natbølge 3/7 og 17/7. Det viste sig relevant: ét spor døde, og de 18 andre kørte upåvirket videre.

Keep-awake kørte hele bølgen. Stall-vagten blev skiftet ud undervejs: den første version flagede **færdige** spor som hængende (stale mtime kan ikke skelne "død" fra "færdig"), hvilket gav ren støj. Erstattet af en vagt der melder på **fremdrift** (nye PR'er) i stedet for på stilhed.

## Redningen

`feat/3327-3328-tier2-calendar-balance` (#3344): agenten døde efter at have skrevet en færdig, verificeret måling — men før den committede. Worktree'et havde 4 upushede commits plus uncommitted arbejde. Per runbook §Recovery blev agenten først nudget (ingen respons på 60 min), derefter reddet manuelt: tests kørt (5261/5261), commit `a4d12dc7`, force-push med lease.

Arbejdet var værd at redde — det viste at orkestratorens eget ×1,25-gæt **ikke opfyldte kriteriet** (DB 390 mod mål 520), og fandt det målte ×1,5 sammen med en dokumenteret bivirkning.

## Fire spor var allerede løst — og det er nattens vigtigste ops-læring

| Spor | Faktisk tilstand | Hvad agenten så gjorde |
|---|---|---|
| **#3015** AI-restitution | Lukket 3/8, PR #3246 | Ingen branch, ingen PR. Målte i stedet frisk fatigue-data og fandt at AI nu restituerer **mere** end mennesker |
| **#2840** dagsløn | Merged i PR #3256, config-gated, slået fra | Målte hullet: 398 ryttere, 391.520 CZ$ sæsonløn undgået |
| **#3009** scorecard-gate | Lukket, PR #3248 (3/8) | Kørte scorecards'ene og fandt at **pengemængden firdobles** (#3360) |
| **#2916** sæsonskifte-opsætning | Lukket 30/7, PR #2987 | Fandt en 6. flade der ikke var dækket: 44/115 døde løbs-referencer |

**Læringen er ikke "spild".** Alle fire agenter verificerede issue-state før de kodede, oprettede ingen duplikater — og tre af dem producerede fund der er mere værd end den oprindelige opgave. Nattens to alvorligste fund (#3360 pengemængde, fatigue-asymmetrien) kom fra spor der teknisk set var forældede.

**Men dispatch-fejlen er min:** alle fire blev valgt fra `MASTERPLAN.md`s tekst uden at tjekke issue-state. Planen halter efter hvad der faktisk er shippet. `gh issue view <N> --json state` før dispatch koster ét kald og havde sparet fire spor. `MASTERPLAN.md` linje 13 er rettet som følge af dette.

## Fund der ikke stod i noget issue

| Fund | Hvor |
|---|---|
| Samme bug som PR #2929 rettede 25/7 fandtes **uændret et andet sted** (`resolveGraduation()`) — andet audit-spor, derfor overset. Plus et tredje hul i release-grenen. | #2881 / PR #3355 |
| **22 ryttere risikerer fejlagtig frigivelse ved sæsonskiftet 23/8** hvis reparationen ikke køres inden | #2881 / PR #3355 |
| Anti-mønstret i #2877 fandtes **to** steder, ikke ét | #2877 / PR #3354 |
| De 20 tabte etape-berigelser kan **ikke** regenereres (ingen fatigue-historik, `race_entries` er ikke en frossen snapshot) — men fladen degraderer ærligt til v1-recap | #2877 |
| Sikkerhedshookens sti-scan matchede kun stier med indledende `/` — den relative form slap forbi | #3342 / PR #3352 |
| De 37 Sentry-monitorer blev ikke slået fra bevidst: 21 stopper i samme 11-timers vindue = kvote-håndhævelse efter en event-flod | #2892 / PR #3351 |
| `developRidersForSeason` ville have revalueret hele populationen stille ved **første sæsonskifte efter merge** | #3345 / PR #3357 |
| `OtherWorldTourB`s eget afkast (455) er allerede under 2×ProSeries (520) — B fejler #3328's kriterium uafhængigt | #3344 |
| Menneskeholdenes ryttere har median 85 i træthed mod AI-holdenes 54 | #2650 |
| **Pengemængden firdobles over 5 sæsoner** (4,24× mod mål 1,3×); `2026-06-21-economy-fase2-calibration.md` er stale med ~90× drift | #3360 |
| **#1150 er ikke 807 men 1.399 udløbende ryttere.** AI-hold havde INGEN fornyelses-mulighed — op til 80 AI-hold ville være skåret til 3-5 ryttere | PR #3362 |
| 44 af 115 `target_race_ids` peger allerede på døde S1-løb — skete ved skiftet 27/7, uopdaget | PR #3361 |
| `race_results` har 710.397 rækker (issuet sagde 487.377) og 225.947 NULL-rider_id (issuet sagde 247) — men **0 ægte dubletter** | PR #3359 |

## Nye issues oprettet

**Proaktive (udfordrer status quo):** [#3349](https://github.com/NicolaiDolmer/CyclingZone/issues/3349) terræn-mixet er skævt mod fladt (kuperet 27,7 % mod virkelighedens 37,6 %) · [#3350](https://github.com/NicolaiDolmer/CyclingZone/issues/3350) spillerne gætter på reglerne — skjul tallene, forklar reglerne.

**Fundet undervejs:** [#3347](https://github.com/NicolaiDolmer/CyclingZone/issues/3347) tier 3's realisme-gate fejler ~11 % på tilfældighed · [#3353](https://github.com/NicolaiDolmer/CyclingZone/issues/3353) V4-værdimodellen skal re-fittes.

## Syntese

De otte målinger fra aftenen og natten er samlet i [`2026-08-05-simulation-drift-synthesis.md`](2026-08-05-simulation-drift-synthesis.md). Kernen: fire uafhængige mekanismer producerer alle spillernes klage om at specialisering ikke betaler sig, og de bør ikke løses enkeltvis i vilkårlig rækkefølge.

## Patch notes

Agenterne rørte **ikke** `patchNotes.js` (per runbook) — hver PR har sin tekst under `## Patch note (til orkestrator)`. Da intet er merged, skal den konsoliderede entry skrives **efter** merge, ikke nu. Ellers ville patch notes love noget der ikke er live.

## Afvigelser/læringer

1. **Ingen barrierer > chunking.** Individuelle Agent-kald gjorde hang-isolationen strukturel i stedet for proceduremæssig. Ét spor døde; 21 kørte upåvirket videre.
2. **Stall-detektion på mtime virker ikke** når færdige og hængende spor ser ens ud. Fremdrifts-signaler (nye PR'er, nye commits) er bedre og støjfri.
3. **Verificér issue-state ved dispatch**, ikke kun planen. Kostede 4 spor — men gav paradoksalt nattens bedste fund.
4. **Redning betaler sig.** Det døde spors uafsluttede arbejde indeholdt bølgens mest præcise måling, og viste at orkestratorens eget gæt var forkert.
5. **Rebase ALDRIG et agent-worktree udefra.** `git rebase origin/main` i et agent-worktree forsøgte at genafspille hele historikken fra "Initial commit". Afbrudt uden skade, men det er en fælde der kan koste en hel bølges arbejde. Brug `gh pr update-branch` (server-side) eller en frisk worktree.
6. **Næsten hvert issue-tal var forældet** — og typisk med faktor 10-1000 (247→225.947 · 807→1.399 · "grøn"→90× drift). Et issue der er mere end en uge gammelt bør genmåles før det bruges som beslutningsgrundlag, ikke citeres.

## Femte gang: "allerede bygget" er reglen, ikke undtagelsen

#2815 (PR #3363) fandt at det gradvise gældsloft allerede var bygget under **#3134 / PR #3228** (merged 3/8) og shippet slået fra, afventende ejerens tærskler. Agenten byggede derfor kun UX-delen — hvilket issuets egen 30/7-kommentar da også havde skåret scope til.

Det er femte spor i nat hvor arbejdet helt eller delvist var gjort (#3015, #2840, #3009, #2916, #2815). **Mønstret er ikke tilfældigt:** repoet shipper hurtigere end issue-teksterne og MASTERPLAN opdateres. Konsekvensen er reel dobbeltarbejde-risiko for enhver fremtidig bølge.

Konkret forslag til næste bølge: et dispatch-forfilter der for hvert kandidat-issue tjekker (a) `state`, (b) om der findes en merged PR med `Refs #N`, (c) hvornår issue-body sidst blev opdateret. Issues ældre end en uge markeres "genmål før dispatch".

## Hvad der stod tilbage ved close-out

Ved close-out kl. 06:05 kørte 7 spor stadig: peak-redigering (#3094/#2883/#2645) · write-grants-audit (#2830) · paginerings-guard (#3331) · aktiverings-hullet (#3007) · scouting (#3334/#2721) · sæson-recap (#2752/#2361) · nyt holds bestyrelse (#2022) · sprog-flimmer (#2045). Plus en genoptaget agent på #3357's `frontend-smoke`-fejl.

Alle har uncommitted arbejde i deres worktrees (1-12 filer hver). Falder de ud uden at pushe, gælder runbook §Recovery: fortsæt i SAMME worktree, ikke en ny.

**Live status er `gh pr list --state open`** — denne fil er et øjebliksbillede fra close-out, ikke en løbende optælling. PR-tallet i metrik-tabellen kan derfor være lavere end det faktiske antal om morgenen.

## Playwright-noter til merge-tiden

To uafhængige spor verificerede at `mobile-webkit`-login-fejlen er en **pre-eksisterende flake**, ikke en regression — #2815's agent bekræftede det ved at køre samme test 2× mod ren `origin/main`, hvor den også fejlede. Klassificér den som advisory per runbook.

`#3357`s `frontend-smoke`-fejl **er også en flake** — og orkestratorens første vurdering var forkert. Jeg konkluderede "ikke en flake" fordi den ramte alle 3 projekter samtidig. Den genoptagne agent modbeviste det ved at genkøre **samme commit** fire gange: FAIL, PASS, FAIL, PASS. **~50 % flake-rate**, filet som [#3364](https://github.com/NicolaiDolmer/CyclingZone/issues/3364).

Rod-årsag: `getByRole('tab', {selected: true})` i `race-distribution.spec.js:434` er ikke scopet til én `tablist` og matcher både Planlægnings-hubbens fane og kalender-sidens interne underfane, afhængigt af om den mockede fetch resolver inden for retry-vinduet.

**Læring:** "fejler på alle projekter" er ikke bevis for determinisme — alle tre projekter kan ramme samme timing-race. Det eneste gyldige bevis er gentagne kørsler af samme commit. En required check med 50 % flake er værre end ingen check, fordi ægte fejl drukner i støjen.
