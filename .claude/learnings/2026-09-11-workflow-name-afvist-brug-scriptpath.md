# Postmortem · 2026-09-11 · `Workflow({ name: "wave" })` afvist: CRLF i wave.js fra core.autocrlf

## Hvad skete der?
Første bølge gennem `.claude/workflows/wave.js` (orkestrator-standard v2, #5142) kunne ikke startes. Claude Desktop-appens permission-handler afviste `Workflow({ name: "wave" })` tre gange med "script contains control characters that would be hidden in the approval dialog". Efter en LF-konvertering af filen gik `Workflow({ scriptPath })` igennem, og bølgen kørte. Kl. 17:13 fejlede `scriptPath`-formen så med samme besked, fordi `git pull --rebase --autostash` i mellemtiden havde rørt filen og givet den CRLF igen. Samlet forsinkelse ca. 40 min, og en forkert første konklusion ("ikke CRLF") nåede at stå i denne fil og i CLAUDE.md.

## Root cause
`core.autocrlf=true` på Windows giver `.claude/workflows/wave.js` CRLF-linjeskift i arbejdskopien. Permission-handleren validerer det opløste script og regner `\r` (0x0D) som et kontroltegn der ville være skjult i godkendelsesdialogen. Både `name:` og `scriptPath:` læser filen fra disk, så begge fejler med CRLF og virker med LF. Min første måling ("0 kontroltegn") kørte mod filen EFTER min egen LF-konvertering, og derfor så jeg ikke sammenhængen; da git senere genskabte CRLF, kom fejlen tilbage.

## Fix
`.gitattributes`: `.claude/workflows/*.js text eol=lf`, så checkouts på Windows altid har LF, uanset autocrlf. Verificeret: efter `sed -i 's/\r$//'` gik Workflow-kaldet igennem begge gange (14:34 dry-run, 14:36 bølge 1, 17:14 bølge 2).

## Forhindret-fremover
- `.gitattributes`-reglen ovenfor (permanent).
- CLAUDE.md-afsnittet "Orkestrator-standard" peger på `scriptPath` og nævner CRLF-årsagen kort.
- Hvis fejlen dukker op igen: `file .claude/workflows/wave.js` viser "CRLF" → `sed -i 's/\r$//'` og prøv igen. Ingen anden fejlsøgning nødvendig.

## Læring
Når et tool-kald afvises af "permission handler returned updatedInput", er det appens validering af det opløste input, ikke dit. Mål filen i den tilstand appen ser den, FØR du ændrer den; en konklusion draget efter egen rettelse er ikke en måling. Og: `git pull --rebase --autostash` normaliserer linjeskift i filer der er i stashen, så en manuel LF-konvertering uden `.gitattributes` overlever ikke næste pull.
