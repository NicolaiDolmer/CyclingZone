# Prompt: afslut roadmap-hubben (5/10)

Kopiér alt under stregen ind som første besked i en ny Claude Code-session i `C:\Dev\CyclingZone`. Anbefalet: Fable 5.1, indsats medium. Det er en afslutnings-session: ingen ny byg ud over det, der står her.

---

Afslut roadmap-hubben. Alt er bygget; der mangler ejerens sidste svar, ét merge og indholdet.

**Læs først**
1. `docs/NOW.md`
2. `docs/drafts/2026-10-04-roadmap-indhold.md` afsnit 8 (ejerens godkendelser + de tre åbne punkter nederst)
3. `docs/drafts/2026-10-04-roadmap-indhold-apply-rapport.md`
4. `.claude/learnings/2026-10-04-roadmap-hub-migration-apply.md`

**Status 4/10 sent**
- Live: migrationen (#6159), admin-fanen (#6161, `/admin/growth?tab=roadmap`), færdig-rutinen (#6162), patch notes-filteret (#6163).
- Mangler: spillersiden PR #6160 (ejeren har set billederne, ikke sagt "merge") og indholdet (`database/manual/2026-10-04-roadmap-hub-indhold.sql`, prøvekørt og rullet tilbage, ikke kørt).
- Billeder af hele indholdet: `pr-screens/6150/indhold/`.

**Tag med ejeren, ét ad gangen**
1. De fire ændringer til kendte fejl efter sandhedstjekket (#5928 → Fixed, #6006 → Fixed, #5949 ny titel, #6129 ny tekst) og deres tekster (EN + DA står på #6129, #5949 og i sessionens rapport).
2. Plan nr. 1 (#3813): del punktet (Done 24/9 + smallere plan-punkt), eller hele punktet til Done?
3. De to fund: ca. 20 ryttere uden træning i S4 (#6129) og søndagens værdikørsel kl. 06:45 (#5842-kommentar). Brand?

**Derefter, i denne rækkefølge**
1. Ret SQL-filen efter svarene. Prøvekør i en transaktion, der rulles tilbage (scriptet fra 4/10 lå i scratchpad; skriv et nyt efter samme mønster: filens indhold uden `COMMIT`, verify-SELECTs, `ROLLBACK`, via `scripts/db-lib.mjs` og `infisical run --env=prod`). Vis tallene.
2. Tjek CI på #6160 (`mergeStateStatus` først). På ejerens ordrette "merge 6160": `scripts/merge-queue.ps1 -Pr "6160"`, vent på grøn main.
3. På ejerens "kør": læg indholdet ind, post-verify mod tallene, åbn `/roadmap` og tjek hver fane på et rigtigt hold (EN + DA, pc + telefonbredde).
4. Kør `node scripts/roadmap-drift.mjs` (read-only) og vis ejeren, hvad der er lovet uden at stå på roadmappet.
5. Skriv roadbook-opslaget til Discord på engelsk som udkast; ejeren poster selv.

**Close-out**
Samlet patch note (EN først) for roadmap-hubben og patch notes-filteret, `help.json` (Hjælp-fanen "Known issues" er flyttet), `FEATURE_REGISTRY.yml` + `node scripts/generate-feature-status.mjs`, NOW.md, statusboard, done-flip på #6150, #5387, #5388, #5845. Opret GitHub-issues for de 8 kendte fejl uden issue og sæt `issue_ref`.

**Låst (genåbn ikke)**
Fem faner; én skala på planen, to i to trin på idéer; Confirmed kun det ejeren selv har bekræftet; ingen datoer på planen; spillere ser kun egne stemmer og tryk; intet postes automatisk i Discord; loftet 1173 er sidste hævning efter den gamle model (#6165).
