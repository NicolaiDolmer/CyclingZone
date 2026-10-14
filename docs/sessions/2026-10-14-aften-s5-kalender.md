# Startprompt: næste session efter 14/10 kl. 20 (S5-start + S5-kalender)

Kopiér alt under linjen ind i en ny Claude Code-session. Skrevet til DOLMERPC (lane-loft 4, ikke målt endnu); på NICOLAIPC er loftet 6.

---

Ny session. Svar på dansk, ét kort ad gangen. Tjek `docs/NOW.md` 🤖 Working agent først (Codex kan arbejde på DOLMERPC; rør ikke filer/issues Codex arbejder på, især #5833 og #6601, uden at spørge).

**Status ved overdragelse (pc1 14/10 eftermiddag):** major-efterslæb #6604 er ryddet og verificeret (Sentry 11 events fra Railway + prod-frontend, @vercel/og 1.0 live, React 19-lint, ESLint 10 marketing). Bølge-loftet er nu pr. maskine: NICOLAIPC 6 laner, default 4 (#6619); verifikations-semafor stadig 2. Preflight kører nu CI's statiske vagter (#6620). Postmortem: `.claude/learnings/2026-10-14-worker-faerdig-foer-review.md` — tjek uløste review-tråde på hver PR før merge-køen.

**Start (5 min):** `git pull --ff-only` + `npm run sync-deps` (lockfiler ændret 14/10: Sentry 11, @vercel/og 1.0.1, ESLint 10 marketing, Dependabot-grupper); `pwsh -File scripts/link-onedrive-context.ps1`; `pwsh -File scripts/agent-doctor.ps1` (forvent `git-bash` + `memory-cloud-only` OK, og nyt `major-behind`-tjek: kun WARN for `@vercel/og` er forventet, låst på 1.0.1); sæt dig som Working agent i NOW. **Mål DOLMERPC** (CPU-kerner, RAM, CPU-last under bølge) og foreslå ejeren dens lane-loft i `scripts/wave-capacity.json` (#6615-mønstret) — indtil da 4 laner.

**Arbejde i rækkefølge:**
1. **S5-startdato:** læs forum-afstemningerne (post 8a504dc4 + b76339e3; lukket 14/10 kl. 20) → endeligt resultat. Codex har arbejdet i #5833 i dag: læs issuets seneste kommentarer, og spørg ejeren før du skriver i #5833. Datoen går ind i S5-kalendergeneratoren.
2. **S5-profiler + kalender live senest lør 18/10 (#6369):** #6360 mellembjerg, #6362 stigende massespurt, #6364 to akser i visningen, #6570 etapesiden 2.0. Læs specs (`docs/superpowers/specs/2026-10-08-s5-etapeprofiler-design-brief.md`) og issuernes seneste kommentarer FØR byg; spillervendte dele kræver designGo. Motor-dele = opus. Byg via `wave.js` (4 laner på DOLMERPC, 6 på NICOLAIPC; motor-filer deler ownership → saml dem i ét spor). Kalender-gaten (`calendarGoldenDiff.mjs`) før generering.
3. **Tor 15/10:** datokort til ejeren om lanceringsteksterne (#6601). Forberedelsen ligger i OneDrive `private-handoffs/2026-10-14-datokort-forberedelse-6601.md` (4 datoer, 5 steder i udkastene + `S5_LAUNCH_COPY` i `backend/lib/emailTemplates.js:682/692`). Ret intet før ejerens go. S5-tørkørsel gennem gaten (#6367) inkl. højdeprofil.
4. Åbne forbedringer fra 14/10 (når kø/laner er fri): #6616 punkt 2 (review-loop i lanen, wave.js), #6617 (Sentry normalizeDepth), #6618 (163 setState-i-effect, efter frontend-frysen).

**Påmindelser til ejeren (NOW):** Alunta-faktura 61,25 kr. (Sentry -62 hver dag) · CodeRabbit-loft (alle PR'er "rate limited" 14/10) · `INDEXNOW_KEY` (#6558) · dvale "Aldrig" på strøm (begge PC'er). `backend/.env` er slettet på pc1 14/10 (Infisical er kilden); findes en på DOLMERPC, spørg ejeren om den må slettes.

**Regler:** byggearbejde kun via bølgen. Intet sendes/postes/aktiveres på ejerens vegne. Ingen natpakker/CronCreate. Close-out efter CLAUDE.md.
