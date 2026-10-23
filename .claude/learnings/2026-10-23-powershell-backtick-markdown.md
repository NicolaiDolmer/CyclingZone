# PowerShell-dobbeltcitat ødelægger markdown med backticks (nat 22-23/10)

**Hvad skete:** Fire tekster blev skrevet med PowerShell `"..."` eller `@"..."@`:

- et postmortem (#7060)
- issue #7077
- kommentarer på #6499 og #5904

Alle fire havde inline-kode i backticks. PowerShell læser `` `r ``, `` `t ``, `` `f ``, `` `n `` og `` `b `` som escape-sekvenser. Resultatet var kontroltegn og forsvundne bogstaver midt i teksten. Det blev først opdaget, da teksterne blev læst igen.

**Rod-årsag:** Backtick er escape-tegnet i PowerShell-strenge, der interpolerer. Markdown bruger det samme tegn til kode. Kombinationen giver tavs datakorruption, ikke en fejl.

**Rettelse:** Alle fire er skrevet om fra filer, der er lavet med Write-værktøjet. Det gjaldt `gh issue edit --body-file`, `gh api PATCH -F body=@fil` og postmortem-filen.

**Regel fremover:**

- Markdown til GitHub skrives altid via Write-fil + `--body-file` eller `-F body=@fil`. Aldrig som PowerShell-dobbeltcitat.
- I PowerShell skrives variabler foran et kolon som `${navn}:`. `"$navn: ..."` er en parse-fejl.

Refs #7060 #7077
