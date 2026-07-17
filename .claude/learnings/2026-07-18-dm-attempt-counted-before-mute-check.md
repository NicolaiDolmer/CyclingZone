# Rate-guarden talte "leveret" før den vidste det: muted brugere udvandede #2571-guarden

**Dato:** 2026-07-18 · **Issue:** [#2571](https://github.com/NicolaiDolmer/CyclingZone/issues/2571) (follow-up på #2609) · **Fundet af:** adversarisk post-merge-review af PR #2609

## Hvad skete der

PR #2609 byggede en aggregeret rate-guard mod #2569-klassen af fejl ("alt fejler tavst, ingen alarm"): tæl forsøgte + skippede DM'er pr. cron-kørsel, og capture til Sentry hvis 100% skipper over 3 kørsler i træk. CI var grøn, PR'en blev merged. En efterfølgende adversarisk gennemgang fandt at guarden selv havde en tælle-fejl:

```js
const recipient = await resolveDmRecipient({ teamId, userId, client: supabase });
if (!recipient) {
  recordDmAttempt({ type, skipped: true, cronRun });
  return;
}
recordDmAttempt({ type, skipped: false, cronRun });   // <-- talt her, FØR mute-tjek og FØR sendDM
if (!isDmTypeEnabled(recipient.prefs, type)) {
  console.info("[discord-dm:muted]", { teamId, userId, type });
  return;                                              // intet sendt — men allerede talt som "leveret"
}
await sendDM(recipient.discordId, payload);             // returværdi ignoreret — fejl her talte ALDRIG som skip
```

`recordDmAttempt({ skipped: false })` blev kaldt så snart en modtager kunne resolves — før det per-type mute-tjek (`isDmTypeEnabled`) og før selve `sendDM`-kaldet. To konsekvenser:

1. En bruger der har muted en DM-type (fx `board_update` i profil-settings) blev talt som "leveret", selvom `sendDM` aldrig blev kaldt.
2. En reel `sendDM`-fejl (udløbet bot-token, bot fjernet fra serveren, permanent Discord-API-fejl) blev også talt som "leveret", fordi tællingen skete FØR forsøget, ikke efter udfaldet.

## Hvorfor det er farligt

Guardens hele formål er at opdage "100% af de reelt afsendelige DM'er fejler, ingen ved det." I en blandet population (nogle brugere har muted typen, andre rammes af en reel bug) udvandede de muted-brugere skip-raten væk fra 100% — netop det scenarie guarden skulle fange kunne derfor gå under radaren, blot fordi én tilfældig bruger i samme kørsel havde slået typen fra. Ingen test dækkede interaktionen (`grep isDmTypeEnabled` i `discordNotifier.test.js` gav 0 hits før denne fix).

## Root cause

Tællingen sad ved forkert *tidspunkt* i kontrolflowet — ved "modtager fundet" i stedet for ved "udfald kendt". Samme bug-klasse som #2569's postmortem pegede på som "kandidat til opfølgning", men denne gang i selve mekanismen der skulle forhindre klassen.

## Fix

`backend/lib/discordNotifier.js`:
- `sendDM()` returnerer nu eksplicit `boolean` (`true` = leveret synkront, `false` ellers — manglende token/id, outbox-kø, eller permanent fejl). Ren tilføjelse af et returværdi-kontrakt; ingen af de eksisterende gren-beslutninger (retry/outbox/Sentry-alarm for token-invalid) er ændret.
- `notifyDiscordDM()`: `recordDmAttempt` flyttet til EFTER mute-tjekket. Muted tælles slet ikke (hverken skip eller delivered) — det er et bevidst spiller-valg, ikke et forsøg. Tællingen sker nu efter `await sendDM(...)`, baseret på dens returværdi (`skipped: !delivered`), så en reel sendfejl tæller korrekt som skip.
- No-recipient-grenen (data-issue: mangler discord_id/opt-out af master-switch) er uændret — den talte allerede korrekt.

## Forhindret-fremover

Regressionstest i `discordNotifier.test.js` ("muted tælles ikke med, sendDM-fejl tælles som skip, blandet population rammer stadig 100%-tærsklen") kører den ægte `notifyDiscordDM` (ikke en `notifyFn`-stub) via en injiceret fake Supabase-client (samme mønster som `discordDmRecipient.test.js`), og blander 3 kategorier pr. simuleret cron-kørsel: 2 muted, 1 reel no-recipient, 1 reel modtager hvor selve `sendDM` fejler (bot-token fjernet fra env under testen). Verificeret at testen **fejler** mod den gamle tælle-rækkefølge (`captureExceptionFn.calls.length` var 0, ikke 1 — muted-brugerne holdt raten under 100%) og **passerer** mod fixet.

## Læring der rækker videre end denne bug

**Tæl et forsøg der hvor det faktisk sker, ikke ved funktions-indgang.** En guard der skal detektere "alt fejler" er selv sårbar over for samme tavse-skip-mønster den forsøger at fange, hvis dens egen tælling sker før udfaldet er kendt. Adversarisk post-merge-review fangede dette selvom CI var grøn — grøn CI beviser kun at de EKSISTERENDE tests passer, ikke at de dækker den rigtige interaktion (her: mute × rate-guard, en kombination ingen test rørte). Se også #2569-postmortem (`.claude/learnings/2026-07-17-silent-param-drop-board-dm.md`) — samme mekanisme ("ikke en fejl for én bruger" via `console.info`) gik denne gang igen ét lag dybere, inde i selve guarden der skulle forhindre den.
