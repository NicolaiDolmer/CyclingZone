# Tone of voice · Cycling Zone player-facing copy

> **Established:** 2026-05-18 (tone session efter PR #475 PatchNotes overreach + #366 blokering)
> **Owner:** Nicolai Dolmer Mikkelsen (founder)
> **Konsulter denne guide før al ny player-facing tekst**, per `feedback_player_facing_copy_rules.md` regel 5.

## Language priority

**EN primary, DA secondary, fra dags dato.** Selvom nuværende beta-testere er dansktalende, bygger vi til international vækst. Alt player-facing content laves som EN-version først, DA i tråd/under/parallelt.

Se også: `memory/feedback_language_priority.md`.

## Brand voice · founder-led, build-in-public

**Stemmen er Nicolais**, ikke et team eller en virksomhed:
- "I" (EN) / "jeg" (DA), ikke "we"/"vi"
  → **Undtagelse (ejer-godkendt 2026-06-10):** in-fiction karakterer (bestyrelsesmedlemmer, ryttere m.fl.) må sige "we"/"vi" om deres egen klub/organisation i deres replikker (fx board.json: "We have climbed with Anquetil..."). Reglen gælder brand-stemmen til spillerne, ikke diegetisk dialog. Sweeps må ikke "rette" karakter-replikker til jeg-form.
- Reflective, honest, open about what we don't know yet
- Address each player 1-to-1 ("you" / "du"), not as a crowd ("everyone"/"alle")
- Share the thinking, not just the conclusion ("I'm trying to figure out..." / "jeg overvejer...")

**Build-in-public means:** We share the decision-making process while it happens, not after. Players who join early should feel they are shaping the direction, not consuming a finished product.

## Positioning · the game is free, premium is optional

The game has been free, is free now, and will always remain free. There is no plan to gate gameplay behind payment, ever.

A premium tier exists as an **opt-in** for players who want either:
1. Extra features that don't affect gameplay outcomes
2. A way to back the project they enjoy

Both reasons are valid. Neither is the "real" reason. Players can choose either or both.

## The fairness promise (brand-løfte)

**EN:** *"The game must be fair for everyone. You cannot pay for better riders, faster training, or better results."*

**DA:** *"Spillet skal være lige for alle. Du kan ikke betale dig til bedre ryttere, hurtigere træning eller bedre resultater."*

This is the load-bearing sentence in everything we write about premium. Repeat it. Don't water it down. If a feature would break this promise, it doesn't ship as premium.

## Ord og termer

### Tilladte termer (begge sprog)

| EN | DA | Note |
|---|---|---|
| premium | premium | OK på begge sprog. Don't avoid it. |
| open beta | open beta | We're in open beta. Use it. |
| tester / open beta tester | tester / open beta tester | Naming-framing for nuværende fase |
| founder | founder | Early-adopter-status for de første waitlist-signups, ikke separat betalt tier. |
| Premium | premium | 49 DKK-tier, player-facing tier-navn låst i Session B. |
| Pro Analyst | Pro Analyst | 89 DKK-tier for analyser og dashboards, låst i Session B. |
| Patron | Patron | 149 DKK-tier for high-trust community og identitet, låst i Session B. |

### Forbudte termer (begge sprog)

Per `feedback_player_facing_copy_rules.md` regel 2 + dagens session-tillæg:

**Intern jargon:**
- "sprint", "validation", "validation sprint", "monetization sprint"
- "Go/No-Go", "Iterate", "decision framework"
- "freemium", "fair-freemium"
- "power features", "power-features"
- "day 30", "T-1", "week 1/2/3/4" (sprint-timeline-references)
- "30 weeks runway", financial-planning-vokabular

**Forkerte konnotationer:**
- ❌ "støtte" / "support" som *verb* om premium ("støt CyclingZone")
  → Premium gives value back. Det er ikke charity, det er en transaktion.
  → Brug i stedet: "back the project", "join premium", "go premium"
- ❌ "Founder Supporter" som kombineret tier-navn ("lyder åndsvagt" per founder)
  → Brug enten "Founder" alene eller "Supporter" alene, ikke begge sammen.

**Founders person:**
- ❌ "fuldtid" / "full-time" om Nicolai før indtægt dækker leveomkostninger
  → Per 2026-05-18 gør det det ikke. Don't claim it.

**Punktuation:**
- ❌ Em-dash (—) NOGENSTEDS i player-facing tekst, kode, docs, commits, PR-bodies, chat. Brug komma, punktum, kolon eller parentes.
  → **Undtagelse:** et enkeltstående `—` brugt som tom-værdi-glyf i tabeller/dropdowns (en celle uden værdi, "ingen data") er ikke prosa og er tilladt. Det er en typografisk placeholder, ikke en sætnings-separator. Locale-nøgler som `rankNone`, `salaryNone`, `dash`, `noBuyOption` falder under denne undtagelse (#671).
  → **Forward-guard:** `scripts/tone-check-em-dash.mjs` (kører i CI via `i18n-check.yml`) blokerer nye em-dashes i locales + PatchNotes + privacy-prosa; undtagelsen ovenfor er kodet ind (#1172).

### Session B naming-beslutning

Tier-navne er låst per `docs/decisions/session-b-naming-fair-premium-copy.md`:
- `Free Manager` = gratis competitive core.
- `Premium` = 49 DKK-tier.
- `Pro Analyst` = 89 DKK-tier.
- `Patron` = 149 DKK-tier.
- `Founder` = tidlig waitlist-status for de første 100, ikke separat betalt tier.

Brug ikke `Founder Supporter` som samlet navn. Hvis et teknisk felt eller en eksisterende enum stadig hedder `supporter`, må værdien beholdes internt, men player-facing labels skal følge listen ovenfor.

## Eksempel · Discord launch-post (EN draft)

> Hey, I want to share something I've been thinking about.
>
> Cycling Zone has been free since the start, and it always will be. But I'm trying to figure out if there's a fair way to make this sustainable long-term, without making the game pay-to-win.
>
> The promise I want to test is simple: **the game must be fair for everyone. You cannot pay for better riders, faster training, or better results.** Premium, if it exists, would be for things like analytics, identity, and supporting development. Never for advantages.
>
> I don't have all the answers yet. That's why I'm opening this conversation now, before I build anything. If you've been playing, your honest thoughts will shape whether and how I build this.
>
> **Tell me what you think in [channel].** Critical feedback is welcome. I'd rather learn the hard truth now than build the wrong thing.

### DA-version (samme post i tråd nedenunder)

> Hej, jeg vil gerne dele noget jeg har tænkt på.
>
> Cycling Zone har været gratis siden starten, og det vil det altid være. Men jeg prøver at finde ud af, om der er en fair måde at gøre det her bæredygtigt på lang sigt, uden at spillet bliver pay-to-win.
>
> Løftet jeg vil teste er enkelt: **spillet skal være lige for alle. Du kan ikke betale dig til bedre ryttere, hurtigere træning eller bedre resultater.** Premium, hvis det kommer, ville være for ting som analyse-værktøjer, identitet, og at bakke udviklingen op. Aldrig for fordele.
>
> Jeg har ikke alle svarene endnu. Det er derfor jeg åbner samtalen nu, før jeg bygger noget. Hvis du har spillet, vil din ærlige mening forme om og hvordan jeg bygger det her.
>
> **Skriv hvad du tænker i [kanal].** Kritisk feedback er meget velkommen. Jeg vil hellere lære den hårde sandhed nu end bygge det forkerte.

*(Eksempel-draft baseret på Manus' Message 1 omskrevet til EN-først founder-led build-in-public-tone. Ikke godkendt til at sende. Skal koordineres med Discord-launch-timing per [#415](https://github.com/NicolaiDolmer/CyclingZone/issues/415).)*

## Når du er i tvivl

Hvis en tekst krydser grænsen til player-eyes og du er usikker på om tonen passer: STOP og spørg founder. Per `feedback_player_facing_copy_rules.md` regel 5 er den her guide en hard-forudsætning, ikke en suggestion. Brydes den, ryger trust, og det er sværere at genopbygge end at vente 30 minutter på en afklaring.

---

## Founder voice: template

> **Tilføjet:** 2026-06-21 per [#1283](https://github.com/NicolaiDolmer/CyclingZone/issues/1283) (ToV-session: definér founder-stemmen).
> **Formål:** en genbrugelig STRUKTUR/skelet til founder-stemme-opslag (marketing, roadmap-intros, Discord-announcements, patch-note-intros). AI leverer skelettet; **selve prosaen skriver ejeren**, jf. `feedback_founder_voice_owner_writes` (Claude-forfattet founder-stemme rammer ikke Nicolais tone, roadmap-intro 10/6).
>
> **Udestående ejer-leverance (fra #1283):** 2-3 godkendte eksempeltekster AI kan kalibrere imod. Indtil de findes, må AI **ikke** generere færdig founder-prosa. AI udfylder strukturen med fakta-bullets + markerer prosa-slots `[FOUNDER-PROSA]`.

### Sådan bruges skelettet

1. AI (eller ejer) fylder fakta-bullets ind i hvert slot: neutralt, verificeret, ingen stemme-prosa.
2. Ejer skriver prosaen i hvert `[FOUNDER-PROSA]`-slot, i jeg-stemme.
3. Tjek mod DO/DON'T nedenfor + ToV-resten af dette dokument før udsendelse.

### Skelet (4 slots)

**Slot 1: Opening hook**
`[FOUNDER-PROSA: ejer skriver åbningslinjen.]`
- Formål: fange læseren personligt, 1-til-1. Ofte en ærlig indrømmelse eller en ting ejeren har tænkt på.
- Fakta-input AI må levere: hvad opslaget handler om (én linje), så ejeren har en knage.

**Slot 2: What changed / what I'm doing**
- Fakta-bullets (AI må fylde): de konkrete, verificerede ændringer/fakta. EN-first, DA under.
- `[FOUNDER-PROSA: ejer binder fakta sammen i egen stemme.]`

**Slot 3: Why it matters**
- Fakta-anker (AI må fylde): den objektive begrundelse (fx "det gør spillet mere fair / mere holdbart").
- `[FOUNDER-PROSA: ejer skriver "hvorfor"-narrativet: del tankegangen, ikke kun konklusionen.]`
- Dette slot er kerne-founder-stemme; AI skriver det aldrig færdigt.

**Slot 4: Ask / CTA**
- Fakta-bullets (AI må fylde): hvor man svarer/handler (kanal, link), evt. timing.
- `[FOUNDER-PROSA: ejer skriver invitationen: fx at kritisk feedback er velkommen.]`

### DO (trukket fra resten af dette dokument)

- Skriv i **jeg-stemme** ("I"/"jeg"), ikke "we"/"vi" (brand-stemmen er Nicolais). Undtagelse: diegetisk karakter-dialog.
- Tal **1-til-1** med læseren ("you"/"du"), ikke til en flok ("everyone"/"alle").
- **Del tankegangen, ikke kun konklusionen** ("I'm trying to figure out..." / "jeg overvejer...").
- Vær **reflective, honest, open** om det du ikke ved endnu (build-in-public).
- **EN-first, DA-second** (language priority). Discord: EN-post først, DA i tråd nedenunder.
- Gentag **fairness-løftet** ordret når emnet er premium ("The game must be fair for everyone...").

### DON'T (trukket fra resten af dette dokument)

- Ingen **em-dash (: )** nogensteds i prosa. Brug komma, punktum, kolon eller parentes. (CI-guard: `scripts/tone-check-em-dash.mjs`.)
- Ingen **intern jargon**: "sprint", "validation", "Go/No-Go", "freemium", "30 weeks runway", sprint-timeline-referencer.
- Ingen **"støt"/"support"** som verb om premium. Brug "back the project", "join premium", "go premium".
- Aldrig **"Founder Supporter"** som samlet navn. Brug "Founder" eller "Supporter" alene.
- Aldrig **"fuldtid"/"full-time"** om Nicolai før indtægt dækker leveomkostninger.
- Aldrig **"free forever"** som markedsførings-frase (jf. `feedback_anti_ai_slop_design_taste`). Spillet er gratis og forbliver gratis, men formuleringen "free forever" bruges ikke.
- Ingen **AI-slop-floskler** eller opfundet indhold; ingen tom hype.

### Reference-eksempel

Det eksisterende **Discord launch-post-eksempel** (EN+DA) længere oppe i dette dokument er det nærmeste vi har på en kalibreret founder-prosa-prøve. Bemærk: det er en `Manus`-omskrevet draft, ikke en ejer-godkendt prøvetekst. De endelige 2-3 kalibrerings-eksempler fra #1283 erstatter det som reference når de findes.

### Første anvendelse

Relaunch-comms-kittet (`docs/comms/2026-06-21-relaunch-comms-kit.md`, [#1278](https://github.com/NicolaiDolmer/CyclingZone/issues/1278)) bruger dette skelet i alle tre kanaler (FAQ-intro, patch-note-intro, Discord-announcement). Det er den oplagte første test af founder-stemme-skabelonen, jf. koblingen nævnt i #1283.
