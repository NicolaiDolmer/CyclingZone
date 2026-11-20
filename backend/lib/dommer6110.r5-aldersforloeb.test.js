// DOMMER #6110 R5 og R6 efter ejervalg 19/11 (kandidat B): alder, kroppens aldring og det
// lille, sene fald. Uden private tal. Skrevet om 19/11; afloeser proeven af ejerens regel
// 12/11 og 14/11 (fuld udvikling til 26, et fald hvert aar fra 27, ca. en fjerdedel ved 31).
//
// Ejerens regler 19/11 (issue #6110):
//   R5  XP er ens hele livet. Kroppen (de fysiske evner + brosten) aeldes ved saesonskiftet
//       fra 29 aar, og trappen er dagens flyttet 2 aar frem. Loeb og haarde traeningsdage
//       bremser faldet. Gaelder fra skiftet S5→S6 (datoen er den nye saesons start_date, en
//       dansk dato), og kun naar XP-kontakten er taendt. Slukket = dagens regel, bit for bit.
//   R6  Teknik, taktik og de andre mentale evner falder en smule sent i karrieren, bremset
//       af loeb som de fysiske. Slukket falder de aldrig (dagens loefte).
//
// Foerst proeves reglerne selv (dommer6110.r5aldersforloeb.mjs), saa de ikke lader en forkert
// kurve gaa igennem. Derefter koeres saesonskiftet gennem motoren mod en falsk database, med
// motorens egen laesning af kontakten, startdatoen og talfilen.
//
// Fingeraftrykket DAGENS_REGEL er taget af dommeren paa origin/main 6f4f8c2a0 (19/11, foer
// #8452) med praecis de samme ryttere. Proeven maa ikke rettes til: aendrer tallet sig, har
// byggeriet aendret saesonskiftet for en slukket kontakt.

import test from "node:test";
import assert from "node:assert/strict";

import { kraev, DOMMER_B_RAA, DOMMER_ALDRING_RAA } from "./dommer6110.fixtures.mjs";
import {
  xpAlderBrud, aldringstrappeBrud, sentFaldBrud, koerSkifte, kohorte, fasteSkifteRyttere, fald, stoersteFald,
  skifteFingeraftryk, KROP, TEKNIK_MENTAL, FOERSTE_FALD, FLYTTET_AAR, LANGT_HEN, SENT_FRA, START_S6_DANSK_DATO, SKIFTE_UR,
} from "./dommer6110.r5aldersforloeb.mjs";

const DAGENS_REGEL = "42b31826bf4692bc59d2260dee1c6ddb99c76bc39e30495f14426c667b9b7910";
const ANTAL_FASTE = 108;

const { DEVELOPMENT_XP_FLAG_KEY, DEVELOPMENT_XP_FROM_DATE_KEY, DEVELOPMENT_XP_PARAMS_KEY } =
  await kraev("./developmentXpFlag.ts", "DEVELOPMENT_XP_FLAG_KEY", "DEVELOPMENT_XP_FROM_DATE_KEY", "DEVELOPMENT_XP_PARAMS_KEY");
const TAENDT = Object.freeze({ [DEVELOPMENT_XP_FLAG_KEY]: "on", [DEVELOPMENT_XP_FROM_DATE_KEY]: START_S6_DANSK_DATO });
const TALFIL = Object.freeze({ [DEVELOPMENT_XP_PARAMS_KEY]: DOMMER_B_RAA });
const taendt = (ryttere, ekstra = {}) => koerSkifte({ ryttere, app: TAENDT, privat: TALFIL, ...ekstra });
const slukket = (ryttere, ekstra = {}) => koerSkifte({ ryttere, app: {}, privat: TALFIL, ...ekstra });
const sum = (ryttere, efter, gruppe) => ryttere.reduce((a, r) => a + fald(r, efter, gruppe), 0);

