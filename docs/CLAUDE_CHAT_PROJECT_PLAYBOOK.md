# CLAUDE_CHAT_PROJECT_PLAYBOOK.md — opskrift på Claude chat project-setup

> **Læs hvornår:** Når du sætter et nyt Claude chat (claude.ai) project op — eller skal rydde op i et eksisterende. Især før første strategi-samtale, hvor det er kritisk at Claude har korrekt context.
> **Tracker:** session 2026-05-25 setup af CyclingZone-projectet.
> **Læring der trigger denne playbook:** [`.claude/learnings/2026-05-25-claude-chat-project-memory-not-fritext.md`](../.claude/learnings/2026-05-25-claude-chat-project-memory-not-fritext.md)

## De tre lag — hvad hører hvor

Et Claude chat project har tre uafhængige context-lag. At blande dem giver token-spild og drift.

| Lag | Sti i UI | Indhold | Auto/manuel |
|---|---|---|---|
| **Project Knowledge (Files)** | Project → Files → Add files | Snapshot-dokumenter Claude læser i fuld længde. Fakta, research, roadmaps, feature-status. | Manuel upload + re-upload |
| **Project Instructions** | Project → Edit → Instructions | Regler for HVORDAN Claude agerer. Tone, format, output-struktur, copy-regler. | Manuel fri-tekst |
| **Project Memory** | Project → Memory → blyant-ikon | Persistente FAKTA om brugeren og projektet. Hvem, hvor, fase, strategiske beslutninger. | **Auto-regenereret hver aften** baseret på samtaler. Styres via "Tell Claude what to remember or forget"-instruktions-felt. |

**Hovedregler:**
- **Game-design, feature-lister, kode-konventioner** → Project Knowledge (ikke Memory)
- **Aktive GitHub-issues** → GitHub (ikke Memory; "status unclear"-entries er en smell)
- **Communication style** → Instructions (ikke Memory)
- **Claude Code-specifikke detaljer** (slash-commands, MCP-IDs, /clear-quota) → IKKE i Claude chat memory — Claude chat skriver ikke kode

## Opsætnings-flow for nyt project

### 1. Project Knowledge (Files) — typisk 100-300 KB

Forbered en samlet upload-folder lokalt, fx `C:\dev\CyclingZone-claude-chat-upload\`. Skript-eksempel: se `scripts/` eller læs hvordan vi gjorde det i session 2026-05-25.

**Hvad skal med (typisk for et CyclingZone-strategi-project):**
- Research-pakke fra Manus (markedsanalyse, freemium-model, validation-plan, metrics)
- Repo's strategi-docs (`docs/NOW.md`, `docs/FEATURE_STATUS.md`, `docs/VERDENSKLASSE_ROADMAP.md`, `docs/AI_COUNCIL.md`, `docs/TONE_OF_VOICE.md`)
- `CLAUDE.md` for ramme-konvention
- `00_INDEX.md` (lavet specifikt til projectet) der forklarer hver fil

**Hvad skal IKKE med:**
- CSV/JSON/PNG raw data (kun hvis Claude skal regne på det)
- Operationelle taktik-docs (landing page-copy, Discord-templates, survey-setup)
- Claude/Codex transcripts, memory, settings, secrets

Tilføj **GitHub-connector** (Project → Files → Add files → GitHub) til live-kode-adgang. Project Knowledge er en snapshot — connector er den friske kanal.

### 2. Project Instructions — ~1500-3000 tegn

Fokuseret på regler. Skal ikke duplikere Project Knowledge.

**Skabelon-struktur:**

```
[Projekt-1-linjer + URL]

NUVÆRENDE FASE
- [2-4 punkter om hvor projektet er nu]

STRATEGISKE BESLUTNINGER (truffet — ikke åbne)
- [4-6 beslutninger der er låst]

[DOMÆNE]-FACING [REGEL-TYPE]
- [konkrete regler for output]

ARBEJDSMÅDE
- Project Knowledge er snapshot [dato]. For live: brug [connector].
- Peg på evidens-kilde når du anbefaler
- Output der skal i repo: lever som markdown-blok
- Decision-output format: "Beslutning: X. Begrundelse: Y. Næste handling: Z (kanal: ...)"
```

### 3. Project Memory — håndteres via instruktions-felt

**Kritisk:** Memory er IKKE et fri-tekst-felt. Det er auto-regenereret hver aften. Du styrer det via "Tell Claude what to remember or forget"-instruktions-felt.

**For at sætte initial memory:**

Skriv én instruktion i feltet og tryk Enter:

```
Memory skal indeholde præcis 5 sektioner: Who & context, Current phase, Strategic decisions, AI Council, Project Knowledge-forhold. Alt andet skal slettes.

