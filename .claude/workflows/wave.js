// .claude/workflows/wave.js
// ============================================================
// EEN INDGANG til parallelt byggearbejde (orkestrator-standard v2, ejer 11/9,
// #5142). Kaldes med Workflow({ name: "wave", args: { tracks: [...] } }).
//
// FEJLKLASSEN: reglerne fandtes allerede - maks 3 samtidige workers (2/9),
// TIER WAVE (6/9), fire spoergsmaal foer spawn (25/8), brief-generatoren (7/9) -
// og blev brudt igen 11/9, da orkestratoren startede 9 haandskrevne subagenter.
// CPU laa paa 100 % i timevis og ejeren maatte spoerge to gange hvad der foregik.
// Rod-aarsagen var ikke uvidenhed: reglerne laa i docs og hukommelse i stedet
// for i den handling der starter arbejdet. Dette script ER den handling.
//
// Standarden (ejer 11/9, DOLMERPC: 8 kerner, 32 GB, dedikeret til Claude Code):
//   - 4 laner, eet uniformt loft hele doegnet (ikke "faerre om dagen").
//   - Maks 2 tunge verifikationer ad gangen paa tvaers af alle worktrees
//     (scripts/verify-lock.ps1; brief'en tvinger workers igennem den).
//   - Livstegn: draft-PR inden 30 min, push hvert 15. min, spor-vindue 120 min
//     (haardt loft 180) maalt paa BRANCH-aktivitet, recovery i SAMME worktree
//     (aldrig reset). Se punkt 1 herunder.
//   - Maks 8 aabne PR'er, tjekket og reserveret af wave-policy.mjs i hooken.
//   - Sidste fase rydder op og fjerner .claude/run/wave-active.json.
//
// args:
//   {
//     tracks: [                       // paakraevet, 1-12 spor
//       {
//         issue: 5143,                // GitHub-issue-nummer
//         branch: "chore/5143-xyz",   // branch (worktree-slug udledes af den)
//         title: "[ops] ...",         // issue-titel (til brief + rapport)
//         scopeText: "...",           // hvad lanen skal loese
//         model: "sonnet",            // 'opus' | 'sonnet' - saettes EKSPLICIT
//         tier: "TARGETED",           // 'TARGETED' | 'FULL' (maks een FULL)
//         ownership: ["scripts/x.ps1"],
//         verifyCommands: ["node --test scripts/x.test.mjs"],
//         ownNodeModules: false       // true = lanen maa selv npm-installere
//       }
//     ],
//     dryRun: false,                  // true = print planen, spawn intet
//     cleanup: "dry-run",             // 'dry-run' (default) | 'execute'
//     allowExistingPr: false,         // true = koer spor der allerede har en aaben PR
//     expiresInMinutes: 240,          // levetid paa wave-active.json
//     lanes: 4,                       // override af lane-loftet (brug sjaeldent)
//     trackTimeoutMinutes: 120        // foerste spor-vindue (klemmes til 10-180)
//   }
//
// FEM VALG DER IKKE ER OPLAGTE:
//
// 1. FRYS MAALES PAA BRANCHEN, IKKE PAA TAVSHED (#5178, postmortem
//    .claude/learnings/2026-09-11-wave-timeout-er-ikke-frys.md). Indtil 13/9
//    var frys-signalet alene "ingen agent-svar inden for 60 min". Begge boelger
//    11/9 stoppede derfor paa LEVENDE spor: #4845 havde committet 12 min foer
//    stoppet, #5159 seks minutter foer. Nu er vinduet 120 min (haardt loft
//    180), og naar det loeber ud, MAALES branchen af en lille read-only
//    probe-agent foer der doemmes:
//      commit < 45 min gammel  -> sporet lever, vinduet forlaenges
//      commit >= 45 min gammel -> frys
//      branchen kan ikke maales -> frys (konservativt, se punkt 2)
//    Reglen som ren, testet kode: scripts/wave-freeze.mjs (+ .test.mjs).
//    Konstanterne herunder er en SPEJLING af den fil - workflow-scripts kan
//    ikke importere, og en test i wave-freeze.test.mjs fejler hvis de drifter.
//
// 2. FRYS STOPPER BOELGEN (jf. .claude/learnings/
//    2026-09-06-frozen-workflow-agents-hold-concurrency-slots.md). En timeout
//    AFBRYDER ikke agenten: den frosne holder stadig sin plads i workflowets
//    samtidigheds-loft. Traekker de oevrige laner nye spor ind, koerer boelgen
//    videre med usynligt reduceret kapacitet - 5-6/9 koerte bolge A reelt paa
//    2 laner fra 01:12 til 03:50 uden at det kunne ses i /workflows. Derfor:
//    ved foerste bekraeftede frys stopper boelgen, og alle spor der ikke naaede
//    at starte rapporteres som "unstarted" til relancering i en ny, ren boelge.
//    Det koster to agenters kontekst og giver fuld kapacitet igen paa minutter.
//    MODSAT: rammer et spor det haarde loft med en LEVENDE branch, er det ikke
//    et frys - sporet er bare stort. Det stoppes, boelgen koerer videre.
//
// 3. FRYS EFTERLADER ALDRIG ET DIRTY WORKTREE. Boelge 2 den 11/9 efterlod
//    ucommittet arbejde i to worktrees (5 + 2 filer), som ingen opdagede foer
//    naeste dag. Ved et frys (eller en agent der doede tavst) koeres derfor en
//    kort WAVE-FOLLOWUP-agent i SAMME worktree, der committer WIP bag guarden
//    og pusher. Den springes over i to tilfaelde: naar proben har set et rent
//    OG pushet worktree, og ved 'hard-cap'. Det sidste er vigtigt - dér lever
//    branchen, saa agenten kan stadig skrive i worktreet (en timeout afbryder
//    den ikke). To agenter der committer samme sted ville slaas om index.lock
//    og kunne commite halvskrevne filer. Sporet raabes i stedet op i loggen og
//    i rapportens `stopped`, og LANEN LUKKES: den gamle agent holder stadig
//    sin plads i samtidigheds-loftet, saa lanen maa ikke traekke et nyt spor.
//
// 4. ALLE UBEHANDLEDE SPOR RAPPORTERES. Hvert spor ender i praecis een af:
//    results (koert), skipped (ikke klar efter fase 0) eller unstarted (naaede
//    aldrig en lane). Ingen spor kan forsvinde tavst ud af koen.
//
// 5. Cleanup er altid scoped til eget waveId og registrerede lane-watch.
//    cleanup-argumentet beholdes til kompatibilitet; global proces-/worktree-
//    oprydning koeres aldrig fra boelgen (#5467).
//
// RESUME: lane-poolens raekkefoelge er IKKE deterministisk (hvilken lane der
// tager hvilket spor afhaenger af timing), saa Workflow({ resumeFromRunId })
// kan gen-spawne spor der allerede er faerdige. Derfor tjekker fase 0
// `gh pr list --head <branch>` og springer spor med en aaben PR over
// (skipped: "existing-pr"). Skal et spor med aaben PR alligevel koeres - fx et
// genoptaget spor hvis PR blev oprettet som draft foer frysningen - saettes
// args.allowExistingPr = true.
//
// BEMAERK om fase 0: Workflow-scripts har hverken filsystem- eller
// Node-API-adgang (og ingen Date.now()). Alt der skal roere disken - skrive
// wave-active.json, oprette worktrees, generere briefs, starte lane-watch -
// gaar derfor gennem en lille WAVE-SETUP-agent. Det er ikke en omvej: det er
// den eneste maade scriptet kan udfoere fase 0 paa, og det holder samtidig
// tidsstempling der hvor uret faktisk findes.
//
// 6. FIRE REGLER TILFOEJET 14-15/9 (#5220): (a) 'investigate'-spor faar et
//    fast, ikke-forlaengeligt 60-min-vindue og skal levere en af to domme
//    ("bekraeftet + fix-plan" / "afvist + bevis-test") - se
//    runInvestigateTrack + investigateBlok. (b) Maks EEN CodeRabbit CLI-runde
//    pr. spor (skrevet i briefen). (c) Blandet koe: sortMixedQueue() stiller
//    lette spor (sonnet+TARGETED) forrest, stabilt, saa hver lane med stor
//    sandsynlighed starter paa et let spor foer et tungt. (d) Livstegn-prik:
//    wave-lane-watch.ps1 sender en besked (IKKE frys) ved 15 min uden commit.
//
// Refs #5142, #5178, #4918, #4919, #4920, #4924, #5220.

export const meta = {
  name: 'wave',
  description: 'Boelge: 4 laner, verifikations-semafor 2, livstegn, reviewer pr. spor, oprydning (#5142)',
  whenToUse: 'Naar 2+ uafhaengige issues skal bygges parallelt. Eneste godkendte indgang til parallelt byggearbejde - haandskrevne Agent-spawns er blokeret af scripts/hooks/guard-agent-spawn.sh mens en boelge koerer.',
  phases: [
    { title: 'Fase 0 - opsaetning', detail: 'wave-active.json, worktrees, briefs, lane-watch' },
    { title: 'Laner', detail: '4 laner over koen, spor-vindue 120 min (loft 180), frys maalt paa branch-aktivitet' },
    { title: 'Review', detail: 'read-only reviewer pr. spor (30 min, eet gen-spawn) + ret-trin ved BLOKERENDE' },
    { title: 'Oprydning', detail: 'stop lane-watch, fjern wave-active.json, prune mergede worktrees' },
  ],
}