/** Lineaer interpolation mellem (alder, vaerdi)-punkter; fladt uden for punkterne. */
const kurve = (punkter) => (alder) => {
  if (alder <= punkter[0][0]) return punkter[0][1];
  for (let i = 1; i < punkter.length; i++) {
    const [a1, v1] = punkter[i];
    if (alder <= a1) {
      const [a0, v0] = punkter[i - 1];
      return v0 + ((v1 - v0) * (alder - a0)) / (a1 - a0);
    }
  }
  return punkter.at(-1)[1];
};
/** En trappe: intet fald til og med `plateau`, derefter trinene (aar forbi plateauet, fald). */
const trappe = (plateau, trin) => (alder) => (alder <= plateau ? 0 : trin.find(([aar]) => alder - plateau <= aar)[1]);
const DAGENS_TRIN = [[3, 1.0], [6, 1.8], [99, 2.6]]; // AGING_V2_CONFIG, offentlig i repoet
const dagensTrappe = trappe(FOERSTE_FALD + FLYTTET_AAR - 1, DAGENS_TRIN);

// ═══ REGLERNE SELV (proeven af proeven) ══════════════════════════════════════════

test("R5-reglen XP: ens hele livet holder; ejerens gamle fald fra 27 og en turbo er roede", () => {
  assert.deepEqual(xpAlderBrud(() => 1), []);
  // Et lille sikkerhedsnet langt hen i karrieren er stadig "samme XP til langt hen i karrieren" (syntetisk eksempel).
  assert.deepEqual(xpAlderBrud(kurve([[LANGT_HEN, 1], [LANGT_HEN + 2, 0.7]])), []);
  // Med en (syntetisk) praecis graense er et net, der starter for tidligt, roedt.
  const net = { fuldTil: LANGT_HEN + 1, netFra: LANGT_HEN + 2, netAndel: 0.7 };
  assert.deepEqual(xpAlderBrud(kurve([[LANGT_HEN + 1, 1], [LANGT_HEN + 2, 0.7]]), undefined, net), []);
  assert.ok(xpAlderBrud(kurve([[LANGT_HEN, 1], [LANGT_HEN + 1, 0.7]]), undefined, net).some((f) => /fuld XP/.test(f)));
  assert.ok(xpAlderBrud(() => 1, undefined, net).some((f) => /sikkerhedsnet/.test(f)));
  // Ejerens regel fra 12/11 (fuld til 26, et fald hvert aar fra 27) er afloest og skal vaere roed.
  const gammel = xpAlderBrud(kurve([[26, 1], [27, 0.85], [28, 0.7], [29, 0.55], [30, 0.4], [31, 0.25]]));
  assert.ok(gammel.some((f) => /^27 aar: XP skal vaere den samme/.test(f)), gammel.join("; "));
  // Et sikkerhedsnet, der tager det meste, er ikke "ens hele livet".
  assert.ok(xpAlderBrud(kurve([[LANGT_HEN, 1], [LANGT_HEN + 3, 0.2]])).some((f) => /det meste/.test(f)));
  // Alder er aldrig en turbo, heller ikke sent, og unge faar ikke mere end voksne.
  assert.ok(xpAlderBrud(kurve([[LANGT_HEN, 1], [LANGT_HEN + 4, 1.2]])).some((f) => /turbo/.test(f)));
  assert.ok(xpAlderBrud(kurve([[18, 1.3], [20, 1]])).some((f) => /^17 aar/.test(f)));
});

test("R6-reglen XP: mentale evner har samme XP som fysiske; 'vokser laengere' (ejer 6/11) er afloest og roed", () => {
  const flad = () => 1;
  assert.deepEqual(xpAlderBrud(flad, flad), []);
  const laengere = xpAlderBrud(kurve([[LANGT_HEN, 1], [LANGT_HEN + 2, 0.7]]), flad);
  assert.ok(laengere.some((f) => /mentale evner skal have samme XP/.test(f)), laengere.join("; "));
});

