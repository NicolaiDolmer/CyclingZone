**Brief til #1115: Discord DM-regression (permanent rod-årsags-fix)**

**Mål:** Identificer og implementer en permanent rodårsags-fix for Discord DM-regressionen, der forhindrer botten i at sende private beskeder. Inkluder forward-guards for at forhindre fremtidige regressioner.

**Runtime-evidens:**
*   `backend/lib/discordNotifier.js`: Dette er den primære evidensfil. Den identificerer den præcise fejl-søm, env-navne-kompatibilitetsadfærd (`DISCORD_BOT_TOKEN` vs. `DISCORD_TOKEN`), stdout/test-channel routing-modes og logningsadfærd. Specifikt er `getBotToken()` (linje 102-104) og `sendDM()` (linje 188-204) kritiske punkter. `notifyDiscordDM()` (linje 214-252) håndterer routing og opt-out [11].
*   `backend/lib/discordBotTokenCheck.js`: En daglig sikkerhedsnet, der validerer bot-tokenet og alarmerer ved problemer. Relevant for forward-guard/monitorering [12].
*   `backend/cron.js`: Viser, at `runDiscordBotTokenCheck` kaldes, og at auktionsfinalisering passerer `notifyAuctionWon` til den delte finalizer, hvilket indikerer, at auktions-DMs stammer fra cron-drevet baggrundsarbejde [13].

**Invarianters der beskyttes:**
*   Discord DMs leveres pålideligt til brugere, der har valgt at modtage dem.
*   Token-rotation og env-sync-problemer forårsager ikke tavse fejl.
*   Test-konti spammer ikke rigtige managers med DMs.

**Minimal change:**
*   Først, verificer den faktiske fejl (token? scope? `openDm 401`? rate-limit? bruger har DMs slået fra?).
*   Tjek om #1002-guard-cron\\'en kører og alarmerer korrekt.
*   Find rodårsagen til regressionen (token-rotation-drift? Railway-env-sync ude af sync?).
*   Implementer en permanent fix, der adresserer rodårsagen, ikke kun symptomet.
*   Tilføj forward-guards (f.eks. forbedret logning, alarmering) der fanger regressionen FØR brugerne mærker den.

**Verification path:**
*   Test, at Discord DMs sendes korrekt for overbuds- og auktionsnotifikationer.
*   Verificer, at `getBotToken()` korrekt henter tokenet under alle omstændigheder.
*   Bekræft, at `discordBotTokenCheck.js` korrekt detekterer og alarmerer ved token-problemer.
*   Udfør en postmortem i `.claude/learnings/` for at dokumentere rodårsagen og den permanente løsning.
