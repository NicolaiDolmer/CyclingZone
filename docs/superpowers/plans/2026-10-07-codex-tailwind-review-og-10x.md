# Prompt: Codex-session 7/10 - uafhængigt Tailwind 4-review + udfordr status quo (#6300)

Model: Codex med højeste ræsonnement. Kopiér alt under stregen ind i en NY Codex-session fra `C:\Dev\CyclingZone`. Kører parallelt med Claude Code (Claude ejer i dag merge-køen, #6291/#6292-opfølgning, PostHog-dashboard #4321 og #5864).

---

Codex-session 7/10 i C:\Dev\CyclingZone. Følg AGENTS.md og `docs/CODEX_WORKFLOWS.md`. Svar på dansk i almindeligt sprog. **Hele sessionen er read-only:** ingen commits, ingen PR'er, ingen merges, ingen prod-skrivninger, ingen spillertekst, rør ikke `docs/NOW.md`/`docs/MASTERPLAN.md`. Højst ÉN plads i `scripts/verify-lock.ps1` ad gangen (Claude har førsteret). Offentligt repo: **aldrig omsætnings-, omkostnings- eller persondata i GitHub**; de tal hører kun i OneDrive `CyclingZone-context/private-audits/`. Markér hver påstand ✅ målt / 📄 fra kode-doc / ❓ antagelse, som i `docs/GROWTH_STACK.md`. Kald `gh`/`git` bart.

## Del 1 (først, før kl. 10): uafhængigt review af Tailwind 4, PR #6289 (issue #6271)

Ejeren vil have et andet øjne på PR'en før den går live. Claude har lavet sit review (kommentar på PR'en 7/10 + audit-tjeklisten 6/10). **Læs dem, men stol ikke på dem: find det de overså.**

1. Tjek PR'en ud i et eget worktree (`scripts/new-worktree.ps1` eller `git worktree add --detach <sti> da2baef`), aldrig i hovedcheckoutet. `npm ci` i `frontend/`.
2. Gennemgå hele diffen mod `main` med fokus på det, der stille bliver forkert i v4: klasser der blev no-ops (`flex-shrink-*`, `bg-opacity-*`, `*-opacity-*`, `decoration-clone`, `overflow-ellipsis` m.fl.), omdøbte skalaer (`shadow-sm→shadow-xs`, `rounded-sm→rounded-xs`, `blur-sm→blur-xs`, `ring→ring-3`, `outline-none→outline-hidden`) der er rettet i den ene retning men ikke den anden, `space-y-*`/`divide-*` på lister med skjulte børn, `hover:` på touch, `@apply` i CSS, dynamisk sammensatte klassenavne (`` `bg-${x}` ``) som v4 ikke kan finde, og klasser i `.ts`/`.tsx`/`index.html` uden for `@source`.
3. Review `frontend/vite-plugins/tailwind-v3-compat.ts` + test: kan `flattenLayers` ændre kaskaden for nogen regel (fx `@supports`/`@media` med lag indeni, `@property`, `@keyframes`)? Kan `restoreV3Alpha` ramme en deklaration den ikke burde? Hvad sker der i dev-mode (HMR) vs build?
4. Kør `npm run build` og sammenlign den byggede CSS med main's build (byg main i et andet worktree): lav en liste over selektorer der findes i den ene men ikke den anden, og forklar hver forskel der ikke er ren omdøbning. Tjek at den byggede CSS har 0 `@layer` og ingen fuldt dækkende `var()`-fallbacks.
5. Kør de berørte tests: `node --test` i `frontend/` og `node scripts/verify-affected.mjs` (under verify-lock). Kun hvis tid: Playwright-snapshots i ét projekt.
6. **Lever:** én PR-kommentar på #6289 med `CODEX-REVIEW da2baef: KLAR` eller `IKKE KLAR` + fund som tabel (fil:linje, hvad spilleren ville se, alvor, forslag). Ingen fund = skriv hvad du har tjekket, så det kan efterprøves.

**Del 1b: hvad Tailwind 4 gør muligt (forslag, ikke kode).** Ejerens spørgsmål: "Hvis det nye Tailwind er bedre, burde det ikke hjælpe os med langvarige forbedringer?" Svaret er ja, men i separate små PR'er EFTER den rene migration (ellers kan ingen skelne en fejl fra en forbedring). Lav en rangeret liste over højst 6 konkrete forbedringer som v4 åbner for i netop vores app, fx container queries til kort/tabeller på mobil, `@starting-style`-overgange, `text-wrap: balance/pretty`, ét token-system i `@theme` (lys/mørk), P3/oklch-farver, hurtigere build. For hver: hvilke sider, hvad spilleren mærker, browser-krav mod vores målte browserandel (Sentry; ca. 2 % under Chrome 111) og om `tailwind-v3-compat.ts` skal ændres. Skriv den som kommentar på #6271. Hold dig til `docs/design/TASTE.md` + `docs/design/PAGE_TEMPLATES.md` (ingen glow, ingen skygger, 5px radius, ingen emoji).

