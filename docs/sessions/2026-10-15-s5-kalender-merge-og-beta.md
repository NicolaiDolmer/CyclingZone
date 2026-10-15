# Startprompt: næste session efter 14/10 aften (S5-kalender, beta, datokort)

Kopiér alt under linjen ind i en ny Claude Code-session. Virker på begge PC'er: NICOLAIPC har lane-loft 6, DOLMERPC har 4 (målt 14/10: 8 kerner, 31,5 GB RAM, CPU 65 % med 2 laner + 2 agenter; loftet bevares).

---

Ny session. Svar på dansk, ét kort ad gangen. Tjek `docs/NOW.md` 🤖 Working agent først. Codex arbejder på pc1 med auditten af de svageste områder (`docs/sessions/2026-10-14-codex-audit-svageste-omraader.md`; rapport kommer i `docs/audits/2026-10-14-svageste-omraader.md` + issues med `needs-design`). Rør ikke #5833 eller #6601 uden at spørge, og læs Codex' seneste kommentarer der først.

**Start (5 min):** `git pull --ff-only`, derefter `npm run sync-deps` hvis lockfiler er ændret, `pwsh -File scripts/link-onedrive-context.ps1` og `pwsh -File scripts/agent-doctor.ps1`. Sæt dig som Working agent i NOW.

**Låst 14/10 (spørg ikke igen):**
- **S5:** første løbsdag onsdag 28/10, sidste løbsdag **lørdag 28/11** (forum: 15/20 og 13/20; #5833). Fra S5 slutter en sæson om lørdagen (#6635 merget). S6 foreløbig mandag 30/11 – lørdag 26/12 (datokortet).
- **S5 §1d = 160 løbsdage pr. division** (32 datoer × 5, samme regel som S4's 140). Ejer-go 14/10 ca. kl. 23.
- **Etapeside 2.0** (#6570) er merget bag `stage_page_v2` = **off**. Ejeren tænder beta selv eller siger det; spørg ikke.
- **Løbshistorien** (replay, Final 5 km som TV-grafik, øjeblikke, mellemtider, referat) skal bygges på løbsloggen. Kontrakten er merget i #6632. Design: artifact v7 https://claude.ai/artifact/CfMddzMmT4uG9FfK3oVQRS. Underlag vises kun, når det ikke er asfalt.

**Arbejde i rækkefølge:**
1. **Merge kalender-PR #6637** (#6367). Generatoren overholder S5-reglerne. Den rummer også review-rettelser (bench via kvote-generator, grus i brosten-aksen) og §1d = 160 (commit `2b218b844`). Tjek uløste review-tråde og CI og merg via `scripts/merge-queue.ps1`. Det er teknisk med design-go, så du merger selv. Kør derefter `buildSeasonCalendar --season 5 --last-day 2026-11-28` som dry-run mod prod (offline er grøn). **Åbne gates før `--apply`:**
   - (a) motor-delen af benchmark-gaten (enkeltstart, #6362/#6363)
   - (b) bølgede etapers afslutningsbånd (regnet med udbrud, som ikke findes i S5; anbefalet: behold benchmarken og mål på motoren under #6368)

   Vis ejeren kalenderen live og få ordret go før `--apply`. Kalender live senest **lør 18/10** (#6369).
2. **Løbshistorien på etapeside 2.0** (del 2 af #6570): byg replay, øjeblikke, mellemtider, Final 5 km og referat på kontrakten fra #6632. Kør via `wave.js`, opus. Spillervendt, men design-go findes allerede (v7).
3. **Tor 15/10: datokort** til ejeren om lanceringsteksterne (#6601). Forberedelsen ligger i OneDrive `private-handoffs/2026-10-14-datokort-forberedelse-6601.md`. Ret intet før ejerens go.
4. **Landingpage** (Codex-handoff i #1369, kommentar 6168854429 + OneDrive `private-handoffs/2026-10-14-claude-code-complete-planning-handoff.txt`): ejeren vil tale om "mennesket bag" (valgt: personlig motivation + bygget sammen med spillerne). Derefter FAQ/footer, billeder, SEO og testplan. Hold P01–P20-registret synligt.
5. **Codex' audit:** når rapporten ligger klar, præsenter top 5 som kort, ét ad gangen.

**Påmindelser til ejeren:**
- Post Discord-tekst 7.356–7.360 (`docs/drafts/discord-patch-7356-7360-2026-10-14.md`, 2 opslag).
- Alunta-faktura 61,25 kr.
- CodeRabbit-loft.
- `INDEXNOW_KEY` (#6558).

**Regler:** byggearbejde kun via bølgen. Intet sendes, postes eller aktiveres på ejerens vegne. Ingen natpakker eller CronCreate. Close-out efter CLAUDE.md.
