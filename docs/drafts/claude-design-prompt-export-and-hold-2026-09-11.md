# Claude Design-prompt: eksportér alt ud af Claude Design, og vent med board 03

Skrevet 11/9 2026 kl. 12:45. Handoffet fra artboard 09 er modtaget og gemt i `docs/design/VISUAL_IDENTITY_HANDOFF.md`. Det der mangler, er selve filerne (renderer, SVG-masters, tokens, art bible) og PNG'erne, som stadig kun findes inde i Claude Design. Ejeren: kopiér alt under linjen ind i den samme Claude Design-samtale. Naar den svarer med filer/downloads: gem dem i en mappe paa PC'en (fx `C:\Dev\cz-visual-identity-export\`) og skriv stien som kommentar paa https://github.com/NicolaiDolmer/CyclingZone/issues/5113. Claude Code laegger dem derefter i `docs/design/visual-identity/` og committer.

---

Thank you for the handoff. I have saved it. Now I need everything that currently lives only inside this design project to exist outside it, so a coding assistant can build from it. Do not start board 03 or any new artwork; the owner has six open questions on GitHub issue #5113 to answer first.

Please do these three things, in order, and nothing else:

1. **Export the project files.** Provide, as downloadable files (or a single zip if you can), exactly these: `cz-portrait.js` (the renderer), every file under `handoff/svg/` (the 11 SVG masters), `handoff/tokens.json`, `handoff/ART_BIBLE.md`. If you cannot produce downloads, paste the full contents of `tokens.json` and `ART_BIBLE.md` as plain text blocks, and paste `cz-portrait.js` in full as one code block. For the SVGs, paste each one as its own code block with its filename as the heading.

2. **Export the finished artboards as images.** PNG at 2x for `01-style-exploration`, `02-art-bible` and the helmet section of `08`. Name them `01-style-exploration@2x.png`, `02-art-bible@2x.png`, `08-helmets@2x.png`. If export is not available, say so in one sentence; do not describe the images instead.

3. **Write a short README block** (plain text, copyable) that lists every exported file with one line each on what it is and which artboard it belongs to, plus the canvas share link. End with the sentence "All files exported; nothing new was drawn."

Then stop and wait. When the owner has answered the six questions on #5113, the next message will say which board to continue with.
