# Forum - samlede forslag (4/9 2026)

Kilder: Discord-sweeps (forum-discord.md), GitHub-issues (forum-github.md), prod-audit (forum-prod.md). Filtreret mod `docs/FORUM_RULES.md` §1 (låste beslutninger).

## Tal fra prod
- 15 tråde, 116 svar i alt (ikke slettet)
- Aktive skribenter: 8 (7 dage) / 17 (30 dage) af 258 managers
- Median tid til 1. svar: 0,5 t (gns. 9,4 t, målt på 13 af 15 tråde)
- Tråde uden svar: 2 af 15 (13,3 %)
- Mest læste tråd: "Too few riders or too many races?" (41 læsere)

## Spillerforslag - samlet og deduplikeret

### Find/naviger
| Forslag | Kilde | Stemmer | Str. | Værdi nu | Bygget/låst? | Anbefaling |
|---|---|---|---|---|---|---|
| Ulæst-markering pr. tråd + gul prik i nav | Discord (3 spillere, deriblandt @egomadsen 29/8) + GitHub #3451 | 3 | - | Ved hvor der er nyt uden at åbne alt | **Ja - live** (#4238, `forum_thread_reads`) | Ingen handling |
| Sortering efter seneste svar (ikke oprettelse) | Prod-reply Friisisch 22/8 + GitHub #4118 | 1 | - | Aktive tråde synker ikke væk | **Ja - live** | Ingen handling |
| "Markér alle som læst"-knap | Prod-reply Chris Machines 26/8: "a button - like in the inbox - where you can mark all threads as read" + Discord-relæ + GitHub #3451 | 1 (3 kildeomtaler) | S | Fjerner gul-prik-støj hurtigt | Nej | Byg nu |
| Åbn tråd ved 1. ulæste / fold læste sammen | @egomadsen 29/8: "the posts before folded together" (Discord+GitHub #3451) | 1 | M | Sparer scroll i lange tråde | Nej | Byg efter 15/9-beslutning #4235 |
| Flere kategorier (Q&A, Off-topic) + arkiv for gamle tråde | @knud_r_flink 30/8: "Maybe add some more topics... 'Archives' for old threads" (GitHub #4492) | 1 | S | Bedre struktur når trådtal vokser | Nej - **låst (§1)** til gate sammen m. sprog-split | Byg efter 15/9-beslutning #4235 |
| Forum-søgning | GitHub #3451 | - | M | Kun værdifuld ved flere tråde | Nej - **låst (§1)**, bevidst udskudt | Byg efter 15/9-beslutning #4235 |

### Notifikationer
| Forslag | Kilde | Stemmer | Str. | Værdi nu | Bygget/låst? | Anbefaling |
|---|---|---|---|---|---|---|
| Notifikation ved alle nye opslag i forummet | Prod-reply dolamba 21/8: "when there's a new post in forum... should get a notification of some sort" | 1 | - | Ønsket, men dækkes allerede | Nej - **låst (§1 pkt. 2)**, gul prik dækker behovet | Afvis - forklar spilleren at gul prik løser det |

### Mobil
| Forslag | Kilde | Stemmer | Str. | Værdi nu | Bygget/låst? | Anbefaling |
|---|---|---|---|---|---|---|
| Flyt "quote"/"report"-knapper ned under indlægsteksten | @egomadsen 29/8: "it would be more readable on the phone" (Discord + GitHub #4415) | 1 | S | Direkte læsbarheds-fix på mobil, billigt | Nej - knapperne ligger stadig i header-række (ForumPostPage.jsx ~l.487) | Byg nu |

### Identitet/social
| Forslag | Kilde | Stemmer | Str. | Værdi nu | Bygget/låst? | Anbefaling |
|---|---|---|---|---|---|---|
| Spiller-til-spiller-beskeder (DM/indbakke, kernefeature) | Ejer-direktiv (#3200, #4751) + spiller @arongreve 3/8 uafhængigt | 2 (ejer + 1 spiller) | L | Socialt lag uden Discord-afhængighed | Nej - deadline sat ("senest S3"), design-samtale ikke afholdt | Byg efter 15/9-beslutning #4235 (afklar scope før start pga. størrelse) |

### Indhold/kategorier
| Forslag | Kilde | Stemmer | Str. | Værdi nu | Bygget/låst? | Anbefaling |
|---|---|---|---|---|---|---|
| L2-indholdstiltag: auto-tråd pr. løbsdag, divisions-subforums, patch notes som tråd, forum-Discord-bro | Ejer-diagnose 25/8 + benchmark (Hattrick/ManagerZone/Sokker) + spiller 24/8: "[Discord] udelukker alle dem som ikke bruger det" | - | L (hver for sig) | Løser evt. indholds-problem hvis synligheds-laget ikke er nok | Nej - betinget af måling 15/9 | Byg efter 15/9-beslutning #4235 |

### Ejer-kommunikation
| Forslag | Kilde | Stemmer | Str. | Værdi nu | Bygget/låst? | Anbefaling |
|---|---|---|---|---|---|---|
| Kommunikér de 6 ventende nyheder til spillerne + bekræft de 13 planlagte info-tråde i #4117 | Intern gap-analyse (Discord-sweep 4/9 + GitHub #4117) | - | S | Spillerne mangler basal info om egne rammer | Nej - status ukendt, se forbehold | Byg nu (uafhængig af 15/9) |

## Ejerens egne ønsker (bobby2106, Discord #feedback-from-dolmer)
Ikke spillerforslag - Nicolais egne krav til Claude, listet separat.

| Ønske | Issue | Str. | Status |
|---|---|---|---|
| Profil-identitet på forum (klikbart navn+holdnavn, profilbillede, klikbart Discord-link) | #4751 | S/M | Ikke bygget |
| Social graf (tilføj ven, liste over online managers, @-tag → indbakke-besked) | #4751 | M | Ikke bygget |
| Abonnér/afmeld pr. kategori | #4751 | M | Ikke bygget |
| Auto-signatur på indlæg | #3517/#4751 | S | Ikke bygget |
| Emoji + links i selve indlægsteksten | #3517 | M | Ikke bygget |
| Dansk/engelsk-split af forummet (to fora) | #3517 | L | Ikke bygget - koblet til #4492-beslutning |
| Opbakning er én tæller (ikke emoji-palet) | #3517 | - | **Bygget + låst (§1)** |
| Citér-svar med notifikation til den citerede | #3517 | - | **Bygget** (QuotedReplyBlock, live) |

## Ubesvarede spørgsmål til ejeren
- **"Would you like to help Cycling Zone?"** - Dolmer, 2026-08-10, 0 svar. Ejerens egen tråd til community, reelt ubesvaret (ingen har svaret ham).
- Tre spillerforslag uden synligt ejer-svar i de gennemsøgte filer: @egomadsen (mobil-knap-placering, 29/8), @knud_r_flink (kategorier/arkiv, 30/8), en unavngiven forum-relæ-bruger (svar-til-specifikt-indlæg, 11/8).
- Uklart om "markér alle som læst" er besluttet eller stadig åbent - patch-noten 2/9 nævner det ikke.

## Afstemninger uden opfølgning
- **"Test - Is it working?"** (2026-08-06): "Yes" (1), "Yes" (2), "Also yes" (1) - kun 2 svar i tråden (Ottendahl, Egomadsen), intet fra Dolmer. Eneste poll i databasen (testpoll, 4 stemmer).

## Ejer-kommunikation der mangler
Ifølge Discord-sweep 4/9 er der ingen omtale fundet af følgende (søgt case-insensitivt i .sweep-daily-2026-09-04.md):
- Skew Protection/404 efter deploy
- AI-hold nedlæggelse (kun beslægtet tekst om AI-hold i global rank/oprykning, ikke en "nedlæggelse")
- U25-klassementet
- Evne-lofter hævet
- Sæsonskifte 27/9
- Pro i euro
- S4-kalender

Spillerne har med andre ord ikke fået disse 6-7 emner kommunikeret endnu - uafhængigt af forum-prioritering bør dette ud snarest.

## Kilde-forbehold
- **Discord-MCP var nede denne session** - al Discord-data stammer fra tidligere sweep-filer (`.sweep-daily-*.md`), ikke en live gennemgang. Kan være forældet eller mangle kontekst.
- **#4117 (13 klar-til-post tråde)**: 0 GitHub-kommentarer, alle 14 checkbokse ustatuerede. Kan ikke bekræftes om de reelt er postet i Discord - kræver enten et kig i kanalerne eller ejerens bekræftelse.
- **FORUM_RULES.md benchmark-grundlag** er delvist svagt: Hattrick-wikien blokerede fetch (søge-snippets, ikke verificeret sideindhold), og de skarpeste udsagn om forummet kommer fra `#staff-chat` (lille testergruppe, ikke bred spillerbase).
- Flere citater i Discord-sweepene er fra unavngivne "forum-relæ"-kilder (Captain Hook-bot) uden bekræftet brugernavn - talt som separate datapunkter, men kan overlappe med navngivne citater fra samme periode.
- "Stemmer"-tal i tabellerne er distinkte personer fundet i de tre inputfiler, ikke en udtømmende optælling af alle forum/Discord-ytringer.
