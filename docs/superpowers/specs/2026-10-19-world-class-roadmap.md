# Verdensklasse-køreplan (ejer-valg 19/10)

Mål (ejer 19/10): Cycling Zone skal kunne stå i toppen af managerspil: fejlfrit, lynhurtigt, en race engine i verdensklasse og en oplevelse der overgår spillernes forventninger, også ved 10x brugere. Fokuslisten og v2-pakken (#6804/#6814/#6909/#6820) kører først; derefter de fire spor i denne rækkefølge (spor 1 og 2 parallelt).

## Spor 1: Fundament (driftssikkerhed, kvalitet, fart) — #6917
**Database (ejer-valg):** arkitektur først, større server når målingerne siger det. Tunge aftenjob i job-kø med direkte Postgres (#6491/#6492, spec #6655), færdigberegnede tabeller + cache for tunge læsninger (som ranglisterne #6765), belastningstest ved 10x som fast port (#5904), mål 99,9 % oppetid med automatiske alarmer (Sentry + heartbeat).
**Kvalitetsstige (ejer-valg, alt nyt):** 1) design + testplan før kode → 2) automatiske tests + review-gate → 3) staging med prod-lignende data → 4) beta-flag → 5) gradvis udrulning (fx 10 % → 100 %) med Sentry-overvågning, der stopper ved nye fejl → 6) live. Ugentlig bug-bash; nul-fejl-regel (kendte fejl i et område rettes før nyt bygges dér).
**Fart (ejer-valg, langsigtet ved 10x):** TanStack Query overalt (cache, dedupe, prefetch ved hover/berøring), ét samlet API-kald pr. side (backend samler, DB-indekser), Supabase Realtime i stedet for polling (auktioner, løb, notifikationer), hastighedsbudget pr. side som CI-port + måling hos rigtige brugere.
**Teknologi (ejer-valg):** typesikre kontrakter ende-til-ende (Zod, delt frontend/backend, valideret ved grænsen) · TypeScript strict overalt (ratchet) · TanStack-samling (Query, Table, Hotkeys, senere Router). Backend-ramme: analyse med ejeren (§5).

## Spor 2: Race engine til verdensklasse — #6914
**Vision (ejer-valg):** forklarlig realisme (kalibreret mod rigtige løbsdata; løbsfilmen viser HVORFOR) · holdenes AI-sportsdirektører med mål pr. løb (etapesejr, klassement, trøjer, TV-tid), der beslutter jagt/angreb/samarbejde · vejr, vind og uheld (sidevind/vifter, regn på nedkørsler, styrt/punktering, placering i feltet) · rytterpersonlighed: 3-5 synlige træk (Angriber, Hjulsuger, Loyal hjælper, Nedkørselsspecialist, Nerve i finalen), kalibreret mod rigtige rytteres stil.
**Sikring (ejer-valg):** statistisk port i CI: hver motor-PR kører tusindvis af etaper (alle løbstyper) mod rigtige data og nuværende motor og blokeres ved forværring; faste "aldrig"-regler som hårde tests.
**Løbsoplevelse (ejer-valg): TV-transmission:** kort med felt og grupper, højdeprofil, forspringskurve, nøgleøjeblikke med kommentator-tekst, holdradio, 60-sek. highlights til mobil, delbar som billede/link.
Plus (aftalt tidligere 19/10): benchmark mod PCS-data, testport obligatorisk, ugentlig løbsfilm-gennemgang med ejeren, konkurrent-gennemgang (PCM m.fl.).

## Spor 3: Oplevelse — mobil #6916 · desktop #6918 · kommandopalet #6915
**Desktop (ejer-valg, alle fire):** managerens cockpit (selvvalgte paneler) · lyn-forhåndsvisning ved hover overalt · regneark-tabeller (TanStack Table + virtualisering, gemte visninger, sammenligning) · træk-og-slip i udtagelse, træningsplan og formplan. Plus kommandopalet + genveje (#6915).
**Mobil:** se `2026-10-19-mobile-10x-design.md`.

## Spor 4: Vækst og fastholdelse — #6919
**Ejer-valg (alle fire):** første 10 minutter (guidet, levende start; første løb som TV-transmission) · del og vind (sejre/highlights som flotte billeder/klip med ét tryk) · smarte notifikationer (kun det der betyder noget for dig + daglig digest) · AI-assistent for managere ("assisterende sportsdirektør"). **OBS:** AI-assistenten er en ny løbende udgift; tidspunkt og budget afgøres med ejeren (regel: ingen nye løbende udgifter før indtægten stiger).

## 5. Backend-ramme: analyse (ejer 19/10 vil forstå det før beslutning)
Fakta 19/10: Express 5.2, `routes/api.js` = 19.164 linjer med ca. 330 endpoints i én fil, Zod brugt i 1 fil, cron i egen proces (2.420 linjer), Railway. Flaskehalsen i dag er databasen og tunge job, ikke Express' fart. Muligheder: (A) behold Express 5, del api.js i domæne-moduler + Zod-kontrakter + job-worker; (B) Fastify (schema-baseret, hurtigere, plugin-system); (C) Hono (moderne, indbygget typed RPC og validering, kan køre på edge). Claudes anbefaling: A nu, revurdér C for nye services. Beslutning tages med ejeren efter en grundig gennemgang.

## Udførelse
Hvert spor får design + testplan før kode (hard rule 36), før/efter-billeder for UI, kvalitetsstigen ovenfor, og ejer-go pr. fase. MASTERPLAN peger hertil.
