# Mobil-stemmer 3/9 - 10/9 2026

> Kilder: (1) daglige Discord-sweeps `scripts/discord/.sweep-daily-2026-09-03.md` til `.sweep-daily-2026-09-10.md` (alle 8 findes og er læst), plus den allerede samlede `docs/audits/2026-09-10-discord-stemmer-s3.md`. (2) `forum_posts` + `forum_replies` i prod, læst read-only via Supabase MCP 10/9. (3) Spørgeskemaet `2026-09-features` (`survey_responses` + `survey_questions`). SQL i bilaget.
>
> **Navngivning:** Discord-brugere står som `@handle` (samme praksis som issue #5060's titel). Skema-svar står uden navn, fordi skemaet er udfyldt i forventning om at svaret ikke bliver knyttet til et holdnavn. Forum-brugere ville stå med managernavn, men der er ingen forum-fund (se §2).

## 1. Sammenfatning (5 linjer)

1. Mobil er ikke spillernes største smerte, men det er den eneste klage i vinduet der er formuleret som et frafaldssignal: "jeg til tider næsten ikke gider åbne spillet pga det" (@smukkethomsen, 8/9).
2. Spørgeskemaet sætter tal på: **8 af 37** har valgt "At spille på telefonen" som en af de tre ting der fungerer dårligst (21,6 %, en 6.-plads af 11 mulige) - under træning (45,9 %) og holdudtagelse (37,8 %), men over kalender, marked og økonomi.
3. Alle konkrete fund peger på **én rodårsag**: brede datatabeller på små skærme (Mit hold, Træning, ranglister, rytterdatabasen, Marked). Ejeren traf 10/9 beslutning D-047 og PR #5111 blev merget samme aften kl. 19:06 - det er første gang rodårsagen bliver angrebet som standard i stedet for som lap.
4. **Forumkilden er tom.** Ikke ét spiller-indlæg eller -svar i hele forummets levetid (23 tråde, 146 svar) nævner mobil, telefon, scroll eller skærm. Den tidligere audits formulering om en "egen forumtråd" om mobil er ikke dækket af data.
5. Spillerne roser faktisk navigationen på telefonen; det er de handlingstunge flader (transfers, træning, taktik) der falder fra hinanden. Se §3.

## 2. Fund

Alvor står med spillernes egne ord: **godt** / **skidt** / **alvorligt ringe**.

| # | Hvad (konkret flade) | Kilde | Ordret citat | Alvor | Issue |
|---|---|---|---|---|---|
| 1 | Rytternavn-kolonnen forsvinder ved vandret scroll (Mit hold, Træning, rytterdatabasen) | Discord #dansk-snak, @smukkethomsen, 8/9 | "kolonnen med spillernavne følger ikke med når man scroller til siden, det er træls" | alvorligt ringe | #5060 (lukkes af #5102 / PR #5111, merget 10/9) |
| 2 | Hele mobiloplevelsen som friktion der koster sessions | Discord #dansk-snak, @smukkethomsen, 8/9 | "det er sååå omstændigt, at jeg til tider næsten ikke gider åbne spillet pga det" | alvorligt ringe | #5060, #1602 |
| 3 | Søgning efter ryttere på telefonen | Discord #dansk-snak, @smukkethomsen, 8/9 | "det er umuligt at søge på spillere" | alvorligt ringe | **#5122** (nyt) |
| 4 | Transfers, træning og taktik som handlingsflader på telefonen | Skema, `works_worst_detail`, 8/9 | "certain core elements like transfers, training and tactics are almost unplayable" | alvorligt ringe | #5102 (kommenteret; taktik stod ikke i sidelisten) |
| 5 | Daglig træning i landskabstilstand viser kun én række | Skema, `works_worst_detail`, 8/9 | "you can only see one row of the list of runners during daily training if you turn your phone sideways" | alvorligt ringe | #4982 (kommenteret; `SCROLLER`-boksens `max-h` er den direkte årsag) |
| 6 | Træningssiden på mobil generelt | Discord #staff-chat, @egomadsen, 6/9 | "Træningssiden på mobil kunne i det hele taget godt trænge til en make-over." | skidt | #3643, #4613 |
| 7 | Træningssiden ligger i en boks med egen scroll i stedet for at fylde siden | Discord #staff-chat, @friisisch, 6/9 | "trænignssiden nu er i en boks og skal scrolles i stedet for fylder hele siden ud?" | skidt | #4982 |
| 8 | "Gruppér efter type"-boksen stjæler plads på mobil | Discord #staff-chat, @egomadsen, 6/9 | "Gruppér efter type-boksen kunne måske også fylde mindre (eller helt forsvinde på mobil?)" | skidt | #3643 |
| 9 | Marked/Ryttere: flag og navne fylder hele skærmbredden | Discord #staff-chat, @egomadsen, 6/9 | "der fylder flag og navne hele siden, ikke ligefrem den bedste side at lade sig inspirere af" | skidt | #1602 (evidens lagt på 7/9), #5102 |
| 10 | Rytternavne på træning og holdside tvinger telefonen på langs | Skema, `works_worst_detail`, 8/9 | "man skal derfor \"vælte\" telefonen, for at få noget ud af siden. Lidt det samme på holdsiden." | skidt | #3643, #5102 |
| 11 | Ranglisterne på mobil | Skema, `works_worst_detail`, 8/9 og 9/9 | "Certain views and llsts on mobile view are lacking. Rankings for instance" · "Der er mange ting der kan være svært på mobilen, specielt ranglister." | skidt | #5102 (ranglister står i scope) |
| 12 | Overblik over ryttere på mobil kontra desktop | Skema, `one_thing`, 10/9 | "Really difficult to get an overview over the riders - works good on a desktop" | skidt | #5102 |
| 13 | Bedre mobil-UI som årsag til at spille mere (retentionsignal) | Skema, `play_more`, 10/9 | "Better UI for mobiledevice" | skidt | #1602 |
| 14 | Bredden af problemet + oplevet langsommere load | Skema, `works_worst_detail`, 8/9 | "Mange sider er ikke mobil venlige" · "Spillet loader langsommere på det seneste" | skidt | #1602, #4952 (load-delen kommenteret) |
| 15 | Etaperesultatet kan ikke findes fra telefonen | Discord #dansk-snak, @thelamba, 8/9 | "jeg kan ikke se etaperesultatet på telefonen, så har lidt svært ved at se hvad der skete" (senere: "Nu fandt jeg etaperesultatet gennem kalenderen, trods alt.") | skidt | **#5123** (nyt) |
| 16 | Etapetypen kan ikke ses på telefonen ved planlægning | Discord #feedback-and-ideas, @friisisch, 2/9 (i @egomadsens tråd fra 30/8) | "I think this makes the planning hard on phone as well. There's no way to see it" | skidt | #4487 (LUKKET; rolling-ikon leveret 6/9, etapeprofil over tabellen 8/9) |
| 17 | Patch notes-siden død på mobil (forældede chunks) | Discord #staff-chat, @egomadsen, 3/9 | "patch-notes er død" + "På mobilen, så har ikke prøvet noget shift" | skidt | #4595 (PR #5097 merget 10/9) |
| 18 | Tilbagevendende fejlskærm på Chrome/iPhone | Discord #staff-chat, @friisisch, 4/9 | "Rammer ind i den her fra tid til anden på Chrome på iPhone" | skidt | #4595 |
| 19 | Screenshot på telefonen bliver helt sort | Discord #dansk-snak, @smukkethomsen, 8/9 | "Jeg kan ikke få lov til at screenshotte det på mobilen, det bliver af en eller anden grund bare helt sort." | uafklaret | Noteret i #5060; ikke filet (kan være telefonens egen politik, ikke verificeret) |
| 20 | Kulturelt signal: mobil opfattes som andenrangs måde at spille på | Discord #dansk-snak, @knud_r_flink til @thelamba, 6/9 | "Ikke nok med at du har sproget på engelsk, så spiller du også på mobil? 😬" | skidt (signal, ikke bug) | ingen |
| 21 | Forummet skal mobiloptimeres (ejerens egen bestilling, ikke spillerstemme) | Discord #feedback-from-dolmer, @bobby2106, 3/9 | "Forummet skal mobiloptimeres" | leveret 4/9 | #4751 |

**Tal fra skemaet, `works_worst` (37 svar, op til 3 valg):** træning 45,9 % · holdudtagelse 37,8 % · løb 29,7 % · akademi 27,0 % · at lære spillet 21,6 % · **mobil 21,6 % (8 svar)** · kalender 18,9 % · marked 16,2 % · økonomi 13,5 % · indbakke 10,8 % · stabilitet 2,7 % · forum 0.

**Kilde-status:**
- Discord-sweeps: 8 filer, alle læst, 12 distinkte mobil-udsagn fra 5 spillere (@smukkethomsen, @egomadsen, @friisisch, @thelamba, @knud_r_flink).
- Forum i databasen: **TOM.** 23 tråde og 146 svar i alt, 9 tråde og 31 svar siden 3/9. Nul spiller-tekster med mobil/mobile/telefon/phone/android/iphone/ipad/tablet/scroll/swipe/touch/skærm/small screen. De eneste træffere var ejerens egne indlæg, hvor ordet "phone" står i et spørgsmål han stiller spillerne ("would you check the result on your phone anyway?") - ingen svarede på den del. Der findes altså ingen "top 5 ældre tråde med mange visninger om mobil"; sættet er tomt uanset dato.
- Spørgeskema: 8 fritekst-svar nævner mobil, plus `works_worst`-optionen "At spille på telefonen" med 8 valg.

## 3. Hvad spillerne siger er GODT på mobil

Det ærlige billede: rosen er reel, men smal.

- **Navigation og informationssøgning virker.** Det tydeligste positive udsagn i hele materialet, fra den samme spiller der kalder kerneflader uspillelige (skema, `works_worst_detail`, 8/9): "You can do a lot on the phone. The main reason I put it here is that certain core elements like transfers, training and tactics are almost unplayable. **You can move around menus well enough and find information.**"
- **Mobil er ikke i top 5 over det værste.** 21,6 % mod træningens 45,9 %. Spillerne bruger telefonen, og de gør det uden at kalde spillet ødelagt.
- **Stabilitet på telefonen er ikke et tema.** "Hastighed, fejl og ting der går i stykker" fik 1 af 37 svar (2,7 %), laveste i hele skemaet. De to mobil-fejlrapporter i vinduet (patch notes 3/9, Chrome/iPhone 4/9) handler begge om chunk-/cache-fejl, ikke om mobil-layoutet.
- **Konkrete forbedringer i vinduet blev bemærket i patch notes og ikke modsagt af nogen:** dashboard uden vandret overløb på telefoner (3/9), landing page loader hurtigere på mobil Safari (3/9), bølget-etapen fik eget ikon "visible on mobile too" (6/9), låste tabeloverskrifter på 7 sider (6/9), etapeprofilen over tabellen på Taktik (8/9).
- **Spillere bidrager frivilligt med mobil-designarbejde.** @egomadsen lavede 6/9 ni skærmbilleder og Paint-mockups af mobilvisningen uselvopfordret. Det er engagement, ikke afsked.

## 4. Hvor spillerne selv mener vi skal starte

Rangeret efter hvad spillerne selv fremhæver, ikke efter hvad der er nemmest.

1. **Rytternavnet og de tre vigtigste tal skal kunne ses uden vandret scroll.** Det er det eneste mobil-punkt der nævnes af både Discord (@smukkethomsen 8/9), skemaet (tre uafhængige fritekster 8-10/9) og de frivillige mockups (@egomadsen 6/9). Ejerens D-047 og PR #5111 (merget 10/9) rammer præcis her. Verificér på prod og luk #5060.
2. **Træningssiden skal have sin egen mobilform.** Nævnt af tre spillere i vinduet. @egomadsen foreslår konkret: "R. Cooper / Spr/Rou / A:20 F:90 T:53" + "Skift"-knap, og at "Gruppér efter type" forsvinder på mobil. Ejeren svarede 6/9: "Jeg er i hvert fald komplet åben overfor at trænings siden bør have sin egen version optimeret til mobilen". #3643 / #4613.
3. **Fjern boks-scrollen fra #4747.** Den er årsag til både @friisisch's observation (6/9) og skemaets landskabs-klage (8/9), og den koster mest netop når skærmen er lav. #4982.
4. **Handlingsflader før visningsflader.** Skemaets egne ord: navigation og informationssøgning virker, det er transfers, træning og taktik der ikke gør. Vælg den rækkefølge i #1602 frem for at jævne alle sider ud.
5. **De to nye, konkrete huller:** søgning på Ønskelisten (#5122) og vejen til etaperesultatet fra telefonen (#5123).

### Issue-handlinger fra denne audit (10/9)

| Handling | Issue | Hvad |
|---|---|---|
| Oprettet | **#5122** | Ønskelisten: søgefeltet skjult bag lukket fold på mobil (sidste flade på legacy-filterpanelet) |
| Oprettet | **#5123** | Etaperesultatet kan ikke findes fra telefonen |
| Kommenteret | #5102 | Rettet tal (8/37, ikke 10/36), fire fritekst-citater, påpeget at taktik mangler i sidelisten |
| Kommenteret | #4982 | Landskabstilstand viser kun én række; `100dvh` i `SCROLLER` er den direkte årsag |
| Kommenteret | #1602 | Samlet evidens, forumkilden er tom, handlingsflader før visningsflader |
| Kommenteret | #5060 | Søge-delen udskilt til #5122 så den ikke falder ud når #5060 lukkes af D-047 |
| Kommenteret | #4952 | "Spillet loader langsommere på det seneste" (én stemme, ikke verificeret) |

Ingen dubletter oprettet: der findes ingen `cat:mobile`-label i repoet, og `gh issue list --search` blev kørt på mobil, ranglister, etapetype, etaperesultat, søgning, taktik og transfers før hvert nyt issue.

## 5. Bilag: SQL

Alle forespørgsler kørt read-only mod `ghwvkxzhsbbltzfnuhhz` via Supabase MCP `execute_sql` den 10/9. Kolonnenavne slået op i `database/schema-snapshot.json` først.

**Forum, tråde i perioden:**
```sql
SELECT p.seq, p.created_at, p.category, p.title, t.name AS team, p.reply_count, p.view_count, left(p.body, 900) AS body
FROM public.forum_posts p LEFT JOIN public.teams t ON t.id = p.team_id
WHERE p.deleted_at IS NULL
  AND p.created_at >= '2026-09-03'
  AND (p.title ILIKE ANY (ARRAY['%mobil%','%mobile%','%telefon%','%phone%','%android%','%iphone%','%ipad%','%tablet%','%scroll%','%swipe%','%tabel%','%table%','%touch%','%tryk%','%lille skærm%','%small screen%','% app%'])
    OR p.body ILIKE ANY (ARRAY['%mobil%','%mobile%','%telefon%','%phone%','%android%','%iphone%','%ipad%','%tablet%','%scroll%','%swipe%','%tabel%','%table%','%touch%','%tryk%','%lille skærm%','%small screen%','% app%']))
ORDER BY p.created_at;
```

**Forum, svar i perioden** (samme ILIKE-liste, uden `%tabel%`/`%table%`/`%tryk%`/`% app%` der gav ejer-støj):
```sql
SELECT r.created_at, p.seq AS post_seq, p.title, t.name AS team, left(r.body, 1200) AS body
FROM public.forum_replies r
JOIN public.forum_posts p ON p.id = r.post_id
LEFT JOIN public.teams t ON t.id = r.team_id
WHERE r.deleted_at IS NULL AND p.deleted_at IS NULL
  AND r.created_at >= '2026-09-03'
  AND r.body ILIKE ANY (ARRAY['%mobil%','%mobile%','%telefon%','%phone%','%android%','%iphone%','%ipad%','%tablet%','%scroll%','%swipe%','%touch%','%lille skærm%','%small screen%'])
ORDER BY r.created_at;
```

**Forum, ældre tråde uanset dato (top efter visninger):** samme WHERE uden datofilter, `ORDER BY p.view_count DESC NULLS LAST LIMIT 12`. **Resultat: 0 rækker.**

**Forum, volumen (til at fastslå at kilden reelt er tom, ikke bare filtreret væk):**
```sql
SELECT count(*) AS total_posts, count(*) FILTER (WHERE created_at >= '2026-09-03') AS posts_since_0309,
 (SELECT count(*) FROM public.forum_replies WHERE deleted_at IS NULL) AS total_replies,
 (SELECT count(*) FROM public.forum_replies WHERE deleted_at IS NULL AND created_at >= '2026-09-03') AS replies_since_0309
FROM public.forum_posts WHERE deleted_at IS NULL;
-- 23 / 9 / 146 / 31
```

**Skema, spørgsmål hvor mobil er en svarmulighed:**
```sql
SELECT q.key, q.kind, q.label_en, q.label_da, q.options
FROM public.survey_questions q JOIN public.surveys s ON s.id = q.survey_id
WHERE s.slug = '2026-09-features'
  AND (q.options::text ILIKE '%mobil%' OR q.label_en ILIKE '%mobil%' OR q.label_da ILIKE '%mobil%' OR q.key ILIKE '%mobil%')
ORDER BY q.sort_order;
-- kun works_worst; optionen er {"key":"mobile","label_da":"At spille på telefonen","label_en":"Playing on the phone"}
```

**Skema, fordeling på works_worst** (bemærk: valgene ligger i `value->'selected'`, ikke `value->'choices'`):
```sql
WITH s AS (SELECT id FROM public.surveys WHERE slug='2026-09-features'),
resp AS (SELECT r.* FROM public.survey_responses r JOIN s ON s.id=r.survey_id WHERE r.question_key='works_worst')
SELECT c AS choice, count(*) AS n, (SELECT count(*) FROM resp) AS respondents,
 round(100.0*count(*)/(SELECT count(*) FROM resp),1) AS pct
FROM resp, LATERAL jsonb_array_elements_text(resp.value->'selected') AS c
GROUP BY 1 ORDER BY 2 DESC;
```

**Skema, fritekst der nævner mobil:**
```sql
WITH s AS (SELECT id FROM public.surveys WHERE slug='2026-09-features')
SELECT r.question_key, r.created_at::date AS d, r.value->>'text' AS txt
FROM public.survey_responses r JOIN s ON s.id=r.survey_id
WHERE coalesce(r.value->>'text','') <> ''
  AND r.value->>'text' ILIKE ANY (ARRAY['%mobil%','%mobile%','%telefon%','%phone%','%android%','%iphone%','%ipad%','%tablet%','%scroll%','%swipe%','%tabel%','%table%','%touch%','%tryk%','%lille skærm%','%small screen%','%skærm%','%app%'])
ORDER BY r.question_key, r.created_at;
-- 8 rækker: one_thing 1, play_more 1, works_worst_detail 6
```

**Discord (ikke SQL):**
```
grep -n -i -E "mobil|mobile|telefon|phone|android|iphone|ipad|tablet|scroll|swipe|touch|lille skærm|small screen|smartphone" \
  scripts/discord/.sweep-daily-2026-09-0[3-9].md scripts/discord/.sweep-daily-2026-09-10.md
```
