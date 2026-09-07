# Prompt til næste session: spørgeskema-design + forum/Discord + vækst (8/9 2026 eller senere)

> **Model + indsats:** hovedtråd **Fable, high** (dialog + prioritering). Workers: **opus** til forum-UI og DM/indbakke, **sonnet** til webhooks, docs, målinger. Ét ejer-kort ad gangen, kontekst INDE i kortet, billeder sendes FØR kortet (ejeren kan ikke se billeder bag kort-teksten, bidt 7/9).
>
> Skrevet 7/9 ca. 19:00 ved close-out af ejer-bestillings-sessionen (audit: `docs/audits/day-wave-2026-09-07-ejer-bestillinger.md`). Kopiér teksten under stregen ind som første besked i en ny Claude Code-session i `C:\Dev\CyclingZone`.

---

Ny session. Læs `docs/NOW.md` først, derefter dette. Du er arkitekt; workers bygger med `model` eksplicit i hvert kald. Ejeren er ved maskinen. Beslutninger ÉN ad gangen med anbefaling; alt der skriver i prod venter på ejerens ordrette "merge" eller "kør".

**Frist FØRST (5 min):** #4270 S4-kalender skal applies inden 10/9. Tjek status (`gh issue view 4270`), og læg et ejer-kort med præcis hvad der køres og hvad ejeren skal se live før go. Kør intet uden "kør".

**Del A: spørgeskema-design, ét spørgsmål ad gangen (ejer-dialog, ingen workers).** Grundlag: `docs/discord/2026-09-07-spoergeskema-spillere-v2.md` (12 spørgsmål), `docs/discord/2026-09-07-feature-inventar-24-8-til-7-9.md` (50 funktioner, 11 kun lovet), PR #5006 (in-app infrastruktur: tabeller, side, dashboard-kort, `backend/scripts/sendSurveyInvite.mjs`; seed i `database/2026-09-07-4943-in-app-survey.sql`, status draft; SSOT `docs/SURVEY_SYSTEM.md` på branchen). For HVERT spørgsmål ét AskUserQuestion-kort med: (1) hvorfor stiller vi det, (2) hvad bruger vi svaret til, (3) hvilken konkret handling udløser dataene (fx "score under 3 på X → X ryger ud af S4-planen"), plus din anbefaling: behold / omformulér / drop / erstat. Saml op til sidst: rettet spørgsmålsliste → worker (sonnet) retter seed + i18n på branchen `feat/4943-in-app-survey` (worktree `C:\Dev\CyclingZone-worktrees\feat-4943-in-app-survey`), CI grøn → merge-kort → ejer tester live på cyclingzone.org/survey/2026-09-features (åbn kun for ejerens hold) → "kør": `UPDATE surveys SET status='open'...` + `sendSurveyInvite.mjs --dry-run` → `--apply`. Discord-post + patch note ved udsendelse. Analyse-SQL står i SURVEY_SYSTEM.md; platform findes ikke i DB (Clarity).

**Del C: forum + Discord (ejerens bestillinger 3-7/9), workers parallelt:**
- #5000 forum: visningstal pr. tråd, seneste indlægs forfatter i trådlisten, antal indlæg på managerens forumprofil (opus, UI → preview-go).
- #4999 Discord: resultat-webhooks kun til division+gruppe-kanaler; samlekanalerne results-d2/d3/d4 skal ikke modtage (`backend/lib/discordNotifier.js`, `getResultWebhooksAndLabel`; sonnet).
- #4818 roadmap/roadbook-kategori kun ejeren kan poste i · #4819 billeder i forum (afklar upload/moderation i ét kort først).
- Rest af #4751: DM/indbakke mellem managers, venner, online-liste, Discord-link på profil, abonnér pr. kategori, @-tag → indbakke. Lav ét kort med rækkefølge + estimat; byg det ejeren vælger.
- Verificér Founder-badget visuelt på den offentlige managerprofil (#4649 lukket, men profilsiden bruger ældre badge-system).

**Vækst (ejeren bad om forslag; præsentér som ÉT rangeret kort før byg):** #4964 launch-kohorten holder 28,6 % mod 86,8 % etablerede, signups 20→6/uge (analyse + første fix) · #2760 win-back-mail til 77 med samtykke (Mail v2 merget, kræver ejer-GO dry_run) · #1173 recruit-a-friend (ligger også i spørgeskemaet) · #4067 SEO-site (1 indekseret side) · #3796 "hvor hørte du om os" · #4811 signup-sprog · #4235 forum vs Discord (15/9) · #4616 Pro i euro (ejerens nøgler, 30 min). Mål før/efter for alt vækst.

**Målinger der skal samles op:** #4595 chunk-fix events/deploy (genmål efter 8/9 14:20, `scripts/sentry-issues.mjs --period=48h`) · #4997 NPS (viste/svar/luk siden 7/9 17:15 via `users.nps_last_prompted_at`, `nps_responses`, `player_events nps_*`) · roadmap-stemmer på de 4 nye punkter.

**Regler:** TIER WAVE for workers (målrettede tests + tsc + preflight; CI = fuld gate; UI/i18n → hele e2e lokalt), push inden 10 min og hvert 15. min, `scripts/wave-lane-watch.ps1 -Once` hvert 15. min, merges én ad gangen via `scripts/merge-queue.ps1 -Pr "N"` (aldrig HH:57-HH:03), CodeRabbit CLI før `gh pr ready` (`%LOCALAPPDATA%\Programs\coderabbit\coderabbit.exe`, ikke i PATH; kør fra PowerShell i worktreet), ingen patch notes i PR'er (samlet ved close-out), UI merges kun efter ejerens preview-go med billeder sendt FØR kortet, subagenter har ikke Discord-MCP (orkestratoren læser). Copy = `docs/TONE_OF_VOICE.md` (ingen tankestreger). Svar på hver ejer-besked med det samme; vent aldrig blokerende. Done-flip pr. issue straks efter merge. Close-out: NOW.md ≤1.200 tokens, Working agent nulstillet, uafsluttet som issues, ny prompt i `docs/drafts/`.
