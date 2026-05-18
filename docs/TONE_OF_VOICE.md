# Tone of voice — CyclingZone player-facing copy

> **Established:** 2026-05-18 (tone session efter PR #475 PatchNotes overreach + #366 blokering)
> **Owner:** Nicolai Dolmer Mikkelsen (founder)
> **Konsulter denne guide før al ny player-facing tekst** — per `feedback_player_facing_copy_rules.md` regel 5.

## Language priority

**EN primary, DA secondary, fra dags dato.** Selvom nuværende beta-testere er dansktalende, bygger vi til international vækst. Alt player-facing content laves som EN-version først, DA i tråd/under/parallelt.

Se også: `memory/feedback_language_priority.md`.

## Brand voice — founder-led, build-in-public

**Stemmen er Nicolais**, ikke et team eller en virksomhed:
- "I" (EN) / "jeg" (DA) — ikke "we"/"vi"
- Reflective, honest, open about what we don't know yet
- Address each player 1-to-1 ("you" / "du"), not as a crowd ("everyone"/"alle")
- Share the thinking, not just the conclusion ("I'm trying to figure out..." / "jeg overvejer...")

**Build-in-public means:** We share the decision-making process while it happens, not after. Players who join early should feel they are shaping the direction, not consuming a finished product.

## Positioning — the game is free, premium is optional

The game has been free, is free now, and will always remain free. There is no plan to gate gameplay behind payment, ever.

A premium tier exists as an **opt-in** for players who want either:
1. Extra features that don't affect gameplay outcomes
2. A way to back the project they enjoy

Both reasons are valid. Neither is the "real" reason — players can choose either or both.

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
| founder | founder | Early-adopter-tier-navn (working draft, brainstorm pending) |
| supporter | supporter | Alternativ tier-navn (working draft) |

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

### Ord der venter på naming-brainstorm

Lås IKKE tier-navne før founder har brainstormet:
- "Founder" vs "Supporter" vs "Pioneer" vs "Charter Member" vs andet
- "Pro Analyst" (Manus' navn for 89kr-tier) — beholde eller ændre?
- "Patron" (Manus' navn for 149+kr-tier) — beholde eller ændre?

Indtil låst: brug working-draft "Founder"/"Supporter" konsistent men flag som ikke-final.

## Eksempel — Discord launch-post (EN draft)

> Hey, I want to share something I've been thinking about.
>
> CyclingZone has been free since the start, and it always will be. But I'm trying to figure out if there's a fair way to make this sustainable long-term, without making the game pay-to-win.
>
> The promise I want to test is simple: **the game must be fair for everyone. You cannot pay for better riders, faster training, or better results.** Premium, if it exists, would be for things like analytics, identity, and supporting development. Never for advantages.
>
> I don't have all the answers yet. That's why I'm opening this conversation now, before I build anything. If you've been playing, your honest thoughts will shape whether and how I build this.
>
> **Tell me what you think in [channel].** Critical feedback is welcome. I'd rather learn the hard truth now than build the wrong thing.

### DA-version (samme post i tråd nedenunder)

> Hej, jeg vil gerne dele noget jeg har tænkt på.
>
> CyclingZone har været gratis siden starten, og det vil det altid være. Men jeg prøver at finde ud af, om der er en fair måde at gøre det her bæredygtigt på lang sigt, uden at spillet bliver pay-to-win.
>
> Løftet jeg vil teste er enkelt: **spillet skal være lige for alle. Du kan ikke betale dig til bedre ryttere, hurtigere træning eller bedre resultater.** Premium, hvis det kommer, ville være for ting som analyse-værktøjer, identitet, og at bakke udviklingen op. Aldrig for fordele.
>
> Jeg har ikke alle svarene endnu. Det er derfor jeg åbner samtalen nu, før jeg bygger noget. Hvis du har spillet, vil din ærlige mening forme om og hvordan jeg bygger det her.
>
> **Skriv hvad du tænker i [kanal].** Kritisk feedback er meget velkommen. Jeg vil hellere lære den hårde sandhed nu end bygge det forkerte.

*(Eksempel-draft baseret på Manus' Message 1 omskrevet til EN-først founder-led build-in-public-tone. Ikke godkendt til at sende. Skal koordineres med Discord-launch-timing per [#415](https://github.com/NicolaiDolmer/CyclingZone/issues/415).)*

## Når du er i tvivl

Hvis en tekst krydser grænsen til player-eyes og du er usikker på om tonen passer: STOP og spørg founder. Per `feedback_player_facing_copy_rules.md` regel 5 er den her guide en hard-forudsætning, ikke en suggestion. Brydes den, ryger trust, og det er sværere at genopbygge end at vente 30 minutter på en afklaring.
