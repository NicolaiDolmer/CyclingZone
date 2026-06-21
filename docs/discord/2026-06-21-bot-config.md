# Discord — bot- & automation-konfiguration (planning reference)

> Owner-prep doc for [#419](https://github.com/NicolaiDolmer/CyclingZone/issues/419). Epic: discord-community.
> Faktuel konfigurations-reference: hvilke bots der er tænkt, deres knapper/indstillinger, kanaler og rettigheder. Alt der kræver ejerens Discord-admin-handling er markeret `[EJER-HANDLING]`. **Ingen tokens/secrets i denne doc** — bot-invites sker via OAuth i browseren, ikke via gemte hemmeligheder.

## Hvorfor to bots

#419 kører **både** Carl-bot og Dyno, fordi de er bedst til hver sin ting (begge gratis):
- **Carl-bot** = roller + levels + welcome + reaction-roles.
- **Dyno** = auto-moderation (stærkere end Carl på dette).

[EJER-BESLUTNING: behold begge bots, eller konsolidér?
- **Begge (som #419):** fordel: best-of-breed pr. funktion. Omkostning: to dashboards + to bots med rettigheder i serveren = større attack-/fejl-flade, overlappende funktioner skal holdes ude af hinanden (fx kun ÉN bot ejer auto-mod).
- **Kun Carl-bot:** fordel: ét sted. Omkostning: svagere auto-mod.
- Anbefaling hører til ejeren. Hvis begge beholdes: aftal eksplicit hvem ejer hvad (matrixen nedenfor) for at undgå dobbelt-håndtering af samme besked.]

## Ansvars-matrix (undgå overlap)

| Funktion | Ejes af | Note |
|---|---|---|
| Welcome-besked | Carl-bot | Kun én bot må sende welcome — ellers dobbelt-besked |
| Auto-rolle ved join (`Beta-Tester`) | Carl-bot | |
| Reaction-roles (interest) | Carl-bot | |
| Level-/XP-system | Carl-bot | Sæt let gain (ikke aggressivt) |
| Auto-mod (spam/links/caps/banned words) | Dyno | Carl-bots auto-mod holdes OFF for at undgå dobbelt-action |
| Mod-log | Dyno | Skriver til `#moderation-log` |

## Carl-bot — konfigurations-reference

**Invite:** [EJER-HANDLING] via OAuth i browser (carl.gg's invite-flow). Kræver `Manage Server` på din konto. Token håndteres af Carl-bot selv — intet at gemme i repo.

**Knapper/indstillinger der skal sættes:**

| Knop | Tiltænkt værdi | Kanal | Status |
|---|---|---|---|
| Welcome-besked | Velkomst der nævner beta-tester-nummer + opfordrer til at sige hej + nævne hold. Eksakt copy: `[FOUNDER-PROSA: ejer skriver]` (placeholder-variabler: `{user}`, `{server.member_count}`) | `#general` | [EJER-HANDLING] |
| Auto-rolle | `Beta-Tester` på alle nye medlemmer | (server-bred) | [EJER-HANDLING] |
| Reaction-roles | Interest-roller (kobler til reaction-role-issue refereret som "#__5" i #419 — [antagelse: placeholder-issue-nummer, verificér i GitHub) | `#start-her` | [EJER-HANDLING] |
| Level-system | Aktivér med **lette** XP-gain-regler (ikke aggressivt) | (server-bred) | [EJER-HANDLING] |

**Rettigheder Carl-bot skal have (mindste nødvendige):**
- `Manage Roles` (for auto-rolle + reaction-roles) — bot-rollen skal ligge **over** de roller den uddeler i rolle-hierarkiet, ellers fejler tildelingen tavst.
- `Send Messages` + `Embed Links` (welcome).
- `Add Reactions` / `Read Message History` (reaction-roles).
- [EJER-HANDLING] Giv IKKE `Administrator` — uddel kun de scopes ovenfor.

## Dyno — konfigurations-reference

**Invite:** [EJER-HANDLING] via OAuth i browser (dyno.gg's invite-flow). Kræver `Manage Server`.

**Knapper/indstillinger der skal sættes:**

| Knop | Tiltænkt værdi | Status |
|---|---|---|
| Auto-mod filter | Aktivér: spam, invite-links, excessive caps, banned-words | [EJER-HANDLING] |
| Mod-log channel | `#moderation-log` | [EJER-HANDLING] |
| Banned-words-liste | [EJER-BESLUTNING: hvilke ord? Start konservativt — fordel: færre falske positiver der irriterer ægte beta-testere. Omkostning: kan misse kant-tilfælde. Alternativ: brug Dynos default-liste og justér efter første uges mod-log.] | [EJER-HANDLING] |

**Rettigheder Dyno skal have (mindste nødvendige):**
- `Manage Messages` (slette regelbrud).
- `Read Messages` / `Read Message History`.
- `Send Messages` + `Embed Links` (mod-log).
- (Valgfrit) `Kick`/`Ban`/`Timeout` hvis auto-mod skal eskalere — [EJER-BESLUTNING: skal auto-mod kunne timeoute/kicke automatisk, eller kun slette + logge? Slet+log er mindst indgribende i en lille beta; auto-kick risikerer at smide ægte testere ud på en falsk positiv.]
- [EJER-HANDLING] Giv IKKE `Administrator`.

## Sesh (events) — udskudt

#419 nævner Sesh (event-bot) som **ikke i scope** her — hører til AMA-issuet ("#__16", [antagelse: placeholder-nummer]). Kan vente til efter soft launch. Ingen handling nu.

## Kanaler der refereres (verificér de findes)

| Kanal | Bruges af | Note |
|---|---|---|
| `#general` | Carl-bot welcome | |
| `#start-her` | Carl-bot reaction-roles | |
| `#moderation-log` | Dyno mod-log | [EJER-HANDLING] opret hvis den ikke findes; gør den privat/mod-only |

[antagelse: kanal-navnene stammer fra #419-teksten; verificér de eksisterer i serveren før konfiguration.]

## Verifikations-tests (acceptance, fra #419)

- [ ] [EJER-HANDLING] Ny test-konto joiner → får `Beta-Tester`-rolle automatisk + welcome-besked i `#general`.
- [ ] [EJER-HANDLING] Spam-besked i `#general` → Dyno sletter den + logger i `#moderation-log`.
- [ ] [EJER-HANDLING] Reaction-role i `#start-her` tildeler korrekt interest-rolle.

## Sikkerheds-noter

- Bot-tokens gemmes ALDRIG i repo, docs eller commit. Invites kører via OAuth i browseren; Carl-bot/Dyno opbevarer selv deres tokens.
- Princip om mindste rettighed: ingen af bots'ene får `Administrator`.
- Rolle-hierarki: bot-roller skal ligge over de roller de administrerer, men under dine egne admin-/mod-roller.
- Én bot pr. funktion (se ansvars-matrix) — to bots der begge auto-modererer samme kanal = dobbelt-sletning + støj i mod-log.
