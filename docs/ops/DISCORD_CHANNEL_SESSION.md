# Discord-kanal-session (ejerens direkte linje til Claude)

Kanal: `#build-a-feature`, id `1566509233023750235` (guild `1504615050831466669`).
Bot: "Cycling Zone#8784" (id `1500376268825301033`). Ejerens Discord-id: `328608731585839107`.
Opsat 1/11-2026 på NICOLAIPC i hovedsessionen "Natsession 1-2/11" (transcript `f7ecfa33-…`). Dokumenteret 2/11 ud fra transcripts.

## access.json

`~/.claude/channels/discord/access.json` findes **ikke** på NICOLAIPC, og mappen `~/.claude/channels/` findes heller ikke. Der er intet `claude --channels plugin:discord…`-kald i nogen transcript. Kanal-sessionen 1/11 brugte altså ikke Claude Code channels-pluginet, men et lille poll-script (nedenfor). Der er derfor intet access.json-indhold at gengive. Skal kanalen køres via channels-pluginet fremover, er det en ny opsætning.

## Sådan startede den

Ingen særskilt startkommando. Ejeren skrev midt i hovedsessionen (1/11 kl. 18.50):

> Har du mulighed for at tale med mig, inde i denne discord kanal med vores cycling zone bot? 1566509233023750235

Svar på opfølgningsspørgsmålet: "Kan vi opsætte det sådan derinde, og kun i den kanal, at du kan besvare mig proaktivt?"

Claude skrev så `dolmer-channel.mjs` i sessionens scratchpad og kørte det med bot-tokenet fra Infisical:

```bash
# send en tekst (deles i bidder på max 1900 tegn)
infisical run --env=dev --silent -- node dolmer-channel.mjs send msg.txt
# send ét billede med valgfri tekst
infisical run --env=dev --silent -- node dolmer-channel.mjs sendfile billede.png caption.txt
# lyt: poll hvert 15. s, afslut med JSON når ejeren skriver (kørt som baggrunds-Bash, timeout 10 t)
infisical run --env=dev --silent -- node dolmer-channel.mjs watch <sidste-besked-id>
```

Scriptet (Discord REST v10, `Authorization: Bot <token>`; tokenet læses fra `DISCORD_TOKEN`/`DISCORD_BOT_TOKEN` og printes aldrig):

- `watch [sinceId]`: henter `/channels/<id>/messages?after=<sinceId>`, filtrerer på ejerens id, printer `{lastId, messages:[{id, at, text, attachments}]}` og afslutter. Sessionen bliver vækket af baggrunds-notifikationen, svarer og starter `watch` igen med `lastId`.
- `send <fil>`: POST med `allowed_mentions: { parse: [] }`, så botten aldrig pinger nogen.
- `sendfile <billede> [tekstfil]`: multipart-upload (`payload_json` + `files[0]`).
- Kanalen kan overstyres med env `CZ_CHANNEL` (tilføjet 1/11, da Claude skulle svare i en anden tråd).

Læsning af andre kanaler skete med Discord MCP (`discord_read_messages`), som kun kan læse.

**Kendt fejl 1/11:** Lytteren blev en gang startet fra et forkert besked-id, og tre beskeder (19.21-19.27) blev overset. Start altid `watch` med `lastId` fra seneste output.

## Regler den fik (ejer 1/11)

