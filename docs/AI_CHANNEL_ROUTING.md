# AI-kanaler og opgaveansvar

Læs ved kanalvalg. Roller/claims: [AGENT_ARCHITECTURE.md](AGENT_ARCHITECTURE.md). Mandat: [AGENTS.md](../AGENTS.md). Resultatansvar/pilot: [CODEX_WORKFLOWS.md](CODEX_WORKFLOWS.md). Opdateret 29/9/2026, Refs #605 #1341 #5467.

Claude Code og Codex kan begge eje et helt godkendt forløb: undersøgelse, design, implementation, verifikation, reviewkoordinering og release efter mandat. Vælg efter faktisk adgang og opgavens behov; et ekstra kanalskift kræves ikke af opgavetypen alene. Ejeren skal ikke transportere prompts mellem agenter.

| Behov | Kanal og ansvar | Grænse |
|---|---|---|
| Arbejde i repoet, fejlundersøgelse, tests, deploykontrol | Claude Code eller Codex med den nødvendige adgang | Isoleret worktree, samme SSOT'er og gates |
| Produktvalg, strategi, design | Ejerens valgte samtale; coding-agenten kan fremskaffe kode- og runtimebevis | Ejeren beslutter; nye spillerfeatures kræver godkendt design/testplan |
| Uafhængigt PR-review | Frisk read-only reviewer i tilgængelig runtime | Krav + diff + testbevis; implementeren godkender ikke sig selv |
| Beslutning fra telefonen | Mobil-chat med beslutningspakke og preview/billeder | UI-go kræver visuelt bevis, ikke kun tekst |
| Spec eller audit i cloud | Cloud-session med afgrænset adgang og delt GitHub-handoff | Ingen antagelse om prod-login, lokale filer eller ret til merge/prod-skrivning |
| Dokumenter og regneark | Kanal med relevante dokumentværktøjer, fx Cowork eller Codex | Adgang og filplacering verificeres; repo-edits følger git-disciplin |
| Asynkront arbejde | Eksplicit bestilt opgave/automation med resultat og stopgrænser | Tavshed er ikke godkendelse; ingen ny monitor uden bestilling |

**Arbejdsform besluttet 24/9:** specs kan forberedes i cloud dagen før; lokal implementering følger den færdige godkendte spec. UI-kort bærer preview-link og desktop-/mobilbilleder, så ejeren kan give go fra telefonen. Denne mulighed består; den kræver ikke et nyt kanal-hop, hvis den valgte hovedsession allerede har design og mandat.

## Handoff og værktøjer

Behold én hovedsession som ansvarlig, indtil resultatet er verificeret eller et konkret handoff er nødvendigt. Delt handoff ligger på GitHub: mål, låste beslutninger, SHA/PR, verifikation og næste handling. Lokale caches er regenererbare.

Vælg model/effort efter opgave og måling i den faktisk tilgængelige runtime. Ingen fast leverandørrolle eller modelnavn fra en gammel matrix er et mandat. Bølger bruger de godkendte indgange og fælles kapacitetsgrænser. Skills bruges efter konkret behov; deres proces må ikke genåbne allerede givne godkendelser.

Historiske kanalmatricer findes i git-historikken. De tidligere forbud mod coding-agenter til strategi, review og deploykontrol gælder ikke som generelle regler.
