# Postmortem · 2026-09-11 · `Workflow({ name: "wave" })` afvist af permission-handleren, brug `scriptPath`

## Hvad skete der?
Første bølge nogensinde gennem `.claude/workflows/wave.js` (orkestrator-standard v2, #5142) kunne ikke startes. `Workflow({ name: "wave", args })` blev afvist tre gange i træk af Claude Desktop-appens permission-handler med teksten "script contains control characters that would be hidden in the approval dialog". Bølgen blev forsinket ca. 25 minutter, og ejeren spurgte hvad der foregik.

## Root cause
Ikke fastslået i appen (lukket kode), men indkredset: filen `wave.js` har 0 kontroltegn (målt med Node på alle kodepunkter; kun `é` som non-ASCII). Fejlen opstod både med CRLF og LF i arbejdskopien, og både med og uden linjeskift i `args`. Fejlen ligger i den vej hvor appen opløser et *navngivet* workflow til et `script`-felt i `updatedInput`, før godkendelsesdialogen. Samme fil via `scriptPath` passerer valideringen.

## Fix
Kald altid `Workflow({ scriptPath: "C:\\Dev\\CyclingZone\\.claude\\workflows\\wave.js", args: { tracks: [...] } })`. Verificeret 11/9 kl. 14:34 (dry-run, 27 ms) og 14:36 (rigtig bølge, run `wf_b225773a-57d`). Indgangen i `CLAUDE.md` (afsnit "Orkestrator-standard") og i wave-skillens beskrivelse rettet til `scriptPath`.

## Forhindret-fremover
- `CLAUDE.md` og skillen viser nu `scriptPath`-formen som den eneste.
- Lad CRLF/LF i wave.js ligge som git leverer den; det var ikke årsagen (`.gitattributes`-ændring er unødvendig).

## Læring
Når et tool-kald afvises af "permission handler returned updatedInput", er det appens omskrivning af inputtet der fejler, ikke dit input. Prøv den alternative indgang (her `scriptPath` i stedet for `name`) FØR du fejlsøger filen. Det kostede tre forsøg og en linjeskift-konvertering at lære.
