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
//   - Livstegn: draft-PR inden 30 min, push hvert 15. min, per-spor-timeout
//     60 min, recovery i SAMME worktree (aldrig reset).
//   - Maks 5 aabne PR'er (natboelge-regel 12) - orkestratoren tjekker FOER kald.
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
//     cleanup: "execute",             // 'execute' | 'dry-run'
//     expiresInMinutes: 240,          // levetid paa wave-active.json
//     lanes: 4                        // override af lane-loftet (brug sjaeldent)
//   }
//
// BEMAERK om fase 0: Workflow-scripts har hverken filsystem- eller
// Node-API-adgang (og ingen Date.now()). Alt der skal roere disken - skrive
// wave-active.json, oprette worktrees, generere briefs, starte lane-watch -
// gaar derfor gennem en lille WAVE-SETUP-agent. Det er ikke en omvej: det er
// den eneste maade scriptet kan udfoere fase 0 paa, og det holder samtidig
// tidsstempling der hvor uret faktisk findes.
//
// Refs #5142, #4918, #4919, #4920, #4924.

export const meta = {
  name: 'wave',
  description: 'Boelge: 4 laner, verifikations-semafor 2, livstegn, reviewer pr. spor, oprydning (#5142)',
  whenToUse: 'Naar 2+ uafhaengige issues skal bygges parallelt. Eneste godkendte indgang til parallelt byggearbejde - haandskrevne Agent-spawns er blokeret af scripts/hooks/guard-agent-spawn.sh mens en boelge koerer.',
  phases: [
    { title: 'Fase 0 - opsaetning', detail: 'wave-active.json, worktrees, briefs, lane-watch' },
    { title: 'Laner', detail: '4 laner over koen, 60 min timeout pr. spor' },
    { title: 'Review', detail: 'read-only reviewer pr. spor + ret-trin ved BLOKERENDE' },
    { title: 'Oprydning', detail: 'stop lane-watch, fjern wave-active.json, prune mergede worktrees' },
  ],
}

// ---------------------------------------------------------------- konstanter
const DEFAULT_LANES = 4
const TRACK_TIMEOUT_MS = 60 * 60 * 1000        // per-spor, jf. standardens livstegn
const FIX_TIMEOUT_MS = 30 * 60 * 1000
const MAX_TRACKS = 12
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
    lanes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          branch: { type: 'string' },
          worktree: { type: 'string' },
          briefPath: { type: 'string' },
          ready: { type: 'boolean' },
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

// Per-spor-timeout. VIGTIGT (natboelgen 5-6/9): en timeout frigiver IKKE lanen
// hos den frosne agent - den frosne holder sin plads i samtidigheds-loftet.
// Timeouten er en oevre graense paa hvor laenge lane-poolen VENTER paa et spor,
// ikke en garanti for at ressourcen er tilbage.
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(TIMED_OUT), ms)),
  ]).then((r) => {
    if (r === TIMED_OUT) log(`TIMEOUT efter ${Math.round(ms / 60000)} min: ${label}`)
    return r
  })
}

function laneBrief(track) {
  // Briefen ligger som fil (genereret af scripts/make-wave-brief.mjs), saa de
  // bindende blokke kommer fra EEN kilde og ikke kan drifte fra dette script.
  // De faa gates der ALDRIG maa mangle staar alligevel her, saa en lane ikke
  // staar helt uden regler hvis fil-laesningen fejler.
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
    `- Refs #${track.issue} i PR-body (ikke Closes).`,
    '',
    `Issue: #${track.issue} - ${track.title}`,
    track.scopeText ? `Scope: ${track.scopeText}` : '',
    '',
    'Slutrapport (kort, dansk): branch, PR-URL, commit-SHA, hovedaendringer, verifikations-status, hvad verifikationen IKKE daekker.',
  ].filter(Boolean).join('\n')
}

