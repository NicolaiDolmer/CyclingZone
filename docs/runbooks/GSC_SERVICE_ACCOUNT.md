# Google Search Console: service-konto til `gsc-report.mjs`

> Ejer-guide til [#3797](https://github.com/NicolaiDolmer/CyclingZone/issues/3797). Ca. 10 minutter, engangsopgave.
> Formål: give `scripts/gsc-report.mjs` læseadgang til Search Console, så søgetal kan hentes uden at nogen skal åbne GSC-UI'et.
> Kun du kan gøre det: alle trin kræver login på din Google-konto. Claude kan ikke oprette hverken Cloud-projekt, service-konto eller GSC-adgang.

## Hvad du ender med

En JSON-nøgle i Infisical under navnet `GSC_SERVICE_ACCOUNT_JSON`, og derefter virker:

```bash
infisical run --env=dev -- node scripts/gsc-report.mjs --days=28
```

Nøglen giver **kun læseadgang** til Search Console (scope `webmasters.readonly`). Den kan ikke ændre noget i GSC, i DNS eller på sitet.

## Trin 1: Google Cloud-projekt (2 min)

1. Åbn [console.cloud.google.com](https://console.cloud.google.com/).
2. Projektvælgeren øverst → **New project**.
3. Navn: `cycling-zone-analytics`. Organisation/mappe: lad stå som foreslået. → **Create**.
4. Vent til notifikationsklokken siger at projektet er oprettet, og vælg det i projektvælgeren.

Har du allerede et Cloud-projekt til Cycling Zone, så brug det og spring til trin 2.

## Trin 2: Aktivér Search Console API (1 min)

1. I søgefeltet øverst: skriv `Google Search Console API`.
2. Vælg resultatet under **Marketplace/APIs**.
3. Klik **Enable**.

Springer du dette trin over, fejler scriptet på selve token-kaldet med en besked om at API'et ikke er aktiveret. Det er den hyppigste årsag til en rød første kørsel.

## Trin 3: Opret service-kontoen (2 min)

1. Venstremenu → **IAM & Admin** → **Service Accounts** → **Create service account**.
2. Navn: `gsc-report`. Beskrivelse: `Læseadgang til Search Console for scripts/gsc-report.mjs`.
3. **Create and continue**.
4. Trin 2 "Grant this service account access to project": **spring over** (klik Continue). Kontoen skal ikke have nogen Cloud-rolle. Adgangen gives i Search Console, ikke her.
5. Trin 3 "Grant users access": spring over. → **Done**.

Noter service-kontoens e-mail. Den ser sådan ud: `gsc-report@cycling-zone-analytics.iam.gserviceaccount.com`. Du skal bruge den i trin 5.

## Trin 4: Hent JSON-nøglen (1 min)

1. Klik på den nye service-konto i listen → fanen **Keys**.
2. **Add key** → **Create new key** → type **JSON** → **Create**.
3. Browseren downloader en `.json`-fil.

> Filen er en adgangsnøgle. Læg den ikke i repoet, ikke i OneDrive og ikke i en chat. Den skal kun ind i Infisical (trin 6), og derefter kan du slette den fra Downloads.

## Trin 5: Giv kontoen adgang til ejendommen i Search Console (2 min)

1. Åbn [search.google.com/search-console](https://search.google.com/search-console/).
2. Vælg ejendommen `cyclingzone.org` (domæne-property, DNS-verificeret 30/6, se `docs/seo/2026-06-21-seo-ownership.md` §6).
3. Venstremenu nederst → **Settings** → **Users and permissions** → **Add user**.
4. E-mail: service-kontoens adresse fra trin 3.
5. Tilladelse: **Full** eller **Restricted**. Begge virker til rapporten. Vælg **Restricted** hvis du vil holde adgangen så smal som muligt.
6. **Add**.

Kontoen dukker op i brugerlisten med det samme. Der sendes ingen invitation der skal accepteres.

## Trin 6: Læg nøglen i Infisical (2 min)

Hele filens indhold skal ind som **én** værdi. Kør fra repo-roden i PowerShell:

```powershell
$json = Get-Content "$HOME\Downloads\<filnavn>.json" -Raw
infisical secrets set GSC_SERVICE_ACCOUNT_JSON="$json" --env=dev
infisical secrets set GSC_SERVICE_ACCOUNT_JSON="$json" --env=prod
```

Erstat `<filnavn>` med den fil browseren hentede. `prod` er med, så en fremtidig automatisk ugerapport kan bruge samme nøgle.

Slet derefter filen:

```powershell
Remove-Item "$HOME\Downloads\<filnavn>.json"
```

## Trin 7: Verificér (1 min)

```bash
infisical run --env=dev -- node scripts/gsc-report.mjs --days=28
```

Forventet: en tabel med klik, visninger, CTR og gennemsnitsposition, top-queries og top-sider, sammenlignet med de foregående 28 dage. Med kun 1 side i Googles indeks (målt 21/8, #4067) er små eller tomme tal det korrekte svar, ikke en fejl.

## Hvis det fejler

| Besked | Årsag | Løsning |
|---|---|---|
| `GSC_SERVICE_ACCOUNT_JSON mangler` | Scriptet blev kørt uden `infisical run` | Kør kommandoen med `infisical run --env=dev -- ` foran |
| `Token-kaldet fejlede ... API ... not enabled` | Trin 2 sprunget over | Aktivér Google Search Console API i Cloud-projektet |
| `403 ... har sandsynligvis ikke adgang` | Trin 5 sprunget over, eller forkert e-mail tilføjet | Tilføj service-kontoens e-mail som bruger på ejendommen |
| `404 ... findes ikke i denne konto` | Ejendommen er en URL-præfiks-property, ikke en domæne-property | Kør med `--site=https://cyclingzone.org/` |
| `kunne ikke parses som JSON` | Kun en del af filen kom med i Infisical | Sæt værdien igen med `-Raw` som i trin 6 |

## Hvis nøglen skal skiftes ud

Opret en ny nøgle på samme service-konto (trin 4), læg den i Infisical (trin 6), og slet derefter den gamle nøgle under **Keys**. Ejendommens brugerliste skal ikke røres. Skal adgangen fjernes helt: slet service-kontoen i Cloud og fjern brugeren i Search Console.

## Relateret

- `scripts/gsc-report.mjs` (headeren har brug, env og exit-koder)
- `docs/ANALYTICS_STACK.md` §1 (hvad GSC ejer sandheden om) og §7 (adgang og scripts)
- `docs/seo/2026-06-21-seo-ownership.md` §6 (DNS-verificeringen af domæne-property'en, som ikke må slettes)