// ---------------------------------------------------------------- konstanter
const DEFAULT_LANES = 4
const MAX_TRACKS = 12

// SPEJLING af scripts/wave-freeze.mjs (#5178). Workflow-scripts kan ikke
// importere, saa vaerdierne staar to steder; drift-vagten
// `node --test scripts/wave-freeze.test.mjs` laeser DENNE fil og fejler hvis
// et af tallene ikke matcher modulet. Ret aldrig et tal her uden at rette det
// samme sted i modulet.
const WAVE_FREEZE = {
  TRACK_TIMEOUT_MINUTES: 120,
  TRACK_HARD_CAP_MINUTES: 180,
  TRACK_MIN_TIMEOUT_MINUTES: 10,
  BRANCH_STALL_MINUTES: 45,
  MIN_EXTENSION_MINUTES: 5,
  REVIEW_TIMEOUT_MINUTES: 30,
  REVIEW_MAX_ATTEMPTS: 2,
  PROBE_TIMEOUT_MINUTES: 5,
  STOP_TIMEOUT_MINUTES: 15,
  INVESTIGATE_TIMEOUT_MINUTES: 60,
  POKE_MINUTES: 15,
}
const FIX_TIMEOUT_MS = WAVE_FREEZE.REVIEW_TIMEOUT_MINUTES * 60 * 1000
const REPO = 'NicolaiDolmer/CyclingZone'
const MAIN_CHECKOUT = 'C:\\Dev\\CyclingZone'
const WORKTREES_ROOT = 'C:\\Dev\\CyclingZone-worktrees'
const SCRATCH_ROOT = WORKTREES_ROOT + '\\.wave-scratch'
const TIMED_OUT = Symbol('timeout')

const SETUP_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    watchPid: { type: 'string', description: 'PID paa wave-lane-watch.ps1, eller "none"' },
    activeFile: { type: 'string' },
    waveId: { type: 'string' },
    lanes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          branch: { type: 'string' },
          worktree: { type: 'string' },
          briefPath: { type: 'string' },
          ready: { type: 'boolean' },
          openPr: { type: 'string', description: 'PR-nummer paa en AABEN PR for branchen, ellers "ingen"' },
          note: { type: 'string' },
        },
        required: ['branch', 'ready'],
      },
    },
    problems: { type: 'array', items: { type: 'string' } },
  },
  required: ['ok', 'lanes'],
}

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['GODKENDT', 'BEMAERKNINGER', 'BLOKERENDE'] },
    pr: { type: 'string', description: 'PR-nummer eller -URL, eller "ingen"' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['blokerende', 'bemaerkning'] },
          file: { type: 'string' },
          what: { type: 'string' },
        },
        required: ['severity', 'what'],
      },
    },
    summary: { type: 'string' },
  },
  required: ['verdict', 'summary'],
}

// Proben er read-only og maaler branchen i worktreet. Alle felter er
// paakraevede: en probe der "glemmer" lastCommitAgeMinutes maa give et
// eksplicit ok=false, ikke et hul der laeses som en frisk branch.
const PROBE_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean', description: 'false hvis git-kaldene fejlede - saa doemmes der konservativt' },
    verdict: { type: 'string', enum: ['frozen', 'extend', 'hard-cap', 'ukendt'] },
    reason: { type: 'string' },
    extendMinutes: { type: 'number' },
    lastCommitAgeMinutes: { type: 'number', description: '-1 hvis den ikke kunne maales' },
    dirty: { type: 'boolean' },
    unpushed: { type: 'number' },
    note: { type: 'string' },
  },
  required: ['ok', 'verdict', 'lastCommitAgeMinutes', 'dirty'],
}

const STOP_SCHEMA = {
  type: 'object',
  properties: {
    committed: { type: 'boolean' },
    pushed: { type: 'boolean' },
    sha: { type: 'string' },
    stillDirty: { type: 'boolean' },
    note: { type: 'string' },
  },
  required: ['committed', 'pushed'],
}

const CLEANUP_SCHEMA = {
  type: 'object',
  properties: {
    activeFileRemoved: { type: 'boolean' },
    watchStopped: { type: 'boolean' },
    prunedWorktrees: { type: 'array', items: { type: 'string' } },
    prunedBranches: { type: 'array', items: { type: 'string' } },
    notes: { type: 'array', items: { type: 'string' } },
  },
  required: ['activeFileRemoved'],
}

// ---------------------------------------------------------------- hjaelpere
function slugOf(branch) {
  return String(branch).replace(/[\\/]/g, '-')
}

function normalizeTrack(raw, index) {
  if (!raw || typeof raw !== 'object') throw new Error(`wave: spor ${index} er ikke et objekt`)
  const issue = raw.issue
  const branch = raw.branch
  if (!issue) throw new Error(`wave: spor ${index} mangler "issue"`)
  if (!branch) throw new Error(`wave: spor ${index} (#${issue}) mangler "branch"`)
  const model = raw.model || 'sonnet'
  if (model !== 'opus' && model !== 'sonnet') {
    throw new Error(`wave: spor #${issue} har ugyldig model "${model}" (brug 'opus' eller 'sonnet')`)
  }
  const slug = slugOf(branch)
  return {
    issue,
    branch,
    slug,
    title: raw.title || `issue #${issue}`,
    scopeText: raw.scopeText || '',
    model,
    // #5220: 'investigate' er et undersoegelsesspor - intet build, fast
    // 60-min-vindue, ingen review/fix-trin (se runInvestigateTrack).
    kind: raw.kind === 'investigate' ? 'investigate' : 'build',
    tier: raw.tier === 'FULL' ? 'FULL' : 'TARGETED',
    ownership: Array.isArray(raw.ownership) ? raw.ownership : [],
    verifyCommands: Array.isArray(raw.verifyCommands) ? raw.verifyCommands : [],
    ownNodeModules: raw.ownNodeModules === true,
    worktree: `${WORKTREES_ROOT}\\${slug}`,
    scratch: `${SCRATCH_ROOT}\\${slug}`,
    briefPath: `${SCRATCH_ROOT}\\${slug}\\brief-${slug}.md`,
    configPath: `${SCRATCH_ROOT}\\${slug}\\brief-${slug}.json`,
  }
}

// SPEJLING af classifyStall() i scripts/wave-freeze.mjs - hold dem identiske.
// Bruges kun som fallback naar probe-agenten leverede raa tal men ikke selv
// naaede at koere `node scripts/wave-freeze.mjs`.
function classifyStall(p) {
  const stall = WAVE_FREEZE.BRANCH_STALL_MINUTES
  const hardCap = WAVE_FREEZE.TRACK_HARD_CAP_MINUTES
  const elapsed = Number((p && p.elapsedMinutes) || 0)
  const age = p && p.lastCommitAgeMinutes
  const ageOk = age !== null && age !== undefined && age !== '' && Number.isFinite(Number(age)) && Number(age) >= 0
  if (!p || p.probeOk !== true || !ageOk) {
    return { verdict: 'frozen', reason: 'probe-failed', extendMinutes: 0, stopsWave: true }
  }
  const ageMin = Number(age)
  if (ageMin >= stall) {
    return { verdict: 'frozen', reason: 'branch-stall', extendMinutes: 0, stopsWave: true }
  }
  const remaining = hardCap - elapsed
  if (remaining <= 0) {
    return { verdict: 'hard-cap', reason: 'hard-cap-reached', extendMinutes: 0, stopsWave: false }
  }
  const wanted = Math.max(stall - ageMin, WAVE_FREEZE.MIN_EXTENSION_MINUTES)
  return {
    verdict: 'extend',
    reason: 'branch-active',
    extendMinutes: Math.round(Math.min(wanted, remaining) * 10) / 10,
    stopsWave: false,
  }
}

// SPEJLING af planReviewAttempt() i scripts/wave-freeze.mjs.
function planReviewAttempt(attempt) {
  const n = Math.max(1, Math.round(Number(attempt) || 1))
  return {
    attempt: n,
    timeoutMinutes: WAVE_FREEZE.REVIEW_TIMEOUT_MINUTES,
    respawn: n < WAVE_FREEZE.REVIEW_MAX_ATTEMPTS,
    final: n >= WAVE_FREEZE.REVIEW_MAX_ATTEMPTS,
  }
}