function reviewPrompt(track) {
  // Read-only. Reviewere maa ALDRIG checke en branch ud (natboelge 19/6: en
  // verify-agent efterlod hoved-checkoutet paa en review-branch).
  return [
    `WAVE-REVIEW: #${track.issue} ${track.branch}`,
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
    '## 1. Registerfil',
    `Opret mappen ${MAIN_CHECKOUT}\\.claude\\run og skriv ${MAIN_CHECKOUT}\\.claude\\run\\wave-active.json med:`,
    '```json',
    '{ "startedAt": "<nu i ISO-8601>", "expiresAt": "<nu + ' + expiresInMinutes + ' minutter i ISO-8601>",',
    `  "lanes": ${lanes}, "verifyMax": 2, "issue": 5142,`,
    '  "tracks": [ { "issue": N, "branch": "...", "slug": "..." } ], "watchPid": null }',
    '```',
    'Hent tidspunktet fra maskinen (fx `pwsh -NoProfile -Command "(Get-Date).ToString(\'o\')"`), gaet det ikke.',
    'Filen er det signal scripts/hooks/guard-agent-spawn.sh laeser - uden den er boelgen uden vagt.',
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
    '## 4. Lane-watch i baggrunden',
    'Start vagten som en SELVSTAENDIG proces (den skal overleve dig - det er den ene undtagelse fra baggrundsforbuddet, og den er orkestratorens, ikke en lanes):',
    `\`pwsh -NoProfile -Command "Start-Process pwsh -ArgumentList '-NoProfile','-File','${MAIN_CHECKOUT}\\scripts\\wave-lane-watch.ps1','-IntervalMinutes','15','-StallMinutes','45' -WindowStyle Minimized -PassThru | Select-Object -ExpandProperty Id"\``,
    'Skriv PID\'en ind i wave-active.json som "watchPid". Lykkes det ikke, saa rapportér "none" og fortsaet - boelgen maa ikke stoppe af en manglende vagt.',
    '',
    '## 5. Spor',
    '```json',
    JSON.stringify(rows, null, 2),
    '```',
    '',
    'Returnér struktureret: ok, watchPid, activeFile, lanes (branch, worktree, briefPath, ready, note), problems.',
    'ready=false for ethvert spor hvor worktree eller brief mangler - saa springer boelgen sporet over i stedet for at starte en lane i blinde.',
  ].join('\n')
}

