# Founder-voice skelet · Landingsside + Signup (2026-06-21)

> **Formål:** give ejeren et udfyldnings-klart skelet til at lægge sin egen stemme på de højest-leverede flader (landingsside + signup), uden at AI skriver founder-prosaen.
> **Bygger på:** de 4 låste tone-beslutninger + Voice DNA i [`docs/TONE_OF_VOICE.md`](../TONE_OF_VOICE.md), founder-voice-skabelonen i samme doc, og landing-page-brand-direction (`docs/superpowers/specs/2026-06-14-landing-page-brand-direction-design.md`).
>
> **VIGTIGT:** landingssiden findes allerede (`frontend/src/pages/LandingPage.jsx`, copy i `frontend/public/locales/en/landing.json` + `da/landing.json`) og er i høj grad allerede på linje med beslutningerne. Dette er derfor et **overlay**: KEEP-markeret copy beholdes, og kun et lille antal `[FOUNDER-PROSA]`-slots venter på din stemme.

## Regler der gælder alle slots (fra TONE_OF_VOICE.md)

- **EN-first, DA-second.** Skriv EN-versionen; DA lægges parallelt i `da/landing.json`.
- **Jeg-stemme** ("I", ikke "we"). Tal 1-til-1 ("you").
- **Ingen em-dash** nogensteds. Brug komma, punktum, kolon, parentes.
- **Ingen emoji** i overskrifter/CTA/labels. **Ingen "free forever".** Ingen ordspil i hero (brand-regel).
- **Ærlig men sikker:** ingen "expect bugs"/WIP-advarsler på akkvisitions-flader. Åbenhed hører til i Discord/community.
- **Fantasi først:** led i klart sprog; cykel-dybde er en belønning, ikke en entry-gate.

## Sådan bruges det

1. Hvert slot har: **nuværende copy** (hvis den findes), **fakta-bullets** (verificeret, til råmateriale), **calibration** (dine egne ord som tone-pejling), og et tomt `[FOUNDER-PROSA]`-slot.
2. Du skriver prosaen i slottet i jeg-stemme.
3. Jeg lægger din EN-tekst ind i `landing.json` (+ DA i parallel) og verificerer i preview.

---

## LANDINGSSIDE

### Slot L1 — Hero-headline · HØJESTE prioritet (din egen)

- **Nuværende:** `hero.title` = "Race a season. Outthink the field."
- **Fakta-anker:** browser-baseret multiplayer cykel-manager · gratis · strategi slår penge.
- **Voice-DNA-pejling:** korte stærke verber, fantasi først, selvsikker men ikke hype. Ingen ordspil, ingen emoji.
- **Calibration (din tone):** *"Det her er starten på noget stort."* · *"Min drøm er, at Cycling Zone skal blive mere end bare et hobbyprojekt."*
- `[FOUNDER-PROSA: din headline, ca. 2-6 ord. Skal lyde som dig, ikke som en tagline-generator. Den nuværende kan beholdes hvis den føles rigtig.]`

### Slot L2 — Hero-subhead · valgfri

- **Nuværende:** `hero.subtitle` = "Cycling Zone is a browser-based cycling manager. Draft your team, bid for riders in live auctions, set the tactics, and chase results across a full season calendar."
- **Vurdering:** allerede fantasi-først, klart sprog, korrekt. **KEEP som default.**
- `[FOUNDER-PROSA (valgfri): kun hvis du vil have din egen rytme i én linje under headlinen.]`

### Slot L3 — "Built in the open" / Discord-sektion · HØJ prioritet (kerne-founder-stemme)