// SPEJLING af needsGracefulStop() i scripts/wave-freeze.mjs.
// 'hard-cap' undtages: dér lever branchen, saa lane-agenten arbejder stadig i
// worktreet (en timeout afbryder ikke agenten). To agenter der committer samme
// sted giver index.lock-kamp og halvskrevne WIP-commits.
function needsGracefulStop(p) {
  if (!p) return true
  if (p.verdict === 'hard-cap') return false
  if (p.probeOk !== true) return true
  if (p.dirty === true) return true
  // Et umaaleligt tal (-1, NaN, mangler) er IKKE "nul upushede" - en branch
  // uden upstream har hele sit arbejde liggende lokalt.
  const raw = p.unpushed
  if (raw === null || raw === undefined || raw === '') return true
  const unpushed = Number(raw)
  return !Number.isFinite(unpushed) || unpushed !== 0
}

// SPEJLING af resolveTrackTimeoutMinutes() i scripts/wave-freeze.mjs.
function resolveTrackTimeoutMinutes(requested) {
  const n = Number(requested)
  if (!Number.isFinite(n) || n <= 0) return WAVE_FREEZE.TRACK_TIMEOUT_MINUTES
  return Math.min(
    WAVE_FREEZE.TRACK_HARD_CAP_MINUTES,
    Math.max(WAVE_FREEZE.TRACK_MIN_TIMEOUT_MINUTES, Math.round(n)),
  )
}

// SPEJLING af isLightTrack()/sortMixedQueue() i scripts/wave-freeze.mjs - hold
// dem identiske (#5220, "blandet koe"). Stiller lette spor (sonnet+TARGETED)
// forrest i koen, stabilt, saa hver af de 4 laner med stor sandsynlighed
// starter paa et let spor foer et tungt - uden det kunne koeen tilfaeldigvis
// starte med 4 tunge spor paa een gang og goere verifikations-semaforen
// (maks 2 tunge koersler) til flaskehalsen fra minut eet.
function isLightTrack(t) {
  return Boolean(t) && t.model === 'sonnet' && t.tier === 'TARGETED'
}
function sortMixedQueue(list) {
  return (Array.isArray(list) ? list : [])
    .map((t, i) => ({ t, i, light: isLightTrack(t) ? 0 : 1 }))
    .sort((a, b) => a.light - b.light || a.i - b.i)
    .map((x) => x.t)
}

// SPEJLING af extractInvestigateVerdict() i scripts/wave-freeze.mjs - hold
// identiske (#5220, CodeRabbit-fund: enhver rapport blev foer accepteret
// ubetinget som en gyldig undersoegelse - selv "ved ikke"). Returnerer
// 'bekraeftet'|'afvist'|null (null = ufuldstaendig aflevering, ALDRIG en
// gaettet dom - hverken ingen af de to fraser eller begge paa een gang).
function extractInvestigateVerdict(reportText) {
  const text = String(reportText || '')
  const hasConfirmed = /bekraeftet\s*\+\s*fix-plan/i.test(text)
  const hasRejected = /afvist\s*\+\s*bevis-test/i.test(text)
  if (hasConfirmed && !hasRejected) return 'bekraeftet'
  if (hasRejected && !hasConfirmed) return 'afvist'
  return null
}

// Per-spor-timeout. VIGTIGT (natboelgen 5-6/9): en timeout frigiver IKKE lanen
// hos den frosne agent - den frosne holder sin plads i samtidigheds-loftet.
// Timeouten er en oevre graense paa hvor laenge lane-poolen VENTER paa et spor,
// ikke en garanti for at ressourcen er tilbage. Derfor MAALES branchen (#5178)
// foer et udloebet vindue doemmes som frys.
function withTimeout(promise, ms, label) {
  let timer = null
  return Promise.race([
    promise,
    new Promise((resolve) => { timer = setTimeout(() => resolve(TIMED_OUT), ms) }),
  ]).then((r) => {
    if (r === TIMED_OUT) log(`TIMEOUT efter ${Math.round(ms / 60000)} min: ${label}`)
    return r
  }).finally(() => {
    // Ryd timeren ogsaa naar lanen blev faerdig foerst (og ogsaa hvis den
    // afviste): ellers holder en to-timers timer scriptet i live efter at
    // alt arbejde er slut.
    if (timer !== null) clearTimeout(timer)
  })
}

// #5220: tvungen aflevering for undersoegelsesspor - staar ORDRET her, saa den
// ikke kan mangle hverken i den fil-genererede brief (scripts/make-wave-brief.mjs)
// eller i dette scripts inline-fallback, hvis brief-filen ikke kunne laeses.
function investigateBlok(track) {
  return [
    `Dette er et UNDERSOEGELSESSPOR (kind: investigate, #5220), ikke et byggespor:`,
    `fast vindue paa ${WAVE_FREEZE.INVESTIGATE_TIMEOUT_MINUTES} min - IKKE forlaengeligt, ingen frys-probe (der er maaske slet ingen commits at maale paa).`,
    'Din slutrapport SKAL ende med PRAECIS EEN af disse to domme, ordret:',
    '- "bekraeftet + fix-plan": problemet er reproduceret/bekraeftet, med en konkret plan for rettelsen (trin, filer, risiko).',
    '- "afvist + bevis-test": problemet kunne IKKE bekraeftes, med beviset vedlagt - en test, et logudsnit, eller en konkret reproduktion du proevede og som IKKE fejlede.',
    'Lever ALDRIG et tredje svar ("ved ikke", "maaske") - vaelg den dom bevisernevet peger paa.',
  ].join('\n')
}

function laneBrief(track) {
  // Briefen ligger som fil (genereret af scripts/make-wave-brief.mjs), saa de
  // bindende blokke kommer fra EEN kilde og ikke kan drifte fra dette script.
  // De faa gates der ALDRIG maa mangle staar alligevel her, saa en lane ikke
  // staar helt uden regler hvis fil-laesningen fejler.
  //
  // CodeRabbit (denne PR): et investigate-spor bygger intet - de generelle
  // build-gates (commit-guard, draft-PR, CodeRabbit-CLI, Refs-i-PR-body) er
  // ALLE meningsloese og selvmodsigende her ("bygger intet" men faar besked
  // om commit-guarden). Egen, trimmet gren i stedet for at genbruge byggeteksten.
  if (track.kind === 'investigate') {
    return [
      `WAVE-LANE: #${track.issue} ${track.branch} (undersoegelsesspor, kind: investigate, #5220)`,
      '',
      'Du er en autonom boelge-worker uden kontekst fra mor-samtalen.',
      '',
      `FOERSTE HANDLING: laes HELE din brief: ${track.briefPath}`,
      'Den er din fulde kontrakt. Foelg den ordret. Kan du ikke laese den, saa STOP og rapporter det - gaet ikke.',
      '',
      'Dette spor bygger INTET: intet commit, ingen push, ingen PR. Gates der gaelder uanset hvad:',
      `- Arbejdsmappe (kun til at LAESE/reproducere i, aendr intet): ${track.worktree}.`,
      '- INGEN baggrundsjob, alt i FORGRUNDEN, ingen under-agenter.',
      `- Fast vindue paa ${WAVE_FREEZE.INVESTIGATE_TIMEOUT_MINUTES} min - IKKE forlaengeligt.`,
      '',
      `Issue: #${track.issue} - ${track.title}`,
      track.scopeText ? `Scope: ${track.scopeText}` : '',
      '',
      investigateBlok(track),
      '',
      'Slutrapport (kort, dansk): hvad du undersoegte og hvordan. Din SIDSTE saetning SKAL vaere PRAECIS en af de to domme ovenfor - intet commit, ingen PR.',
    ].filter(Boolean).join('\n')
  }

  return [
    `WAVE-LANE: #${track.issue} ${track.branch}`,
    '',
    'Du er en autonom boelge-worker uden kontekst fra mor-samtalen.',
    '',
    `FOERSTE HANDLING: laes HELE din brief: ${track.briefPath}`,
    'Den er din fulde kontrakt. Foelg den ordret. Kan du ikke laese den, saa STOP og rapporter det - gaet ikke.',
    '',
    'Gates der gaelder uanset hvad (gentaget her med vilje):',
    `- ABSOLUT WORKING DIR: ${track.worktree} - brug \`git -C "${track.worktree}"\` til ALLE git-kald. Arbejd ALDRIG i ${MAIN_CHECKOUT}.`,
    `- Commit KUN bag guarden: \`bash "${track.worktree}/scripts/guard-commit-branch.sh" ${track.branch} "${track.worktree}"\`.`,
    `- Commit-besked-fil: ${track.scratch}\\msg-${track.slug}.txt (uden for worktreet). Aldrig heredoc.`,
    `- Tunge kommandoer wrappes: \`pwsh -File "${track.worktree}\\scripts\\verify-lock.ps1" -Max 2 -Timeout 1800 -- <kommando>\`.`,
    '- Draft-PR inden 30 min, push mindst hvert 15. minut, alt i FORGRUNDEN, ingen baggrundsjob, ingen under-agenter.',
    '- Maks EEN CodeRabbit CLI-runde pr. spor (`coderabbit review --base main --committed`), koert praecis eengang foer `gh pr ready` (#5220).',
    `- Refs #${track.issue} i PR-body (ikke Closes).`,
    '',
    `Issue: #${track.issue} - ${track.title}`,
    track.scopeText ? `Scope: ${track.scopeText}` : '',
    '',
    'Slutrapport (kort, dansk): branch, PR-URL, commit-SHA, hovedaendringer, verifikations-status, hvad verifikationen IKKE daekker.',
  ].filter(Boolean).join('\n')
}