## Del 2: udfordr status quo, vejen til markant vækst (#6300)

Mål (ejer 7/10): find de få, professionelle og bæredygtige tiltag der kan give en mangedobling af indtægten over tid, og som også hjælper her og nu. Kvalitet og fair play først: intet pay-to-win (`docs/BUSINESS_STRATEGY.md` §3 er ufravigelig).

**Læs først:** `gh issue view 6300`, `docs/GROWTH_STACK.md`, `docs/BUSINESS_STRATEGY.md`, `docs/BILLING_STACK.md`, `docs/OPERATING_PLAN.md`, `docs/MASTERPLAN.md`, `docs/superpowers/specs/2026-10-06-ejer-beslutninger-stabilitet-10x.md`, `docs/strategy/TDF_2026_LAUNCH_PLAN.md`, Claudes analyser på #6291 (dag 2) og #6292 (kilde) fra 7/10. Byg videre på dem, dupliker dem ikke.

**Grundlag (målt, ikke gættet):** `infisical run --env=prod -- node scripts/monday-numbers.mjs` (read-only) + Supabase SELECT (slå kolonner op i `database/schema-snapshot.json` FØR SQL). Byg én tragt: besøg → signup → hold → første bud → første løb → D1/D2/D7/D30 → betaler → opsigelse. Find hvor flest falder fra, og hvad der adskiller dem der bliver og betaler. Pengetal kun i det private bilag.

**Spørgsmål der skal besvares (ét afsnit hver):**
1. **Tilgang:** hvilke kanaler skalerer (SEO for "pro cycling manager"-søgninger, AI-assistenter, Reddit/Hattrick/PCM-communities, cykel-podcasts/YouTube, Grand Tour-sæsoner, henvis-en-ven #1173)? Hvad koster en aktiv spiller pr. kanal i ejer-tid?
2. **Fastholdelse:** hvad er det ene stærkeste dag-1/uge-1-loop, vi mangler? (Claudes #6291-fund: spillere der byder, træner og udtager hold på dag 1 kommer tilbage langt oftere.)
3. **Betaling:** er Pro værd at betale for, sammenlignet med tier-planen i BUSINESS_STRATEGY §2? Pris, årsplan, Patron/supporter, gaver, holdabonnement, hvorfor folk opsiger. Hvad sælger andre fair-play-managerspil (Hattrick, GPRO, Football Manager-communities, Velogames)?
4. **Status quo der bremser:** hvad i vores egen måde at arbejde på (antal spor, procesregler, ejerens tid som flaskehals, driftsomkostning pr. aktiv spiller, stabilitet ved 10x) skal ændres eller stoppes? Vær konkret og ærlig.

**Lever:**
- **Privat bilag** `OneDrive/CyclingZone-context/private-audits/2026-10-07-10x-undersoegelse-private.md` med alle tal og regnestykket: hvor mange aktive og betalende spillere kræver en mangedobling, og hvilken kombination af tiltag kan realistisk nå dertil på 6, 12 og 24 måneder.
- **Offentlig kommentar på #6300** (ingen pengetal): højst 7 tiltag rangeret efter effekt ÷ indsats. For hvert: hypotese, forventet effekt (interval + ✅/📄/❓), pris i ejer- og agenttid, hvor let det rulles tilbage, målepunkt, stopregel og første skridt på 2 uger. Plus en kort "stop med at gøre dette"-liste og din anbefalede top 3.
- **Højst 5 nye issues** med `needs-decision` for de øverste tiltag, hvert som ét beslutningskort (A/B + anbefaling), `Refs #6300`.

Du må dele Del 2 op i op til 4 read-only spor (`kind: "investigate"` i `scripts/codex-wave.mjs`), fx tilgang / fastholdelse / betaling / konkurrenter. Hvert spor skriver kun i sin egen scratch-mappe; du samler.

## Afslutning
Kommentér status på #6289, #6271 og #6300. Sidste linje i din chat: `CODEX-REVIEW #6289: KLAR/IKKE KLAR <sha>` og antal fund pr. alvor, så Claude kan merge eller rette.
