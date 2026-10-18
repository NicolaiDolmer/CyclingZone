# Codex-agentopsætning

SSOT for projektets fem Codex-roller og setup-script (Refs #605). Mandat og arbejdsdeling ejes af [AGENTS.md](../AGENTS.md), leveranceforløb af [CODEX_WORKFLOWS.md](CODEX_WORKFLOWS.md), isolation/kapacitet af [PARALLEL_WORKTREE_ORCHESTRATION.md](PARALLEL_WORKTREE_ORCHESTRATION.md). Ejerbestilling: [startprompt 18/10](sessions/2026-10-18-codex-startprompt.md), opgave 1. Claude reviewer og merger denne leverance; Codex merger aldrig i denne session.

## Roller

| Rolle | Model / effort | Ansvar |
|---|---|---|
| explorer | gpt-6-luna / low | Afgrænset læsning med filbevis, ingen edits |
| worker | gpt-6.1-sol / medium | Én godkendt opgave i ét tildelt worktree |
| reviewer | gpt-6-astra / high | Uafhængigt review, ingen edits |
| verifier | gpt-6.1-sol / medium | Tildelt test-tier, ingen kildeændringer |
| ui-checker | gpt-6.1-sol / medium | Rigtige screenshots mod templates/TASTE |

Modellerne blev fundet i kontoens lokale `models_cache.json` og i sessionens tilladte modeller 18/10; det er ikke et løfte om fremtidig tilgængelighed. Vælg kun modeller, den aktuelle konto tilbyder. Luna er det lette valg til snæver læsning; ingen faktisk prisbesparelse er målt.

[Officiel agentdokumentation](https://learn.chatgpt.com/docs/agent-configuration/subagents) kontrolleret 18/10/2026: standalone projektroller læses fra `.codex/agents/*.toml`. `name`, `description` og `developer_instructions` er påkrævet; rollerne her låser desuden model/effort. Samme navn erstatter indbygget rolle. Filens model/effort har forrang for spawn-værdier; ellers opløses spawn → `[agents]`-standard → parent. Roller arver parent-rettigheder, provider og MCP-servere. En instruktion om ingen edits er ikke en selvstændig read-only sandbox.

## Installation pr. maskine

```powershell
pwsh -NoProfile -File scripts/codex-setup.ps1          # dry-run, ingen skrivning
pwsh -NoProfile -File scripts/codex-setup.ps1 -Apply   # skriv kun agentstandarder
```

Kræver `python` på PATH, version 3.11+ til standardbibliotekets TOML-parser. Defaultsti er `$CODEX_HOME/config.toml`, ellers `~/.codex/config.toml`. `-ConfigPath <fixture>` bruges til lokal prøvekørsel. Scriptet indfører kun disse tre værdier i `[agents]`:

```toml
default_subagent_model = "gpt-6.1-sol"
default_subagent_reasoning_effort = "medium"
max_concurrent_threads_per_session = 3
```

Loftet tæller spawned tråde, eksklusive parent; parent + tre er fire. Det er ikke en maskinlås: projektets fælles lane- og verify-lofter samt Claudes aktive arbejde gælder stadig. Ingen ændring af hovedmodellens default, tilladelser, provider, hooks, MCP, nøgler eller tokens. Ukendte agents-nøgler bevares. Legacy `max_threads` afvises før skrivning: den installerede CLI 0.162.1 meldte konkret dubletfelt ved kombination med det nye navn. Migrér det gamle felt manuelt først. Kontroller et eventuelt modstridende ældre V2-override separat frem for at ændre det automatisk.

Helperen parser hele TOML-dokumentet privat og validerer, at kun de tre tilsigtede værdier er ændret. Øvrige tekstbytes, kommentarer, BOM og linjeskift bevares. Output viser kun de tre ønskede agentværdier; hverken eksisterende værdier, configtekst eller rå parserfejl udskrives. Apply skriver atomisk og afviser observeret samtidig ændring. Ingen backup med hemmeligheder oprettes. Anden apply er no-op. Symlinket config afvises.

Ved eksisterende `[agents]` kræves kanonisk header og simple bare keys. Inline/quoted/dotted table-syntax eller multiline strings, som gør tekstredigering tvetydig, afvises uden skrivning; ret manuelt. Fraværende agents-tabel kan tilføjes sikkert efter øvrig TOML. Scriptet aktiverer ikke roller i en allerede startet session: åbn en ny session i den betroede projektworktree efter installation. [Konfigurationsreference](https://learn.chatgpt.com/docs/config-file/config-reference) beskriver `project_doc_max_bytes` og at ikke-betroede projekter springer `.codex`-lag over. Intet trust- eller byte-loft ændres her.

## Verifikation og måling

- `python -m unittest discover -s scripts -p codex_setup_test.py`: fixtures, dry-run uden mappeoprettelse, idempotens, CRLF/BOM, uændret øvrig config, nested tables, malformed/ambiguous input og ingen private fixtures i output. Kører også i eksisterende `ops-script-tests` i CI.
- PowerShell-wrapperens dry-run og apply testes mod en midlertidig fixture; brugerconfig kontrolleres i dry-run.
- `pwsh -File scripts/check-agent-token-hygiene.ps1`: alle bindende regelankre skal bestå. Byte-mål er højst 13.000 for AGENTS; tokenmålet er scriptets LF-normaliserede tegn/4-estimat, ikke modeltokenizer.
- FULL efter gældende tier: `verify-local.ps1` gennem verify-semafor, preflight i forgrunden og uafhængigt read-only review før push. Ingen frontend-/spillerændring; e2e og visuelle screenshots er ikke relevante for denne ops-leverance.

Målinger fra denne leverance, inklusive probevilkår og fejl, står i PR-body. Sammenlign kun samme model, effort, prompt og sandbox. Registrér første agentbesked og færdigt resultat separat. En shell-fejl eller en afvist model er ikke gennemført testarbejde. En enkelt kørsel kan vise funktion, ikke årsag til en hastighedsgevinst. Cold-start-estimatets harnessdel kommer fra en eksisterende snapshot og er ikke en frisk måling af hele desktop-sessionens prompt.

Parallelitet skal vises med overlappende, observerede agentforløb; statiske rolle-filer alene beviser ingen delegation. Appens aktuelle spawn-værktøj kan mangle `agent_type`; i så fald kan eksplicit model/effort og rolleprompt bruges, men det må ikke kaldes bevis på automatisk indlæsning af custom-rollen. Brug en frisk CLI/app-session til den kontrol. Ingen ny scheduler, automatisk baggrundsopfølgning eller kontoomlægning indgår.

Patch notes og FEATURE_REGISTRY ændres ikke: denne leverance ændrer kun udvikleropsætning, ingen spilleradfærd, kernefeature eller flag. NOW/MASTERPLAN/STATUS_BOARD ejes af Claudes særskilte close-out.

## Målt 18/10/2026

| Måling | Før | Efter |
|---|---:|---:|
| AGENTS.md bytes, samme worktree | 26.746 | 12.533 |
| AGENTS estimerede tokens | 6.492 | 3.072 |
| Scriptets observerede Codex cold-start-estimat | 28.604 | 25.649 |
| Første agentbesked, fast CLI-probe | 22,37 s | 10,85 s |
| Hele CLI-kørslen | 69,14 s | 15,90 s |
| Gennemført korrekt fast testopgave | Nej | Nej |

Cold-start-tallene kommer fra `check-agent-token-hygiene.ps1`; 14.782 harness-tokens er et ældre målt snapshot, ikke ny runtime-tokenmåling. Mellem kørslerne regenererede CLI-hooks SESSION_CONTEXT-cache fra 0 til anslået 465 tokens. Netto observeret fald er derfor 2.955; selve AGENTS-reduktionen er 3.420. Med identisk cachebidrag ville efterestimatet være 25.184. Ingen målt besparelse i faktisk modelregning påstås.

Fast probe, begge gange CLI 0.162.1, `gpt-6-luna`, `low`, `--ephemeral --json --sandbox read-only` i eget worktree; stopwatch starter umiddelbart før CLI-start og første `item.completed` med `agent_message` måles:

```text
Read-only fixed setup benchmark. In the current worktree, inspect scripts/codex-wave.mjs and .codex/agents if present. Return one concise sentence naming the wave CLI entrypoint and the number of custom agent TOML files. Do not edit, fetch, commit, merge, read secrets or user config, or delegate. This is an explicitly authorized isolated benchmark; no project work is claimed.
```

Før: agenten rapporterede shell-startfejl. Efter: svaret hævdede 0 TOML-filer, mens en direkte filsystemmåling viste 5. Begge CLI-processer returnerede exit 0; det er ikke bevis for korrekt opgaveløsning. Svartiderne er registreret, men kan ikke dokumentere en produktivitetsgevinst.

Parallel-probe: før blev to Luna-explorers startet på hver sit læseområde; præcis overlapstid blev ikke målt. Efter blev de samme to agenter aktiveret uden at afvente den første. Appens `collaboration.list_agents` observerede BEGGE som `running`; derefter blev begge afslutninger set. Rapporterede værktøjstider var 17:53:02 UTC (hygiejne) og 17:53:05-17:53:16 UTC (setup). Samtidig aktiv agentstatus er positivt observeret; samtidig shell-CPU er ikke målt. Parent samlede begge svar. Appens værktøj mangler `agent_type`, så denne kontrol brugte eksplicit model/effort og rolleprompt.

En frisk CLI-probe med `agent_type explorer` hævdede to afslutninger, men JSON-events viste kun en wait med tomme receiver-ids; en verifier-probe havde samme begrænsning. Ingen custom-role-dispatch erklæres runtime-verificeret på det grundlag. Filerne TOML-parses, og det officielle format er kontrolleret; automatisk valg/indlæsning skal stadig bekræftes i en frisk understøttet session med observerbare spawn-ids.

Brugerens tre agentstandarder er installeret på NicolaiPC; anden apply var byteuændret/no-op. Der er ikke skrevet til hovedcheckout, Claudes worktrees eller prod, og ingen merge er udført.