- **Nuværende:** `discord.body` = "I am building Cycling Zone as a solo developer, in public. The Discord is where I share what I am working on, where new managers find their feet, and where your feedback shapes what gets built next."
- **Hvorfor dette slot:** det er #next-step-cz-registeret, din stærkeste flade. Den nuværende er god, men er det den der bedst lyder som DIG?
- **Fakta-bullets:** solo-udvikler · bygger i det åbne · Discord = hvor du deler fremdrift + nye managere får hjælp + feedback former næste skridt · frisk sæson på vej.
- **Calibration (din tone):** *"Det startede som en idé, en passion og et ønske om at skabe et cykelmanagerspil, hvor man ikke bare klikker sig igennem nogle tal, men hvor man faktisk føler, at man bygger noget op over tid."* · *"Du kommer på grund af fællesskabet. det er fællesskabet der gør, at du bliver."*
- `[FOUNDER-PROSA: 2-4 sætninger i din stemme. Del tankegangen, ikke kun konklusionen. Behold "solo-udvikler, i det åbne".]`

### Slot L4 — FAQ-intro · valgfri (let varme)

- **Nuværende:** ingen intro; FAQ starter direkte på Q/A. De fire Q/A er fine og allerede ærlig-men-sikker.
- `[FOUNDER-PROSA (valgfri): 1-2 sætningers varm indledning over FAQ-blokken, jeg-stemme.]`

### KEEP uden ændring (allerede på linje)

- **"How you play"** (4 rækker: draft squad · live auctions · tactics · race the calendar) med ægte data-tags. Fantasi først, korrekt. Ingen prosa-slot.
- **"Built on one promise"** + fairness-løftet ordret: *"The game must be fair for everyone. You cannot pay for better riders, faster training, or better results."* Load-bearing, ændres ikke.
- **De tre value-cards** (Strategy over spending · Free to play · No install). Konkrete, sande, selvsikre.
- **Email-waitlist** ("Get the launch email" + felter). Funktionel, klar.
- **Trust-chips** (Free to play · No credit card · Runs in your browser). KEEP.

---

## SIGNUP (`frontend/src/pages/LoginPage.jsx`)

Signup er mest funktionel og transaktionel. To valgfri varme-slots, resten beholdes.

### Slot S1 — Signup-velkomst · valgfri (lav tærskel-varme)

- **Nuværende:** subtitle = "Create your manager account".
- **Voice-DNA-pejling:** lav tærskel, invitation. Din naturlige "kom som du er".
- **Calibration (din tone):** *"Man kan være med på egne præmisser og komme og gå som man vil."* · *"Det bedste tidspunkt at komme med i spillet er altid nu."*
- **Fakta-bullets:** gratis · intet betalingskort · tager ca. 1 minut · opretter konto + hold · i browseren.
- `[FOUNDER-PROSA (valgfri): én kort velkomst-linje under wordmark der sænker tærsklen, jeg-stemme.]`

### Slot S2 — Success-state efter signup · valgfri

- **Nuværende:** "Almost there. Confirm your email." + "We've sent a confirmation link to {email}. Click it to activate your account, then log in."
- `[FOUNDER-PROSA (valgfri): en varmere bekræftelses-linje i din stemme, hvis du vil. Den funktionelle besked kan også bare beholdes.]`

### KEEP uden ændring

- Feltlabels (Team name · Manager name · Email · Password) + hjælpetekster + knaptekster ("Create account and team"). Funktionelle og klare.
- "New here? Meet other managers and get help on our Discord." KEEP (matcher fællesskab-først).

---

## Hvad jeg IKKE rørte

- Visuelt design, layout, fonts, farver (styres af brand-direction-doc).
- Faktuelle features: kun det der er **live i dag** må påstås (se verificeret feature-liste i `docs/FEATURE_STATUS.md`). Ikke nævne contracts-flows, season recaps, Hall of Fame, fans/merch, rivalry, manager-XP (ikke live endnu).
- Ingen prosa er forfattet af AI; alle `[FOUNDER-PROSA]`-slots er dine.

## Næste skridt

1. Du skriver de 2 høj-prioritets-slots (L1 hero-headline, L3 Discord/build-in-public). De valgfri kan vente.
2. Send mig din EN-tekst, så lægger jeg den i `landing.json` (+ DA-parallel) og viser dig resultatet i preview.
