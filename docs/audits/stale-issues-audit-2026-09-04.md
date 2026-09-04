# Stale-issues audit — 2026-09-04

> **Kun analyse — ingen ændringer udført.** Ejeren bad om at intet lukkes/redigeres på GitHub i denne kørsel; alt herunder er FORSLAG. Ingen `gh issue close`, `gh issue edit` eller `gh issue comment` er kørt mod noget issue i denne audit. Alle 124 issues nedenfor har `claude:todo` og `updatedAt < 2026-08-05`.

**Metode:** `gh issue list` filtreret på åbne + `updatedAt < 2026-08-05` (124 stk. — matcher ejerens estimat på ~124). Cross-referenceret mod GitHub's issue-timeline (`cross-referenced`-events, alle merged PR'er der nævner issuet — ikke kun `Refs`/`Closes`) for at finde "glemt-done"-kandidater. De stærkeste kandidater er derefter verificeret direkte: fil-eksistens i git, `git merge-base --is-ancestor` mod `origin/main`, kodegennemgang (grep/Read) af den faktiske implementering, og ét live-opslag i Microsoft Clarity for #2041. Resten er kategoriseret via label-mønstre (needs-decision/needs-contract/needs-ai-triage/manual-review/post-launch/epic/addendum) + kort body-læsning.

**Totaler:** 124 stale issues → **A (forslag: luk) 6** · **B (dublet) 0** · **C (legitimt parkeret) 89** · **D (kræver ejerens valg) 22** · **Noteret, ikke rørt (blocked/needs-user-action/manual:user) 7**.

---

## Spand A — Forslag: luk (leveret/forældet)

Alle 6 er verificeret uafhængigt (kode på `origin/main`, fil væk fra repo, eller live metrik). Ingen af dem er lukket i denne kørsel — kun forslag.