test("R5-reglen trappen: dagens trappe flyttet 2 aar frem holder; ikke flyttet, flyttet 1 eller 3 aar og andre trin er roede", () => {
  assert.equal(dagensTrappe(30), 0, "dagens regel: intet fald som 30-aarig");
  assert.ok(dagensTrappe(31) > 0, "dagens regel: foerste fald som 31-aarig");
  assert.deepEqual(aldringstrappeBrud(trappe(FOERSTE_FALD - 1, DAGENS_TRIN), dagensTrappe), []);
  for (const plateau of [FOERSTE_FALD + 1, FOERSTE_FALD, FOERSTE_FALD - 2]) {
    const fejl = aldringstrappeBrud(trappe(plateau, DAGENS_TRIN), dagensTrappe);
    assert.ok(fejl.length > 0, `intet fald til og med ${plateau} skal vaere roedt`);
  }
  // Foerste fald som 29-aarig, men en anden trappe (haardere fald, eller trin der kommer senere).
  assert.ok(aldringstrappeBrud(trappe(FOERSTE_FALD - 1, [[3, 1.5], [6, 1.8], [99, 2.6]]), dagensTrappe).some((f) => /^29 aar: trappen/.test(f)));
  assert.ok(aldringstrappeBrud(trappe(FOERSTE_FALD - 1, [[5, 1.0], [8, 1.8], [99, 2.6]]), dagensTrappe).some((f) => /^32 aar: trappen/.test(f)));
});

test("R6-reglen sent fald: et lille fald sent holder; intet fald, et tidligt fald og et stort fald er roede", () => {
  const krop = trappe(FOERSTE_FALD - 1, DAGENS_TRIN);
  const sent = (fra, stoerrelse) => (alder) => (alder >= fra ? stoerrelse : 0);
  assert.deepEqual(sentFaldBrud(sent(SENT_FRA + 1, 0.4), krop), []);
  // Praecis start (syntetisk): et fald, der begynder senere end den angivne alder, er roedt.
  assert.deepEqual(sentFaldBrud(sent(SENT_FRA + 1, 0.4), krop, SENT_FRA + 1, true), []);
  assert.ok(sentFaldBrud(sent(SENT_FRA + 4, 0.4), krop, SENT_FRA + 1, true).some((f) => /skal begynde her/.test(f)));
  assert.ok(sentFaldBrud(() => 0, krop).some((f) => /en smule sent i karrieren/.test(f)), "intet sent fald er ejerens gamle loefte, ikke den nye regel");
  assert.ok(sentFaldBrud(sent(FOERSTE_FALD, 0.4), krop).some((f) => /er sent/.test(f)), "et fald fra kroppens foerste aar er ikke sent");
  assert.ok(sentFaldBrud(sent(SENT_FRA + 1, 1.8), krop).some((f) => /er lille/.test(f)), "samme fald som kroppen er ikke lille");
});

// ═══ SLUKKET = DAGENS REGEL, BIT FOR BIT ═════════════════════════════════════════

test("R5 slukket: saesonskiftet giver praecis samme evner og stop som i dag (108 faste ryttere)", async () => {
  const ryttere = fasteSkifteRyttere();
  assert.equal(ryttere.length, ANTAL_FASTE);
  const stille = [
    ["ingen kontakt", {}],
    ["off", { [DEVELOPMENT_XP_FLAG_KEY]: "off", [DEVELOPMENT_XP_FROM_DATE_KEY]: START_S6_DANSK_DATO }],
    ["beta", { [DEVELOPMENT_XP_FLAG_KEY]: "beta", [DEVELOPMENT_XP_FROM_DATE_KEY]: START_S6_DANSK_DATO }],
    ["on uden startdato", { [DEVELOPMENT_XP_FLAG_KEY]: "on" }],
    ["on, startdato dagen efter skiftet", { [DEVELOPMENT_XP_FLAG_KEY]: "on", [DEVELOPMENT_XP_FROM_DATE_KEY]: "2026-11-29" }],
  ];
  for (const [navn, app] of stille) {
    const { efter } = await koerSkifte({ ryttere, app, privat: TALFIL });
    assert.equal(skifteFingeraftryk(ryttere, efter), DAGENS_REGEL, `${navn}: saesonskiftet har flyttet sig fra dagens regel`);
  }
});

