# Natsession (Opus) 27/8 → fredag morgen: sæsonstart-beredskab + backlog

> Skrevet torsdag 27/8 kl. ~01:20 af beredskabssessionen (Fable). **Sæsonen starter
> FREDAG 28/8 kl. 11.** Ejeren tjekker resultaterne fredag morgen.
>
> **Mandat (ejer 27/8):** PR'er + lav-risiko merges. Dvs.: docs-/test-/CI-vagt-PR'er
> med grøn CI må du selv merge (+ done-flip straks). ALLE kode-PR'er og ALLE
> UI-PR'er står til ejer-review fredag morgen — merge dem IKKE.

## 0 · Hard constraints (læs før alt andet)

- **Kør `date` før du skriver en dato nogen steder.**
- **INGEN prod-mutationer.** Supabase-MCP kun til read-only SELECTs. Rør ALDRIG
  `seasons`, `races`, `race_stage_*`, `race_entries`, feature-flags, RPC'er.
  Slå kolonnenavne op i `database/schema-snapshot.json` FØR ad-hoc SQL.
- **Rør ikke #4278** (D4 for bjergrig — ejer-beslutning efter sæsonstart) og
  **merge ikke PR #4284** (udtagelses-fixes — ejeren reviewer selv fredag morgen).
- **Worktrees:** alt arbejde i worktrees via `scripts/new-worktree.ps1`;
  hoved-checkoutet må ikke skifte branch. Commit kun bag
  `bash scripts/guard-commit-branch.sh <branch>`.
- **Workers:** må spawnes (sonnet), max 3 tunge parallelt; DU ejer e2e-slottet
  (workers kører aldrig fuld suite); spawn-prompter kræver commit pr. delfix +
  push hvert 30. min; 45 min tavshed → status-krav, +15 → TaskStop og overtag.
- **Pre-flight pr. PR:** `pwsh -File scripts/preflight-pr.ps1` + relevante tests
  (TIER-reglerne i CLAUDE.md). UI-ændringer: ægte renderede screenshots i PR-body.
- **Loop-guard:** 2 CI-fails på samme symptom → stop det spor, notér i issuet, videre.

## 1 · Opgaverne (prioriteret — nå så langt du kan, i rækkefølge)

**A. Sæsonstart-kritisk (før alt andet)**

1. **#4200 anden halvdel** (`raceRunner.js:812`) — masterplanens punkt 1 under
   holdudtagelsen. Læs issuet + NOW.md; byg + test + PR. NB: PR #4284 rører også
   `raceRunner.js` (withdrawn-filter i `loadFieldBindingContext`) — basér dig på
   main og undgå konflikt med den, eller cherry-pick dens commit ind i dit worktree.
2. **#4183 + #4233** — nye spillere kan ikke lande korrekt (ét bug,
   `aiTeamGenerator.js:403`, D4-A på 25 hold). Sæsonstart betyder nye signups
   fredag. Byg + test + PR.
3. **Vagterne #4229 · #4215 · #4219 · #4123 · #4211** (masterplanens punkt 3).
   Læs hvert issue; de fleste er guards/CI-gates. Levér som 1 PR pr. issue.
   CI-vagt-PR'er med grøn CI må merges.
4. **#4261 [docs/HØJ]** — fem spillere står med ubesvarede mekanik-spørgsmål om
   løb-som-træning to dage før S3. Opdatér `help.json` (EN først, DA under, æøå i
   DA) + skriv svar-UDKAST til ejeren pr. spørgsmål (han poster selv — send ALDRIG
   spillerbeskeder). Docs-PR → må merges.
5. **#4260 [bug/i18n]** — rå oversættelses-nøgler tre steder (finans-historik,
   fyring, træning 'Tempo'). Lille fix + i18n-check + PR (kode → venter på ejer).

**B. Vagt-robusthed (fredag morgen skal main være til at stole på)**

6. **#4281 [ci]** — Playwright Smoke kører kun på PR'er; main kan stå rød uopdaget.
   Tilføj main-push/schedule-trigger. CI-PR → må merges.
7. **`audit` (league-size) er rød på main + alle branches** (NOW.md løs ende,
   "reelt dødt værn"). Diagnosticér rod-årsagen, fix vagten eller dokumentér
   hvorfor den skal erstattes (issue hvis stort). CI-PR → må merges.
8. **#4184-klyngen: verify-invariants forældede typelister** (finance/notification
   + monument-værn forældet efter eksklusivitets-ophævelsen). Opdatér typelisterne
   så vagten måler det rigtige. Script/test-PR → må merges.
9. **#4258** — klokke-afhængige backend-tests (klokke-drift-testens fund).
   Gør dem deterministiske. Test-PR → må merges.

**C. Diagnoser (read-only, beslutningsgrundlag til fredag)**

10. **#4282** — 2 hold over gældsloft: reelt brud eller forældet loft? Read-only
    målinger + klar anbefaling i issuet (A/B + anbefaling). INGEN mutation.
11. **#4146** — 24 hold over trupgrænse: samme øvelse. Afgør om det er
    S3-transitionens forventede tilstand eller håndhævelses-hul; anbefaling i issuet.

**D. Oprydning (hvis tid)**

12. **#4274 [ops]** — dev-script skrev sin rapport ind i et ANDET worktree.
    Find + fix path-antagelsen. Script-PR → må merges.
13. **#4256 [ops]** — forældreløs branch med 850 linjer #3570-arbejde inkl.
    sikkerhedsfix. Rebase på main i et worktree, kør fuld verifikation, åbn PR
    med tydelig risiko-note. Sikkerhedsfix → merges ALDRIG af dig.
14. **#4259 [ux]** — Planlægning: intet ikon viser at en rytter allerede er
    udtaget til et løb den dag. Direkte udtagelses-UX til fredag. Byg efter
    `PAGE_TEMPLATES.md`-opskrifterne, ægte screenshots i PR. UI-PR → venter på ejer.
15. **Done-men-åbne:** løb `claude:done`-labelede + åbenlyst-shippede issues
    igennem; luk verificerede med `--reason completed` + kort evidens (max ~20).

## 2 · Close-out (inden du slutter, senest ~08:30)

1. **Morgenrapport til ejeren** — kort markdown-kommentar på issue #4283-tråden
   ELLER en `docs/audits/2026-08-28-natsession-rapport.md`: pr. opgave status
   (PR-link / merged / blokeret / ikke nået) + de 2-3 beslutninger ejeren skal
   tage fredag morgen, ENKELTVIST formuleret med anbefaling.
2. **Kør fredag-tjeklistens queries** (read-only) fra
   `sessions/2026-08-27-holdudtagelse-beredskab-session-prompt.md` §6 én gang
   ved close-out og rapportér tallene (overlap = 0? binding-sanity = 0?).
   Assistent-dækningen (query 3) er først meningsfuld kl. ~10:15 — notér det.
3. **NOW.md:** opdatér 🎯 Next action (peg på ejerens fredag-morgen-rutine:
   review #4284 → merge → apply migration → kl. 9-11-tjeklisten) + nulstil
   🤖 Working agent. Budget maks ~1.200 tokens.
4. **Done-flip** pr. merged PR med det samme; `pwsh -File scripts/check-agent-token-hygiene.ps1`.
5. **Patch notes** ved enhver brugerrettet ændring (7.198+); Hjælp/FAQ-rutinen ved
   mekanik-ændringer.