| # | Titel | Foreslået handling | Evidens |
|---|---|---|---|
| [#1276](https://github.com/NicolaiDolmer/CyclingZone/issues/1276) | PCM-dump-xlsx med rigtige rytternavne lå synligt i public repo | Luk completed | Filen `scripts/WORLD DB 2026 Dyn_Cyclist.xlsx` findes ikke længere i repoet; fjernet i commit `6712d9ee5` ("fjern committet PCM-dump med rigtige rytternavne (#1276)", PR #1986, merged 29/6). |
| [#2041](https://github.com/NicolaiDolmer/CyclingZone/issues/2041) | investigation(analytics): Returning users stadig ~0 efter #1797 | Luk completed | To merged fixes citerer #2041 direkte (PR #3244 consent-signal, PR #3829 self-referral-filter). Live Clarity-opslag i dag (28/8–4/9): **81 returning vs. 32 nye brugere** — ikke længere ~0. |
| [#2164](https://github.com/NicolaiDolmer/CyclingZone/issues/2164) | Aktivér nedrykning Division 3 → Division 4 (ingen nedrykning fra div 4) | Luk completed | `economyEngine.js::processDivisionEnd` har `if (division < MAX_DIVISION)`-gate mod videre nedrykning fra bundtieret + en eksplicit "Div4-udskydelse"-kommentar der citerer #2164 direkte. Mekanikken er generisk implementeret. |
| [#2416](https://github.com/NicolaiDolmer/CyclingZone/issues/2416) | Udbrud v2: jagt-interesse-model | Luk completed | `backend/lib/engine/v4/mechanics/breakaway.ts` leveret ordret via PR #4085 ("M5 udbrud v2 - jagt-interesse-model"), merged 21/8, bekræftet på `origin/main`. |
| [#2478](https://github.com/NicolaiDolmer/CyclingZone/issues/2478) | Race-motor: adaptive AI-holdtaktik pr. etape | Luk completed | PR #4088 ("M14 - adaptiv, forklarlig AI-holdtaktik (race engine v4)") — titel matcher issuet ordret, merged 21/8, bekræftet på `origin/main`. |
| [#1837](https://github.com/NicolaiDolmer/CyclingZone/issues/1837) | Autobud/proxy-bud fra rytterprofil ved auktionsstart | Luk completed (medium confidence) | `frontend/src/pages/RiderStatsPage.jsx:576` har allerede en "Autobud-loft"-sektion koblet til `auction_proxy_bids`. Anbefaling: kort visuel spot-check før luk, da jeg ikke har set flowet live. |

---

## Spand B — Dubletter

**0 fundet.** Denne stale-delmængde (124 issues) er gennemgået for oplagte titel-/scope-overlap; ingen klare dubletpar dukkede op — addendum-fase-issues (#2487–2495) og perf-sub-tasks (#1373–1375) ligner hinanden men dækker distinkte, ejer-låste faser/delopgaver, ikke samme arbejde to gange.

---

## Spand C — Legitimt parkeret (89 stk.)

Epics, post-launch-slices, ejer-låste addendum-faser og reel (ikke-forældet) backlog. Ingen handling foreslået — listet så puklen er gennemsigtig.

| # | Titel (kort) | Evidens/begrundelse |
|---|---|---|
| [#1147](https://github.com/NicolaiDolmer/CyclingZone/issues/1147) | [Epic] Living World feed | Produktdoktrin-epic (parent #1145), langsigtet — ingen forældelse. |
| [#1148](https://github.com/NicolaiDolmer/CyclingZone/issues/1148) | [Epic] World history & Club Museum | Samme doktrin-familie (parent #1145). |
| [#1151](https://github.com/NicolaiDolmer/CyclingZone/issues/1151) | [Epic] Human-driven transfer market & AI liquidity | needs-contract + post-launch — epic-niveau, ikke en enkelt beslutning. |
| [#1154](https://github.com/NicolaiDolmer/CyclingZone/issues/1154) | [Epic] Rider personality & club relationship | Samme doktrin-familie (parent #1145). |
| [#1173](https://github.com/NicolaiDolmer/CyclingZone/issues/1173) | Vækst/viralitets-loop: referral | Roadmap-spec §7 — ikke startet, ingen af de refererede merged PR'er (#2044/#2821/#2988) leverer referral-mekanikken. |
| [#1177](https://github.com/NicolaiDolmer/CyclingZone/issues/1177) | Holddynamik-dybde: vejkaptajner + mentor | Eksplicit post-launch, bygger oven på #1154. |
| [#1199](https://github.com/NicolaiDolmer/CyclingZone/issues/1199) | Natlig harness-vagt (gates mod prod-data på cron) | post-launch, epic:ai-workflow — reelt uimplementeret feature, ikke samme som github-housekeeping-routinen (#627). |
| [#1208](https://github.com/NicolaiDolmer/CyclingZone/issues/1208) | Kalibrér boardIdentity star-score væk fra uci_points | Gate B i `docs/superpowers/plans/2026-06-20-pcm-uci-permanent-retirement-plan.md` — beslutning taget (Option B), eksekvering bevidst sekventeret/gated. |
| [#1239](https://github.com/NicolaiDolmer/CyclingZone/issues/1239) | [Design] Board-DNA og holdfokus v2 | post-launch investigation, ikke startet. |
| [#1270](https://github.com/NicolaiDolmer/CyclingZone/issues/1270) | Session-hardening hooks (D1/D7/D4) | `.githooks/pre-push` findes og dækker lint+secrets+patch-note-kollision allerede (111 linjer) — men ingen `node --test`-kald fundet. Sandsynligvis delvist leveret; bør spot-tjekkes, ikke et sikkert close. |
| [#1290](https://github.com/NicolaiDolmer/CyclingZone/issues/1290) | [AI-ops] Codex udfases — oprydning | Labels `agent:codex`/`codex:needs-prod-verify` m.fl. og `.codex.local/` findes stadig i repoet — oprydningen er ikke udført. Lav værdi nu, men ikke forældet præmis. |
| [#1293](https://github.com/NicolaiDolmer/CyclingZone/issues/1293) | Race-motor: population-berigelse + gate-bånd | post-launch — kræver populations-/evne-design, ikke gjort. |
| [#1294](https://github.com/NicolaiDolmer/CyclingZone/issues/1294) | Race-motor test-værktøjer: seed-variation i preview | Ejer-behov fra 11/6, ingen PR fundet der leverer variations-preview. |
| [#1299](https://github.com/NicolaiDolmer/CyclingZone/issues/1299) | Dynamiske OG share-billeder via @vercel/og | Grep bekræfter `@vercel/og` IKKE i `package.json` — ikke leveret. PR #3405 (Hero & Agony-kort) er en beslægtet men separat feature (client-side PNG-eksport, ikke social-preview `og:image`). |
| [#1301](https://github.com/NicolaiDolmer/CyclingZone/issues/1301) | SEO-fundament (epic, løbende loop) | Eksplicit designet som kontinuerlig loop — ikke en engangsopgave, mange merged PR'er viser fremdrift. |
| [#1341](https://github.com/NicolaiDolmer/CyclingZone/issues/1341) | [AI-ops] AI Council → Claude-only oprydning | Beslutningskonteksten er ændret siden (memory: "Claude-only" 12/6 betød kun Codex-exit) — lav værdi, men ingen bekræftet levering. |
| [#1369](https://github.com/NicolaiDolmer/CyclingZone/issues/1369) | [Meta] Langsigtet CRO-loop | Eksplicit løbende meta-tracker, ikke en enkeltopgave. |
| [#1373](https://github.com/NicolaiDolmer/CyclingZone/issues/1373) | [perf] Delt query-cache + optimistic UI | Post-launch perf-spec-sub-task; PR #2554 (referenceret) løser en anden specifik perf-ting (serial-await), ikke query-cache. |
| [#1374](https://github.com/NicolaiDolmer/CyclingZone/issues/1374) | [perf] Targeted Realtime-invalidering | Samme spec-familie som #1373 — ikke leveret. |
| [#1375](https://github.com/NicolaiDolmer/CyclingZone/issues/1375) | [perf] Performance-arkitektur — eksekverings-tracker | Paraply-tracker for hele perf-specen (#1371); needs-ai-triage men ingen enkelt beslutning venter, kun eksekvering. |
| [#1379](https://github.com/NicolaiDolmer/CyclingZone/issues/1379) | Genbesøg evnesystemet + watt-intervaller | epic:progression, fremtidig session, ikke startet. |
| [#1528](https://github.com/NicolaiDolmer/CyclingZone/issues/1528) | [AI-ops] A1: selv-forbedrende burndown-loop | Feature-forslag fra 19/6, ingen implementation fundet. |
| [#1595](https://github.com/NicolaiDolmer/CyclingZone/issues/1595) | WS2-backend PCM-sletning (Option B) | Beslutning ER taget 20/6 (Option B) og dokumenteret i retirement-planen — men selve kodesletningen (`pcmResultsImport.js` m.fl. findes stadig) er bevidst sekventeret bag Gate A/B/C. Ikke en åben beslutning, kun ventende eksekvering. |
| [#1712](https://github.com/NicolaiDolmer/CyclingZone/issues/1712) | Fuld 140-etaper/5-per-dag sæson-rekalibrering | Eksplicit bevidst udskudt fra 22/6-launch til post-launch (kode-kommentar bekræfter). |
| [#1818](https://github.com/NicolaiDolmer/CyclingZone/issues/1818) | Økonomi-gates ignorerer 0c hale-ryttere | epic:economy-overhaul, reel teknisk gæld, ikke rørt. |
| [#1833](https://github.com/NicolaiDolmer/CyclingZone/issues/1833) | In-game forklaring af rytter-evner (tooltips) | UX-feature-backlog, intet tegn på levering. |
| [#1857](https://github.com/NicolaiDolmer/CyclingZone/issues/1857) | Race-sim reproducerbarhed: snapshot rytter-betingelser | Reel teknisk gæld (race-motor), ikke startet. |
| [#1875](https://github.com/NicolaiDolmer/CyclingZone/issues/1875) | Vercel preview-env (VITE_PREVIEW_MOCK) | Kræver et manuelt Vercel-dashboard-trin; ingen af de refererede PR'er sætter selve env-vars. |
| [#1888](https://github.com/NicolaiDolmer/CyclingZone/issues/1888) | Auto-push patch notes til Discord | Feature-ønske fra 25/6, ingen bot-integration fundet. |
| [#1896](https://github.com/NicolaiDolmer/CyclingZone/issues/1896) | Træning: synliggør omkostning ved ikke at engagere sig | UX-feature-backlog. |
| [#1900](https://github.com/NicolaiDolmer/CyclingZone/issues/1900) | Cross-division standings-overblik (bred, #1835-split) | S6 (relateret, snævrere) er leveret separat — men #1900's egen bredere ask er ikke det samme og ikke leveret. |
| [#1925](https://github.com/NicolaiDolmer/CyclingZone/issues/1925) | Follow-ups efter holdudtagelses-overhaul | 8 uafkrydsede checkboxes i body, ingen kommentar bekræfter afslutning. Reel resterende opgaveliste. |
| [#1979](https://github.com/NicolaiDolmer/CyclingZone/issues/1979) | Omdøb/fjern 'udbrud'-etapeprofil-navn | Lille UX-navngivningsopgave, ikke gjort. |
| [#2030](https://github.com/NicolaiDolmer/CyclingZone/issues/2030) | Race-kalender: auto-skift til næste racedag | Ejer var positiv 30/6 men intet spor af implementation fundet. |
| [#2064](https://github.com/NicolaiDolmer/CyclingZone/issues/2064) | Design ongoing new-rider influx mechanic | Delvist adresseret via akademi-intake-pipelinen (mange merged PR'er: S0 søndags-drip, overflow, sundhedstjek) — men issuets bredere ask (løbende tilførsel til SENIOR free-agent-poolen) er ikke bekræftet dækket. Bør revurderes, ikke lukkes blindt. |
| [#2101](https://github.com/NicolaiDolmer/CyclingZone/issues/2101) | Opfølgning #2098: ability_progress-scoping | Sikkerheds-opfølgning, to konkrete rest-punkter, ikke leveret. |
| [#2178](https://github.com/NicolaiDolmer/CyclingZone/issues/2178) | Upload af holdlogo + rework af holdsiden | Feature-ønske fra ejeren 4/7, ikke startet. |
| [#2222](https://github.com/NicolaiDolmer/CyclingZone/issues/2222) | Merchandise-funktion | Eksplicit 2027-horisont i MASTERPLAN, bevidst langt ude. |
| [#2227](https://github.com/NicolaiDolmer/CyclingZone/issues/2227) | /board høj dead-click-tæthed | Beslægtede dead-click-fixes er landet på RiderSwitcherBar/kalender/team (PR #3068/#3239/#3241) — men ingen af dem nævner `/board` specifikt. Uafklaret om selve /board er fikset. |
| [#2230](https://github.com/NicolaiDolmer/CyclingZone/issues/2230) | Layout-shift (CLS) på core-sider | Investigation, egen advarsel om outlier-kontaminerede Clarity-tal — ikke konkluderet. |
| [#2236](https://github.com/NicolaiDolmer/CyclingZone/issues/2236) | Organic community outreach (Reddit+Discord) | Løbende tracker med eget "living tracker"-artifact — ikke en enkelt beslutning, arbejdet er i gang. |
| [#2270](https://github.com/NicolaiDolmer/CyclingZone/issues/2270) | Natlig game-day smoke-sim (CI) | Ejer-godkendt 10/7, ingen CI-job fundet der matcher beskrivelsen. |
| [#2337](https://github.com/NicolaiDolmer/CyclingZone/issues/2337) | Træning: løbs-bevidst periodisering | Balance-ændring, kræver dry-run-scorecard før ship — ikke gjort. |
| [#2398](https://github.com/NicolaiDolmer/CyclingZone/issues/2398) | Vis træner-stats + sign-on/release-gebyr | PR #2566 leverer trænerOVERBLIK på tværs af hold, ikke de specifikke individuelle stats+gebyrer issuet beder om. |
| [#2417](https://github.com/NicolaiDolmer/CyclingZone/issues/2417) | τ-kompression exit-strategi | Kalibrerings-gæld, afhænger eksplicit af #1293 (population-berigelse) først. |
| [#2441](https://github.com/NicolaiDolmer/CyclingZone/issues/2441) | Discord: nye medlemmer ser ikke kanalerne | Community-ops-opgave, ingen bekræftet fix. |
| [#2460](https://github.com/NicolaiDolmer/CyclingZone/issues/2460) | [ops] Fjern setup-forhindringer + proaktiv audit | Bredt ejer-direktiv 13/7 — delvist adresseret af senere AI-ops-audits (19/7, 25/7, 31/8, 3/9 m.fl. per changelog), men selve issuet er ikke lukket/opdateret siden. |
| [#2476](https://github.com/NicolaiDolmer/CyclingZone/issues/2476) | Race-motor: sidevind + vifter (echelons) | Uddyber #939, ikke startet. |
| [#2477](https://github.com/NicolaiDolmer/CyclingZone/issues/2477) | Race-motor: verdensrangliste (design) | Design-investigation, ikke startet. |
| [#2479](https://github.com/NicolaiDolmer/CyclingZone/issues/2479) | Research-spike: W'/Critical Power-model | backend-only research, "ship intet"-scope, ikke startet. |
| [#2480](https://github.com/NicolaiDolmer/CyclingZone/issues/2480) | Motor-ops: ML-assisteret kalibreringsforslag | 2027-visionsissue, ikke startet. |
| [#2487](https://github.com/NicolaiDolmer/CyclingZone/issues/2487) | Gennembruds-vinduer & stagnations-diagnoser (addendum Fase 2) | Ejer-lås 16/7 for fremtidig fase — kun Fase 0 (akademi-drip) er leveret indtil videre. |
| [#2488](https://github.com/NicolaiDolmer/CyclingZone/issues/2488) | Projekt-ryttere: flersæsons udviklingsplaner (addendum Fase 2) | Samme addendum-spec, fremtidig fase. |
| [#2489](https://github.com/NicolaiDolmer/CyclingZone/issues/2489) | Sæsonkortet: periodiseringsflade (addendum Fase 3) | Samme addendum-spec, fremtidig fase. |
| [#2490](https://github.com/NicolaiDolmer/CyclingZone/issues/2490) | Rytter-krøniken: karrierebiografi (addendum Fase 2-4) | PR #3406 (Maiden Win Engine — career-firsts) leverer ET element af konceptet, men ikke hele "Historie"-fanen/event-fundamentet issuet beskriver. Delvis fremdrift, ikke fuldt leveret. |
| [#2491](https://github.com/NicolaiDolmer/CyclingZone/issues/2491) | Graduation Day: tier-overgangs-ritual (addendum Fase 4) | Samme addendum-spec, fremtidig fase. |
| [#2493](https://github.com/NicolaiDolmer/CyclingZone/issues/2493) | Årgangs-cyklussen (addendum Fase 5) | Samme addendum-spec, fremtidig fase. |
| [#2494](https://github.com/NicolaiDolmer/CyclingZone/issues/2494) | Informations-derbyet: scout-vindue (addendum Fase 5) | Samme addendum-spec, fremtidig fase. |
| [#2495](https://github.com/NicolaiDolmer/CyclingZone/issues/2495) | Akademi-filosofi: valgbar skole (addendum Fase 5) | Samme addendum-spec, fremtidig fase. |
| [#2635](https://github.com/NicolaiDolmer/CyclingZone/issues/2635) | Harness-skema-drift ud over pending_team_id | Issuet ER selv follow-up'en på et allerede lukket delfix (#2634) — resten (loan_agreements m.fl.) er reelt uløst. |
| [#2667](https://github.com/NicolaiDolmer/CyclingZone/issues/2667) | Værdimodel v4 slice 4: selvkørende re-fit | Fremtidig rollout-slice fra #2594-cutoveren, ikke startet. |
| [#2669](https://github.com/NicolaiDolmer/CyclingZone/issues/2669) | Migrér 7 offline-harnesses til v4-værdimodel | Efterslæb-oprydning, ikke startet. |
| [#2679](https://github.com/NicolaiDolmer/CyclingZone/issues/2679) | AI-audit 19/7: disable-bølge (5 plugins) | Del af 19/7-AI-ops-audit-batch. Ingen individuel verifikation kørt denne gang — sandsynligvis delvist overhalet af senere AI-ops-sessioner (memory viser mange audits siden), bør spot-tjekkes samlet. |
| [#2681](https://github.com/NicolaiDolmer/CyclingZone/issues/2681) | AI-audit 19/7: memory-hygiejne | Samme 19/7-batch — MEMORY.md-budgettet er siden håndteret løbende (memory-filens egen disciplin), men issuet selv er ikke lukket. |
| [#2683](https://github.com/NicolaiDolmer/CyclingZone/issues/2683) | AI-audit 19/7: oprydning scheduled tasks | Samme 19/7-batch, ikke verificeret denne gang. |
| [#2684](https://github.com/NicolaiDolmer/CyclingZone/issues/2684) | AI-audit 19/7: drift-vagt-hærdning | Samme 19/7-batch, ikke verificeret denne gang. |
| [#2685](https://github.com/NicolaiDolmer/CyclingZone/issues/2685) | AI-audit 19/7: skill /close-out | Samme 19/7-batch — bemærk at `github-housekeeping`-skillen (brugt i DENNE audit) allerede dækker en del af samme idé for issue-hygiejne; /close-out specifikt er ikke verificeret bygget. |
| [#2686](https://github.com/NicolaiDolmer/CyclingZone/issues/2686) | AI-audit 19/7: skills-bølge 2 | Samme 19/7-batch, ikke verificeret. |
| [#2687](https://github.com/NicolaiDolmer/CyclingZone/issues/2687) | AI-audit 19/7: PostToolUse eslint-hook | Samme 19/7-batch, ikke verificeret — men memory nævner stadig "kør npm run lint før push" som aktiv manuel regel, hvilket antyder hooket IKKE er bygget. |
| [#2698](https://github.com/NicolaiDolmer/CyclingZone/issues/2698) | Progressiv evne-udviklingskurve (logaritmisk) | Balance-ønske fra ejeren 19/7, kræver dry-run — ikke gjort. |
| [#2747](https://github.com/NicolaiDolmer/CyclingZone/issues/2747) | Regen/newgen: erstat pensionerede ryttere | Reelt hul (senior-pool krymper ~84/sæson) — akademi-intake dækker kun ungdom, ikke senior-erstatning. Stadig åbent. |
| [#2751](https://github.com/NicolaiDolmer/CyclingZone/issues/2751) | Season-standings: NULL league_division_id | Lav-prioritet latent bug, 0 ægte managere ramt endnu — reelt backlog. |
| [#2757](https://github.com/NicolaiDolmer/CyclingZone/issues/2757) | Pointtrøje: sprintpoint vægter for højt på bjerge | PR #3054 fikser en anden, relateret men separat bug (mellemsprint på klatresegment) — ikke selve pointvægtnings-spørgsmålet. |
| [#2762](https://github.com/NicolaiDolmer/CyclingZone/issues/2762) | FAQ: kategori-inddeling + oprydning | Ejer-direktiv 19/7, ikke udført endnu. |
| [#2768](https://github.com/NicolaiDolmer/CyclingZone/issues/2768) | [Epic] Verdensklasse løbsmotor | Aktiv, stort epic — race-engine v4-arbejde (M5/M14 m.fl., se spand A) leverer LØBENDE ind i denne epic; epic'en selv forbliver åben til den er udtømt. |
| [#2783](https://github.com/NicolaiDolmer/CyclingZone/issues/2783) | grand_tour-arketype: HC-total udenfor realisme-bånd | Reel bug-backlog (race-engine), opfølgning på #2781, ikke rettet. |
| [#2789](https://github.com/NicolaiDolmer/CyclingZone/issues/2789) | Sub-3 gap-model: 6 rute-huller | Høj prioritet, adversarisk verificeret fund 22/7 — bør tages snart, men ikke en beslutning, bare uafgjort arbejde. |
| [#2820](https://github.com/NicolaiDolmer/CyclingZone/issues/2820) | /founder-supporter vs /pro modsigende betalingsbesked | Ligetil bug (to sider siger modstridende ting), ikke en beslutning — bare ikke rettet endnu. |
| [#2822](https://github.com/NicolaiDolmer/CyclingZone/issues/2822) | [fable] Verdensklasse-benchmark | Kræver en dedikeret Fable-session ("kan ikke deles ud til workers") — ikke en simpel beslutning, men venter på kapacitet. |
| [#2838](https://github.com/NicolaiDolmer/CyclingZone/issues/2838) | regionOf() forkerte stigningsnavne (NL/BE) | Kosmetisk bug, lav prioritet, reelt backlog. |
| [#2893](https://github.com/NicolaiDolmer/CyclingZone/issues/2893) | [ops] Daglig sundhedsrapport på job_heartbeat | Høj prioritet strukturel anbefaling fra 25/7-driftsaudit, ikke bygget endnu. |
| [#2923](https://github.com/NicolaiDolmer/CyclingZone/issues/2923) | Marked-/auktionsfrys som app_config-flag | Ops-behov fra 25/7-multiagent-audit, ikke bygget. |
| [#2964](https://github.com/NicolaiDolmer/CyclingZone/issues/2964) | [infra] Fuldt PR-preview (backend+DB) | Stort infra-ønske, gentaget ejer-frustration — ikke startet, ingen enkelt beslutning venter (kræver design+bygning). |
| [#2990](https://github.com/NicolaiDolmer/CyclingZone/issues/2990) | Migrer 10 resterende hold-queries til humanTeamFilter | Refactor-efterslæb efter #2852, ikke gjort. |
| [#3010](https://github.com/NicolaiDolmer/CyclingZone/issues/3010) | Prologer mangler eget distance-bånd | Race-engine-detalje, reelt backlog. |
| [#3033](https://github.com/NicolaiDolmer/CyclingZone/issues/3033) | perf: JWT lokal verifikation fremfor /auth/v1/user | Perf-fund fra RAM-incidenten 26/7, ikke implementeret. |
| [#3087](https://github.com/NicolaiDolmer/CyclingZone/issues/3087) | [planner etape 3] Mål-løb-modellen | Ejer-godkendt 27/7 (beslutning ER taget), afventer kun bygning — ikke en åben beslutning. |
| [#3109](https://github.com/NicolaiDolmer/CyclingZone/issues/3109) | 4 AI-hold fik trup erstattet af heal-sweep-fejl | Kun AI-modstandere ramt, ingen ægte managere — lav hastende, reel men lille oprydning. |
| [#3233](https://github.com/NicolaiDolmer/CyclingZone/issues/3233) | Sanktioner: arkivér frem for hård-slette | Sikkerheds-/fair-play-teknisk-gæld, ikke bygget. |

---

## Spand D — Kræver ejerens valg (22 stk.)

| # | Titel (kort) | Hvorfor det venter på ejeren | Evidens |
|---|---|---|---|
| [#3147](https://github.com/NicolaiDolmer/CyclingZone/issues/3147) | Sponsor race-day-udbetalinger løbende vs. klumpsum | needs-decision — spillerønske om udbetalingstiming | PR #3320 (4/8) viser kun en breakdown-SEKTION, ikke ændret udbetalingstiming. |
| [#3096](https://github.com/NicolaiDolmer/CyclingZone/issues/3096) | Sæsonskiftet nulstiller træthed, ikke form S1→S2 | Beslutningen er **eksplicit aldrig truffet** (kode-kommentar bekræfter det bevidst udeladt) | `backend/lib/seasonFatigueReset.js:13-15`. |
| [#3153](https://github.com/NicolaiDolmer/CyclingZone/issues/3153) | Community-flagget transfer 29/7 — manuel review | manual-review — konkret sag, kræver ejerens dømmekraft | Discord-rapport 29/7, ingen konklusion draget endnu. |
| [#3050](https://github.com/NicolaiDolmer/CyclingZone/issues/3050) | Venskabsløb/custom turneringer på tværs af divisioner | needs-decision — nyt spillerønske (Discord 26/7) | Ingen implementation fundet. |
| [#3049](https://github.com/NicolaiDolmer/CyclingZone/issues/3049) | Rolle-/taktikvalg pr. rytter i endagsløb | needs-decision — spillerønske om AI vs. spillerkontrol | Ingen implementation fundet. |
| [#2991](https://github.com/NicolaiDolmer/CyclingZone/issues/2991) | Grand Tour-achievement kan ingen menneske opnå | needs-decision — Division-1-only-gate er by design, men gør en achievement uopnåelig | `tierRaceSelection.js` TIER_CLASS_WHITELIST. |
| [#2944](https://github.com/NicolaiDolmer/CyclingZone/issues/2944) | Styrt er binære (intet resultat) og for hyppige | needs-decision + needs-ai-triage — balance-designvalg | Spillerklager 20-23/7, to adskilte spørgsmål skal afgøres. |
| [#2885](https://github.com/NicolaiDolmer/CyclingZone/issues/2885) | Sælg rytter til AI efter N mislykkede auktioner | needs-decision — nyt spillerønske | Ingen implementation fundet. |
| [#2856](https://github.com/NicolaiDolmer/CyclingZone/issues/2856) | Historisk holdklassement-reparation (destruktiv) | needs-decision, eksplicit ejer-gated — omgør allerede udbetalte point/præmier | Fremadrettet fix er live (PR #2714); historisk reparation kræver ejer-go til at røre tildelte beløb. |
| [#2759](https://github.com/NicolaiDolmer/CyclingZone/issues/2759) | Facebook-annoncer + organisk TikTok | Ejeren skal selv godkende tekster + budget FØR noget går live | Body: "Ejer godkender tekster + budget FØR noget går live." |
| [#2749](https://github.com/NicolaiDolmer/CyclingZone/issues/2749) | S1 prize-overbetaling: 40,7M vs 35,98M payable | needs-ai-triage, uafkrydset AC | Rod-årsag (re-import/holdskift) ikke fundet endnu. |
| [#2689](https://github.com/NicolaiDolmer/CyclingZone/issues/2689) | AI-audit 19/7: prioriteringsoversigt (10 issues) | needs-decision — rollup-issue for #2679-2688 | Muligvis delvist forældet af senere AI-ops-arbejde — værd at revurdere samlet med sine 9 underpunkter. |
| [#2688](https://github.com/NicolaiDolmer/CyclingZone/issues/2688) | AI-audit 19/7: Fable-optimering (4 håndtag) | needs-decision — ejeren vælger hvilke af 4 tiltag der pilottestes | Ingen af de 4 håndtag bekræftet valgt/bygget. |
| [#2675](https://github.com/NicolaiDolmer/CyclingZone/issues/2675) | 19/7: udløbs-auktioner + 16 backfill-ryttere | needs-decision — konkret ejer-valg om kompensations-backfill | Del 1 (verify) delvist udført, del 2 (beslutning) udestår. |
| [#2622](https://github.com/NicolaiDolmer/CyclingZone/issues/2622) | Auto-entry-generator fylder hele sæsonen proaktivt | needs-decision — kun horisont/tilstand mangler at vælges | **Mekanismen er nu klar** (PR #4673, merged 3/9): `assistant_selection_mode`-flag med `proactive`/`late_fill`/`opt_in`. PR-teksten selv: "selve valget er stadig ejerens." |
| [#2582](https://github.com/NicolaiDolmer/CyclingZone/issues/2582) | Race-motor: tidsgrænse (broom wagon/cutoff) | needs-decision — ejer-ønske 16/7, mangler UCI-regelanalyse+design | Ingen implementation fundet. |
| [#2457](https://github.com/NicolaiDolmer/CyclingZone/issues/2457) | AI-holdenes rytterkvalitet skal matche division | needs-ai-triage — konkret ejer-ønske 13/7 | Spillerevidens (Div 4 for let) peger samme vej, ikke kalibreret endnu. |
| [#2388](https://github.com/NicolaiDolmer/CyclingZone/issues/2388) | race:gate:roles rød siden 16/6 (itt-bånd 59% vs ≥60%) | Titlen selv siger "ejer-beslutning om interim-bånd" | Hoved-gate (CI) er grøn; kun den lokale roles-variant er rød på ét seed. |
| [#2161](https://github.com/NicolaiDolmer/CyclingZone/issues/2161) | Discord OAuth login/signup | Sandsynligvis kræver ejerens Discord Developer Portal-opsætning (ekstern konto-handling) | Grep bekræfter ingen `signInWithOAuth`-Discord-kald i frontend — ikke bygget. Kun 25/96 hold har manuelt Discord-ID i dag. |
| [#2000](https://github.com/NicolaiDolmer/CyclingZone/issues/2000) | EPIC: rytter-side rework | Epic er stort set leveret (12 merged PR'er), MEN sidste kommentar (4/7) rejser en ubesvaret regression: højde/vægt + compare-værktøj forsvundet fra ny UI | Grep bekræfter `height_cm`/`weight_kg` IKKE fundet på `RiderStatsPage.jsx` — spørgsmålet fra @thelamba ("did it get removed on purpose?") er stadig ubesvaret. |
| [#1981](https://github.com/NicolaiDolmer/CyclingZone/issues/1981) | Catch-up for nye/tilbagevendende klubber | needs-contract — eksplicit evidens-gated ("ingen data endnu") | Basal catch-up er allerede live (Div3-entry); denne udvidelse venter bevidst på data. |
| [#1461](https://github.com/NicolaiDolmer/CyclingZone/issues/1461) | DMARC: p=none → quarantine → reject | needs-ai-triage — sikkerhedsrisiko-afvejning (kan blokere ægte mails hvis forhastet) | DMARC står stadig i `p=none` (monitorering) siden 18/6 per issue-body. |

---

## Ikke rørt — blocked / needs-user-action / manual:user (7 stk., kun noteret)

Per instruks rørt ikke ud over at liste dem her.

| # | Titel (kort) | Label |
|---|---|---|
| [#2217](https://github.com/NicolaiDolmer/CyclingZone/issues/2217) | Staff-kontrakter + genforhandling (#1441) | `claude:blocked` |
| [#2218](https://github.com/NicolaiDolmer/CyclingZone/issues/2218) | Pension→staff: retired ryttere bliver trænere/spejdere (#1441) | `claude:blocked` |
| [#3092](https://github.com/NicolaiDolmer/CyclingZone/issues/3092) | Afinstallér ubrugt Manus Connector GitHub App | `needs-user-action`, `manual:user` |
| [#2680](https://github.com/NicolaiDolmer/CyclingZone/issues/2680) | Cowork-connector-toggles i dev-kanal | `needs-user-action` |
| [#1450](https://github.com/NicolaiDolmer/CyclingZone/issues/1450) | Vercel Secret Sync via Infisical App Connections | `needs-user-action` |
| [#1407](https://github.com/NicolaiDolmer/CyclingZone/issues/1407) | SEO measurement layer (GSC+GA4+Ahrefs+Morningscore) | `needs-user-action` |
| [#1283](https://github.com/NicolaiDolmer/CyclingZone/issues/1283) | ToV-session: definér founder-stemmen | `needs-user-action` |

---

## Til ejeren: de 10 vigtigste beslutninger (sorteret efter værdi for spil/penge)

Dette er et udpluk af spand D — dem der betyder mest, forklaret i klart sprog. Resten af spand D-listen ovenfor er reel, men mindre presserende.

1. **#2856 — Skal jeg rette gamle holdklassementer, der er forkerte pga. en bug?** Ét kendt løb ("Tour de la Loire") har en forkert vinder af holdklassementet, fordi vinderholdet reelt kun havde 1 gennemførende rytter (skal være mindst 3). Fejlen er rettet FREMADRETTET — men at rette FORTIDEN betyder at rykke rundt på allerede udbetalte point og præmiepenge. Det er en pengemæssig omgørelse, så jeg rører den ikke uden dit ja. **Anbefaling:** ret den — det er kun ét løb, og det er den rigtige vinder der mangler sin sejr.

2. **#3096 — Skal rytternes form (ikke bare deres træthed) nulstilles ved sæsonskifte?** En spiller opdagede at ryttere går ind i en ny sæson med den form de sluttede den gamle sæson med. Det var en bevidst udeladelse dengang (kun træthed blev besluttet nulstillet) — men beslutningen om FORM blev aldrig taget. **Anbefaling:** tag stilling nu, inden næste sæsonskifte gør det til et tilbagevendende spørgsmål.

3. **#2622 — Skal assistenten stoppe med at fylde hele sæsonen ud på forhånd?** Fem spillere har bedt om at assistenten kun skal udfylde det de IKKE selv nåede (i stedet for at fylde hele sæsonen proaktivt). Den gode nyhed: mekanikken er allerede bygget og klar (landede i går, 3/9) — den venter kun på at du vælger hvilken tilstand der skal være standard. **Anbefaling:** vælg "kun udfyld en helt tom trup, 24 timer før løb" — det er præcis hvad spillerne bad om.

4. **#2789 — 6 huller i ruternes realisme, fundet ved et modbevis-tjek.** Højt prioriteret allerede (mærket "high"), fundet 22/7 mod ægte sæson-2-data. Ikke en beslutning i klassisk forstand, men et sæt konkrete fund der bør vurderes samlet, fordi de påvirker hvordan løb opleves. **Anbefaling:** sæt en session af til at gå de 6 fund igennem.

5. **#2944 — Skal styrt give delvist resultat i stedet for at være alt-eller-intet?** Spillere oplever at ét styrt kan koste en hel sæsons GC-kamp, fordi et styrt i dag betyder "intet resultat" i stedet for "mistede tid, men fuldførte" som i virkeligheden. **Anbefaling:** ja til graduerede udfald — det er tættere på virkeligheden og føles mere retfærdigt.

6. **#2000 — Er højde/vægt + sammenlign-værktøjet på rytterprofilen forsvundet med vilje?** En spiller spurgte direkte i juli om disse to ting mangler efter den store rytterside-ombygning, og spørgsmålet er aldrig besvaret. Jeg har tjekket koden: de er faktisk væk fra den nye profilside. **Anbefaling:** beslut om de skal tilbage, eller om det var en bevidst forenkling — og svar spilleren.

7. **#2161 — Skal Discord-login (OAuth) bygges nu?** Kun 25 ud af 96 rigtige hold har sat deres Discord-ID op manuelt i dag. Et ét-klik "log ind med Discord" ville løse det for alle på én gang (adgang til rolle-sync, DM'er, notifikationer). Kræver sandsynligvis at du opretter en Discord-app i deres udviklerportal først. **Anbefaling:** værd at prioritere — det er en stor spillerbase der i dag går glip af notifikationer.

8. **#2457 — Skal AI-holdenes rytterkvalitet kalibreres pr. division?** Du bad selv om dette i juli, og en spiller har allerede bekræftet at Division 4 føles for let. **Anbefaling:** kør kalibreringen — det er allerede din egen prioritet, bare ikke udført endnu.

9. **#2749 — Er der betalt 4,7 mio for meget i præmier i sæson 1?** En audit fandt at der er udbetalt 40,7 mio i præmier mod 35,98 mio der reelt skulle udbetales. Blokerer ikke noget akut, men roden til driften bør findes så det ikke gentager sig. **Anbefaling:** lav-hastende, men sæt den på listen til en ren analyse-session.

10. **#2582 — Skal der indføres en realistisk tidsgrænse (broom wagon) i løbsmotoren?** Dit eget ønske fra 16/7 om at hægte langsomme ryttere af et løb, ligesom i virkeligheden. Kræver at nogen (mig) analyserer de rigtige UCI-regler og designer mekanikken — men retningen skal komme fra dig først. **Anbefaling:** god idé, sæt den i kø efter de mere presserende punkter ovenfor.

---

## Bekræftelse

Ingen `gh issue close`, `gh issue edit` eller `gh issue comment` er kørt i denne session. Kun læse-operationer (`gh issue list`, `gh api .../timeline`, `gh pr view`, `git log`/`grep`/`git merge-base`, ét Microsoft Clarity-opslag). Intet at rulle tilbage.
