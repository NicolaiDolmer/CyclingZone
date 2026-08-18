# Discord-DM-triage: fra pastet besked til issue og svarudkast

> **Status:** Design ejer-godkendt 2026-08-18 (rutine + anonymisering som default). Implementering ikke påbegyndt.
> **Baggrund:** Ejer-spørgsmål 18/8 om at læse og besvare personlige Discord-DM'er og få dem i GitHub.

## Problemet

Ejeren modtager spiller-henvendelser som personlige Discord-DM'er. De bliver læst og besvaret ad hoc, og indholdet ender aldrig i backloggen. En DM med en reel bug har i dag ingen vej til et issue ud over at ejeren selv husker at oprette det.

## Hvorfor ikke automatisere indgangen

To veje blev undersøgt og fravalgt 18/8:

**Personlige DM'er kan ikke læses programmatisk.** Det kræver et bruger-token (selfbot), hvilket er brud på Discords ToS med reel risiko for permanent ban af ejerens konto. Ikke en mulighed.

**Bot-DM'er kan læses, men ikke via REST.** Målt 18/8 mod produktions-botten:

```
GET /users/@me        -> 200  "Cycling Zone"
GET /users/@me/channels -> 200  array længde 0
```

De 0 er Discord-begrænsningen, ikke tomhed: bots kan ikke liste DM-kanaler via REST. Indgående bot-DM'er kræver en gateway-forbindelse med `DIRECT_MESSAGES`-intent, som ikke findes i backend i dag. Den udgående vej er derimod fuldt bygget (`discordDmDelivery`, `discordDmOutbox`, `discordDmRateGuard`, `boardDmMirror`).

Ejeren valgte 18/8 den manuelle rutering. Gateway-lytteren er ikke afvist, men ligger uden for denne spec.

## Afgrænsning mod eksisterende flader

To ting findes allerede og skal ikke genopfindes:

| Flade | Hvad den dækker | Hvorfor den ikke løser dette |
|---|---|---|
| Admin-feedback-indbakke (#2842, merged) | `player_feedback` med status new/in_progress/closed, reply-sti, `AdminFeedbackTab.jsx`, `backend/lib/feedbackInbox.js` | `POST /feedback` kræver `requireAuth` og sætter `user_id NOT NULL` mod `auth.users`. Kan ikke tage imod tekst fra en Discord-bruger uden konto, og der er ingen admin-opret-sti |
| Daglig Discord-sweep (`scripts/discord/sweep-daily.mjs`) | Forum-tråde i `#bugs` og `#feedback-and-ideas` siden sidste cutoff, dumper til dateret markdown | Læser kun guild-kanaler. Personlige DM'er er per definition uden for guilden |

## Løsningen

En projekt-skill i `.claude/skills/discord-dm/SKILL.md`, samme mønster som den eksisterende `github-housekeeping`. Ejeren paster DM-teksten i Claude Code og skriver `/dm`.

### Rutinen

**Trin 1: normalisér.** Copy-paste fra Discord tager typisk afsendernavn, tidsstempel og beskedtekst i én klump, og lange beskeder kan have citat-blokke fra tidligere svar. Trinnet skiller afsender fra indhold, så de følgende trin arbejder på ren beskedtekst. Er der flere beskeder i samme paste, behandles de som separate henvendelser.

**Trin 2: triagér** i fire spande:

| Spand | Bliver til issue |
|---|---|
| Bug | Ja, efter verifikation i trin 3 |
| Feature-ønske | Ja |
| Spørgsmål eller support | Kun hvis spørgsmålet afslører at noget er uforståeligt i spillet. Så er det et UX-issue, ikke en supportsag |
| Støj | Nej |

**Trin 3: verificér før claim.** En DM er en påstand, ikke evidens. Før noget beskrives som en bug, tjekkes kode eller runtime. Dette er repoets hard rule, og den er nemmest at bryde her, hvor spilleren lyder sikker. Kan påstanden ikke verificeres, oprettes issuet med påstand og verifikationsforsøg tydeligt adskilt, ikke som konstateret fejl.

**Trin 4: søg for dublet.** `gh issue list --search` før oprettelse. Findes issuet i forvejen, kommenteres spillerens evidens på det eksisterende i stedet for at oprette nummer to.

**Trin 5: opret issue.** Indhold: citatet som evidens, verifikationsfund adskilt fra påstanden, labels efter repoets state-maskine (`claude:todo` plus type og priority).

**Trin 6: svarudkast på EN og DA.** Leveres til copy-paste. Ejeren poster selv. Udkastet siger hvad der sker uden at love en dato.

### Anonymisering (ejer-godkendt 18/8)

CyclingZone-repoet er closed-source men publicly viewable. Et Discord-håndtag i et issue er derfor offentligt læsbart permanent.

**Default: anonymisér.** Issues skriver "en spiller skriver" plus citatet. Håndtaget udelades. Ejeren kan bede om håndtaget i den enkelte sag, og først da kommer det med. Sporbarheden tilbage til personen ligger i ejerens egen DM-tråd, ikke i issuet.

Citatet skal desuden renses for oplysninger der indirekte identificerer: holdnavn, e-mail, andre spilleres navne.

### Hvad rutinen bevidst ikke gør

- Sender aldrig noget til spilleren. Kun udkast til copy-paste, jf. den stående regel om ikke at sende spillerbeskeder på ejerens vegne
- Opretter ikke issue på støj eller på allerede kendte sager
- Gætter ikke en bug frem uden at have kigget i koden

### Fejlhåndtering

| Situation | Håndtering |
|---|---|
| Uklar DM ("der er noget galt med mit hold") | Spørg ejeren hvad spilleren mente. Opfind ikke et issue. Dette er den fejlklasse der ellers fylder backloggen med gæt |
| Påstand kan ikke verificeres | Issue oprettes med påstand og verifikationsforsøg adskilt, ikke som konstateret fejl |
| Flere henvendelser i ét paste | Behandles som separate sager, hver med egen triage |
| Dublet fundet | Kommentér på eksisterende issue, opret ikke nyt |
| `gh` fejler | Stop og rapportér. Opret ikke issuet delvist |

## Verifikation

Skills kan ikke unit-testes. Rutinen verificeres mod to til tre rigtige DM'er ejeren har liggende, med kontrol af at:

1. Triage-spanden er rigtig
2. Dublet-søgningen finder et kendt eksisterende issue når en DM med vilje beskriver noget allerede rapporteret
3. Det oprettede issue indeholder nul identificerende oplysninger
4. Svarudkastet findes på både EN og DA

## Afledt fund, ikke i scope

Backend sender DM'er til spillere i dag (board-updates m.m.), men lytter ikke efter svar. Spiller-svar på de DM'er går tabt. En gateway-lytter med `DIRECT_MESSAGES`-intent ville lukke hullet og kunne føde ind i den eksisterende daglige sweep. Bør oprettes som selvstændigt issue.
