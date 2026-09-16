# Cycling Zone: kritisk gennemgang + plan for flere managers

Repo: `C:\Dev\CyclingZone`. Læs `AGENTS.md`, `CLAUDE.md` og `docs/NOW.md` først.

## Dit mandat denne session

Du er min tekniske og forretningsmæssige rådgiver. **Du skriver ingen kode, åbner ingen PR og merger intet.**
Du leverer en kritisk gennemgang og en prioriteret plan. Kode kommer i en senere session, når vi er enige.

Jeg er solo-founder og udvikler. Cycling Zone er et browser-baseret multiplayer cykelmanager-spil,
gratis at spille, åben beta siden 8. maj 2026, live på cyclingzone.org.

**Målet er at få markant flere managers ind i spillet — og at de bliver.**

En anden AI (Claude) har netop gennemgået det samme. Dens konklusioner står nederst under
"Claudes konklusioner". **Din opgave er ikke at gentage dem — det er at efterprøve dem.**
Hvor den tager fejl, vil jeg vide det. Hvor den har overset noget, vil jeg vide det.
Enighed uden selvstændig efterprøvning er værdiløst for mig.

---

## 1. Forretningssituationen (tal målt mod prod 16/9-2026, ikke gæt)

### Tilstrømningen er kollapset

Nye brugere pr. uge: `6/7: 15 · 13/7: 5 · 20/7: 32 · 27/7: 19 · 3/8: 18 · 10/8: 17 · 17/8: 12 · 24/8: 20 · 31/8: 6 · 7/9: 6 · 14/9: 1`

Fra 32 til 1 på otte uger. Jeg ved ikke hvorfor.

### Og de nye bliver ikke (issue #4964)

| Kohorte | Aktive uge 1 | Igen uge 2 | Retention |
|---|---:|---:|---:|
| Tilmeldt før 1/8 | 38 | 33 | **86,8 %** |
| Tilmeldt 1.-23. aug | 13 | 8 | 61,5 % |
| Tilmeldt i launch-ugen 24.-30. aug | 14 | 4 | **28,6 %** |

Produktet holder på folk der er kommet ordentligt i gang. Det er **overgangen fra ny til etableret**
der knækker. Forbehold: launch-kohorten er 14 brugere, så 28,6 % er retningsgivende, ikke præcist.

### Nuværende tilstand

