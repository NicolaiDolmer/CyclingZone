# Dagbølge 2026-09-07 (ejer-bestillinger, ejer ved maskinen)

| Metrik | Værdi |
|---|---|
| Start/slut (lokal tid) | ca. 15:45 → 19:00, Fable som orkestrator |
| Emne | Ejerens egne bestillinger fra Discord #feedback-from-dolmer 2-7/9 + teknisk carry-over |
| Bestillinger verificeret | 17 (agent-tabel): 4 helt glemt (spørgeskema ikke sendt, forum-statistik, webhook-indskrænkning, NPS), resten delvist/issue. Ejer valgte fokus 1+2+3+5+8 (spørgeskema, patch notes, NPS, roadmap, GitHub-audit) |
| PR'er merged (merge-queue, én ad gangen) | #4988 #4996 #5002 #4998 #5003 #4975 #5005 |
| Issues lukket | #4589 #3457 #4993 #4997 |
| Nye issues | #4997 (lukket samme dag), #4999, #5000, #5001, #5004 |
| GitHub-audit (github-housekeeping) | 28 done lukket, 1 dublet (#4059), #3514 done→todo, 0 label-konflikter |
| Ikke merged | #5006 in-app spørgeskema (klar, 47 checks grønne, CodeRabbit 10/11 rettet) — ejeren vil designe spørgsmålene selv |

## Hvad der blev lavet (kort)

- **#4988 holdspil B:** gab -0,06 → 7,35 (v3-paritet 7,10).
- **#4996:** CodeRabbit CLI-trin tilføjet i `make-wave-brief`.
- **#5002 roadmap:** anon-RLS + fallback-bullets, post-verify på `pg_policies` OK.
- **#4998 M10:** solo-id-format `solo-m10-<segment>-<seq>` + strammere incident-undtagelse (CodeRabbit fandt 2 ægte fund, #4993).
- **#5003 NPS:** flyttet til dashboard efter 3 løb + luk-logging. 195 brugere kvalificerer nu (mod 40 viste før). Første 40 min live: 7 vist, 1 svar, 1 luk.
- **#4975 felt-sammenhæng:** CodeRabbit fandt ægte fejl — bonus ramte små grupper. Rod-årsag: `splitKindFor` døbte store felt-klumper "gruppetto". Fix: gate på gruppestørrelse `max(8, 20 % af feltet)`. Ankeret faldt 88 → 69 % efter gating, endte 88,0 % PASS.
- **#5005:** patch note v7.262.
- **§7b refresh** (commit `3c2a33b94`): felt 88,0 % PASS, bjerg 206 s, hale 8,10 %, favorit 62,6 % FAIL (eneste røde), nedkørsel 0,44, sprinter 100 %. §7 række 13 rettet, audit-doc linje 71 rettet.
- **Prod med ejer-go:** `roadmap_items` (3 → shipped, "Deadline day" slettet, 4 nye; `database/manual/2026-09-07-3457-roadmap-refresh.sql`). Migrationer via CI (#5002 policy; #5003 ingen migration).
- **Lukket:** #4589 (ejer B: lad ligge, ingen løn-historik), #3457, #4993, #4997.
- **Docs på main:** spørgeskema v1 (`c62dc8aa2`) + v2 med to akser (`6d8995be3`) + feature-inventar 24/8-7/9 (50 funktioner: 6 shippet, 4 delvist, 29 planlagt, 11 kun lovet); Discord patch-notes catch-up v7.256-7.262 (`a397078d4`); roadmap-SQL (`55ff69687`).
- **#5006 in-app spørgeskema:** klar (47 checks grønne, CodeRabbit 10/11 rettet), ikke merged — ejeren vil designe spørgsmålene ét ad gangen i egen session (hvorfor / hvad bruges / hvilken handling).
- **Chunk-fix #4970 målt på #4595:** events/deploy -21 % efter 1,5 t (forventet -60-70 %), for tidligt målt. Genmål 8/9 14:20.

## Afvigelser/læringer

- **Billeder skal sendes FØR AskUserQuestion.** Ejeren kunne ikke se dem bag kort-teksten.
- **CodeRabbit CLI ligger i `%LOCALAPPDATA%\Programs\coderabbit\coderabbit.exe`, ikke i PATH.** 3 workers troede den manglede.
- **Subagenter har ikke Discord-MCP.**
- **`renderV4AnchorTable` skriver docs uden `--write`** (#5001).
- **Verifikations-agentens fund om manglende patch note på #4913 var forkert** — v7.259 dækkede det. Tjek refs før claim.
- **Kind-strengen "gruppetto" er ikke en gruppestørrelse** — rod-årsagen til #4975.
- **Merge-queue tager `-Pr "N"`, ikke positional args.** Første kald mergede kun den første PR.

_Refs #4595 #4914 #4589 #4987 #4979 #4980 #4992 #4993._

Næste: `docs/drafts/next-session-prompt-2026-09-08-spoergeskema-forum-vaekst.md`