test("R5 slukket: fingeraftrykket maaler noget, og taendt giver et andet udfald", async () => {
  const ryttere = fasteSkifteRyttere();
  const fra = await slukket(ryttere);
  const medFald = ryttere.filter((r) => fald(r, fra.efter, KROP) > 0).length;
  assert.ok(medFald >= 30, `kun ${medFald} ryttere faldt; fingeraftrykket ville vaere tomt`);
  assert.ok([...fra.efter.values()].some((r) => r.stoppet), "nogen stopper karrieren i de faste scenarier");
  const til = await taendt(ryttere);
  assert.notEqual(skifteFingeraftryk(ryttere, til.efter), DAGENS_REGEL, "taendt kontakt skal aelde efter den nye regel");
});

test("R6 slukket: teknik, taktik og de andre mentale evner falder aldrig (dagens loefte), heller ikke for de aeldste", async () => {
  const ryttere = [...fasteSkifteRyttere(), ...kohorte({ alder: 38, navn: "gammel" })];
  const { efter } = await slukket(ryttere);
  for (const r of ryttere) assert.equal(fald(r, efter, TEKNIK_MENTAL), 0, `${r.id} (${r.alder} aar)`);
});

// ═══ TAENDT: KROPPEN AELDES FRA 29, TRAPPEN FLYTTET 2 AAR FREM ═══════════════════

test("R5 taendt: ingen under 29 mister noget, og 29-aarige uden loeb mister fysiske point", async () => {
  const unge = [22, 25, 27, 28].flatMap((alder) => kohorte({ alder }));
  const foerste = kohorte({ alder: FOERSTE_FALD });
  const { efter } = await taendt([...unge, ...foerste]);
  for (const r of unge) {
    assert.equal(fald(r, efter, KROP), 0, `${r.id}: en ${r.alder}-aarig maa ikke miste fysiske point`);
    assert.equal(fald(r, efter, TEKNIK_MENTAL), 0, `${r.id}: en ${r.alder}-aarig maa ikke miste teknik eller mentale point`);
  }
  for (const r of foerste) assert.ok(fald(r, efter, KROP) >= 1, `${r.id}: en 29-aarig uden loeb skal miste fysiske point`);
  // Modproeve: efter dagens regel mister de samme 29- og 30-aarige intet.
  const tredive = kohorte({ alder: 30 });
  const fra = await slukket([...foerste, ...tredive]);
  for (const r of [...foerste, ...tredive]) assert.equal(fald(r, fra.efter, KROP), 0, `${r.id}: dagens regel holder niveauet til og med 30`);
});

test("R5 taendt: trappen er flyttet 2 aar frem (en rytter aeldes som en, der er 2 aar aeldre i dag)", async () => {
  for (const belastning of [null, { raceDays: 45, hardDays: 0 }]) {
    for (let alder = 26; alder <= 40; alder++) {
      const nu = kohorte({ alder, belastning, navn: "trappe" });
      // De samme ryttere (samme id'er og evner), blot 2 aar aeldre, efter dagens regel.
      const aeldre = kohorte({ alder: alder + FLYTTET_AAR, belastning, navn: "trappe" }).map((r, i) => ({ ...r, id: nu[i].id, rider: { ...r.rider, id: nu[i].id }, abilities: nu[i].abilities }));
      const ny = await taendt(nu);
      const gammel = await slukket(aeldre);
      for (let i = 0; i < nu.length; i++) {
        const forskel = Math.abs(fald(nu[i], ny.efter, KROP) - fald(aeldre[i], gammel.efter, KROP));
        assert.ok(forskel <= 1, `${nu[i].id}: en ${alder}-aarig under XP skal miste det samme som en ${alder + FLYTTET_AAR}-aarig i dag (forskel ${forskel})`);
      }
      const snitNy = sum(nu, ny.efter, KROP) / nu.length;
      const snitGammel = sum(aeldre, gammel.efter, KROP) / aeldre.length;
      assert.ok(Math.abs(snitNy - snitGammel) <= 0.25, `${alder} aar: snitfaldet ${snitNy.toFixed(2)} skal vaere dagens for ${alder + FLYTTET_AAR} aar (${snitGammel.toFixed(2)})`);
    }
  }
});