1. Kun denne kanal. Ingen andre kanaler, ingen spillerkommunikation via botten.
2. Claude må svare proaktivt dér, når ejeren skriver.
3. Svar KUN på det, der bliver spurgt om i kanalen. Ingen statuskort og intet om andet igangværende arbejde, medmindre det er relevant for netop den Discord-samtale (ejer-citat: "Igangværende arbejde skal kun nævnes, hvis det er relevant i forhold til det der skrives om i discord samtalen").
4. Sprog: dansk til ejeren. Spillertekst skrives først på EN, navnet i spillertekst er "Dolmer", tone efter `docs/TONE_OF_VOICE.md`.
5. "Bygger intet": byggestop (#7336) gælder. Wireframes er designforslag til diskussion; ingen produktionskode, ingen PR ud fra kanalen.
6. Ingen balance-tal i offentlige tekster. Fjern personfølsomme ting fra skærmbilleder, før de deles.
7. Beslutninger stilles én ad gangen.
8. **Aldrig GitHub-links** (issues, PR'er, repo) i kanalen. Skriv "gemt som issue" i ord (ejer 2/11).
9. Wireframes er **på engelsk** og følger designsystemet: 5px radius, firkantede badges, ingen runde piller (ejer 2/11).
10. Spillertekst følger ejerens stemme: jeg-form ("I", aldrig "we"), korte linjer, "Hep!" som åbning i opslag (se roadbook-udkastene i `docs/drafts/`).
11. Når ejeren sender et Codex-spørgsmål: giv svaret som en kodeblok, der kan kopieres direkte. Svaret gives i Claude-sessionen, ikke i Discord, og der henvises aldrig til et tidligere svar.

Reglerne ligger også i Claudes memory (`reference_owner_discord_channel.md`), men den er kun en cache. Denne fil er kilden.

## Wireframe-metode

1. Læs tråden (Discord MCP `discord_read_messages` eller `dump-channel.mjs <kanal> <antal>`).
2. Skriv en selvstændig HTML-fil i sessionens scratchpad (fx `wireframes.html`, `train-*.html`) med inline CSS i Cycling Zone-stil: hairline-borders, 5px radius, tabular figures, stroke-ikoner (aldrig emoji), én gold primary-knap, jf. `docs/design/PAGE_TEMPLATES.md` og `docs/design/TASTE.md`. Hver wireframe er et element med eget id (`#w1`, `#w2` …).
3. Rigtig holddata hentes read-only fra prod via Supabase MCP. Slå kolonnenavne op i `database/schema-snapshot.json` først (`riders`: `firstname`/`lastname`/`birthdate`).
4. Render til PNG med Playwright fra `frontend/node_modules`, skala 2:

   ```js
   import { chromium } from 'file:///C:/dev/CyclingZone/frontend/node_modules/playwright/index.mjs';
   const b = await chromium.launch();
   const p = await b.newPage({ viewport: { width: 900, height: 900 }, deviceScaleFactor: 2 });
   await p.goto('file:///' + html);
   await p.locator('#w').screenshot({ path: out });
   await b.close();
   ```

   (`shot-one.mjs` = ét element; `shot-ids.mjs`/`shot-sections.mjs` = flere id'er i én kørsel.)
5. Se selv billedet (Read) før det sendes.
6. Vedhæft i kanalen med `dolmer-channel.mjs sendfile <png> <caption.txt>`, ét billede pr. besked med kort dansk caption.
7. Gem kopier i `docs/drafts/local/<issue>/` (lokal, ikke committet) eller OneDrive, og læg en kort spec som kommentar på issuet (fx #7456).

Side-sessionen "Discord-kanal: 2 wireframes med rigtig holddata (JeppeK)" (1/11 kl. 22.45) brugte samme metode (`gen.mjs` → HTML → `shot.cjs` med Playwright, 1280×800, skala 2), men kunne kun læse Discord og gav derfor billederne til ejeren med SendUserFile plus et EN-opslagsudkast.

## Status 2/11

Ingen lytter kører på NICOLAIPC (ingen `dolmer-channel`- eller `--channels`-proces), og ingen af de to sessioner har en aktiv tur. Botten svarer derfor ikke i kanalen, før en session starter `watch` igen.

## DolmerPC 2/11 (aften)

Kørte samme poll-script uden Infisical: User env var `DISCORD_TOKEN` (sat af `scripts/setup-discord-mcp.ps1`) er nok, `node dolmer-channel.mjs …` direkte. Lytteren kørt som baggrunds-Bash og startet igen fra `lastId` efter hvert svar. Kendt: `node` kan afslutte med exit 127 (`UV_HANDLE_CLOSING`-assertion) efter `process.exit`; outputtet er korrekt, bare start igen. Discord-pluginet (`--channels`) blev ikke brugt; Bun er installeret på DolmerPC, men pluginet står fortsat slået fra.

Resultater: #7533 (PR #7534), design #7535 (spec `docs/superpowers/specs/2026-11-02-planning-workbench-design.md`, prototype https://claude.ai/artifact/4tEvfHZmh3r2NM2iX1p2SY), #7536, #7537. Billeder og prototype i OneDrive `CyclingZone-context/design/2026-11-02-planning-workbench/`. Lytteren stoppet ved sessionens afslutning.
