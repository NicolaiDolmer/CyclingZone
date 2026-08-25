# Næste session — forum + dashboard

> Skrevet 25/8 ved close-out af forum-løft-sessionen. Der kører et **parallelt spor** mod fredag 28/8 (holdudtagelse, S3-kalender, Planning Center) — se `2026-08-26-naeste-session-prompt.md`. Denne prompt dækker kun forum- og dashboard-sporet, og det viger for fredags-sporet.

## Start med

1. Læs **`docs/FORUM_RULES.md`** og **`docs/DASHBOARD_RULES.md`** før du rører noget. Begge er nye (25/8) og skrevet præcis fordi beslutningerne lå udokumenterede og blev brudt.
2. `pwsh -File scripts/worker-status.ps1` — ét blik på alle worktrees: minutter siden sidste commit, **ucommitted filer**, upushede commits, åbne PR.
3. `gh pr list --state open` — se hvad der stadig ligger.

## Tilstand ved close-out

**Merged og live:** Forum L1 "puls" (#4238) — aktivitets-sortering, ulæst pr. tråd + gul prik i nav, svar-notifikation med dedupe, påkrævet rapport-begrundelse. Begge migrationer kørt i prod med post-verify.

**To regressioner fulgte med #4238 og blev fikset samme dag.** Det er værd at kende, fordi de siger noget om verifikationen:
- #4244/#4247: manglende `return channel` i en callback → `undefined.subscribe()` ved hver mount, 17 spillere ramt. Slap gennem 561 e2e-tests, fordi **ingen test lytter på `pageerror`** → guard-issue **#4248**.
- #4251: CodeQL high — format-string-taint i `notifyForumThreadReply`.

## Åbne PR'er — foreslået merge-rækkefølge

| # | Hvad | Rækkefølge og hvorfor |
|---|---|---|
| **#4251** | CodeQL high, format-string i forum-notifikation | **Først.** Sikkerhed, lille diff, retter en fejl i live kode |
| **#4249** | Dashboard-kort + layout-omlægning | **Efter #4251.** Kræver ejerens visuelle godkendelse — UI |
| **#4250** | Opbakning + citér-svar | **Efter #4249.** Rører `api.js` som #4251 → rebase nødvendig. Kræver også visuel godkendelse |
| #4242 | preflight-push-guard (hook) | Når som helst — uafhængig |
| #4237 | clock-drift-detektor i CI | Når som helst — uafhængig |
| #3512 | arketype-prior | Draft, hører til spor B — ikke dette spor |

**Efter #4250 er merged:** kør `database/2026-08-25-3517-forum-reactions.sql` (idempotent, post-verify som ved #4238) og **fjern derefter `schema-columns-ok`-kommentaren** i `backend/lib/forum.js` samt opdatér `database/schema-snapshot.json`. Undtagelsen findes kun, fordi `quoted_reply_id` ikke er i prod endnu.

## Næste opgaver, prioriteret

1. **#4252** — holdnavnet i sidebaren har **470 døde klik mod 123 virksomme** på 7 dage, det mest fejlklikkede element i appen. Få linjers fix, største enkeltstående friktion på fladen.
2. **#4248** — `pageerror`-guard i Playwright. Ville have fanget #4244 før merge. Start i rapporterende tilstand, allowlist bevidst.
3. **#4235** — måleaflæsning **15/9**, før sæsonen slutter 20/9. Baseline og tærskler ligger i issuet. Rammer vi dem ikke, er problemet indhold frem for synlighed, og så er auto-tråde pr. løbsdag + divisions-forums næste træk.
4. **#3451** — forum-søgning. Bevidst udskudt til efter #4235: med 12 tråde er der ikke noget at søge i.

## Faldgruber, betalt for i dag

- **Kun én worker må have `FULL` e2e-verifikation ad gangen.** To samtidige fulde suiter (23 min hver) sulter hinanden på samme maskine. Se "Fire spørgsmål FØR spawn" i `docs/PARALLEL_WORKTREE_ORCHESTRATION.md`.
- **Giv workers eksplicit ret til at committe rod.** En worker stod 66 minutter med 190 linjers færdigt arbejde ucommitted, fordi den ventede på at være "færdig nok" til en pæn commit.
- **Nye dashboard-moduler hører i to-kolonne-gridet**, ikke i den øvre fuldbredde-stak. Fuld bredde kræver en grund, der kan skrives ned.
- **Grøn verifikation beviser kun det, verifikationen måler.** Spørg hvad den *ikke* dækker, før du melder færdig — især ved effekt-kode (abonnementer, intervaller, timere).
- Læserne af forummet kan først måles gennem `forum_thread_reads`; før den fandtes, kunne vi kun tælle skribenter.

## Ejer-præferencer, der styrede beslutningerne

- Opbakning er **én tæller, ikke en emoji-palet** — matcher Discords upvote-vane, holder fladen fri for emoji.
- **Ingen notifikation ved alle nye opslag** — nav-prikken dækker behovet uden at fylde indbakken.
- Dashboardet må ikke fyldes med fuldbredde-moduler: *"Så må der kunne være to ved siden af hinanden."*
- Ved UI-ændringer: **vis visuelt før beslutning**, og merge aldrig UI uden ejerens visuelle godkendelse.