test("R5 taendt: loeb og haarde traeningsdage bremser kroppens fald, og en fuld saeson stopper det", async () => {
  const alder = 31;
  const koer = async (belastning) => {
    const ryttere = kohorte({ alder, belastning, navn: "bremse" });
    const { efter } = await taendt(ryttere);
    return { ryttere, efter, iAlt: sum(ryttere, efter, KROP) };
  };
  const ingen = await koer(null);
  const lidt = await koer({ raceDays: 30, hardDays: 0 });
  const halv = await koer({ raceDays: 60, hardDays: 0 });
  const fuld = await koer({ raceDays: 120, hardDays: 0 });
  const medTraening = await koer({ raceDays: 30, hardDays: 80 });
  assert.ok(ingen.iAlt > lidt.iAlt && lidt.iAlt > halv.iAlt && halv.iAlt > fuld.iAlt, `flere loebsdage skal give mindre fald (${ingen.iAlt}, ${lidt.iAlt}, ${halv.iAlt}, ${fuld.iAlt})`);
  assert.equal(fuld.iAlt, 0, "en fuld saeson med loeb stopper faldet");
  assert.ok(medTraening.iAlt < lidt.iAlt, "haarde traeningsdage bremser oven i loebsdagene");
  // Bremsen er den samme som i dag: halvdelen af en fuld saeson tager halvdelen af faldet.
  assert.ok(Math.abs(halv.iAlt / ingen.iAlt - 0.5) <= 0.05, `60 loebsdage skal halvere faldet (${(halv.iAlt / ingen.iAlt).toFixed(2)})`);
  for (let i = 0; i < ingen.ryttere.length; i++) {
    assert.ok(fald(halv.ryttere[i], halv.efter, KROP) <= fald(ingen.ryttere[i], ingen.efter, KROP), `${ingen.ryttere[i].id}: loeb maa aldrig give et stoerre fald`);
  }
});

// ═══ DATOEN: GAELDER FRA SKIFTET S5→S6, DEN NYE SAESONS START I DANSK TID ════════

test("R5 datoen: skiftet aeldes efter den nye saesons startdato, ikke efter uret, ogsaa ved en genkoersel", async () => {
  const ryttere = kohorte({ alder: FOERSTE_FALD, navn: "dato" });
  const nyRegel = (efter) => ryttere.every((r) => fald(r, efter, KROP) >= 1);
  const dagensRegel = (efter) => ryttere.every((r) => fald(r, efter, KROP) === 0);
  // Saeson 6 starter 28/11, og XP gaelder fra 28/11. Skiftet koeres aftenen foer (27/11 kl. 18
  // dansk tid), og en genkoersel kan komme naeste morgen eller en uge senere: altid den nye regel.
  for (const ur of [SKIFTE_UR, "2026-11-27T23:20:00Z", "2026-11-28T09:00:00Z", "2026-12-05T08:00:00Z"]) {
    const { efter } = await taendt(ryttere, { ur: new Date(ur) });
    assert.ok(nyRegel(efter), `ur ${ur}: skiftet til saesonen, der starter 28/11, skal aelde efter den nye regel`);
  }
  // XP gaelder foerst fra 29/11: skiftet 28/11 hoerer til dagens regel, ogsaa naar det koeres igen senere.
  const fra29 = { [DEVELOPMENT_XP_FLAG_KEY]: "on", [DEVELOPMENT_XP_FROM_DATE_KEY]: "2026-11-29" };
  for (const ur of [SKIFTE_UR, "2026-11-30T10:00:00Z", "2026-12-05T08:00:00Z"]) {
    const { efter } = await koerSkifte({ ryttere, app: fra29, privat: TALFIL, ur: new Date(ur) });
    assert.ok(dagensRegel(efter), `ur ${ur}: et skifte foer startdatoen aeldes efter dagens regel, ogsaa ved en genkoersel`);
  }
  // Et skifte, hvis saeson startede foer XP (S4→S5, 25/10), faar aldrig den nye aldring ved en sen genkoersel.
  const { efter } = await taendt(ryttere, { startDato: "2026-10-25", ur: new Date("2026-12-05T08:00:00Z") });
  assert.ok(dagensRegel(efter), "et gammelt skifte, koert igen efter taendingen, aeldes efter dagens regel");
});