function cleanupPrompt(tracks, cleanupMode, watchPid) {
  return [
    'WAVE-CLEANUP: sidste fase af en boelge (#5142)',
    '',
    `Arbejd i hoved-checkoutet ${MAIN_CHECKOUT}. Alt i FORGRUNDEN, ingen under-agenter.`,
    '',
    `1. Stop lane-vagten. PID fra fase 0: ${watchPid}. Er den et tal: \`pwsh -NoProfile -Command "Stop-Process -Id ${watchPid} -Force -ErrorAction SilentlyContinue"\`. Er den "none", saa spring over.`,
    `2. Slet ${MAIN_CHECKOUT}\\.claude\\run\\wave-active.json. Det er det der laeser boelgen som slut for scripts/hooks/guard-agent-spawn.sh - glemmes den, spaerrer hooken den naeste session (den udloeber dog selv paa expiresAt).`,
    `3. Oprydning: \`pwsh -File ${MAIN_CHECKOUT}\\scripts\\close-out-cleanup.ps1${cleanupMode === 'execute' ? ' -Execute' : ''}\`. Den fjerner efterladte gh --watch/vite/playwright-processer og kalder scripts/prune-merged-worktrees.ps1 for mergede worktrees og branches. Den roerer ALDRIG keep-awake.ps1 eller Claude Codes egne processer.`,
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
  throw new Error(`wave: ${rawTracks.length} spor er for mange (loft ${MAX_TRACKS}). Koer boelgen i flere omgange - loftet paa 5 aabne PR'er gaelder stadig.`)
}

const tracks = rawTracks.map(normalizeTrack)
const lanes = Math.max(1, Math.min(Number(input.lanes) || DEFAULT_LANES, tracks.length))
const dryRun = input.dryRun === true
const cleanupMode = input.cleanup === 'dry-run' ? 'dry-run' : 'execute'
const expiresInMinutes = Number(input.expiresInMinutes) || 240

const fullTiers = tracks.filter((t) => t.tier === 'FULL')
if (fullTiers.length > 1) {
  throw new Error(`wave: ${fullTiers.length} spor har tier FULL (${fullTiers.map((t) => '#' + t.issue).join(', ')}). Kun EET spor maa koere fuld suite - resten er TARGETED, CI er den fulde gate (TIER WAVE, ejer 6/9).`)
}

const planLines = tracks.map((t, i) => `  ${i + 1}. #${t.issue} ${t.branch} [${t.model}/${t.tier}] -> ${t.worktree}`)
log(`Boelgeplan: ${tracks.length} spor, ${lanes} laner, verifikations-semafor 2, per-spor-timeout 60 min.`)
for (const line of planLines) log(line)

if (dryRun) {
  log('DRY-RUN: intet spawnes, intet skrives. Fjern args.dryRun for at koere boelgen.')
  return {
    dryRun: true,
    lanes,
    verifyMax: 2,
    trackTimeoutMinutes: TRACK_TIMEOUT_MS / 60000,
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

if (!setup) throw new Error('wave: fase 0 fejlede (ingen svar fra opsaetnings-agenten). Ingen laner startet.')

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

async function runTrack(track) {
  const label = `#${track.issue} ${track.branch}`
  const row = { issue: track.issue, branch: track.branch, model: track.model, tier: track.tier }

  const build = await withTimeout(
    agent(laneBrief(track), { label, phase: 'Laner', model: track.model }),
    TRACK_TIMEOUT_MS,
    label,
  )
  if (build === TIMED_OUT) {
    row.status = 'timeout'
    row.note = `Ingen svar inden for 60 min. Worktreet staar urort: ${track.worktree}. Genoptag i SAMME worktree - reset aldrig.`
    return row
  }
  if (build === null) {
    row.status = 'doed'
    row.note = `Agenten stoppede uden svar. Worktreet staar urort: ${track.worktree}.`
    return row
  }
  row.status = 'bygget'
  row.report = String(build).slice(0, 4000)

  const review = await withTimeout(
    agent(reviewPrompt(track), { label: `review ${label}`, phase: 'Review', model: 'sonnet', schema: REVIEW_SCHEMA }),
    FIX_TIMEOUT_MS,
    `review ${label}`,
  )
  if (!review || review === TIMED_OUT) {
    row.review = 'ikke gennemfoert'
    row.note = 'Reviewer svarede ikke - PR\'en skal menneske-reviewes foer merge.'
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

if (queue.length > 0) {
  await parallel(Array.from({ length: laneCount }, () => async () => {
    while (queue.length > 0) {
      const track = queue.shift()
      if (!track) return
      try {
        results.push(await runTrack(track))
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

// --- Oprydning --------------------------------------------------------------
phase('Oprydning')
const cleanup = await agent(cleanupPrompt(tracks, cleanupMode, setup.watchPid || 'none'), {
  label: 'oprydning + statusrapport',
  phase: 'Oprydning',
  schema: CLEANUP_SCHEMA,
})

const stopped = results.filter((r) => r.status === 'timeout' || r.status === 'doed' || r.status === 'fejl')
log(`Boelge slut: ${results.length} spor koert, ${stopped.length} stoppet, ${skipped.length} sprunget over.`)
if (cleanup && cleanup.activeFileRemoved !== true) {
  log('ADVARSEL: wave-active.json blev IKKE fjernet. Slet den i haanden, ellers blokerer Agent-guarden naeste session (den udloeber dog selv paa expiresAt).')
}

return {
  lanes: laneCount,
  verifyMax: 2,
  cleanup: cleanup || { activeFileRemoved: false, notes: ['oprydnings-agenten svarede ikke'] },
  skipped: skipped.map((s) => ({ issue: s.issue, branch: s.branch, reason: s.reason })),
  stopped: stopped.map((s) => ({ issue: s.issue, branch: s.branch, status: s.status, note: s.note })),
  tracks: results,
}