// Frys-probe (#5178). Read-only, sonnet, kort levetid: den maaler BRANCHEN, saa
// et udloebet vindue ikke doemmes paa agentens tavshed alene. Regnestykket
// ligger i scripts/wave-freeze.mjs, og proben kalder den CLI - saa dommen
// kommer fra den testede kilde og ikke fra en agents hovedregning.
function probePrompt(track, elapsedMinutes) {
  return [
    `READ-ONLY: frys-probe paa #${track.issue} ${track.branch} (#5178)`,
    '',
    'Du maa KUN laese. Ingen commits, ingen pushes, ingen checkout, ingen filaendringer.',
    'Alt i FORGRUNDEN, ingen baggrundsjob, ingen under-agenter. Du er faerdig paa under et minut.',
    '',
    'Koer praecis disse fire kommandoer og laes outputtet selv:',
    `1. \`git -C "${track.worktree}" --no-pager log -1 --format=%ct\`  -> sekunder siden epoch for seneste commit (tom = ingen commits)`,
    '2. `pwsh -NoProfile -Command "[int][double]::Parse((Get-Date -UFormat %s))"`  -> nu, i sekunder siden epoch',
    `3. \`git -C "${track.worktree}" status --porcelain\`  -> ucommittede aendringer (tom = rent)`,
    `4. \`git -C "${track.worktree}" --no-pager rev-list --count @{u}..HEAD\`  -> upushede commits.`,
    '   Fejler kaldet - fx fordi branchen aldrig er pushet og slet ingen upstream har - saa rapportér -1, ALDRIG 0.',
    '   Netop dér ligger HVER eneste commit kun lokalt, og et 0 ville faa boelgen til at tro at alt var i hus.',
    '',
    'Laeg saa dommen ved at koere regnestykket i repoet (kilden til reglen, ikke hovedregning):',
    `\`node "${MAIN_CHECKOUT}\\scripts\\wave-freeze.mjs" --last-commit-epoch <1> --now-epoch <2> --elapsed-minutes ${Math.round(elapsedMinutes)} [--dirty] --unpushed <4>\``,
    'Den skriver JSON med verdict/reason/extendMinutes/lastCommitAgeMinutes. Send felterne videre uaendret.',
    '',
    'Fejler et git-kald, eller kan du ikke faa et tal ud af 1 eller 2: saet ok=false,',
    'verdict="ukendt" og lastCommitAgeMinutes=-1. Gaet ALDRIG en alder - et gaet paa en',
    'frisk branch holder en frossen lane i live, og et gaet paa en gammel stopper hele boelgen.',
    '',
    'Returnér struktureret: ok, verdict, reason, extendMinutes, lastCommitAgeMinutes, dirty, unpushed, note.',
  ].join('\n')
}

// Graceful stop (#5178). Boelge 2 den 11/9 efterlod ucommittet arbejde i to
// worktrees. Denne agent koerer i SAMME worktree som det stoppede spor og har
// praecis een opgave: faa arbejdet ud af worktreet og op paa branchen.
function stopPrompt(track, verdict) {
  return [
    `WAVE-FOLLOWUP: graceful stop paa #${track.issue} ${track.branch} (${verdict}, #5178)`,
    '',
    `ABSOLUT WORKING DIR: ${track.worktree} (EKSISTERENDE worktree - opret ALDRIG et nyt, reset ALDRIG, stash ALDRIG).`,
    `Brug \`git -C "${track.worktree}"\` til alle git-kald.`,
    '',
    'Sporet blev stoppet af boelgen. Din ENESTE opgave er at redde arbejdet - du bygger INTET,',
    'retter INTET og koerer INGEN tests. Ligger der ucommittet arbejde, er det halvfaerdigt; det',
    'skal gemmes som det er, ikke goeres faerdigt.',
    '',
    '1. `git status --porcelain` - er der intet og ingen upushede commits, saa er du faerdig.',
    `2. Ellers: \`git add\` de KONKRETE aendrede/nye filer (aldrig \`git add -A\` - lint-staged fejer untracked med).`,
    `3. Skriv commit-beskeden til ${track.scratch}\\msg-${track.slug}-wip.txt med Write-vaerktoejet (aldrig heredoc).`,
    `   Foerste linje ordret: \`wip(#${track.issue}): boelge-timeout, ucommittet arbejde gemt\``,
    `4. Commit KUN bag guarden: \`bash "${track.worktree}/scripts/guard-commit-branch.sh" ${track.branch} "${track.worktree}" && git -C "${track.worktree}" commit -F "${track.scratch}\\msg-${track.slug}-wip.txt"\``,
    '   Blokerer guarden: STOP og rapportér det. Gentag ALDRIG uden guarden.',
    `5. \`git -C "${track.worktree}" push\` (foerste gang: \`push -u origin ${track.branch}\`).`,
    '   Afvises pushet, saa `git fetch origin` + `git rebase origin/main` og push igen. Lykkes det stadig ikke: rapportér det.',
    '',
    'Markér ALDRIG en PR klar her, og luk aldrig issuet - arbejdet er pr. definition ufaerdigt.',
    '',
    'Sikkerhedsventil: en boelge-timeout AFBRYDER ikke den oprindelige lane-agent. Ser du tegn paa at',
    'den stadig arbejder - `.git/index.lock` findes, et git-kald fejler med "another git process", eller',
    'filer aendrer sig under dig - saa STOP med det samme og rapportér det i note. Lad vaere med at slette',
    'index.lock, og kaemp ikke om worktreet: en halvskreven WIP-commit er vaerre end ingen.',
    '',
    'Returnér struktureret: committed, pushed, sha, stillDirty, note.',
  ].join('\n')
}

function reviewPrompt(track, attempt) {
  // Read-only. Reviewere maa ALDRIG checke en branch ud (natboelge 19/6: en
  // verify-agent efterlod hoved-checkoutet paa en review-branch).
  return [
    `WAVE-REVIEW: #${track.issue} ${track.branch}`,
    attempt > 1
      ? `(gen-spawn ${attempt}/${WAVE_FREEZE.REVIEW_MAX_ATTEMPTS} - foerste reviewer svarede ikke inden ${WAVE_FREEZE.REVIEW_TIMEOUT_MINUTES} min. Vaer kortfattet og svar inden for vinduet.)`
      : '',
    '',
    'Du er READ-ONLY reviewer. Du maa IKKE aendre filer, committe, pushe eller checke branches ud.',
    `Laes diffen med \`gh pr diff --repo ${REPO} <PR-nummer>\` (find PR'en med \`gh pr list --repo ${REPO} --head ${track.branch} --state all --json number,url,isDraft\`).`,
    'Bruger du git, saa kun read-only kald med `git -C "' + track.worktree + '"` (log, diff, show) og altid `--no-pager`.',
    '',
    `Kontekst: issue #${track.issue} - ${track.title}`,
    track.scopeText ? `Forventet scope: ${track.scopeText}` : '',
    '',
    'Tjekliste (samme som docs/PARALLEL_WORKTREE_ORCHESTRATION.md og docs/NIGHT_WAVE_RUNBOOK.md):',
    '1. Loeser diffen det issuet beder om - hele vejen, ikke halvt?',
    '2. Er der arbejde UDEN FOR scope, eller filer der tilhoerer en anden lane?',
    '3. Er forbudte filer roert: docs/NOW.md, docs/MASTERPLAN.md, frontend/src/pages/PatchNotesPage.jsx, frontend/src/data/patchNotes.js, docs/archive/**?',
    '4. Er der secrets, noegler eller balance-tal (vaegte, formler, eksponenter) i diff, PR-body eller kommentarer? (hard rule 17)',
    '5. Har PR-body `## Brugerverifikation` med mindst et `- [x]`, eller labelen docs-only/backend-only?',
    '6. Staar der `Refs #N` og ikke `Closes #N`?',
    '7. Er der nye/aendrede regler uden test, eller tests der er slaaet fra?',
    '8. Er nye frontend-filer skrevet i .ts/.tsx (hard rule 31)?',
    '',
    'Dom: BLOKERENDE kun ved noget der ikke maa merges (forkert scope, forbudte filer, secrets, manglende verifikation af en ny regel). Smagsting er BEMAERKNINGER.',
    'Vaer konkret: fil + hvad der er galt. Ingen ros, ingen opsummering af hvad diffen goer.',
  ].filter(Boolean).join('\n')
}

