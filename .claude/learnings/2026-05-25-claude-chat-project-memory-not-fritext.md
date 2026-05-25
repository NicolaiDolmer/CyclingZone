# Claude chat project memory er instruktions-felt, ikke fri-tekst — og applies natligt

## Context

Audit + cleanup af CyclingZone-projectet i Claude chat (claude.ai) inden første strategi-interview om forretningsmodel. Memory-feltet indeholdt ~4000 tegn stale content: aktive GitHub-issues (achievements-bug, transfer-window status unclear), game-design-konstanter der duplikerede `DOMAIN_REFERENCE.md`, kode-konventioner der duplikerede `CONVENTIONS.md`, Claude Code-specifikke detaljer (StackBlitz, /clear, /compact) og hardcoded project-IDs.

Første antagelse: "paste ny tekst over den gamle" — viste sig at være forkert mental model.

## Root cause (af min fejl-antagelse)

Claude chat project memory er IKKE et fri-tekst-felt brugeren skriver i. Det er en **auto-genereret** tekst som regenereres **hver aften** baseret på samtaler i projectet. Editor-feltet hedder "Tell Claude what to remember or forget" — et **instruktions-felt** hvor man fortæller Claude hvad der skal huskes/glemmes, ikke et felt hvor man paster fuldteksten.

Konsekvenser jeg overså:
1. **Paste ≠ erstat.** Brugerens tidligere paste blev tolket som "tilføj dette" frem for "erstat alt", hvorfor memory blev en hybrid.
2. **Edits er pending.** Submittede instruktioner ligger som "Manage edits"-pending entries og applies først ved næste natlige regenerate. Der er ingen "Apply now"-knap.
3. **Single-line text input.** Felt er `<input type="text">` med maxLength=100000 — ikke en textarea. Linjeskift bliver fladet ud, men maxlength er højt nok til lange instruktioner.

## Fix pattern

For at rydde op i et CC project memory:

1. Klik blyant-ikonet ved "Memory" → "Manage project memory"-dialog åbner.
2. Skriv en **eksplicit instruktion** i "Tell Claude what to remember or forget"-feltet — fx:
   > Slet permanent disse sektioner: "X", "Y", "Z". Behold kun: "A", "B", "C". Begrundelse: X tilhører Project Knowledge, Y tilhører Instructions, Z er stale.
3. Tryk Enter for at submit (ingen separat submit-knap).
4. Verificér via "Manage edits"-tæller — pending edits skal vises der.
5. **Vent til næste dag** — regenerate sker natligt. Tjek memory næste morgen.

Anti-pattern: at paste hele blokken med tekst som "Indsæt dette i stedet for hele memory" — Claude tolker det inkonsistent (nogle gange tilføj, nogle gange erstat).

## Forward-guard

- **Skil tier-disciplin op:**
  - **Project Knowledge (Files):** Snapshot-dokumenter Claude læser i fuld længde (forretningsmodel, roadmap, feature-status). Re-upload manuelt.
  - **Project Instructions:** Regler for HVORDAN Claude agerer (tone, format, output, copy-regler). Direkte fri-tekst.
  - **Project Memory:** Persistente FAKTA om brugeren og projektet (hvem, hvor, fase, beslutninger). Auto-regenereret. Styres via instruktions-felt.
- **Aldrig paste game-design, feature-lister eller kode-konventioner i Memory** — de hører i Project Knowledge.
- **Aldrig paste Claude Code-specifikke detaljer** (slash-commands, MCP-IDs, daily-reset) i Claude chat Memory — Claude chat skriver ikke kode.
- **Aktive GitHub-issues hører i GitHub**, ikke i Memory. Memory-entries med "status unclear" er smell.
- **For genbrug:** se `docs/CLAUDE_CHAT_PROJECT_PLAYBOOK.md`.

## Verification

- Memory-dialog inspiceret via Chrome MCP: bekræftet ingen Apply/Save-knap, kun Close/Back/Clear edits/Remove edit
- Instruktion submittet (1150 tegn), tæller gik fra 1 → 2 pending edits
- Eksisterende stale-blok stadig synlig efter submit (forventet — applies natligt)
- Re-verify required morgen 2026-05-26 — hvis stadig stale, eskaler til endnu mere eksplicit DELETE-syntax
