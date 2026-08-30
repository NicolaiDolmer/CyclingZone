# Postmortem · 2026-08-30 · Ops-alarmer pingede aldrig ejeren (#2739)

## Hvad skete der?
`DISCORD_OPS_MENTION` var sat, men hvis den var sat til en bar numerisk
Discord-ID i stedet for `<@id>`-format, blev tallet sendt uændret som
`content` i webhook-payloaden. Discord viser et rå tal som ren tekst, ikke
som en mention, så kritiske ops-alarmer (tavse stalls, sæson-count-anomali,
bot-token-drift, DM-outbox-død) landede i #ops-kanalen uden at pinge nogen.

## Root cause
`backend/lib/opsWebhook.js` sin `getOpsMention()` trimmede kun
miljøvariablen og returnerede den rå streng. Der var ingen normalisering af
input-formatet. Den eksisterende test (`opsWebhook.test.js`) dækkede kun
det allerede-korrekte `<@123>`-format, så et fejlformateret env-var i
Railway/Infisical ville aldrig være blevet fanget af testsuiten.

## Fix
`getOpsMention()` normaliserer nu en bar numerisk streng (`/^\d+$/`) til
bruger-mention-format `<@id>`, før den returneres. Allerede-formaterede
mentions (`<@id>`, rolle-format `<@&id>`, `@here`, `@everyone`) røres ikke.
Vi kan ikke afgøre ud fra et bart tal om det er en bruger eller en rolle,
så default er bruger-format; en rolle skal skrives eksplicit som `<@&id>`
i miljøvariablen (dokumenteret i en kode-kommentar).

## Forhindret-fremover
`backend/lib/opsWebhook.test.js` har nu testcases for: bar numerisk ID →
normaliseret, allerede `<@id>` → uændret, allerede `<@&id>` → uændret,
`@here`/`@everyone` → uændret, tom/whitespace → null.

## Læring
Enhver funktion der læser en fri-tekst miljøvariabel og injicerer den
direkte i et output-format (her: Discord-mention-syntaks), bør normalisere
til det format konsumenten faktisk forstår i stedet for at antage
operatøren husker den præcise syntaks. Test-dækning der kun bekræfter det
allerede-korrekte format fanger ikke denne klasse af fejl.
