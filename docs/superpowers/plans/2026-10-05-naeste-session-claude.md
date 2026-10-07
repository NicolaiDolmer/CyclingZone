# Prompt: næste Claude-session (løbsmotoren), start 5/10 eftermiddag

Model: **Claude Fable 5.1**, indsats **høj**. Kopiér alt under stregen.

---

Ny session, fortsættelse af planlægningen 5/10 (#6148). **Fokus: løbsmotoren er det vigtigste.** Undersøg altid før du spørger (ejer-kommentarer på issuet, PR'er, prod). Stil beslutninger som 4 popup-spørgsmål ad gangen med nøgletal i spørgsmålet. Udskyd aldrig uden aftale, og skriv aldrig egne tidsskøn. Opdatér roadmappet og MASTERPLAN i samme tur som hver beslutning.

**Læs først:** `docs/NOW.md`, `docs/MASTERPLAN.md` og #6157 med alle diagnoser fra 5/10 som kommentarer på #6187 #6185 #5978 #6201 #6199 #6200 #6137 #3460 #5951.

**1. Tjek først (prod):**
- Merge-køen fra 5/10: #6183 og patch note #6211 merget? Post-verificér. Kør `node scripts/patch-notes-discord.mjs 7.341` og giv ejeren teksten til Discord.
- #6153: ingen 500 på `/api/rankings/*`.

**2. Løbsmotoren (hovedopgaven):** lav ÉT samlet billede med alle diagnoser (årsag, hvad spilleren ser, 2 retninger hver), send det som fil, og tag så designsamtalerne ét punkt ad gangen og visuelt, med ægte etapedata:
1. Eget hold jagter sit udbrud (#6187)
2. Hvem må i udbrud + udbrudsstørrelse på bjerg (#5978 #6201)
3. Afsat udbryder mærkes forkert (#6185)
4. Tidsmodel: stigning og nedkørsel (#6199 + #6200, én fælles model)
5. Spar kræfter (#3460)
6. v4-grænser + scorecard (#2557)
7. Løbsfilm (#6137), tekster (#6186 #5059)

Hvert aftalt design bygges straks via `Workflow({name:"wave"})` (maks 4 laner, `model` eksplicit). **Form og formtoppe (#6156) bygges først, når resten er undersøgt og designet.** #6156 må IKKE stå på roadmappet som kendt fejl (embargo, spec 4/10 beslutning 3).

**3. Når motoren kører i laner:** Udvikling 2.0 D1-D7 (#6110, + #4765) · udgifterne gennemgås med ejeren (Vercel Usage, Supabase staging ca. 100 kr/md, Railway; #6202 #6184) · #6053 programmer (ejeren var ikke glad) · Train now bliver i beta, mens #6139 (lås efter træning) og #6111 (gevinst ikke synlig) rettes, og der skrives et svar til tråden "Feedback: New training system" · #5864 (PR #6198 → dry-run → ejeren ser listen live → go) · #6130 (6 hold uden mandat → go) · #6196 timeouts (synk med main; rører boardAutoAccept.js).

**4. Staging:** kopi og rens er gjort (1.889.644 resultater, 0 webhooks, 300 auth pseudonymiseret). Restoren blev afbrudt, så kør schema-fingeraftrykket mod prod, ret huller, og kør derefter #6170-prerequisites. Så kan Codex måle (#5904).

Resten af ugens liste står i MASTERPLAN under "Uge 41" (#6212 patch notes, #708, #6209 omdømme-løfte, #6210, #4714, Holdarbejde-opfyldning m.fl.).