[Detaljer for hver sektion]

Begrundelse for udeladelse: game-design tilhører Project Knowledge, kode-konventioner tilhører CONVENTIONS.md, communication preferences tilhører Project Instructions.
```

**For at rydde op i eksisterende stale memory:**

Vær eksplicit — list hvilke sektioner der skal slettes:

```
Slet permanent disse sektioner fra project memory: "Core game design", "Current state", "On the horizon", "Key learnings & principles", "Approach & patterns", "Communication preferences", "Tools & resources".

Behold kun: "Who & context", "Current phase", "Strategic decisions", "AI Council", "Project Knowledge-forhold".

Slet også fra "Who & context": tech stack-detaljer og alle Project IDs — de hører i Project Knowledge eller env-variabler.
```

**Hvad sker efter submit:**
- Edit lægger sig i "Manage edits"-kø som pending
- Memory applies ved næste natlige regenerate
- Ingen "Apply now"-knap
- Verificér næste dag

**Anti-pattern:** Paste hele memory-blokken som "Indsæt dette i stedet". Claude tolker inkonsistent (tilføj vs erstat).

## Strategi-interview-prompt-skabelon

Når Project Knowledge + Instructions + Memory er sat, start ny samtale med en struktureret interview-prompt:

```
Vi skal lave en grundig strategi-session om [DOMÆNE]. Mål: at du forstår [TINGEN] så fuldt at vi kan prioritere både kort og langt sigt korrekt.

FØR DU STILLER FØRSTE SPØRGSMÅL:
1. Læs Project Knowledge — særligt [filer-X-Y-Z]
2. Lav en intern liste af "evidens-huller": ting der påvirker prioritering, men hvor Project Knowledge er tavs, modsiger sig selv, eller bygger på antagelser
3. Prioritér efter beslutnings-impact
4. For hvert hul, vurdér hvem der bedst svarer: mig / [AI Council-medlem] / ekstern data
5. Vis top-10 rangliste først, så top-1-spørgsmålet

FORMAT PR. SPØRGSMÅL:
- Ét spørgsmål ad gangen
- Sig hvorfor du spørger
- Hvor det giver mening: 2-3 options (A/B/C + "andet")
- For tekniske valg: trade-off-format (benefit / cost / alternativ)
- Vis din nuværende antagelse — bekræft eller korrigér

EFTER HVERT SVAR:
- Opdatér løbende "Working Model" — vis kun delta
- Park spørgsmål der bedre ejes af andre AI Council-medlemmer / data

LOOP-GUARD:
- Hver 5. spørgsmål: pause + fuld Working Model + opdateret rangliste
- Hvis "ved ikke" / "afhænger" 3x i træk: park emnet

STOP-KRITERIE:
- (a) top-5 huller lukket, (b) jeg siger stop, (c) tilbageværende huller kræver ekstern data

DELIVERABLE (når vi stopper):
- Konsolideret "[NAVN] Working Model" markdown til `docs/[FIL].md`
- Prioriteret kortsigts-liste med foreslået kanal pr. punkt
- Langsigts-retning med åbne spørgsmål
- Liste af antagelser der mangler validation

START NU MED: din top-10 evidens-hul-rangliste, derefter første spørgsmål.
```

## Friskhed — sådan holder du det opdateret

Project Knowledge er en **snapshot**, ikke en sync. Re-upload pakken hvis:
- Manus-research / ekstern data opdateres
- VERDENSKLASSE_ROADMAP, NOW eller FEATURE_STATUS ændrer sig væsentligt
- Forretningsmodel pivotes

For aktuel kode/issues: brug GitHub-connector mod repo'et.

## Cross-refs

- AI Channel Routing-doc: [`docs/AI_CHANNEL_ROUTING.md`](AI_CHANNEL_ROUTING.md) — hvilken AI-kanal hører hvilken task i
- AI Council rolle-matrix: [`docs/AI_COUNCIL.md`](AI_COUNCIL.md) — hvem ejer hvilken beslutning
- Læring der trigger denne playbook: [`.claude/learnings/2026-05-25-claude-chat-project-memory-not-fritext.md`](../.claude/learnings/2026-05-25-claude-chat-project-memory-not-fritext.md)
- Dispatch-playbook (asynk-tasks): [`docs/DISPATCH_PLAYBOOK.md`](DISPATCH_PLAYBOOK.md)
