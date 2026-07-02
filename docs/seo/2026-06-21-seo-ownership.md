# SEO measurement — ownership & gotchas

> Owner-prep doc for [#1407](https://github.com/NicolaiDolmer/CyclingZone/issues/1407). Refs #1301, #1304.
> Formål: én kilde til sandhed for "hvilket værktøj ejer hvilket tal", så fremtidige SEO-reviews ikke sammenligner æbler og pærer. Ingen kode-ændringer i denne doc.

## 1. Ansvarsfordeling — hvem ejer hvilket tal

Hvert værktøj har ÉT ansvar. Ser to værktøjer på "det samme tal" og er uenige, så slå op her hvilket der er sandheden for netop dén metrik.

| Værktøj | Ejer (sandheds-kilde for) | Ejer IKKE | Status (per #1407) |
|---|---|---|---|
| **Google Search Console (GSC)** | Hvad vi rankerer på: impressions, clicks, CTR, gennemsnitlig position, query-liste, indeksdækning (Coverage/Pages) | Adfærd efter landing; konvertering | Sat op (#352, #1302); domæne-property DNS-verificeret 2026-06-30 — se §6 |
| **GA4** | Hvad folk gør efter de lander: sessions, engagement, funnel, key events / konvertering, attribution | Ranking-position; backlinks | Sat op (#352); admin-toggles mangler — se §3 |
| **Ahrefs Webmaster Tools** (gratis) | Backlinks + uafhængig teknisk site-audit | Adfærd; konvertering | [EJER-HANDLING] ikke verificeret endnu |
| **Morningscore** | Keyword-discovery, rank-tracking, konkurrent-overvågning | Real-traffic-tal (brug GA4/GSC) | Planlagt |
| **Lighthouse-CI** | LAB Core Web Vitals + bundle-size som CI-gate (bundle-size hard, scores advisory) + ugentlig prod-review | Field-CWV (brug web-vitals→GA4); trafik/ranking | Implementeret 2026-06-23 (perf-seo-loop) |
| **web-vitals → GA4** | FIELD Core Web Vitals — rigtige brugeres LCP/INP/CLS/FCP/TTFB | Lab-scores (brug Lighthouse); ranking | Implementeret 2026-06-23 (perf-seo-loop) — gratis erstatning for Vercel Speed Insights |
| **Microsoft Clarity** | Session-replay + heatmaps (kvalitativ adfærd) | Kvantitativ konvertering (brug GA4) | Sat op (separat fra #1407-scope) |

Tommelfingerregel ved konflikt:
- "Hvor mange så os i Google?" → **GSC** (impressions).
- "Hvor mange klikkede sig ind?" → **GSC clicks** = ~indgang; **GA4 sessions** = hvad der så skete. De to tal matcher ALDRIG 1:1 (forskellige målemetoder, bots, consent-gate) — det er forventet, ikke en fejl.
- "Hvem linker til os?" → **Ahrefs**.
- "Hvilke keywords skal vi skrive content til?" → **Morningscore** (discovery) + **GSC** (hvad vi allerede ranker på).

## 2. Owner vs. automatisérbart — hvad kræver din hånd

**Kun ejeren kan** (kræver login/admin-rettigheder i eksterne UI'er — kan ikke automatiseres herfra):
- GA4 admin-indstillinger (Enhanced Measurement, data-retention, Search Console-link, key-event-markering) — se §3.
- GSC property-ejerskab, sitemap-submit, manuelle indekserings-requests.
- Ahrefs/Morningscore konto-verifikation af `cyclingzone.org`.
- Google Signals on/off-beslutning.

**Automatisérbart / Claude-kan** (lever i repo):
- `sitemap.xml`-generering + `robots.txt` (kode i repo).
- Meta-tags / OG-tags / structured data i frontend.
- Lighthouse-CI gate i CI-pipeline.
- GA4-klient-integration (`frontend/src/lib/gaIntegration.jsx`) — instrumenteringen i koden, IKKE admin-toggles.
- Denne ownership-doc + fremtidige SEO-audit-docs.

[EJER-BESLUTNING: skal Morningscore beholdes ved siden af Ahrefs, eller er der overlap der ikke retfærdiggør to værktøjer?
- Behold begge — fordel: Morningscore = aktiv keyword-discovery + konkurrent-tracking som Ahrefs-gratis ikke giver. Omkostning: ekstra abonnement + endnu et dashboard at holde øje med. Alternativ: kør Ahrefs-gratis alene til backlinks/audit i starten og tilføj Morningscore først når der er content-volumen at rank-tracke.]

## 3. ⚠️ SPA + GA4 — den kritiske faldgrube

**Problemet (gælder os direkte):** Cycling Zone er en single-page-app (React + `react-router-dom` `BrowserRouter`, se `frontend/src/App.jsx`). Når en bruger navigerer mellem sider (fx `/riders` → `/auctions`), laver browseren IKKE en fuld page-load — kun en JS-route-ændring via History API. **GA4's standard `gtag("config", ...)` sender kun ÉT `page_view` ved den allerførste load.** Uden ekstra opsætning ser GA4 derfor kun 1 pageview pr. session, uanset hvor mange sider brugeren faktisk besøger. Det ødelægger landing-page-rapporter, funnel-analyse og engagement-tal.

**Hvor det bider hos os — grounded i koden:**
- `frontend/src/lib/gaIntegration.jsx` (linje 30-31) kalder `gtag("js", ...)` + `gtag("config", MEASUREMENT_ID)` og injicerer derefter `gtag.js`. Der er **ingen** manuel `page_view`-wiring (verificeret: ingen `useLocation`/`send_page_view`-kald i `frontend/src/` der sender pageviews på route-skift).
- Kode-kommentaren (linje 41-43) siger eksplicit: *"SPA route changes are tracked by GA4 Enhanced Measurement (history events) — no manual page_view wiring needed."*
- **Det betyder:** vores SPA-pageview-tracking afhænger 100 % af at **Enhanced Measurement → "Page changes based on browser history events"** er slået **ON** i GA4-admin. Er den OFF, får vi tavst kun 1 pageview/session — ingen fejl i koden, ingen advarsel; tallene er bare forkerte.

**To måder at løse SPA-pageviews på (begge er gyldige — vi har valgt A i koden):**
- **A: GA4 Enhanced Measurement (admin-toggle).** Fordel: nul kode, vedligeholdes af Google. Omkostning: afhænger af en admin-indstilling der kan stå forkert uden at nogen opdager det → derfor §3-verifikations-checklisten nedenfor. Dette er vores nuværende design.
- **B: Manuel `page_view` på hver route-ændring i koden** (`useLocation` + `gtag("event", "page_view", { page_path })`). Fordel: eksplicit, versioneret, kan ikke "falde af" i et admin-UI. Omkostning: kode at vedligeholde + risiko for dobbelt-tælling hvis Enhanced Measurement OGSÅ er ON. [EJER-BESLUTNING: bliv på A (admin-toggle) eller flyt til B (kode)? Anbefaling hører til ejeren — begge virker; A er allerede valgt og dokumenteret i koden.]

**Verifikations-checkliste (ejeren — bekræft at A faktisk virker):**
- [ ] [EJER-HANDLING] GA4 Admin → Data Streams → web-stream → **Enhanced measurement** = ON, og under tandhjulet: **"Page changes based on browser history events"** = ON.
- [ ] [EJER-HANDLING] Åbn `cyclingzone.org`, klik gennem 3-4 sider, og bekræft i **GA4 Realtime** at antallet af `page_view`-events stiger pr. klik (ikke står på 1). Dette er den eneste pålidelige røgtest.
- [ ] [EJER-HANDLING] Tjek at `page_view`-rapporten viser flere distinkte `page_path`-værdier end kun landing-pagen.

## 4. Key-event-DEFINITIONER (ikke implementering)

GA4 kalder konverterings-events for **key events**. Listen nedenfor er DEFINITIONER — hvad hvert event betyder og hvornår det bør fyre — så måling, attribution og copy taler samme sprog. Implementering (hvor i koden `gtag("event", ...)` kaldes) er en separat opgave; her aftaler vi kun semantikken.

| Event-navn (forslag) | Fyrer når | Hvorfor det er en key event | Acquisition-værdi |
|---|---|---|---|
| `signup_completed` | Bruger har gennemført signup (konto oprettet + bekræftet, ikke kun formular-submit) | Det primære konverterings-mål; kobler til signup-attribution (#1304) | Lukker funnel landing → konto; nævner SEO/kanal-ROI |
| `waitlist_join` | Bruger tilmelder sig waitlist (når waitlist er aktiv) | Sekundær konvertering i perioder hvor signup er lukket/begrænset | Fanger intent når fuld signup ikke er åben |
| `team_drafted` (kandidat) | Bruger har draftet/oprettet sit første hold | Aktiverings-milepæl — skiller "kontoen findes" fra "spilleren er i gang" | Skelner registrering fra reel aktivering |
| `first_auction_bid` (kandidat) | Bruger afgiver sit første bud i en live-auktion | Dyb aktivering — kerne-loop berørt | Stærkt retention-prædiktivt signal |

Definitions-regler:
- **`signup_completed` = bekræftet konto**, ikke formular-submit. Et formular-submit der fejler validering må ALDRIG tælle som key event — ellers er konverterings-raten kunstigt høj.
- Hold event-navne i `snake_case` og stabile over tid; et omdøbt event bryder historik-sammenligning i GA4.
- Marker et event som "key event" i GA4-admin FØR du bygger rapporter på det — ellers mangler historik bagud.
- [EJER-BESLUTNING: hvilke af kandidat-events (`team_drafted`, `first_auction_bid`) skal markeres som key events fra start?
  - Kun `signup_completed` + `waitlist_join` — fordel: smal, ren funnel, mindre støj. Omkostning: ingen synlighed på aktivering vs. blot registrering.
  - Tilføj `team_drafted` — fordel: skelner "konto oprettet" fra "spiller i gang" (aktiverings-måling). Omkostning: ét event mere at instrumentere + holde stabilt.
  - Alternativ: instrumentér alle fire som almindelige events nu, men markér kun signup som key event — så findes historikken den dag I vil promovere et af dem.]

## 5. Hvor sandheden ligger (TL;DR for fremtidige reviews)

- Ranking-spørgsmål → **GSC**.
- Adfærd/konvertering → **GA4** (og tjek §3 hvis pageview-tal ser for lave ud).
- Backlinks/teknisk audit → **Ahrefs**.
- Keyword-research → **Morningscore** + GSC.
- Core Web Vitals → **Lighthouse-CI** (lab, CI-gate) + **web-vitals→GA4** (field, rigtige brugere).
- GA4 og GSC's tal matcher aldrig 1:1 — det er by design, ikke en bug.

## 6. GSC domæne-property — DNS-verificering (2026-06-30)

Ud over den oprindelige URL-præfiks-property (#352/#1302) er der nu oprettet en **domæne-property** for `cyclingzone.org` i Search Console. En domæne-property dækker alle subdomæner (`www.`, `api.`, …) og både `http`/`https` under ét — bredere end en URL-præfiks-property, og den verificeres via en DNS-TXT-record på roden.

DNS for `cyclingzone.org` ligger hos **Vercel** (`ns1/ns2.vercel-dns.com`), team-scope `nicolai-dolmers-projects`. Verificerings-recorden blev tilføjet via Vercel CLI:

```
vercel dns add cyclingzone.org "@" TXT "google-site-verification=…" --scope nicolai-dolmers-projects
```

- **Type/navn:** `TXT` på roden (`@`)
- **Værdi:** `google-site-verification=ZJ5UDpjchfIx-x3X_uku_GzF25NDm5aMjIEPA-0cMbg`
- **Vercel record-id:** `rec_dc5575dee9ce28c770bc0b29`

> ⚠️ **Slet ALDRIG denne TXT-record.** Google gen-tjekker DNS-verificeringen løbende; fjernes recorden, mister property'en sin verificering, og GSC-data (impressions/clicks/coverage) holder op med at opdatere. Recorden er additiv og rører hverken site-routing (ALIAS) eller email-records (SPF/DKIM/DMARC).
