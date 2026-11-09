# Search Console: adgang og privat ugerapport

Refs #1407, #3797. SSOT: [ANALYTICS_STACK §7](../ANALYTICS_STACK.md). Ingen ny dependency eller løbende udgift.

## Engangsopsætning

1. I Google Cloud Console: vælg CyclingZone-projektet, eller opret et projekt.
2. APIs & Services → Library → Google Search Console API → Enable.
3. IAM & Admin → Service Accounts → Create service account. Opret en særskilt rapportkonto uden Cloud-roller. GSC-adgang gives i Search Console, ikke Cloud IAM.
4. Search Console: vælg domæneejendommen `cyclingzone.org` → Indstillinger → Brugere og tilladelser → Tilføj bruger. Angiv kontoens mail og **Begrænset** adgang. Rapporten bruger kun scope `webmasters.readonly`.
5. Kontoens Keys-fane: Add key → Create new key → JSON → Create. Hent i din almindelige browser, og kontrollér at download fuldføres. Googles kvittering alene beviser ikke, at filen findes lokalt.
6. Infisicals CyclingZone-projekt: opret `GSC_SERVICE_ACCOUNT_JSON` i rodmappen i **dev og prod**. Værdien er hele JSON-filens indhold som én streng. Brug Infisical UI, aldrig rå secrets-kommandoer i agenttranscript. JSON-import kræver objektet `{ "GSC_SERVICE_ACCOUNT_JSON": "<hele credential-JSON som streng>" }`, ellers oprettes credentialfelterne fejlagtigt som separate secrets.
7. Kør rapporten gennem Infisical. Efter verificeret indlæsning og live-læsekald fjernes midlertidige importfiler. Nøglen må aldrig ligge i Git, rapporter eller chatten. Gamle nøgler tilbagekaldes særskilt efter ejerens godkendelse.

## Rapport

```bash
infisical run --env=dev -- node scripts/gsc-report.mjs --weekly --out=<privat-absolut-sti>/seo-uge.md
infisical run --env=dev -- node scripts/gsc-report.mjs --days=28 --json --out=<privat-absolut-sti>/seo-baseline.json
```

`--weekly` er rullende syv GSC-datoer med tre dages forsinkelse, sammenlignet med de foregående syv. Det er ikke en kalenderuge. Datoerne følger Googles `America/Los_Angeles`, også ved sommertid og omkring UTC-midnat. `--now=<ISO-tidspunkt-med-zone>` gør kørslen reproducerbar. Standard er 28 dage; maksimum 240, så begge perioder holder sig inden for GSC-historikken.

Rapporten viser separate ejendomstotaler for klik, visninger, CTR og position samt top-søgeord, sider, lande, enheder og en daglig serie. Den bruger endelige web-data. Toplister er udsnit; anonymiserede queries mangler. Tomt svar markeres manglende data. Indeksering/canonical måles separat i Search Console → Sider / URL Inspection. GSC-klik er ikke besøg, konti eller signups.

`--out` skriver Markdown, eller JSON med `--json`, og kun en kvittering på stdout. Destinationen skal være privat uden for Git, fx `balance-internals/growth/seo/` i det delte OneDrive-område. Git-checkouts afvises også via links. Eksisterende filer overskrives aldrig; brug nyt dateret filnavn. Uden `--out` vises rapporten på stdout og skal behandles privat.

Ugerutinen bruger en lokal Codex-app-automation efter merge, Infisical og samme script; ingen ny scheduler, offentlig Actions-rapport, mail eller Discord-post. Maskinen og appen skal være tilgængelige. Ingen database/dashboard indgår i denne del-leverance; #3797 lukkes ikke som fuldt leveret.

## Fejl

- Exit 1: ukendte/gentagne argumenter, ugyldigt tidspunkt eller outputplacering.
- Exit 2: manglende/ugyldig servicekonto, forkert token-endpoint eller signering.
- Exit 3: API/netværk/timeout eller filfejl. Rå Google-svar og credentialfelter vises aldrig.
- HTTP 403: kontrollér API og kontoens GSC-adgang. HTTP 404: kontrollér property; URL-prefix kan vælges med `--site=https://cyclingzone.org/`.
- Windows keyring `Access is denied`: kontrollér CLI i den autoriserede brugers normale miljø. Det beviser ikke, at hemmeligheden mangler.

Officielle kilder: [API og Pacific-datoer](https://developers.google.com/webmaster-tools/v1/searchanalytics/query), [datadækning](https://developers.google.com/webmaster-tools/v1/how-tos/all-your-data), [Google-nøgler](https://docs.cloud.google.com/iam/docs/keys-create-delete), [GSC-rettigheder](https://support.google.com/webmasters/answer/7687615).