- 269 brugere i alt; 241 har spillet mindst 3 løbsdage; **kun 45 aktive de sidste 30 dage**, 125 inaktive 30+ dage
- **58 % af sessioner er mobil** (Clarity, 7 dage: 637 mobil / 465 PC / 9 tablet)
- Sæson S4 starter **28/9** og giver næste naturlige tilstrømning. Er hullet ikke lukket inden, spilder jeg den også.
- Indtægt: abonnement via Alunta ("Founder Supporter"). Spillet er og bliver gratis at spille.
- Budget: **500-2.000 kr/md** til at teste betalt akkvisition. Testpenge, ikke skalering.
- Kanaler i dag: organisk + Discord. Ingen annoncer kører. **ChatGPT er allerede top-5 signup-kilde** (#4322).

---

## 2. Teknisk tilstand (verificeret 16/9 — brug det, gentag ikke målingen)

**Arkitektur: to apps, ét domæne.**

| | Spil-appen | Marketing-sitet |
|---|---|---|
| Sted | `frontend/` | `marketing/` |
| Teknologi | React 18 + Vite (SPA, klient-renderet) | Next.js 16 + React 19 (server-renderet) |
| Tailwind | 3.4 (migration åben, #5151) | 4.3 |
| Vercel-projekt | `cycling-zone` | `cycling-zone-marketing` |

Spilleren ser kun ét domæne — alt går gennem rewrites i `frontend/vercel.json`.
Vercel Pro betales pr. bruger, ikke pr. projekt, så det andet projekt koster ~0 kr ekstra i abonnement.

- Spil-appen: **689 kildefiler, 65 sider, ~59.500 linjer**. Bundle-budget **1.138 KB gzipped** (alle chunks).
- **Ingen PWA**: intet manifest, ingen service worker, ingen push, ingen installérbarhed.
- SEO virker nu på de flyttede sider (`curl -A Googlebot` giver unikke titler). Før #4067: **1 side indekseret i hele sitet**.
- Backend: Node/Express på Railway. Data/auth: Supabase (Postgres + RLS). Fejl: Sentry.

**Måling** (fuld SSOT i `docs/ANALYTICS_STACK.md`):
Postgres ejer sandheden om tragt, aktivitet, retention og penge — den ser 100 % af brugerne.
Browser-værktøjerne ser kun de ~2/3 der siger ja til analytics-samtykke: GA4, Microsoft Clarity,
Vercel Web Analytics og PostHog. Plus en cookie-fri traffic beacon på offentlige sider.
First-touch attribution (utm + referrer + landing path) gemmes ved signup i `signup_attribution`.

**Kendte huller, nu som issues:** `#5304` click-ids fanges ikke · `#5305` PostHog har 0 events og
`/ingest`-proxyen kan knække lydløst · `#5306` NPS er reelt tavs · `#5307` langsigtet arkitektur + PWA/push.

---

## 3. Hvad jeg vil have fra dig

### A. Efterprøv Claudes konklusioner (nederst). Hvor tager den fejl?
Vær specifik. "Enig" er ikke et svar — sig *hvorfor*, eller sig hvad den overså.

### B. Diagnose før kur: hvorfor faldt tilstrømningen fra 32 til 1?
Opstil de mest sandsynlige forklaringer, og for **hver enkelt: hvilket konkret tal eller hvilken kilde
be- eller afkræfter den?** Jeg kan køre SQL mod prod og kigge i GSC, GA4 og Clarity — fortæl mig
præcis hvad jeg skal slå op. Gæt ikke på årsagen; giv mig testen.

Forhold dig mindst til: sæsonalitet (cykelsæsonen slutter), en enkelt kilde der er tørret ud,
et SEO-fald, et knækket signup-flow, eller at juli-toppen var én engangsomtale.

### C. Kritisk gennemgang, område for område
For hvert område: **karakter (1-10), det stærkeste, det svageste, og den ene ting jeg skal gøre.**
Vær hård. Jeg vil hellere høre at noget er middelmådigt nu end om seks måneder.

1. **Brugeroplevelse** — er den nye spillers første 10 minutter god nok? (Se #1140, #1569)
2. **SEO** — er hybrid-splittet rigtigt? Hvad er den største uudnyttede mulighed?
3. **Markedsføring** — hvor findes cykelmanager-spillere realistisk? Vær konkret om *hvilke*
   communities, subreddits, fora, YouTube/Twitch-nicher, sprogområder. Sig også hvad jeg skal droppe.
4. **Tracking** — fire browser-leverandører på 269 brugere. Er det for meget? Hvad måler jeg ikke,
   som blokerer en beslutning?
5. **Hastighed** — 1.138 KB gz og 58 % mobil. Hvor slemt er det reelt, og hvad koster det i kroner og brugere?
6. **Mobiloptimering** — mobil er flertallet. Er PWA + push det rigtige svar på retention, eller er det en afledning?
7. **Spiloplevelse** — holder produktet? 86,8 % retention blandt etablerede siger måske ja. Hvad siger det ikke?
8. **Brugerfastholdelse** — hvorfor forsvinder to ud af tre nye, og hvad er den billigste rettelse?

### D. Akkvisition eller retention — hvilken ende først?
Træf ét valg og begrund det med tallene. Jeg vil have en anbefaling, ikke "begge dele er vigtige".

### E. Prioriteret plan: 5-8 indsatser, rangeret
For hver: **hvad** (konkret nok til at gå i gang i morgen) · **hvorfor den rangerer der**
(forventet effekt på antal nye *aktive* managers) · **indsats** i timer for mig + kroner ·
**hvordan jeg måler om den virkede** (hvilket tal, hvilken kilde, hvornår) ·
**hvornår jeg dropper den igen** hvis den ikke virker.

Rangér efter forventet effekt ÷ indsats. Regn i **cost-per-aktiv-manager**, ikke cost-per-signup —
med 125 inaktive ud af 241 igangsatte ser en signup-pris billig ud og er stadig spild.

### F. Langsigtet: hvad ville vi vælge hvis vi startede forfra i dag?
Og vigtigere: **hvad er den rigtige vej derhen herfra**, uden en omskrivning jeg ikke har tid til?
Se #5307. Er Astro relevant? (Claude siger nej — efterprøv det.)

### G. Penge
Hvordan går et gratis nichespil med ~45 aktive brugere fra hobby til levebrød, uden pay-to-win?
Vær ærlig om hvilke brugertal der skal til før det overhovedet er realistisk.

### H. Adgang og værktøjer
Er der noget du eller Claude mangler adgang til for at kunne rådgive ordentligt?
Kendte huller i dag: **GA4 har ingen MCP** (så ingen AI kan verificere en GA4-påstand),
**Google Search Console har ingen MCP** (`scripts/gsc-report.mjs` er klar, service-kontoen mangler),
**Vercel Web Analytics svarer 404** (målt tre gange), **Ahrefs er gratis-tier** ("Insufficient plan"
på keywords og GSC), **Discord-MCP'en fejlede med CONNECTION_CLOSED** i denne session.
Sig hvilke der faktisk betyder noget for beslutningerne, og hvilke jeg kan ignorere.

---

## 4. Relevante åbne issues

Læs dem. Dublér dem ikke. **Din plan skal sige hvilke der rykker op, hvilke der rykker ned,
og hvilke jeg skal lukke som ikke-værd-at-gøre.**

*Diagnose:* `#4964` væksthavariet + kohorte-tallene (priority:high, needs-decision).

*Aktivering — hvor de 71 % falder fra:* `#1140` strømlin ny-spiller-onboarding til ét flow ·
`#1569` onboarding-audit med handlingsplan. Begge skrevet FØR kohorte-tallet fandtes;
#4964 er målepunktet de skal løses op imod.

*Akkvisition:* `#2759` Facebook-annoncer + organisk TikTok · `#4322` AI-assistenter som målt kanal ·
`#4067` offentligt Next.js marketing-site · `#2824` login-væggen som synlighedsproblem · `#1173` referral-loop.

*Reaktivering:* `#2760` win-back-mails til dormante. Der er 125 inaktive at skrive til.

*Måling:* `#3796` UTM-disciplin + "hvor hørte du om os?" · `#3797` GSC + funnel pr. kanal ·
`#1407` SEO measurement · `#5304` click-ids · `#5305` PostHog-pipeline.

*Hastighed og mobil:* `#5131` paraply for hastighed + mobil · `#1602` mobil-epic ·
`#4952` alle JS-fejl sidste uge kom fra Firefox mobil · `#5307` arkitektur + PWA/push.

Jeg har desuden netop kørt et spørgeskema til alle spillere om ønskede features
(lukkedato 14/9, `#4943`/`#5121`). Spørg efter resultatet hvis det ændrer din anbefaling.

---

## 5. Claudes konklusioner — efterprøv dem

1. **Splittet i to Vercel-projekter er korrekt, ikke et rod.** En SPA kan ikke indekseres;
   Next.js løser det; spillerne ser kun ét domæne; det koster ~0 kr ekstra.
   Den reelle pris er kompleksitet for en solo-udvikler, ikke penge.
2. **Astro er ikke svaret.** Problemet er allerede løst med Next.js og virker. At skifte nu
   er at lave løst arbejde om. Astro ville ikke hjælpe den højinteraktive spil-app.
3. **Endemålet er én Next.js-app, men vejen er side-for-side bag de eksisterende rewrites** —
   aldrig en big-bang-omskrivning af 59.500 linjer.
4. **Offentlige spildata (rytter- og holdprofiler, stillinger) er den største uudnyttede
   akkvisitionskanal.** Long-tail-søgeord ingen konkurrent dækker, og de er delbare.
5. **PWA + push er sandsynligvis den største enkeltstående retention-løftestang**, fordi spillet
   er en daglig løkke med deadlines, 58 % er mobil, og den hyppigste årsag til frafald er at man glemmer det.
6. **Retention før akkvisition.** Flere besøgende ind i en spand der lækker i den ende er den dyre rækkefølge.
7. **Ingeniør-disciplinen er høj** (bundle-gate, Lighthouse CI, samtykke-arkitektur, RLS, SSOT-docs),
   **men målingen er overbygget i forhold til de beslutninger der faktisk træffes**, og retention-løkken —
   det der afgør om forretningen lever — er den mindst gennemarbejdede del.

---

## 6. Regler for dit svar

- **Ingen opfundne tal.** Bruger du et benchmark, så sig hvor det kommer fra og hvor godt det passer
  på et gratis nichespil med 269 brugere. Er du usikker, så skriv "antagelse:" foran.
- **Verificér før du påstår.** Har du adgang til repoet, så læs koden frem for at gætte.
- **Direkte og ærligt.** Ingen ros, ingen opmuntring, ingen "det er et stærkt fundament".
  Er noget af det jeg har bygget spild af tid, så sig det.
- **Konkret frem for generelt.** "Lav content marketing" er ubrugeligt.
  "Skriv tre sammenligningssider mod Pro Cycling Manager, målret disse keywords" er brugbart.
- **Ingen åbne option-lister.** Træf valget og begrund det. Skal jeg vælge, så giv A/B med din anbefaling.
- **Udskyd ikke selv.** Foreslå ikke at noget "tages senere" — rangér det, eller sig det skal droppes.
- **Start dit svar med den ene sætning der bedst beskriver hvad mit egentlige problem er.**
