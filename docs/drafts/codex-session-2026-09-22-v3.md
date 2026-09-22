# Codex-session v3 (ny session fra bunden; ejeren kopierer alt i kodeblokken)

> Samler hovedprompten 22/9 + tillægget + status efter Codex' første session (1a = PR #5487). Erstatter `codex-prompt-2026-09-22.md` og `-addendum.md` som Codex' indgang; de to bevares som historik. Vedligeholdes af Claude ved hver kontrol-session.

```
Du arbejder i C:\Dev\CyclingZone (github.com/NicolaiDolmer/CyclingZone). Svar mig på dansk. Dette er en ny session; intet fra tidligere samtaler er i din hukommelse. Al state står i filerne og på issues.

LÆS FØRST (i denne rækkefølge): AGENTS.md · CLAUDE.md · docs/NOW.md · docs/MASTERPLAN.md (øverste blok) · docs/TONE_OF_VOICE.md · docs/design/PAGE_TEMPLATES.md · seneste kommentar på #5443 og #5435 (ejer-beslutning 22/9) · docs/drafts/2026-09-22-winback-mail.md.

FASTE REGLER
- Eget worktree + egen branch pr. opgave via scripts/new-worktree.ps1, oprettet fra hoved-checkoutet. Skriv ALDRIG i hoved-checkoutet. Kør ikke `git fetch` inde i en sandboxet worker; ajourfør main i hoved-checkoutet FØR du opretter worktreet.
- Commit kun bag scripts/guard-commit-branch.sh <branch> <dir>. Push efter commit. PR-body = templaten, Brugerverifikation "- [x]", "Refs #N", PR-nummer i titlen. Når en PR med #N i titlen merges, flipper du #N til claude:done i samme tur.
- Du merger ALDRIG. Go = mit ordrette "merge". UI-PR = skærmbilleder desktop 1440 + mobil 390 med ægte data i PR'en.
- Ingen --apply, ingen flag-flip, intet skrives til prod. Ingen hold-/rytternavne i committede filer.
- Spillervendt tekst: EN først, DA under, jeg/du (aldrig vi), ingen em-dash, kort på fladen. Patch notes: "What changed: ..." / "Hvad er ændret: ...", 1-2 sætninger.
- Tunge kørsler: pwsh -File scripts/verify-lock.ps1 -Max 2 -- <kommando>. scripts/preflight-pr.ps1 før push. Maks 8 åbne PR'er. Token-hygiejnens kendte FAIL på FEATURE_STATUS.md er ikke din; ignorer den.
- Stablede PR'er (base = anden PR's branch) lukkes af GitHub når basen merges: byg altid fra main, aldrig oven på en åben PR.
- Bølger kun via indgangen fra #5468; første bølge = #5482 (blokeret af FETCH_HEAD-fund, Claude tager den). Indtil da: ét spor ad gangen.
- Ét spørgsmål ad gangen, kort, anbefaling først. Udskyd intet selv. Stop og vis resultatet efter hver opgave.
- SESSION-REGEL: når en opgave er i PR og venter på mit "merge", eller når samtalen passerer ca. 80 beskeder, skriver du "Ny session anbefales: <hvad næste session starter med>" som sidste linje. Al state skal stå i docs/NOW.md eller på issues, aldrig kun i samtalen.

STATUS 22/9
- Merget i dag: #5477 #5478 (v7.293) #5465 (skader 5-25 løbsdage bag flag) #5469 (finale-kalibrering) #5475 (indbakke-crash) #5468 (Codex-bølger).
- 1a (best_role som data, inkl. #5423) = PR #5487; merget eller afventer mit "merge" (tjek `gh pr view 5487`). #5488 = CRLF-artefakt i en test-vagt, egen lille PR, ikke en fejl på main.
- Ejer-beslutninger 22/9: værdien regnes på den rating spilleren SER (bedste rolle nu), og værdiskift + visning lander som ÉT skift · v4 løbsmotor live ved S4-start 28/9 · #5281 venter til flip-dagen · #3512 lukket, #5327 omskrevet · #5444 splittes · win-back-tekst godkendt.

OPGAVER i rækkefølge (stop og vis mig efter hver):

1. VÆRDI + RATING = SAMME ROLLE (#5443 + #5435), fortsættelse efter 1a:
   1b) RE-FIT: v5 med type_source = "best_role" (riderValuationModelV5.json, fit.offset pr. type fittes om). Ny branch fra main med KUN dev-scripts fra PR #5444 (v4RefitDryRun5443.mjs, v4RefitCompare5443.mjs, marketV3AndEvent5443.mjs, unfreezeSelection5443.js + test, scorecard-/fit-udvidelser, SQL-forslag) = #5444-splittet; luk #5444 når den er merget. Kalibrér så samlet holdværdi rammer det godkendte mål (ikke stiger af sig selv); mål og rapportér: værdihop ved rolleskift (fordeling, top 20), samlet pengemængde før/efter, misbrug (kan man træne sig til rolleskift og hop?), listen over ryttere der taber over halvdelen. Scorecard + sim. INGEN model-flip. Vis mig tallene; jeg vælger.
   1c) ADMIN-FORHÅNDSVISNING: tabel value_transition_preview_5443 (rider_id, team_id, primary_type, best_role, rating_before, rating_after, value_before, value_after, diff, computed_at; idempotent migration i database/) · tørkørslen upserter · GET /api/admin/value-transition-5443 (requireOwner, sortering/filter/totaler pr. hold) · T2-side admin/value-transition-5443 efter PAGE_TEMPLATES (overblik først, tabular figures) · FJERN den gamle AdminValueTransitionPage.jsx (+ shape + test) og endpoints /admin/market-value-level-correction/gate + /dry-run i backend/routes/api.js (~13774-13816) + route/link; rør IKKE RiderLevelCorrectionReceipt.jsx / NotificationsPage.jsx. Skærmbilleder med tørkørselsdata.
   1d) VISNING (#5435, kun model A, ingen loft-tal): rating på kortet = bedste rolle nu, badge = naturlig rolle (rytterprofil, Mit hold, rytterdatabasen), bag app_config-kontakt (off) så den tændes i samme deploy som kørslen; ratingGolden.5321.json KUN med mit go; Vercel-preview + før/efter-billeder (desktop + mobil).
   Derefter #5461: rebase mod main (7.294 er næste), tone (præfiks, 1-2 sætninger, jeg-stemme), udvid med visningen, dato = "KØRSELSDAG". Ret udmeldingen (docs/drafts/2026-09-20-vaerdiskifte-*.md + 2026-09-22-vaerdiskifte-forum.md) så den nævner at ratingen på kortet nu er bedste rolle.

2A. LØBSMOTOR v4 KLAR TIL S4-START (#4916): læs docs/RACE_ENGINE_RULES.md §5. Én PR pr. punkt, alle bag race_engine_v4 (off), v4-testsuiten grøn: #4914 (all_out ikke gratis på fladt, grupetto, feltspredning; scorecard 5 seeds) · #4707 (jagt-model vs. bjerg-anker) · #4915 (TTT uheld/tidsgrænse/point) · #4948 (hjælpe-sektion vises bag flag). Derefter v3/v4-sammenligning på 5 seeds som én rapport i docs/audits/, så jeg kan sige "flip".

2B. WIN-BACK-MAIL (#2760): ret backend/lib/emailTemplates.js buildWinbackEmail (EN + DA) ordret til docs/drafts/2026-09-22-winback-mail.md. Opdatér tests + snapshot. Ingen afsendelse, ingen flag. PR med rendret HTML-skærmbillede (EN + DA).

3. #5327 ARKETYPE, LILLE UDSNIT: primær type fra DEFAULT_DISTRIBUTION i archetypeDistribution.js (kalender-efterspørgsel + FLOOR_PCT 8,5) i stedet for TIER_TYPE_WEIGHTS, bag app_config-kontakt (off), på #5269's own-priors-underlag. Ingen signatur-boost. Før/efter-fordeling på 1.000 genererede ryttere i PR-body + sim-harness grønt.

4. BRAND, ugens spillerfund (én PR pr. issue, patch note-linje i hver): #5471 rangliste på mobil · #5313 indbakken åbner ved nyeste besked · #5417 Race Center mobil "View details" · #5456 + #5418 skader/Echelon: TAL FØRST (SELECT, sidste 14 dage vs. før 12/9), ingen ændring uden mit go · #5483 hjælpetekst national kerne (≥4 ryttere OG ≥35 %) · #5488 CRLF-vagt.

5. BESTYRELSEN færdig: #5472 desktop-layout + i18n-huller fra beta; derefter #4857-backfill som DRY-RUN, apply kun på mit "kør".

6. TRÆNINGSSIDEN (#3643 mobil-paritet + #5485 + #5486). Ejer-direktiv 22/9: ingen lange scroll-sider, faner/modals, det mest brugte øverst, "programmet" i toppen skal have en mere forståelig løsning, landscape må ikke falde tilbage til desktop-layout. FØRST: Clarity-analyse af /training (scroll-dybde, klik, døde klik, tid pr. område; rapport i docs/audits/) og ét før/efter-mockup til mit valg. SÅ byg: skadet/status i rækken, ugeplan fra telefonen, dagens rapport, sortering på score, landscape. #5486: træningsscore-grafen uden huller på løbsdage.

7. S4-KALENDER (#5405): ret de tre finale-afvigelser afgrænset (bånd/vægte som #5469). Fælles varianter er en ejerbeslutning (#5480), byg dem IKKE. Tørkørsel uden --uniform-tilt, vis scorecard. --apply er mit go pr. kørsel.

8. SAMLET PATCH NOTE v7.295 (#5481): #5475 + det fra opgave 4 der er merget. Bag-flag-ting får ingen linje før flip-dagen.

9. U23 (kun hvis 1-5 er i PR): #5432 hård 8-cap i RPC'erne → migration + test; A2-migration (league_divisions.squad, races.squad), apply post-merge.

NÅR DU STOPPER: opdatér docs/NOW.md (maks 1.200 tokens; Next action + Working agent nulstillet), kør pwsh -File scripts/check-agent-token-hygiene.ps1, status som kommentar på hvert issue du har rørt, flip claude:todo -> claude:done på det der er merget, og skriv "Ny session anbefales: ..." som sidste linje.
```
