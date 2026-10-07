# Prompt: næste Claude-session (6/10 aften → fortsætter)

Model: **Claude Opus 5.5** i Claude Code, indsats høj. Kopiér alt under stregen ind i en ny session fra `C:\Dev\CyclingZone`.

---

Ny session, fortsætter 6/10. Svar på dansk, kort og i almindeligt sprog uden fagjargon: ejeren skal kunne følge med uden at kende issue-numre. Status ved hver milepæl er **3 linjer**: hvad er færdigt, hvad venter, hvad skal ejeren gøre. Beslutninger kommer som popup, én ad gangen, med anbefaling og nøgletallene i selve spørgsmålet. Kald værktøjer bart (ingen `cd X &&`). Kør én merge-kø ad gangen (`scripts/merge-queue.ps1`). Bølger startes med `Workflow({name:"wave"})` fra repo-roden. Læs issuets seneste ejer-kommentar, før du fastlægger scope.

**Læs først:** `docs/NOW.md`, `docs/superpowers/specs/2026-10-06-ejer-beslutninger-stabilitet-10x.md`, `.claude/learnings/2026-10-06-supabase-udfald-og-merge-tempo.md`.

**Frihed (ejer 6/10):** merge selv ved grøn CI + diff-tjek + review, når det gælder teknik uden spillertekst (hard rule 35: ops/CI/infra, Dependabot, motor bag slukket regel-revision) OG små tekstrettelser. Vis ejeren tekstrettelserne bagefter. Spørg altid først ved nye spillervendte features, økonomi/balance, data-ændrende migrationer og alt der **tænder** noget. **Start aldrig natkørsler eller tidsstyrede jobs selv (CronCreate o.l.).** Foreslå tidspunktet og vent på ejerens OK. Spillerpåvirkende skridt (deploy af frontend, migrationer, tænding) lægges uden for spidstid: spids er kl. 11-14 og 19-22, lavpunktet starter kl. 23.

## 1. Merge-gennemgang (først)
Gennemgå alle åbne PR'er. For hver: hvad gør den (én linje), CI-status, hvilken merge-regel den falder under, og om den kan merges nu, kræver ejer-go eller skal vente til lav trafik. Åbne 6/10 kl. ~19:
- **#6280** PostHog uden cookies (banner + privatlivstekst). Ejer-go givet ved grøn CI, men den er frontend-deploy → foreslå tidspunkt uden for spidstid.
- **#6279** PostHog server-milepæl + tabel `user_milestones` (additiv migration), regel 35. Merges sammen med #6280.
- **#6265** indeks-migration (statement_timeout 20 min). Ejer-go "kl. 21+", men tunge DB-ting skal ligge uden for spidstid. Følg auto-migrate, verificér `idx_race_results_race_id_imported_at` indisvalid=true, og overvåg `/api/feature-flags`. Fejler den: `DROP INDEX CONCURRENTLY` + rapport på #6184.
- **PostHog tænding** (ejer-go "efter merge, uden for spidstid"): offentlig projektnøgle (EU-projekt 259474) som `VITE_POSTHOG_KEY` i Vercel og `POSTHOG_PROJECT_KEY` på Railway + Infisical. Print aldrig værdien. Verificér at `$pageview` er "seen", og byg D1/D7-dashboardet for kerne-rejsen.
- #6281 #6254 (ops), #6248 (træning maks +1: ejeren vil se en langsigtet model som A/B 7/10), #6198 (udløbne kontrakter, ejer-gated), #6053 (træningsprogrammer, UI), drafts #6170 #6136 #5827.
Pak de tre første + PostHog-tænding som ÉN natpakke-prompt og spørg ejeren, om og hvornår den skal køres.

## 2. Sideløbende: Tailwind 4 (bølgespor) + 10x forretning (hovedsession)
- **Tailwind 4** (#6271, ejer-go 6/10, merge senest 13/10): plan og faldgruber står i ejer-kommentaren på #6271. Kort: `tailwindcss@4.3.3` + `@tailwindcss/vite`, gennemgå hver ændring uden for `className` (værktøjet lavede `removeEventListener("blur")` → `"blur-sm"` og ændrede prosa i patch notes), flyt tokens og z-skala til `@theme`, TIER FULL + snapshots i alle 3 Playwright-projekter, og ét samlet før/efter-billede til ejeren før merge.
- **10x forretning:** følg `docs/superpowers/plans/2026-10-06-session-10x-forretning.md`.

## 3. Beta: hvad kan forlade beta?
Lav en liste over ALT der kun er live for beta (flags og `FEATURE_REGISTRY.yml`, fx træning, sæsonmatrix og programmer). For hver: hvad det er, live-brug (Postgres), åbne fejl og klager, og en dom (klar til alle / forbedres først med konkret liste / mangler). Vis listen visuelt (ét billede), og lad ejeren vælge, hvad der flippes. Flip aldrig selv.

## 4. Race engine: er det godt nok for spillerne?
Tre dele, alle read-only:
- **Det live nu (v4):** dagens og gårsdagens løb i prod. Ser resultater, udbrud, tider og løbsfilm rigtige ud? Tjek de seneste klager fra Discord/issues.
- **v3-reglerne før tænding:** analysen fra 6/10 står på #5515 (12 PASS / 3 FAIL, plan for de fejlende ankre; tal i `balance-internals/v3flip-2/`). Er analysen god nok som beslutningsgrundlag, og hvad mangler? Tænd ALDRIG selv.
- **Testdækning:** hvilke spillervendte race-fejl de sidste 30 dage ville vores automatiske tests have fanget, og hvilke ikke? Foreslå de 3 vigtigste nye tests.

## 5. Roadmap på hjemmesiden
Skal være sand og opdateret i dag. Alt merget 6/10 står som færdigt, intet står falsk som "i gang", og de næste store ting (Tailwind 4, PostHog, v3-regler, stabilitet/10x) står rigtigt. Vis før/efter. Roadmap-flip må du selv køre, informér ejeren.

## Close-out
NOW.md (Next action + Working agent nulstillet), MASTERPLAN hvis rækkefølgen ændrede sig (spørg først), patch notes samlet for dagens spillervendte merges (#6277: ranglisten opdateres nu ~1 min efter løb; #6280 privatlivstekst), token-hygiejne, `close-out-cleanup.ps1` (efterladt mappe `C:\Dev\CyclingZone-worktrees\tw4-probe` med låst fil), status board.

**Fra i dag (til orientering):** merget #6269 #6270 #6247 #6277 (inkl. Claude-review-rettelser, verificeret i prod) #6260 #6259. Målinger på #6273 (worker-service uge 44), #6275 (peak 6.474 kald/min, 83 % fra tick-backend) og #6271 (Tailwind-gate). Session-prompter klar: prompt-audit og 10x i `docs/superpowers/plans/2026-10-06-session-*.md`.
