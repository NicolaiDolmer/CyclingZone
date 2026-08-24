# Sådan hjælper du med Cycling Zone

Kort version: du arbejder på en branch, åbner en pull request, og CI fortæller dig om det er grønt. Nicolai godkender og merger. Du skal aldrig røre produktion.

## Det du skal bruge

- **Node 24** (repoet kræver `>=24.0.0 <25`)
- **Git** og en GitHub-konto
- En **dev-`.env`** som Nicolai sender dig. Den ligger aldrig i repoet
- Valgfrit: din egen Claude-konto, hvis du vil bruge Claude Code

## Opsætning (én gang)

```bash
git clone https://github.com/NicolaiDolmer/CyclingZone.git
```

Læg derefter de to `.env`-filer du har fået fra Nicolai i `backend/` og `frontend/`. Strukturen kan du se i de committede `backend/.env.example` og `frontend/.env.example`.

Installér afhængigheder:

```bash
npm ci --prefix backend && npm ci --prefix frontend
```

Brug altid `npm ci`, ikke `npm install`. `npm install` kan sige "up to date" mens dine pakker reelt er bagud i forhold til lockfilen.

## Arbejdsgangen

**1. Tag ét issue ad gangen.** Skriv en kommentar på issuet så andre kan se det er taget, og assign dig selv. Assignee på GitHub er det der gælder, ikke filer i repoet.

**2. Lav en branch fra `main`.** Navngiv den efter issue-nummeret:

```bash
git checkout -b feat/1234-kort-beskrivelse origin/main
```

Præfiks: `feat/` til ny funktionalitet, `fix/` til fejlrettelser, `docs/` til dokumentation.

**3. Commit og push undervejs.** Små commits er bedre end én stor. Push gerne tidligt, også når arbejdet ikke er færdigt, så andre kan se hvad der sker.

**4. Åbn en pull request.** PR-skabelonen udfyldes automatisk. Udfyld i det mindste **Hvad**, **Refs #N** og **Brugerverifikation**. Skriv `Refs #1234`, ikke `Closes #1234`, fordi Nicolai lukker selv issues efter manuel verifikation.

Er arbejdet ikke færdigt, så åbn den som **draft**.

## Verifikation: lad CI om det

Du behøver **ikke** køre den fulde lokale testsuite. CI kører alle checks automatisk på din PR, og det er gratis fordi repoet er offentligt.

Kør gerne dette lokalt først, det fanger det meste og tager under et minut:

```bash
npm run build --prefix frontend && npm run lint --prefix frontend
```

Resten fanger CI. Er en check rød, så klik ind i loggen og ret det. Fejler den samme check to gange på samme symptom, så stop og spørg Nicolai i stedet for at gætte videre.

## Godkendelse

`main` er låst. Ingen andre end Nicolai kan pushe til den eller merge en PR.

Når din PR er grøn, gennemgår han den og kører sin egen review ovenpå. Så merger han, eller beder om ændringer. Pusher du nye commits efter en godkendelse, bortfalder godkendelsen automatisk og han skal se den igen.

Der går typisk ikke lang tid, men skriv endelig i PR'en hvis der er noget der haster.

## Regler der ikke er til forhandling

- **Aldrig produktion.** Ingen adgang til prod-databasen, Railway eller Vercel. Alt hvad du laver, går live gennem en merge som Nicolai godkender
- **Aldrig commit en `.env`** eller nogen form for nøgle eller token. CI har en secret-scanner, men den er sidste forsvarslinje, ikke første
- **Aldrig push direkte til `main`**
- **Ingen databasemigrationer uden aftale.** Rører dit arbejde `database/`, så tag en snak først

## Spillervendt tekst

Al tekst brugerne ser skal være **engelsk først, dansk bagefter**. Begge sprog skal opdateres i samme PR. Dansk tekst skrives med rigtige æ, ø og å.

## Når du er i tvivl

Spørg i issuet. Et spørgsmål koster fem minutter, en forkert antagelse koster en dag.
