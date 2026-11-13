// DOMMER #7855, ejerens valg 2 (13/11): MINDRE PR. SPURT.
//   Ejer 13/11: "Mindre pr. spurt". Stykket pr. spurt saettes ned, saa en hel dags jagt stadig
//   ligger taet paa Haard, og ordet paa skaermen passer.
//   Ejer 12/11 (valg 3): hver spurt koster lidt.
//   Ejer 7/11: opgaven koeres paa samme trin som tempo og foelg med, taeller som dagens haardeste
//   indsats og vises som ordet Haard.
//
// Regler (se dommerens regler.md): R6 (hver spurt koster), R7 (en hel dags jagt ligger taet paa
// Haard), R8 (aldrig billigere end Haard; ordet er Haard).
//
// DOMMERENS LAESNING AF "TAET PAA HAARD" (et forslag; selve tallet i motoren er ejerens designtal,
// og ejeren skal se foer og efter): en hel dags jagt i spurterne, op til tre spurter, koster
// hoejst ÉT LILLE TRIN mere end Haard. Det lille trin er afstanden fra Middel op til Haard paa
// samme etape og samme rytter. Saa ligger dagen lige saa taet paa Haard, som Middel goer, og langt
// fra Meget haard. Ingen tal fra motoren staar her: trappen maales paa motoren selv.
//
// Skrevet FOER koden. Maa ikke rettes til af byggebanen.

import test from "node:test";
import assert from "node:assert/strict";

import { motor, koerEtape, etape, fladMedSpurter, pris, prisPaaTrin, betalte, tider, afrund, HJAELPERE } from "./dommer7855.fixtures.mjs";

const M = await motor();

// Dommerens laesning af ejerens ord (se toppen). Meldt til ejeren som spoergsmaal.
const HEL_DAG_SPURTER = 3; // "en hel dags jagt": op til tre spurter (i dag har ingen etape i spillet mere end én)
const TAET_PAA_HAARD_SMAA_TRIN = 1; // hoejst saa mange smaa trin (Middel -> Haard) over Haard for hele dagen

const FROE = ["v2-a", "v2-b", "v2-c"];
const r6 = (x) => afrund(x, 6);

/** En hjaelpers dag med "Hent point" mod samme dag paa tempo (Haard uden opgaven), samme froe. */
async function dag(row, froe, id) {
  const jagt = await koerEtape(row, froe, { planer: { [id]: [{ task: "hunt_points" }] } });
  const tempo = await koerEtape(row, froe, { planer: { [id]: [{ task: "tempo" }] } });
  const haard = await pris(tempo, id);
  return {
    sammeLoeb: JSON.stringify(tider(jagt)) === JSON.stringify(tider(tempo)),
    spurter: betalte(jagt, id, "sprint"),
    jagt: await pris(jagt, id),
    haard,
    middel: await prisPaaTrin(tempo, id, "normal"),
    megetHaard: await prisPaaTrin(tempo, id, "all_out"),
  };
}

const dage = new Map();
async function alleDage() {
  if (dage.size) return dage;
  for (const antal of [1, 2, 3]) {
    for (const id of HJAELPERE) for (const froe of FROE) dage.set(`flad${antal}:${id}:${froe}`, { antal, ...(await dag(fladMedSpurter(antal), froe, id)) });
  }
  return dage;
}

test("valg 2, forudsaetning: pristrappen har Middel under Haard under Meget haard, og jagten er samme loeb som tempo", async () => {
  const fulde = new Map([[1, 0], [2, 0], [3, 0]]);
  for (const [noegle, d] of await alleDage()) {
    assert.ok(d.middel < d.haard && d.haard < d.megetHaard, `${noegle}: trappen`);
    assert.ok(d.sammeLoeb, `${noegle}: jagten og tempo skal vaere samme loeb, ellers kan priserne ikke sammenlignes`);
    assert.ok(d.spurter <= d.antal, `${noegle}: flere betalte spurter end etapen har`);
    if (d.spurter === d.antal) fulde.set(d.antal, fulde.get(d.antal) + 1);
  }
  // Opgaven skal have faaet hjaelperen med i alle dagens spurter paa de fleste dage, ellers maaler proeverne intet.
  for (const [antal, n] of fulde) assert.ok(n >= 8, `kun ${n} af 12 dage med ${antal} spurt(er), hvor hjaelperen koerte med om dem alle`);
});

