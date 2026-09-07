# Prompt til næste session: ejerens egne bestillinger først (8/9 2026)

> **Model + indsats:** hovedtråd **Fable, high** (prioritering + ejer-dialog). Workers: **opus** til engine-rebasen (#4975/#4988) og UI-design, **sonnet** til småfund, docs og patch notes. Ét ejer-kort ad gangen; ingen mega-dossier.
>
> Skrevet 7/9 ved close-out af dagbølgen (audit: `docs/audits/day-wave-2026-09-07.md`). Kopiér teksten under stregen ind som første besked i en ny Claude Code-session i `C:\Dev\CyclingZone`.

---

Ny session. Læs `docs/NOW.md` først (🎯 Next action + carry-over fra 7/9), derefter dette. Du er arkitekt; workers bygger med `model` eksplicit i hvert kald. Ejeren er ved maskinen og vil have beslutninger ÉN ad gangen med anbefaling; kontekst skal stå INDE i kortet.

**Emne 1 (før alt andet): hvad ejeren selv har bestilt.** Læs Discord-kanalen **#feedback-from-dolmer** (id `1522915781766283296`) for de sidste 7 dage (1/9-8/9) med `mcp__discord__discord_read_messages` (limit 60). Det er ejerens egne bestillinger, ikke spillerønsker. For HVER bestilling: slå op om den findes som issue/PR (`gh issue list --search`, `gh pr list --search`), om den er shippet (merged PR + live på cyclingzone.org), eller om den er glemt. Genmål, gæt ikke. Lav derefter ÉT kort: en rangeret liste over hvad du foreslår vi fokuserer på i dag, med begrundelse pr. punkt (bestilt-dato, status, hvad der mangler). Ejeren vælger rækkefølgen. Kendte bestillinger fra kanalen 4-7/9 (verificér status, tag ikke listen for givet):

- 6/9 (til 7/9): patch notes tjekkes på hjemmesiden OG i Discord for de seneste 14 dage; manglende noter lægges ind begge steder. Dagbølgen 7/9 lagde én samlet note på hjemmesiden (se NOW.md) — Discord-siden er IKKE tjekket.
- 6/9 (til 7/9): spørgeskema til alle spillere (hvad er vigtigst / hvad fungerer dårligst) — er det sendt? (#4820 indholdsplan + spørgeskema).
- 6/9 (til 7/9): roadmap på hjemmesiden opdateres (nye punkter ind, færdige ud); skal matche roadbooken i Discord.
- 6/9 (til 7/9): GitHub-audit (dubletter, done-men-åbne). Dagbølgen flippede 15 issues done; en fuld audit er ikke kørt (`github-housekeeping`-skillen).
- 7/9: forum: visningstal pr. tråd, seneste indlæg-forfatter før man åbner tråden, antal indlæg på spillerprofilen (tjek #4751/#4818/#4819/#4821 og forumkategori-issues).
- 7/9: Discord-webhooks: de samlede divisions-kanaler (results-d2/d3/d4) skal væk, kun division+gruppe skal have webhooks.
- 7/9: "Founder"-badge på ejerens egen managerprofil, synligt for andre.
- 7/9: for få NPS-besvarelser — gør det muligt/lettere at svare; find ud af om brugerne bare lukker den.
- 4/9: forum-indlæg-liste (Pro-fordele, U23/junior, nationale mesterskaber, S4-ruter, ansigter/personligheder, spilleridentitet, recruit-a-friend) + forum roadmap-kategori kun for ejeren (#4818) + billeder i forum (#4819).
- 3/9: forum- og social-pakke (#4751): klikbare navne, profilbillede, autosignatur, Discord-link, DM/indbakke, venner, online-liste, flere kategorier, mobil, "markér alle som læst", abonnér pr. kategori, @-tag med indbakke-besked.
- 2/9: Pro/alunta-siden på engelsk + euro (#4608/#4616, venter på ejerens nøgleblok) · dashboard loader for langsomt — mål alle sider, ret de værste én ad gangen.
- 31/8: patch-notes-SSOT (hjemmeside + Discord) · "modtag forslag fra assistenten"-knap på træningssiden + assistent-knapper generelt.

**Emne 2: teknisk carry-over fra 7/9 (kør parallelt som workers, ingen ejer-kort nødvendigt før merge):**
- #4975 (felt-sammenhæng, finale.ts) og #4988 (holdspil B, ejer-valgt) ligger oven på den gamle #4971-sha. Rebase begge på main, regenerér golden fixtures (nye `group_merged`-events + vagter fra #4971), genmål ankre på 5 seeds, merge én ad gangen via `scripts/merge-queue.ps1`; refresh §7b efter hver merge (`node backend/scripts/buildV4AnchorBaseline.mjs && node backend/scripts/renderV4AnchorTable.mjs --write`, commit som docs). CodeRabbit-review på begge før merge (#4975 har ét; #4988 mangler).
- Mål chunk-fixet (#4970 live 7/9 ~14:20): CYCLINGZONE-56 events/dag før/efter (`infisical run --env=dev -- node scripts/sentry-issues.mjs --period=48h`) + deploy-verify-summary. Forventning: -60-70 % ved samme deploy-tempo. Skriv tallet på #4595 og luk hvis det holder.
- #4589 reparation: 19 ryttere i akademiet siden 28/8 kan have forkert løn (dry-run `database/manual/2026-09-07-4589-academy-demote-salary-repair-dryrun.sql`). Ejer-kort: kør reparation (ejer-GO på netop det skridt) eller lad ligge.
- Bifund fra #4971-workeren: `incidents.ts` (M10) trækker en uheldsramt i solo-gruppe efter M2-splittet, og `incidents.ts`/`climbSelection.ts` deler id-formel (`segmentIndex*1000+seq`) → mulig kollision på `solo-<n>`. Issue findes (se NOW.md); sonnet-lane.
- CodeRabbit-flow: bølge-PR'er åbnes som draft og markeres klar til sidst (#4991 shippet); CLI'en er installeret og logget ind (`coderabbit review --base main --committed` i worktreet, ~2,5 min, egen kvote). Læg CLI-reviewet ind som fast trin i `scripts/make-wave-brief.mjs` FØR `gh pr ready`. Sky-review kun på det endelige incrementelle pas. Spending cap 20 USD + 25 USD promo-kredit (udløber 14/9).

**Regler for sessionen:** TIER WAVE for workers (målrettede tests + tsc + preflight, CI er fuld gate), push inden 10 min og hvert 15. min, `scripts/wave-lane-watch.ps1 -Once` hvert 15. min, merges én ad gangen (aldrig HH:57-HH:03), ingen patch notes i PR'er (samlet ved close-out), UI merges kun efter ejerens preview-go, alt der skriver i prod kræver ejerens ordrette "merge"/"kør". Copy = `docs/TONE_OF_VOICE.md` (ingen tankestreger — tone-vagten fejler ellers). Vent aldrig blokerende på en worker; svar på hver besked fra ejeren med det samme. Done-flip pr. issue umiddelbart efter merge. Close-out: NOW.md ≤1.200 tokens, Working agent nulstillet, uafsluttet som issues, ny prompt i `docs/drafts/`.