function fixPrompt(track, review) {
  const findings = (review.findings || [])
    .filter((f) => f.severity === 'blokerende')
    .map((f, i) => `${i + 1}. ${f.file ? f.file + ': ' : ''}${f.what}`)
    .join('\n')
  return [
    `WAVE-FOLLOWUP: ret BLOKERENDE reviewer-fund paa #${track.issue} ${track.branch}`,
    '',
    `ABSOLUT WORKING DIR: ${track.worktree} (EKSISTERENDE worktree - opret ALDRIG et nyt, reset ALDRIG).`,
    `Brug \`git -C "${track.worktree}"\` til alle git-kald.`,
    '',
    'Reviewerens blokerende fund:',
    findings || review.summary,
    '',
    'Opgave: ret praecis disse fund. Intet andet arbejde, ingen refactor ved siden af.',
    'Er et fund forkert, saa ret det ikke - skriv i stedet i din slutrapport hvorfor, med henvisning til koden.',
    '',
    'Regler:',
    `- Commit KUN bag guarden: \`bash "${track.worktree}/scripts/guard-commit-branch.sh" ${track.branch} "${track.worktree}"\`.`,
    `- Commit-besked-fil: ${track.scratch}\\msg-${track.slug}-fix.txt. Aldrig heredoc.`,
    `- Tunge kommandoer gennem \`pwsh -File "${track.worktree}\\scripts\\verify-lock.ps1" -Max 2 -Timeout 1800 -- <kommando>\`.`,
    '- Alt i FORGRUNDEN. Ingen baggrundsjob, ingen under-agenter, ingen watchers.',
    '- Push naar du er faerdig. Markér PR klar (`gh pr ready`) KUN hvis den ikke allerede er det og verifikationen er groen.',
    '',
    'Slutrapport: hvilke fund der er rettet, hvilke der er afvist og hvorfor, commit-SHA.',
  ].join('\n')
}

function setupPrompt(tracks, lanes, expiresInMinutes) {
  const rows = tracks.map((t) => ({
    issue: t.issue,
    slug: t.slug,
    branch: t.branch,
    model: t.model,
    title: t.title,
    scopeText: t.scopeText,
    ownership: t.ownership,
    tier: t.tier,
    verifyCommands: t.verifyCommands,
    ownNodeModules: t.ownNodeModules,
    repoWorktreesRoot: WORKTREES_ROOT,
    scratchRoot: SCRATCH_ROOT,
  }))
  return [
    'WAVE-SETUP: fase 0 for en boelge (#5142)',
    '',
    `Arbejd i hoved-checkoutet ${MAIN_CHECKOUT}. Alt i FORGRUNDEN, ingen baggrundsjob, ingen under-agenter.`,
    'Du bygger INTET og roerer ingen kildekode - du saetter kun boelgen op.',
    '',
    '## 1. Faelles admission (#5467)',
    `Koer node ${MAIN_CHECKOUT}/scripts/wave-policy.mjs inspect. Hooken skal allerede have reserveret boelgen atomisk.`,
    'Kraev runtime=claude, state=running og et waveId. Mangler det, returner ok=false og STOP foer setup.',
    'Returner waveId fra markoeren. Skriv eller overskriv ALDRIG wave-active.json selv. En udloebet markoer er ikke et ledigt slot.',
    '',
    '## 2. Worktree pr. spor',
    'For hvert spor herunder: findes worktreet allerede, saa lad det staa (recovery skal kunne genbruge det).',
    `Ellers: \`pwsh -File ${MAIN_CHECKOUT}\\scripts\\new-worktree.ps1 -Branch <branch>\`.`,
    `Opret ogsaa scratch-mappen ${SCRATCH_ROOT}\\<slug>.`,
    '',
    '## 3. Brief pr. spor',
    'Skriv hvert spors config-objekt (herunder) som JSON til <scratch>\\brief-<slug>.json og koer:',
    `\`node ${MAIN_CHECKOUT}\\scripts\\make-wave-brief.mjs <scratch>\\brief-<slug>.json --out <scratch>\\brief-<slug>.md\``,
    'Verificér bagefter at hver .md-fil findes og ikke er tom. En lane uden brief maa IKKE meldes ready.',
    '',
    '## 3b. Har sporet allerede en aaben PR?',
    `For hver branch: \`gh pr list --repo ${REPO} --head <branch> --state open --json number,url,isDraft\`.`,
    'Er der en aaben PR, saa rapportér dens nummer i "openPr" (ellers "ingen"). Sporet springes saa over:',
    'en genstartet boelge (resumeFromRunId) maa ikke saette en ny agent i gang oven i et spor der allerede er bygget.',
    '',
    '## 4. Lane-watch i baggrunden',
    'Start vagten som en SELVSTAENDIG proces (den skal overleve dig - det er den ene undtagelse fra baggrundsforbuddet, og den er orkestratorens, ikke en lanes):',
    `\`pwsh -NoProfile -Command "Start-Process pwsh -ArgumentList '-NoProfile','-File','${MAIN_CHECKOUT}\\scripts\\wave-lane-watch.ps1','-IntervalMinutes','15','-StallMinutes','45' -WindowStyle Hidden -PassThru | Select-Object -ExpandProperty Id"\``,
    `Registrer PID med node ${MAIN_CHECKOUT}/scripts/wave-policy.mjs watch --wave-id <waveId> --pid <PID>. Rediger aldrig markoeren direkte.`,
    '',
    '## 5. Spor',
    '```json',
    JSON.stringify(rows, null, 2),
    '```',
    '',
    'Returnér struktureret: ok, waveId, watchPid, activeFile, lanes (branch, worktree, briefPath, ready, openPr, note), problems.',
    'ready=false for ethvert spor hvor worktree eller brief mangler - saa springer boelgen sporet over i stedet for at starte en lane i blinde.',
  ].join('\n')
}

function cleanupPrompt(tracks, cleanupMode, watchPid, waveId) {
  return [
    'WAVE-CLEANUP: sidste fase af en boelge (#5142)',
    '',
    `Arbejd i hoved-checkoutet ${MAIN_CHECKOUT}. Alt i FORGRUNDEN, ingen under-agenter.`,
    '',
    `1. Kontroller ejerskab: node ${MAIN_CHECKOUT}/scripts/wave-policy.mjs inspect. waveId SKAL vaere ${waveId}. Ellers STOP.`,
    '2. Bekraeft at ALLE boelgens agenter er stoppet. Timeout alene er ikke terminal tilstand. Kan det ikke bevises, behold markoeren og rapporter det.',
    `3. Koer node ${MAIN_CHECKOUT}/scripts/wave-policy.mjs release --wave-id ${waveId} --children-stopped. Scriptet stopper kun markoerens registrerede lane-watch. Ingen generel process- eller worktree-oprydning.`,
    `4. Rapportér status pr. branch: \`gh pr list --repo ${REPO} --state all --json number,url,state,isDraft,headRefName --limit 50\` og filtrér paa boelgens branches: ${tracks.map((t) => t.branch).join(', ')}.`,
    '',
    'Slet ALDRIG en worktree med ucommitted arbejde eller en branch der ikke er merged - rapportér den i stedet under notes.',
    '',
    'Returnér struktureret: activeFileRemoved, watchStopped, prunedWorktrees, prunedBranches, notes.',
  ].join('\n')
}

// ---------------------------------------------------------------- koersel
const input = Array.isArray(args) ? { tracks: args } : (args || {})
const rawTracks = Array.isArray(input.tracks) ? input.tracks : []
if (rawTracks.length === 0) {
  throw new Error('wave: args.tracks er tom. Kald: Workflow({ name: "wave", args: { tracks: [{ issue, branch, title, scopeText, model, tier }] } })')
}
if (rawTracks.length > MAX_TRACKS) {
  throw new Error(`wave: ${rawTracks.length} spor er for mange (loft ${MAX_TRACKS}). Koer boelgen i flere omgange - loftet paa 8 aabne PR'er gaelder stadig.`)
}

// #5220: blandet koe - sorteret stabilt saa lette spor (sonnet+TARGETED)
// staar forrest. Paavirker BAADE dryRun-udskriften og den faktiske koe
// herunder (queue bygges af 'tracks' i denne raekkefoelge).
const tracks = sortMixedQueue(rawTracks.map(normalizeTrack))
const lanes = Math.max(1, Math.min(Number(input.lanes) || DEFAULT_LANES, tracks.length))
const dryRun = input.dryRun === true
// Compatibility metadata only; cleanup is always scoped to the owned wave.
const cleanupMode = input.cleanup === 'execute' ? 'execute' : 'dry-run'
const allowExistingPr = input.allowExistingPr === true
const expiresInMinutes = Number(input.expiresInMinutes) || 240
const trackTimeoutMinutes = resolveTrackTimeoutMinutes(input.trackTimeoutMinutes)

const fullTiers = tracks.filter((t) => t.tier === 'FULL')
if (fullTiers.length > 1) {
  throw new Error(`wave: ${fullTiers.length} spor har tier FULL (${fullTiers.map((t) => '#' + t.issue).join(', ')}). Kun EET spor maa koere fuld suite - resten er TARGETED, CI er den fulde gate (TIER WAVE, ejer 6/9).`)
}

