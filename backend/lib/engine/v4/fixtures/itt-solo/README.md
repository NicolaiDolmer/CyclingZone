# Golden fixture: itt-solo (#5576)

Flad enkeltstart paa 32 km med 16 haandbyggede ryttere: et tydeligt TT-hierarki
(r01 bedst), to klatrere og to sprintere. Testen i
`mechanics/individualTimeTrial.test.ts` laaser:

- bit-identitet mod `expected.json`;
- at feltets bedste enkeltstartsrytter (r01) vinder;
- at hver rytter har sin egen tid (invariant 7);
- at der hverken er udbrud eller `sprint_decided`;
- at feltet skilles af minutter, ikke sekunder.

`expected.json` er det fulde `simulateStageV4(input)`-output, inspiceret foer det
blev frosset. Aendres motoren bevidst, regenereres det saadan (fra `backend/`):

```
node --import ./test-setup.js -e "import('./lib/engine/v4/index.ts').then(({ simulateStageV4 }) => { const fs = require('node:fs'); const dir = 'lib/engine/v4/fixtures/itt-solo'; const input = JSON.parse(fs.readFileSync(dir + '/input.json', 'utf8')); fs.writeFileSync(dir + '/expected.json', JSON.stringify(simulateStageV4(input), null, 2) + '\n'); })"
```

Se diffen igennem foer commit: en ITT-fixture der pludselig giver mange ens
tider eller en anden vinder er en regression, ikke en ny baseline.