test("R6 valg 2 (ejer 12/11): hver spurt koster, og flere spurter koster mere", async () => {
  const d = await alleDage();
  let sammenlignet = 0;
  for (const id of HJAELPERE) for (const froe of FROE) {
    const tre = [1, 2, 3].map((n) => d.get(`flad${n}:${id}:${froe}`));
    if (tre.some((x) => x.spurter !== x.antal)) continue; // han koerte ikke med om alle spurter den dag
    sammenlignet++;
    const over = tre.map((x) => r6(x.jagt - x.haard));
    assert.ok(over[0] > 0, `${id} ${froe}: én spurt skal koste mere end Haard alene`);
    assert.ok(over[1] > over[0] && over[2] > over[1], `${id} ${froe}: to spurter koster mere end én, tre mere end to (${over.join(" / ")})`);
  }
  assert.ok(sammenlignet >= 6, `kun ${sammenlignet} hjaelpere og froe kunne sammenlignes`);
});

test("R7 valg 2 (ejer 13/11): en hel dags jagt, op til tre spurter, ligger taet paa Haard", async () => {
  const fejl = [];
  for (const [noegle, d] of await alleDage()) {
    if (d.antal > HEL_DAG_SPURTER) continue;
    const over = r6(d.jagt - d.haard);
    const lilleTrin = r6(d.haard - d.middel);
    if (over > r6(TAET_PAA_HAARD_SMAA_TRIN * lilleTrin)) fejl.push(`${noegle}: ${d.antal} spurt(er) koster ${afrund(over / lilleTrin, 2)} smaa trin over Haard`);
  }
  assert.deepEqual(fejl, [], `en hel dags jagt maa hoejst koste ${TAET_PAA_HAARD_SMAA_TRIN} lille trin (Middel til Haard) mere end Haard`);
});

test("R7 valg 2 paa rigtige etapeformer (én spurt): dagen ligger taet paa Haard, og naermere Haard end Meget haard", async () => {
  // Repoets proeve-etaper har hoejst én indlagt spurt, som alle etaper i spillet i dag.
  const fejl = [];
  let maalt = 0;
  for (const nr of [4, 5, 13, 37]) {
    for (const id of HJAELPERE.slice(0, 2)) for (const froe of FROE.slice(0, 2)) {
      const d = await dag(etape(nr), froe, id);
      if (!d.sammeLoeb || d.spurter === 0) continue;
      maalt++;
      const over = r6(d.jagt - d.haard);
      if (over > r6(TAET_PAA_HAARD_SMAA_TRIN * (d.haard - d.middel))) fejl.push(`etape ${nr} ${id} ${froe}: ${afrund(over / (d.haard - d.middel), 2)} smaa trin over Haard`);
      assert.ok(d.jagt - d.haard < d.megetHaard - d.jagt, `etape ${nr} ${id} ${froe}: dagen ligger naermere Meget haard end Haard`);
    }
  }
  assert.ok(maalt >= 8, `kun ${maalt} dage kunne maales`);
  assert.deepEqual(fejl, []);
});

test("R8 (ejer 7/11, dom 2 og 3): jagten er aldrig billigere end Haard, og ordet paa opgaven er Haard", async () => {
  for (const [noegle, d] of await alleDage()) assert.ok(r6(d.jagt) >= r6(d.haard), `${noegle}: jagten er billigere end Haard`);
  assert.equal(M.sp.TASK_EFFORT.hunt_points, "protect", "'Hent point' koeres paa trinnet Haard");
  assert.equal(M.sp.TASK_EFFORT.tempo, "protect");
  assert.equal(M.sp.TASK_EFFORT.follow_moves, "protect");
});