const planLines = tracks.map((t, i) => `  ${i + 1}. #${t.issue} ${t.branch} [${t.model}/${t.tier}] -> ${t.worktree}`)
log(`Boelgeplan: ${tracks.length} spor, ${lanes} laner, verifikations-semafor 2, spor-vindue ${trackTimeoutMinutes} min (haardt loft ${WAVE_FREEZE.TRACK_HARD_CAP_MINUTES} min).`)
log(`Frys maales paa BRANCH-aktivitet (#5178): et udloebet vindue forlaenges saa laenge seneste commit er under ${WAVE_FREEZE.BRANCH_STALL_MINUTES} min gammel.`)
for (const line of planLines) log(line)

if (dryRun) {
  log('DRY-RUN: intet spawnes, intet skrives. Fjern args.dryRun for at koere boelgen.')
  return {
    dryRun: true,
    lanes,
    verifyMax: 2,
    trackTimeoutMinutes,
    trackHardCapMinutes: WAVE_FREEZE.TRACK_HARD_CAP_MINUTES,
    branchStallMinutes: WAVE_FREEZE.BRANCH_STALL_MINUTES,
    reviewTimeoutMinutes: WAVE_FREEZE.REVIEW_TIMEOUT_MINUTES,
    reviewMaxAttempts: WAVE_FREEZE.REVIEW_MAX_ATTEMPTS,
    cleanup: cleanupMode,
    expiresInMinutes,
    tracks: tracks.map((t) => ({
      issue: t.issue,
      branch: t.branch,
      slug: t.slug,
      model: t.model,
      tier: t.tier,
      worktree: t.worktree,
      scratch: t.scratch,
      briefPath: t.briefPath,
      ownNodeModules: t.ownNodeModules,
    })),
  }
}

// --- Fase 0 -----------------------------------------------------------------
phase('Fase 0 - opsaetning')
const setup = await agent(setupPrompt(tracks, lanes, expiresInMinutes), {
  label: 'fase 0: worktrees, briefs, lane-watch',
  phase: 'Fase 0 - opsaetning',
  schema: SETUP_SCHEMA,
})

if (!setup || setup.ok !== true || !setup.waveId) throw new Error('wave: fase 0 fejlede (ingen gyldig admission). Ingen laner startet.')

const readyByBranch = new Map()
for (const lane of setup.lanes || []) readyByBranch.set(lane.branch, lane)

const skipped = []
const queue = []
for (const track of tracks) {
  const laneInfo = readyByBranch.get(track.branch)
  if (!laneInfo || laneInfo.ready !== true) {
    skipped.push({ ...track, reason: (laneInfo && laneInfo.note) || 'worktree eller brief mangler efter fase 0' })
    continue
  }
  // Resume-beskyttelse: lane-poolens raekkefoelge er ikke deterministisk, saa
  // en genstart med resumeFromRunId kan ramme et spor der allerede er bygget.
  // En aaben PR er det billigste bevis paa at sporet er koert.
  const openPr = String((laneInfo && laneInfo.openPr) || '').trim()
  const hasOpenPr = openPr !== '' && !/^(ingen|none|nej|-)$/i.test(openPr)
  if (hasOpenPr && !allowExistingPr) {
    skipped.push({ ...track, reason: `existing-pr (${openPr}) - sporet har allerede en aaben PR. Send args.allowExistingPr = true for at koere det alligevel.` })
    continue
  }
  queue.push(track)
}
for (const s of skipped) log(`SPRINGER OVER #${s.issue} ${s.branch}: ${s.reason}`)
if (setup.problems && setup.problems.length) {
  for (const p of setup.problems) log(`fase 0: ${p}`)
}
if (queue.length === 0) {
  log('Ingen spor er klar. Boelgen stopper her - ryd op og undersoeg fase 0-problemerne.')
}

// --- Laner ------------------------------------------------------------------
// Lane-pool (natboelgen 2-3/9): hver lane traekker naeste spor fra koen saa
// snart den er fri. Chunk-barrierer efterlod tomme slots hele natten; poolen
// holder alle laner fyldt. results samles undervejs, saa et doedt spor kun
// koster sin egen lane.
phase('Laner')
const results = []
const laneCount = Math.max(1, Math.min(lanes, queue.length || 1))

// Maaler branchen naar et spor-vindue er udloebet. Returnerer altid et objekt;
// en probe der selv fejler eller tier giver den konservative dom (frys).
async function probeBranch(track, elapsedMinutes) {
  const probe = await withTimeout(
    agent(probePrompt(track, elapsedMinutes), {
      label: `frys-probe #${track.issue}`,
      phase: 'Laner',
      model: 'sonnet',
      schema: PROBE_SCHEMA,
    }),
    WAVE_FREEZE.PROBE_TIMEOUT_MINUTES * 60 * 1000,
    `frys-probe #${track.issue}`,
  )
  if (!probe || probe === TIMED_OUT) {
    return {
      probeOk: false,
      verdict: 'frozen',
      reason: 'probe-svarede-ikke',
      extendMinutes: 0,
      stopsWave: true,
      lastCommitAgeMinutes: null,
      dirty: null,
      unpushed: null,
    }
  }
  const age = Number(probe.lastCommitAgeMinutes)
  const probeOk = probe.ok === true && Number.isFinite(age) && age >= 0
  // Proben har allerede koert scripts/wave-freeze.mjs; stoler vi paa dens svar,
  // bruger vi det. Kunne den ikke koere CLI'en, regner vi selv paa de raa tal
  // med den spejlede classifyStall - samme regel, samme tal.
  const trusted = probeOk && (probe.verdict === 'frozen' || probe.verdict === 'extend' || probe.verdict === 'hard-cap')
  const decision = trusted
    ? {
        verdict: probe.verdict,
        reason: probe.reason || probe.verdict,
        extendMinutes: Number(probe.extendMinutes) || 0,
        stopsWave: probe.verdict === 'frozen',
      }
    : classifyStall({ probeOk, lastCommitAgeMinutes: probeOk ? age : null, elapsedMinutes })
  // Det haarde loft er ORKESTRATORENS, ikke probe-agentens: klem enhver
  // forlaengelse mod den resterende tid, uanset hvad proben foreslog. Uden det
  // kunne et forkert --elapsed-minutes i probens kald sende sporet forbi 180 min.
  if (decision.verdict === 'extend') {
    const remaining = WAVE_FREEZE.TRACK_HARD_CAP_MINUTES - elapsedMinutes
    if (remaining <= 0) {
      decision.verdict = 'hard-cap'
      decision.reason = 'hard-cap-reached'
      decision.extendMinutes = 0
      decision.stopsWave = false
    } else {
      decision.extendMinutes = Math.min(decision.extendMinutes, remaining)
    }
  }
  // En "extend" uden brugbart minuttal ville give et 0-ms vindue og dermed en
  // probe-storm. Fald tilbage paa bunden i stedet (men aldrig over loftet).
  if (decision.verdict === 'extend' && !(decision.extendMinutes > 0)) {
    decision.extendMinutes = Math.min(
      WAVE_FREEZE.MIN_EXTENSION_MINUTES,
      WAVE_FREEZE.TRACK_HARD_CAP_MINUTES - elapsedMinutes,
    )
  }
  return {
    ...decision,
    probeOk,
    lastCommitAgeMinutes: probeOk ? age : null,
    dirty: probe.dirty === true,
    // -1 = kunne ikke maales. Coercer man den til 0, ser en branch uden
    // upstream - hvor ALT ligger lokalt - ud som fuldt pushet. Bemaerk at
    // null/'' skal fanges eksplicit: Number(null) er 0, ikke NaN.
    unpushed: (probe.unpushed === null || probe.unpushed === undefined || probe.unpushed === ''
      || !Number.isFinite(Number(probe.unpushed)))
      ? -1
      : Number(probe.unpushed),
    note: probe.note || '',
  }
}

// Redder ucommittet arbejde ud af et stoppet spor, saa worktreet aldrig
// efterlades dirty (#5178, punkt 3 i headeren).
async function gracefulStop(track, probe) {
  if (!needsGracefulStop(probe)) {
    const note = probe && probe.verdict === 'hard-cap'
      ? 'sprunget over ved hard-cap: agenten er ikke afbrudt og kan stadig skrive i worktreet, og to agenter samme sted ville slaas om index.lock. Worktreet er IKKE verificeret rent - tjek det med scripts/worker-status.ps1.'
      : 'worktreet var rent og pushet'
    return { skipped: true, note }
  }
  const stop = await withTimeout(
    agent(stopPrompt(track, probe.verdict), {
      label: `graceful stop #${track.issue}`,
      phase: 'Laner',
      model: 'sonnet',
      schema: STOP_SCHEMA,
    }),
    WAVE_FREEZE.STOP_TIMEOUT_MINUTES * 60 * 1000,
    `graceful stop #${track.issue}`,
  )
  if (!stop || stop === TIMED_OUT) {
    // `unknown` skelner "vi ved det ikke" fra "der var intet at gemme": en
    // stop-agent i et rent worktree svarer med rette committed:false, og det
    // maa ikke ende som en advarsel om ucommittet arbejde.
    return { skipped: false, unknown: true, committed: false, pushed: false, note: 'stop-agenten svarede ikke - TJEK WORKTREET I HAANDEN' }
  }
  return { skipped: false, ...stop }
}

