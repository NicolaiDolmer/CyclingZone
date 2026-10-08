# Prompt: Codex-session ved siden af Claude, start 5/10 eftermiddag

Model: **den stærkeste Codex-model du har**, indsats **høj**. Kopiér alt under stregen.

---

Codex-session i `C:\Dev\CyclingZone`, samtidig med en Claude-session, der arbejder på løbsmotoren. **Rør ikke løbsmotoren** (`backend/lib/engine/v4`, `raceEngineV4Bridge.js`, `raceRunner.js`), #6156 eller `docs/NOW.md`. Ingen prod-skrivninger og ingen merges: hver opgave bliver én PR, som ejeren giver go til. Brug `node scripts/codex-wave.mjs plan.json --run`. Følg AGENTS.md, også commit bag `scripts/guard-commit-branch.sh` og spillertekst efter `docs/TONE_OF_VOICE.md` (EN først, DA under, jeg-form).

Spor (aftalt til denne uge 5/10):
1. **#708** Supabase-grants: GRANT-skabelon til nye tabeller, grant-audit-script og CI-vagt. Frist 30/10.
2. **#6202** Vercel bygger production på hver commit til main: byg kun, når `frontend/` (eller det, frontenden afhænger af) er ændret. Mål antal builds før og efter i PR'en.
3. **#5916 + #5940** sponsor- og præmievisning: vis det rigtige beløb pr. løbsdag (kontrakt 1.120 pr. etape mod 480 pr. løbsdag, total uændret) og et realistisk præmie-estimat. Kun visning og tekst, ingen økonomiændring.
4. **#6209** omdømme-sortering er forkert, og spillerne spørger "hvilke 7 tæller?". Ejeren lovede en rettelse 3/10. Ret sorteringen og forklar reglen i Hjælp (EN + DA).

Hver PR: template, `Refs #N`, tests grønne, preflight grøn, og en patch note-tekst i PR-bodyen, som ejeren kan godkende. Send en kort status, når hver PR er klar.
