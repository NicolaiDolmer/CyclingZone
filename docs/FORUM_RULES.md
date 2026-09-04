# Forummets regler — SSOT

> **Læs denne FØR enhver opgave der rører det indbyggede forum, forum-notifikationer eller community-laget.**
>
> Forummet gik live 6/8 2026 ([#3199](https://github.com/NicolaiDolmer/CyclingZone/issues/3199), PR #3447). Beslutningerne herunder er truffet 25/8 på grundlag af en samlet indsamling fra fire kilder: in-app forum-tråde, `player_feedback`, GitHub-issues, Discord og en benchmark af Hattrick, ManagerZone og Sokker.

---

## 0. Diagnosen der styrer alt andet

**Forummet er ikke dødt — det er usynligt.** Målt 25/8, 19 dage efter lancering:

| Måling | Værdi |
|---|---|
| Skribenter pr. 30 dage | 15 af 90 aktive spillere = **17 %** |
| Opslag / svar i alt | 12 / 75 |
| Median svar pr. opslag | 4 |
| Tråde uden svar | 2 af 12 (17 %) |

Normal benchmark for skrivende deltagere i et community er 1-9 %. Forummet lå altså **over** normalen uden ét eneste synligheds-signal. Når nogen først er inde, svarer de. Problemet var, at intet fortalte dem, at der var sket noget.

**Konsekvens for al fremtidig prioritering:** før du bygger mere *indhold* i forummet, så spørg om problemet i stedet er, at ingen ved der er noget nyt.

---

## 1. Låste designbeslutninger

| Beslutning | Hvorfor | Dato |
|---|---|---|
| **Opbakning er én tæller, ikke en emoji-palet** | Matcher upvote-vanen fra Discords `#feedback-and-ideas` og holder fladen fri for emoji-støj. Se [anti-AI-slop-linjen i PAGE_TEMPLATES](design/PAGE_TEMPLATES.md) | Ejer 25/8 |
| **Ingen notifikation ved *alle* nye opslag** | Den gule prik i navigationen dækker samme behov uden at fylde en indbakke, der besøges 6.152 gange. Bevidst fravalg, ikke en forglemmelse | Ejer 25/8 |
| **Svar-notifikationer dedupes pr. tråd** | En tråd med 20 svar må aldrig give 20 notifikationer. Findes der allerede en ulæst notifikation for tråden, opdateres den ("N new replies") | 25/8, PR #4238 |
| **Trådlisten sorterer efter seneste aktivitet** | `coalesce(last_reply_at, created_at) desc`, pins øverst. Sortering efter oprettelse lod levende tråde synke | [#4118](https://github.com/NicolaiDolmer/CyclingZone/issues/4118) |
| **Rapportering kræver begrundelse** | Ejer-direktiv: *"gider ikke se rapporter uden grund"* | [#3452](https://github.com/NicolaiDolmer/CyclingZone/issues/3452), 6/8 |
| **Søgning er udskudt** | Med 12 tråde er der ikke noget at søge i. Bliver først værdifuld hvis auto-indhold får trådtallet til at vokse | 25/8, se §3 |
| **Kategorier udvidet fra 2 til 6 + arkiv-filter** | Ejer-beslutning 4/9 ("kategorier skal vi have flere af"), efter spillerønske fra @knud_r_flink 30/8. Overtrumfer [#4492](https://github.com/NicolaiDolmer/CyclingZone/issues/4492)'s egen accept-linje om at kategori-sættet skulle besluttes samlet med sprog-splittet i #3517 — ejeren valgte at køre kategorierne nu, uafhængigt. Nye: `questions`, `tactics`, `transfers`, `off_topic` (general + feedback_ideas uændret; transfers tilføjet samme dag efter samme ejer-beslutning). `archive` er IKKE en DB-kategori — det er et beregnet visnings-filter i `backend/lib/forum.js` (ingen aktivitet i 60 dage), så en tråd falder automatisk ud af arkivet igen ved et nyt svar | Ejer 4/9, [#4492](https://github.com/NicolaiDolmer/CyclingZone/issues/4492) |

---

## 2. Datamodellen

| Tabel | Rolle | RLS |
|---|---|---|
| `forum_posts`, `forum_replies` | tråde og svar, soft delete via `deleted_at` | backend-only skrivning, deny for klienten |
| `forum_thread_reads` | "sidst læst" pr. (bruger, tråd). Ulæst = `coalesce(last_reply_at, created_at) > last_read_at`, eller ingen række | bruger ser/skriver **kun egne rækker** (`user_id = auth.uid()`) |
| `forum_reactions` | opbakning, én pr. bruger pr. mål, toggle | som `forum_thread_reads` |
| `forum_poll_options`, `forum_poll_votes` | afstemninger, kun admin kan oprette | — |
| `forum_reports` | rapportering + moderation-indbakke | — |

`forum_thread_reads` er samtidig **vores eneste kilde til læser-tal** — før den fandtes, kunne vi kun tælle skribenter.

Notifikationstypen er `forum_thread_reply` i `notificationTypes.js`, med paritets-guard mod migrationsfilen i `notificationTypes.test.js`.

---

## 3. Den åbne beslutning: forummets rolle over for Discord

Discord har i dag et **parallelt forum** — `#feedback-and-ideas`, `#bugs` og `#samlet-feedback-features-og-bugs` med 70+ tråde. En spiller 24/8: det sociale liv sker på Discord, *"hvilket udelukker alle dem som ikke bruger det."*

Ejer-beslutning 25/8: **byg synligheds-laget (L1) først, og afgør rollen bagefter på faktiske tal.** Måleplan, baseline og tærskler ligger i [#4235](https://github.com/NicolaiDolmer/CyclingZone/issues/4235), som aflæses **15/9** (før sæson 3 slutter 20/9).

Rammer vi ikke tærsklerne, er problemet ikke synlighed men indhold — og så er næste træk det, benchmarken peger på: auto-oprettet tråd pr. løbsdag, divisions-bundne sub-forums, patch notes som kommenterbar tråd. Ingen af delene er besluttet endnu.

---

## 4. Forbehold ved kildegrundlaget

De skarpeste udsagn om forummet kommer fra `#staff-chat` — en lille testergruppe, ikke den brede spillerbase. For L1 betød det ikke noget, fordi ønskerne var entydige og billige. Men hviler en fremtidig beslutning på "spillerne siger", så hviler den reelt på en håndfuld mennesker. Benchmarken har samme svaghed: Hattrick-wikien blokerede fetch, så dele af den er søge-snippets, ikke verificeret sideindhold.
