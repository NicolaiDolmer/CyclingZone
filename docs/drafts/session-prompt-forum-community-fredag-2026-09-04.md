# Session-prompt: Forum-forbedringer + "Community fredag" (4/9 2026)

> Copy-paste til en ny Claude Code-session i `C:\Dev\CyclingZone`. Skrevet 4/9 af orkestratoren på ejerens bestilling.

---

Start session. Læs `docs/NOW.md` først (working agent skal være "Ingen aktiv session").

**Mål for sessionen (ejer 4/9):** Forummet skal blive markant bedre, og jeg vil i dag skrive til
community flere steder og holde en "Community fredag" inde på forummet: flere indlæg om
forskellige emner, der får ordnet noget af al den kommunikation der mangler til spillerne.

**Trin 1 — Saml ALLE forslag til forummet (read-only, én rapport):**
Gennemsøg tre kilder og saml hvert forslag med kilde, dato, hvem og ordret citat:
1. **Discord:** sweep-filerne `scripts/discord/.sweep-daily-*.md` (alle datoer) + Discord-MCP'en
   (`discord_read_messages`) for kanalerne #feedback-from-dolmer, #questions-and-answers,
   #dansk-snak, #dansk-strategi, #staff-chat, #hattrick — søg efter "forum" og efter forslag om
   søgning, notifikationer, kategorier, mobil, profil, DM, citater, afstemninger.
2. **GitHub:** `gh issue list --state all --search "forum" --limit 200` + labels `cat:community`;
   kendte: #4751 (forum- og social-pakke: klikbare navne, profilbillede, DM), #4492 (kategorier
   Q&A/off-topic + arkiv), #3451 (søgning + ulæste), #4415 (mobil: citer/rapporter over teksten),
   #3517 (v1.1: citér-svar m. notifikation, emoji), #4235 (forummets rolle vs. Discord —
   beslutning 15/9, L1 puls er bygget), #3200 (spiller-til-spiller-beskeder), #4117 (tråd-bank:
   13 klar-til-post tråde), #428 (ugentlig rytme MAN/ONS/SØN).
3. **Forummet selv (prod, read-only via Supabase MCP `execute_sql`, projekt ghwvkxzhsbbltzfnuhhz):**
   tabellerne `forum_posts`, `forum_replies`, `forum_reactions`, `forum_poll_options`,
   `forum_poll_votes`, `forum_thread_reads`, `forum_reports` — slå kolonnenavne op i
   `database/schema-snapshot.json` FØRST (gæt aldrig). Find: tråde/svar der nævner forummet selv,
   de mest læste tråde, ubesvarede spørgsmål til ejeren (ingen svar fra ejer-kontoen), afstemninger
   uden opfølgning, og tal: aktive skribenter 7/30 dage, læsere pr. tråd, svartid.
   Regler: `docs/FORUM_RULES.md` er SSOT for forummets regler; `docs/design/PAGE_TEMPLATES.md` +
   `docs/design/TASTE.md` er bindende for al UI.

Lever rapporten som `docs/audits/forum-forslag-samlet-2026-09-04.md`: én tabel (forslag, kilde,
antal stemmer/gentagelser, størrelse S/M/L, værdi for spillerne nu, anbefaling), grupperet i
områder (find/naviger · notifikationer · mobil · identitet/social · indhold/kategorier · ejer-
kommunikation). Ingen nye issues før jeg har set listen. Vis mig listen som beslutningskort:
ÉT område ad gangen, A/B + anbefaling, kontekst inde i kortet.

**Trin 2 — Byg det jeg vælger:** workers (sonnet default, opus kun til tunge UI-flader), maks 3
samtidig, targeted verify, "push senest efter 15 min" i hver prompt, draft-PR'er med preview-
screenshots (desktop + Android-bredde) til mit visuelle go. Ingen merge uden mit go.

**Trin 3 — Community fredag (i dag):** skriv UDKAST (jeg poster selv, aldrig Claude) til 4-6
forum-indlæg og én kort Discord-note der peger på forummet. Emner: (a) hvad der skete i denne
uge (Skew Protection + selvheling, sort-side-fixet, AI-hold-nedlæggelse, U25-klassementet rettet,
lofter hævet), (b) hvad vi ved om S3 lige nu (kalender, puljer), (c) svar på de ubesvarede
spørgsmål fra trin 1, (d) én afstemning (fx #4714 12-timers-minimum), (e) hvad der kommer
(S4-kalender, sæsonskifte 27/9, Pro i euro). Copy-regler: EN først, DA under; kort; ingen tal-
dump, ingen tidspunkter/løfter om datoer, glad tone, ingen em-dash, ingen AI-fyld, ingen
"free forever". Tjek `docs/NOW.md`, `docs/MASTERPLAN.md` og PatchNotesPage 7.246 for fakta, og
tjek Discord om jeg allerede har postet noget af det.

**Hard rules:** send ALDRIG beskeder på mine vegne (Discord/forum/mail); prod-mutationer kun med
mit ordrette go; luk ingen issues uden aftale; commit kun bag `scripts/guard-commit-branch.sh`;
kald `gh`/`git` bart (aldrig `cd X && …`), ingen heredoc; close-out pr. CLAUDE.md (NOW.md,
patch notes, token-hygiejne).
