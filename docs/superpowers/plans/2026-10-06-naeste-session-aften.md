# Prompt: næste Claude-session 6/10 aften (fortsætter direkte)

Model: **Claude Opus 5.5**, indsats høj. Kopiér alt under stregen.

---

Ny session, fortsætter dagen. Arbejdsform (ejer 6/10): langsigtet værdi, best practice, klar til 10x brugere; udfordr status quo; god fart; udskyd intet du kan nå i dag. Beslutninger som popup med anbefaling, én ad gangen. Discord-tekst altid rå i kodeblok. Kald værktøjer bart (ingen `cd X &&`), start merge-køer direkte og én ad gangen, bølger med `Workflow({name:"wave"})` fra repo-root, og læs issuets seneste ejer-kommentar før scope.

**Læs først:** `docs/NOW.md`, `docs/MASTERPLAN.md`, `docs/superpowers/specs/2026-10-06-ejer-beslutninger-stabilitet-10x.md` (10 ejer-beslutninger), `.claude/learnings/2026-10-06-supabase-udfald-og-merge-tempo.md`, hændelsen på #5878.

## 1. Merge (stående regel 35 er udvidet 6/10)
- #6269 patch note 7.343 (ejer-go) → bagefter Discord-tekst rå til ejeren (`node scripts/patch-notes-discord.mjs 7.343`).
- #6270 sharp 0.35.5 i rod + marketing (Dependabot-sikkerhed, merges uden go ved grøn CI).
- Codex' #5692 når den er meldt klar (review diffen) → derefter #6259 (#6120, ejer-go; synk med main, rører seasonTransition.js).
- **#6265 kl. 21+** (ejer-go): indeks-migration med statement_timeout 20 min. Følg auto-migrate, verificér `idx_race_results_race_id_imported_at` indisvalid=true, overvåg backend `/api/feature-flags`. Fejl → `DROP INDEX CONCURRENTLY` + rapport på #6184.

## 2. Denne uge, start nu
- **PostHog A (#4321):** EU-cloud, `posthog-js` (ikke installeret i dag), uden cookies før login, identify efter login, kerne-rejsen (signup → hold → første bud → første løb med egen trup → første træning → dag 2/7), dashboard D1/D7. Bølge-spor.
- **Målinger (read-only):** API-svartider ved etape-tick (#6273, Railway http-response-time), dagens peak → 10× mål (#6275, edge_logs), browserversion i Sentry (Tailwind-gate #6271).

## 3. v3-analysen (efter merges, ejer)
Main har nu hele motorpakken (#6187 #3460 #6185d1 #6223 #6224 #6253 #6247 #6250 #6266). Kør `backend/scripts/v4FlipReadiness.mjs --rules=orders_gc_v3` (inkl. realistisk felt) og replays. Kendte FAIL før #6266: udbrudsrater, bjerg top-10, kort opad, nedkørsel vs top. Opdatér #6260 (anker også i realistisk felt, rebase). Lav en plan for de fejlende ankre. Tal kun i `balance-internals/`. Tænd ALDRIG selv.

## 4. GitHub-rest
34 lukkekandidater fra priority:high-audit 6/10 (ejeren lukker selv claude:done; vis listen), dubletter #6240=#6181 og #6239=#6208, #6207 rutematch 56/51.

## 5. 7/10 (ejerens egne udskydelser)
DB-alarm #6272 · #6248 maks +1: langsigtet model som A/B · #6156 form/formtoppe.

## Close-out
NOW, MASTERPLAN, roadmap-flip (informér ejeren), patch notes, token-hygiejne, close-out-cleanup, status board.