test("R5 datoen i dansk tid: baerer saesonens start et klokkeslaet, er det den danske dato, der taeller", async () => {
  const ryttere = kohorte({ alder: FOERSTE_FALD, navn: "dansk" });
  // 28/11 kl. 00:15 dansk tid er 27/11 i UTC. XP gaelder fra 28/11: den nye regel.
  const efterMidnat = await taendt(ryttere, { startDato: "2026-11-27T23:15:00Z" });
  assert.ok(ryttere.every((r) => fald(r, efterMidnat.efter, KROP) >= 1), "28/11 kl. 00:15 dansk tid er paa startdatoen 28/11");
  // 27/11 kl. 23:45 dansk tid er dagen foer: dagens regel.
  const foerMidnat = await taendt(ryttere, { startDato: "2026-11-27T22:45:00Z" });
  assert.ok(ryttere.every((r) => fald(r, foerMidnat.efter, KROP) === 0), "27/11 kl. 23:45 dansk tid er foer startdatoen 28/11");
});

// ═══ R6: DET LILLE, SENE FALD I TEKNIK OG MENTALE EVNER ══════════════════════════

test("R6 taendt: teknik og mentale evner falder ikke foer sent i karrieren, og derefter kun en smule", async () => {
  const sent = DOMMER_ALDRING_RAA.late.fromAge;
  assert.ok(sent >= SENT_FRA, "dommerens tal skal selv vaere 'sent'");
  const foer = [FOERSTE_FALD, FOERSTE_FALD + 1, sent - 1].flatMap((alder) => kohorte({ alder, navn: "foer" }));
  const efterSent = [sent, sent + 2, sent + 5].flatMap((alder) => kohorte({ alder, navn: "sent" }));
  const { efter } = await taendt([...foer, ...efterSent]);
  for (const r of foer) assert.equal(fald(r, efter, TEKNIK_MENTAL), 0, `${r.id}: en ${r.alder}-aarig mister ikke teknik eller mentale point`);
  assert.ok(sum(efterSent, efter, TEKNIK_MENTAL) >= efterSent.length, "sent i karrieren falder teknik og mentale evner");
  for (const r of efterSent) {
    assert.ok(stoersteFald(r, efter, TEKNIK_MENTAL) <= 1, `${r.id}: hoejst ét point i en evne pr. saeson (en smule)`);
    assert.ok(fald(r, efter, TEKNIK_MENTAL) < fald(r, efter, KROP), `${r.id}: det sene fald er mindre end kroppens fald samme saeson`);
  }
  // Pr. evne er det sene fald hoejst halvdelen af kroppens: seks evner mod elleve.
  const prEvne = (gruppe) => sum(efterSent, efter, gruppe) / gruppe.length;
  assert.ok(prEvne(TEKNIK_MENTAL) <= 0.5 * prEvne(KROP), "det sene fald er lille mod kroppens fald");
});

test("R6 taendt: det sene fald bremses af loeb som de fysiske evner, og en fuld saeson stopper det", async () => {
  const alder = DOMMER_ALDRING_RAA.late.fromAge + 2;
  const koer = async (belastning) => {
    const ryttere = kohorte({ alder, antal: 240, belastning, navn: "sentbremse" });
    const { efter } = await taendt(ryttere);
    return { sent: sum(ryttere, efter, TEKNIK_MENTAL), krop: sum(ryttere, efter, KROP) };
  };
  const ingen = await koer(null);
  const halv = await koer({ raceDays: 60, hardDays: 0 });
  const fuld = await koer({ raceDays: 120, hardDays: 0 });
  assert.ok(ingen.sent > 0, "uden loeb falder teknik og mentale evner sent i karrieren");
  assert.equal(fuld.sent, 0, "en fuld saeson med loeb stopper ogsaa det sene fald");
  assert.ok(halv.sent < ingen.sent, "loeb bremser det sene fald");
  const andelSent = halv.sent / ingen.sent;
  const andelKrop = halv.krop / ingen.krop;
  assert.ok(Math.abs(andelSent - andelKrop) <= 0.1, `samme bremse som de fysiske evner (sent ${andelSent.toFixed(2)}, krop ${andelKrop.toFixed(2)})`);
});
