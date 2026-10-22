# Startprompt 23/10: primær session (PC1, Claude Code)

Samlet fra to overleveringer 22/10: "Claude Code prioritering" (`docs/sessions/2026-10-22-handoff.md`) og "Dynamisk workflow-session" (#7029, #7039, drejebogen, MASTERPLAN 22/10). Ejeren lukker begge sessioner. Alt state ligger i GitHub; private tal i `balance-internals/` (+ OneDrive `CyclingZone-context/balance-internals/`).

```
Du er den primære session for CyclingZone (PC1). Du styrer alt og følger påbegyndt arbejde til dørs.
Læs først: docs/NOW.md, docs/sessions/2026-10-22-handoff.md, docs/MASTERPLAN.md og docs/runbooks/2026-10-25-s4-s5-drejebog.md.
Udskyd intet uden aftale med ejeren. Rækkefølge = MASTERPLAN, "dato først".

1. MERGE-KØ (én proces, scripts/merge-queue.ps1):
   - #6820 motor v2: ejerens ordrette "tænd" er givet 22/10. Skal være deployet før første S5-etape 28/10 kl. 11; tjek bagefter read-only, at nye løb binder til s5_profiles_v2.
   - #6988 form/træthed 2.0 (ejer "merge" 21/10; condition_model_v2 forbliver slukket).
   - #7011 S5-mail (preheader-go 22/10; send ingen mails uden ejeren).
   - #7012 (ops, ved grøn CI) · #7021 formtest efter v2 · #7026 (#7008) med v2.
   - Railway er Hobby, og builds er pauset (#7029). Plan: vent til lørdag aften → skift kilde til GHCR-image (#7034, ejer-go på skiftet) → ellers Pro i én måned. Verificér Node 24.22.1 i første build.

2. S5-SKIFTET 25/10 ca. kl. 20:30 (drejebogen):
   - 23/10 prøvekørsler: aldring #6499, afventer oprykning #6710 (+ hjælpetekst PR #7036 samme dag som flaget), server-test #5904.
   - Byg #7031 (ingen ungdomsklassement i U23/junior) før 28/10.
   - Ungdom søndag efter parkering: regroup → kalender U23 → junior → transition → løft (prøvekørsel 22/10: 6+6 grupper à 24). De korte ungdomsgrupper C-E skyldes #7039 og genopbygges af regroup; ingen anden handling.
   - Formtoppe #6156: ejer 22/10: tændes ved skiftet på ordret "tænd", efter transitionen og før 28/10 kl. 11, når formtesten (#7021) og v2-testporten er grønne.
   - Patch note 25/10 (EN først, DA under, kort, TONE_OF_VOICE): akademiets Scouting-fane (#6987), mobilmenu (#7010), motor v2, S5-ruter/identitet.

3. SIKKERHED (#7029): ingen nøgleændringer fre-søn. Efter 25/10: backend på de nye nøgler → GitHub/Vercel → tilbagekald gamle nøgler + slå legacy JWT fra · Resend, Discord, VAPID.

4. DEREFTER: løbsfilm-pakken samlet (#6814 + #6803 + #6512) · motor v3 #6804 (#7013, #7016; mål ca. 31/10-2/11) · Udvikling 2.0 · #7022 punkt 2 (teknisk) · fairplay-kort til ejeren mandag 26/10 (#5203).

ARBEJDSFORM:
- Ét spørgsmål ad gangen via AskUserQuestion, med din anbefaling og et billede, når det handler om noget visuelt eller spillervendt.
- Byggearbejde kører som bølge via .claude/workflows/wave.js med højst 3 spor. Codex kører på DolmerPC (ejeren starter den) og rører ikke merge-kø, S5, motor v2 eller nøgler.
- Auto-fix slået fra. Maks. 2 Codex-runder pr. PR; derefter bliver P2/P3 et opfølger-issue. Svar ikke på rutine-CI-beskeder.
- Prod-skrivninger kun på ejerens ordrette "kør". Done-flip ved hvert merge. Opdatér MASTERPLAN og NOW.md ved hvert merge.
- Arkivér en sidesession først, når dens PR er merget OG dens private filer er flyttet til hovedmappens balance-internals/. Arkivering sletter sessionens worktree.
- Ejerens egne opgaver (påmind, gør dem ikke): post S5-opslaget og Discord-svarene (docs/drafts/), afskriv Alunta-faktura 7534, ejer-mail #7041.
```

## Codex (DolmerPC)

```
Genstart Codex-bølgen: node scripts/codex-wave.mjs docs/drafts/wave-2026-10-21-codex.json --run (rettelsen #7028 er merget). Rør ikke merge-køen, S5-skiftet, motor v2 eller nøgler; dem ejer den primære session på PC1. Hver track ender som en draft-PR med "Refs #N". Maks. 2 review-runder pr. PR.
```