// #5220: undersoegelsesspor bygger intet og har maaske slet ingen commits at
// maale branch-frys paa - derfor bruger det IKKE frys-probe-extend-maskinen
// fra build-spor (probeBranch/gracefulStop) og faar heller ikke et review-
// eller fix-trin (der er ingen kode-diff at reviewe). Fast vindue paa
// INVESTIGATE_TIMEOUT_MINUTES, ingen forlaengelse. investigateBlok() (i
// laneBrief) skriver den tvungne dom ind i selve briefen.
async function runInvestigateTrack(track) {
  const label = `#${track.issue} ${track.branch}`
  const row = { issue: track.issue, branch: track.branch, model: track.model, tier: track.tier, kind: 'investigate' }
  const build = await withTimeout(
    agent(laneBrief(track), { label, phase: 'Laner', model: track.model }),
    WAVE_FREEZE.INVESTIGATE_TIMEOUT_MINUTES * 60 * 1000,
    label,
  )
  if (build === TIMED_OUT || build === null) {
    // Eget statusnavn (ikke 'timeout'): den generelle 'timeout'-status
    // betyder specifikt "haardt loft naaet med en LEVENDE branch" for
    // byggespor, og dens log-tekst refererer branch-alder - meningsloest for
    // et undersoegelsesspor, der maaske aldrig commiter noget.
    row.status = 'investigate-timeout'
    row.note = `Undersoegelsesspor svarede ikke inden det faste vindue paa ${WAVE_FREEZE.INVESTIGATE_TIMEOUT_MINUTES} min (ingen forlaengelse - #5220). Ingen dom modtaget.`
    return row
  }
  const reportText = String(build)
  const verdict = extractInvestigateVerdict(reportText)
  row.report = reportText.slice(0, 4000)
  if (verdict) {
    row.status = 'undersoegt'
    row.verdict = verdict
  } else {
    // CodeRabbit (denne PR): den tvungne aflevering staar i briefen, men et
    // spor kan stadig svare uden for kontrakten (fx "ved ikke", eller begge
    // domme paa een gang). Det maa ALDRIG stille tolkes som en gyldig
    // undersoegelse - meld det tydeligt op i stedet.
    row.status = 'undersoegt-ufuldstaendig'
    row.note = 'Slutrapporten indeholder ikke praecis EEN af de to tvungne domme ("bekraeftet + fix-plan" / "afvist + bevis-test", #5220) - kraev en ny dom fra sporet foer det lukkes.'
  }
  return row
}

async function runTrack(track, trackTimeoutMinutes) {
  if (track.kind === 'investigate') return runInvestigateTrack(track)

  const label = `#${track.issue} ${track.branch}`
  const row = { issue: track.issue, branch: track.branch, model: track.model, tier: track.tier }

  // EEN agent, flere ventevinduer. Promise'et spawnes praecis en gang og
  // races mod et vindue ad gangen; loeber vinduet ud, maales branchen, og
  // lever den, ventes der videre paa SAMME agent (#5178).
  const buildPromise = agent(laneBrief(track), { label, phase: 'Laner', model: track.model })
  let elapsedMinutes = 0
  let waitMinutes = trackTimeoutMinutes
  let build = TIMED_OUT
  let stopProbe = null

  for (;;) {
    build = await withTimeout(buildPromise, waitMinutes * 60 * 1000, label)
    elapsedMinutes += waitMinutes
    if (build !== TIMED_OUT) break

    // Proben koster ogsaa tid (op til PROBE_TIMEOUT_MINUTES), og uden Date.now()
    // kan scriptet ikke maale hvor laenge den faktisk tog. Vi bogfoerer derfor
    // dens OEVRE graense FOER kaldet, saa baade probens egen beregning og
    // klemningen mod loftet regner paa et tal der aldrig er for lavt. Summen af
    // vinduer alene ville underdrive alderen med 5 min pr. runde, og et spor
    // kunne saa ligge en time over det "absolutte" loft. Prisen er at et spor
    // kan rammes af loftet lidt foer 180 min i vaeggur - den rigtige side at
    // tage fejl paa, naar loftet er defineret som absolut.
    elapsedMinutes += WAVE_FREEZE.PROBE_TIMEOUT_MINUTES
    const probe = await probeBranch(track, elapsedMinutes)
    const ageText = probe.lastCommitAgeMinutes === null ? 'ukendt' : `${Math.round(probe.lastCommitAgeMinutes)} min siden`
    if (probe.verdict === 'extend') {
      waitMinutes = probe.extendMinutes
      log(`${label}: branchen lever (seneste commit ${ageText}) efter ${elapsedMinutes} min - forlaenger med ${waitMinutes} min (loft ${WAVE_FREEZE.TRACK_HARD_CAP_MINUTES} min).`)
      continue
    }
    stopProbe = probe
    break
  }

  if (stopProbe) {
    const ageText = stopProbe.lastCommitAgeMinutes === null ? 'kunne ikke maales' : `${Math.round(stopProbe.lastCommitAgeMinutes)} min siden seneste commit`
    row.status = stopProbe.stopsWave ? 'frys' : 'timeout'
    row.freeze = { verdict: stopProbe.verdict, reason: stopProbe.reason, lastCommitAgeMinutes: stopProbe.lastCommitAgeMinutes, dirty: stopProbe.dirty, unpushed: stopProbe.unpushed }
    row.note = stopProbe.stopsWave
      ? `FRYS efter ${elapsedMinutes} min (${stopProbe.reason}, ${ageText}). Worktreet: ${track.worktree}. Genoptag i SAMME worktree - reset aldrig.`
      : `Haardt loft paa ${WAVE_FREEZE.TRACK_HARD_CAP_MINUTES} min naaet med en LEVENDE branch (${ageText}) - ikke et frys. Boelgen venter ikke laengere, men agenten er ikke afbrudt og kan stadig skrive i ${track.worktree}, saa ingen stop-agent er sendt ind. Tjek worktreet selv (scripts/worker-status.ps1) - det er IKKE verificeret rent.`
    row.gracefulStop = await gracefulStop(track, stopProbe)
    return row
  }

  if (build === null) {
    row.status = 'doed'
    row.note = `Agenten stoppede uden svar. Worktreet staar urort: ${track.worktree}.`
    // Ogsaa her kan der ligge ucommittet arbejde - tilstanden er ukendt, saa
    // stop-agenten koeres (needsGracefulStop giver true paa probeOk=false).
    row.gracefulStop = await gracefulStop(track, { probeOk: false, verdict: 'doed' })
    return row
  }
  row.status = 'bygget'
  row.report = String(build).slice(0, 4000)

  // Reviewer har sit eget, kortere vindue og faar praecis EET gen-spawn
  // (#5178, punkt 3 i issuet). Tavshed er her billig at teste igen.
  let review = null
  for (let attempt = 1; attempt <= WAVE_FREEZE.REVIEW_MAX_ATTEMPTS; attempt += 1) {
    const plan = planReviewAttempt(attempt)
    const answer = await withTimeout(
      agent(reviewPrompt(track, attempt), {
        label: attempt > 1 ? `review ${label} (gen-spawn)` : `review ${label}`,
        phase: 'Review',
        model: 'sonnet',
        schema: REVIEW_SCHEMA,
      }),
      plan.timeoutMinutes * 60 * 1000,
      `review ${label}`,
    )
    if (answer && answer !== TIMED_OUT) {
      review = answer
      row.reviewAttempts = attempt
      break
    }
    if (plan.final) {
      row.reviewAttempts = attempt
      break
    }
    log(`Reviewer paa ${label} svarede ikke inden ${plan.timeoutMinutes} min - gen-spawner EEN gang (#5178).`)
  }
  if (!review) {
    row.review = 'ikke gennemfoert'
    row.note = `Reviewer svarede ikke i ${WAVE_FREEZE.REVIEW_MAX_ATTEMPTS} forsoeg - PR'en skal menneske-reviewes foer merge.`
    return row
  }
  row.review = review.verdict
  row.reviewSummary = review.summary
  row.pr = review.pr || 'ingen'

  if (review.verdict === 'BLOKERENDE') {
    log(`BLOKERENDE fund paa ${label} - starter ret-trin i samme worktree.`)
    const fix = await withTimeout(
      agent(fixPrompt(track, review), { label: `ret ${label}`, phase: 'Review', model: track.model }),
      FIX_TIMEOUT_MS,
      `ret ${label}`,
    )
    row.fix = (fix === TIMED_OUT || fix === null) ? 'ikke gennemfoert' : String(fix).slice(0, 2000)
    row.status = row.fix === 'ikke gennemfoert' ? 'rettelse-mangler' : 'rettet'
  }
  return row
}

// Saettes ved foerste bekraeftede frys. Se punkt 1 i scriptets header: en
// frossen agent holder sin plads i samtidigheds-loftet, saa boelgen ville
// fortsaette med usynligt reduceret kapacitet. I stedet stopper vi og
// rapporterer resten til relancering i en ny, ren boelge.
let stoppedByFreeze = null

