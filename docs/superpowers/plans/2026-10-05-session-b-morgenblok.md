# Prompt: Session B (Claude Code) - morgenblok: Udvikling 2.0, udgifter, træning, go-kort

Model: **Claude Fable 5.1**, indsats **høj**. Kopiér alt under stregen. Køres EFTER session A er lukket (eller mens ingen motor-bølge kører i en anden session; viser NOW.md en aktiv session, så STOP og spørg).

---

Ny session. Formål: **de ejer-beslutninger og mindre rettelser fra 5/10-listen, som ikke er løbsmotor.** Motoren røres ikke her (det er session A). Sessionens formål er bindende.

Arbejdsform (ejer 5/10): verdensklasse, god fart, token-effektivt. Undersøg før du spørger (ejer-kommentarer på issuet, PR'er, prod). Popup med nøgletal i spørgsmålet, højst 4 ad gangen. Alt ejeren skal handle på eller kopiere, sendes som fil med svaret i billedteksten. Visuelt med ægte data. Aldrig egne tidsskøn. Opdatér roadmap, MASTERPLAN og masterplan-artifacten i samme tur som hver beslutning.

**Læs først:** `docs/NOW.md`, `docs/MASTERPLAN.md` ("Uge 41" og "Ejer-beslutninger").

**0. Codex' fire PR'er fra 5/10 (review på diffen, derefter go-kort ét ad gangen)**
- #6215 sponsor- og præmievisning (#5916 + #5940; spillervendt: ÉT annoteret før/efter-billede før go)
- #6218 omdømme-sortering + Hjælp (#6209; spillervendt)
- #6220 grants-skabelon, audit og CI-vagt (#708, frist 30/10)
- #6222 Vercel build-filter (#6202; historisk replay 48 → 15 builds, reel eftermåling efter merge)
Codex har foreslået patch note-tekst (EN + DA) i hver PR-body. Runner-fejlen er parkeret i #6214.

**1. Udvikling 2.0, kort D1-D7** (#6110, + #4765 svage evner). Spec `docs/superpowers/specs/2026-10-03-udvikling-2-design.md`. Ét kort ad gangen, visuelt. Hvert aftalt kort bygges via `Workflow({name:"wave"})` (kurve B #3564 · løbsdag + rolle #5950 · tilbagegang #6109, klar før S4→S5 · én kurve for AI/frie #6059).

**2. Udgifterne med ejeren:** Vercel Usage, Supabase (staging-branchen på Small ca. 100 kr/md; sæt den ned igen, når Codex har målt), Railway. Issues #6202 (Vercel bygger på hver commit; Codex har sporet) og #6184.

**3. Træning**
- #6053 "vælg rytter først" på Program-fanen: ejeren var ikke glad for den. Find hvad han sagde, vis ét før/efter-billede, få go eller ret.
- Train now bliver i beta, mens #6139 (lås efter træning på telefon) og #6111 (gevinst ikke synlig) rettes. Problem + løsning vises ejeren før byg.
- Skriv et færdigt svar (ejerens stemme, EN) til Discord-tråden "Feedback: New training system". Ejeren poster selv.

**4. Go-kort**
- #5864 udløbne kontrakter: PR #6198 → dry-run → ejeren ser listen LIVE → go.
- #6130 seks hold uden mandat → go.
- #6196 timeouts (PR er DIRTY: synk med main; rører `boardAutoAccept.js`). Hold den op mod målingen 5/10 på #6184.

**5. Supabase-stabilisering (koordinér med Codex, byg ikke selv det, Codex har)**
Codex har sin egen prompt: `docs/superpowers/plans/2026-10-05-naeste-session-codex-stabilitet.md`. Rækkefølgen står i MASTERPLAN og på #6184: liveness-tælling → ranglisteopdatering ved hændelse (#5692) → #3511 → #6102 (PR #6136, ejerens "kør") → Realtime. Staging er klar (#5904, status 5/10). Åbne ejer-valg: regnekraft (#5878), #4269 notifikationskanal.

**6. Resten af uge 41** (MASTERPLAN): #6212 patch notes, #6209, #6210, #4714, Holdarbejde-opfyldning (#5268 A), løfterne #5831 #5917 #5979 #6060, og før S5 (25/10): #6109 #5865 #5842 #5833.