if (queue.length > 0) {
  await parallel(Array.from({ length: laneCount }, () => async () => {
    while (queue.length > 0 && !stoppedByFreeze) {
      const track = queue.shift()
      if (!track) return
      try {
        const row = await runTrack(track, trackTimeoutMinutes)
        results.push(row)
        // KUN 'frys' stopper boelgen. Et 'timeout' er nu et spor der ramte det
        // haarde loft med en LEVENDE branch (#5178) - stort, ikke frossent - og
        // maa ikke koste de oevrige laner deres spor, som det gjorde 11/9.
        if (row.status === 'frys') {
          stoppedByFreeze = { issue: track.issue, branch: track.branch, reason: (row.freeze && row.freeze.reason) || 'ukendt' }
          log(`FRYS bekraeftet paa #${track.issue} ${track.branch} (${stoppedByFreeze.reason}): branchen har staaet stille, og den frosne agent holder stadig sin plads i samtidigheds-loftet.`)
          log('Boelgen stopper her. De resterende spor rapporteres som "unstarted" og skal relanceres i en NY boelge (natboelgen 5-6/9: bolge A koerte reelt paa 2 laner i 2,5 time uden at det kunne ses).')
          return
        }
        if (row.status === 'timeout') {
          log(`#${track.issue} ${track.branch} ramte det haarde loft paa ${WAVE_FREEZE.TRACK_HARD_CAP_MINUTES} min med en levende branch - boelgen venter ikke laengere. Ingen stop-agent sendt ind (to agenter i samme worktree slaas om index.lock); foelg sporet i haanden.`)
          // Lanen er IKKE fri. withTimeout afbryder ikke agenten, saa den
          // gamle agent holder stadig sin plads i samtidigheds-loftet. Trak vi
          // et nyt spor ind her, ville boelgen koere med flere byggeagenter end
          // laner - praecis den oversubscription 4-lane-loftet og semaforen
          // findes for at forhindre. Denne lane lukkes; de oevrige toemmer koen.
          log(`Lane lukket efter #${track.issue}: den gamle agent holder stadig sin plads i samtidigheds-loftet, saa lanen traekker ikke et nyt spor.`)
          return
        }
        // #5220: undersoegelsesspor har sit eget, adskilte timeout-navn (se
        // runInvestigateTrack) - samme lane-lukning, men uden byggesporets
        // "levende branch/haardt loft"-tekst, som ikke giver mening her.
        if (row.status === 'investigate-timeout') {
          log(`#${track.issue} ${track.branch} (undersoegelsesspor) svarede ikke inden det faste ${WAVE_FREEZE.INVESTIGATE_TIMEOUT_MINUTES}-min-vindue (ingen forlaengelse, #5220).`)
          log(`Lane lukket efter #${track.issue}: den gamle agent holder stadig sin plads i samtidigheds-loftet, saa lanen traekker ikke et nyt spor.`)
          return
        }
      } catch (err) {
        results.push({
          issue: track.issue,
          branch: track.branch,
          status: 'fejl',
          note: String((err && err.message) || err),
        })
      }
    }
  }))
}

// Alt der stadig staar i koen naaede aldrig en lane - enten fordi boelgen
// stoppede paa et frys, eller fordi alle laner faldt fra. Det MAA rapporteres:
// et spor der forsvinder tavst ud af koen ligner et spor der blev koert.
const unstarted = queue.splice(0).map((t) => ({
  issue: t.issue,
  branch: t.branch,
  worktree: t.worktree,
  reason: stoppedByFreeze
    ? `boelgen stoppede paa frys i #${stoppedByFreeze.issue} - relancér dette spor i en ny boelge`
    : 'naaede aldrig en lane - relancér det i en ny boelge',
}))
for (const u of unstarted) log(`IKKE STARTET #${u.issue} ${u.branch}: ${u.reason}`)

// --- Oprydning --------------------------------------------------------------
phase('Oprydning')
const cleanup = await agent(cleanupPrompt(tracks, cleanupMode, setup.watchPid || 'none', setup.waveId), {
  label: 'oprydning + statusrapport',
  phase: 'Oprydning',
  schema: CLEANUP_SCHEMA,
})

const stopped = results.filter((r) => r.status === 'frys' || r.status === 'timeout' || r.status === 'investigate-timeout' || r.status === 'undersoegt-ufuldstaendig' || r.status === 'doed' || r.status === 'fejl')
log(`Boelge slut: ${results.length} spor koert, ${stopped.length} stoppet, ${skipped.length} sprunget over, ${unstarted.length} ikke startet (af ${tracks.length} i alt).`)
// Et worktree der stadig er dirty efter den graceful stop-agent skal ses af et
// menneske - det er praecis den tilstand boelge 2 den 11/9 efterlod usynligt.
// Fire tilstande der alle skal raabes op, og ingen flere:
//   unknown - stop-agenten svarede ikke, saa worktreet er uafklaret
//   stillDirty - den naaede ikke at faa alt med
//   proben SAA arbejde (dirty, eller upushede/umaalelige commits), men
//     stop-agenten fik ikke committet - fx fordi guarden blokerede. Uden det
//     her ville en blokeret redning se ud som en vellykket.
//   committed uden pushed - arbejdet ligger i en LOKAL commit, lige saa
//     usynligt som et dirty worktree
// Et rent worktree svarer med rette committed:false/pushed:false; det er ikke
// en advarsel, og maa ikke taelle med.
const hadWork = (f) => Boolean(f) && (f.dirty === true
  || f.unpushed === null || f.unpushed === undefined
  || !Number.isFinite(Number(f.unpushed)) || Number(f.unpushed) !== 0)
const stillDirty = results.filter((r) => r.gracefulStop && r.gracefulStop.skipped !== true
  && (r.gracefulStop.unknown === true
    || r.gracefulStop.stillDirty === true
    || (hadWork(r.freeze) && r.gracefulStop.committed !== true)
    || (r.gracefulStop.committed === true && r.gracefulStop.pushed !== true)))
for (const r of stillDirty) {
  log(`ADVARSEL: #${r.issue} ${r.branch} kan stadig have ucommittet ELLER upushet arbejde i worktreet - ${(r.gracefulStop && r.gracefulStop.note) || 'ingen note fra stop-agenten'}. Tjek det i haanden.`)
}
// Hard-cap faar aldrig en stop-agent (den levende lane-agent ejer worktreet),
// saa de spor skal raabes op for sig - ellers forsvinder de i statistikken.
for (const r of results.filter((x) => x.status === 'timeout')) {
  log(`ADVARSEL: #${r.issue} ${r.branch} blev sluppet paa det haarde loft med en levende branch. Worktreet er hverken tjekket eller reddet - se selv efter med scripts/worker-status.ps1.`)
}
for (const r of results.filter((x) => x.status === 'investigate-timeout')) {
  log(`ADVARSEL: #${r.issue} ${r.branch} (undersoegelsesspor) svarede ikke inden ${WAVE_FREEZE.INVESTIGATE_TIMEOUT_MINUTES} min - ingen dom modtaget. Ingen forlaengelse per design (#5220); relancér som et nyt undersoegelsesspor om noedvendigt.`)
}
for (const r of results.filter((x) => x.status === 'undersoegt-ufuldstaendig')) {
  log(`ADVARSEL: #${r.issue} ${r.branch} (undersoegelsesspor) leverede IKKE en af de to tvungne domme (#5220) - se r.report i resultatet. Kraev en ny dom, accepter ALDRIG stiltiende.`)
}
if (unstarted.length > 0) {
  log(`RELANCER: ${unstarted.map((u) => '#' + u.issue).join(', ')} i en NY boelge - worktrees og PR'er staar urort.`)
}
if (cleanup && cleanup.activeFileRemoved !== true) {
  log('ADVARSEL: wave-active.json blev IKKE fjernet. Bevar markoeren. Normal release kraever ejerskabsbevis; ved doed ejer bruges wave-policy.mjs recover. Ingen TTL eller manuel sletning.')
}

return {
  lanes: laneCount,
  verifyMax: 2,
  trackTimeoutMinutes,
  trackHardCapMinutes: WAVE_FREEZE.TRACK_HARD_CAP_MINUTES,
  branchStallMinutes: WAVE_FREEZE.BRANCH_STALL_MINUTES,
  cleanup: cleanup || { activeFileRemoved: false, notes: ['oprydnings-agenten svarede ikke'] },
  cleanupMode,
  stoppedByFreeze,
  dirtyWorktrees: stillDirty.map((r) => ({ issue: r.issue, branch: r.branch, gracefulStop: r.gracefulStop })),
  skipped: skipped.map((s) => ({ issue: s.issue, branch: s.branch, reason: s.reason })),
  stopped: stopped.map((s) => ({ issue: s.issue, branch: s.branch, status: s.status, note: s.note, gracefulStop: s.gracefulStop })),
  unstarted,
  tracks: results,
}
