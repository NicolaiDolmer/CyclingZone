// #3762 — dagstype før session. Testene her vogter tre ting:
//   1) at de kombinationer der beviseligt intet gjorde ikke kan gemmes længere
//   2) at gamle rækker læses som en tilstand der FINDES, også før migrationen
//   3) at migrationen bevarer EVNERNE (ejer-beslutning 14/8), ikke intensiteten

import test from "node:test";
import assert from "node:assert/strict";
import {
  DAY_TYPES,
  SKILL_SESSIONS,
  TRAINING_LEVELS,
  TRAINING_SESSIONS_BY_LEVEL,
  SESSION_INTENSITY,
  RECOVERY_FOCUS,
  RECOVERY_INTENSITY,
  dayTypeForProgram,
  sessionForProgram,
  sessionsForDayType,
  levelForSession,
  programForChoice,
  normalizeProgram,
  migrationTargetFor,
} from "./trainingDayTypes.js";
import { TRAINING_FOCUSES, TRAINING_CONFIG } from "./training.js";

test("hver session har præcis én intensitet, og den er gyldig", () => {
  for (const [session, intensity] of Object.entries(SESSION_INTENSITY)) {
    assert.ok(TRAINING_CONFIG.intensities.includes(intensity), `${session} har ugyldig intensitet ${intensity}`);
  }
});

test("hver session findes som fokus i motorens egen tabel", () => {
  for (const session of Object.keys(SESSION_INTENSITY)) {
    assert.ok(TRAINING_FOCUSES[session], `${session} mangler i TRAINING_FOCUSES — motoren ville træne ingenting`);
  }
  assert.ok(TRAINING_FOCUSES[RECOVERY_FOCUS], "restitution mangler i TRAINING_FOCUSES");
});

test("restitution rører KUN restitutions-evnen", () => {
  assert.deepEqual([...TRAINING_FOCUSES[RECOVERY_FOCUS]], ["recovery"]);
});

test("trænings-niveauerne dækker alle trænings-sessioner uden overlap", () => {
  const alle = TRAINING_LEVELS.flatMap((level) => TRAINING_SESSIONS_BY_LEVEL[level]);
  assert.equal(new Set(alle).size, alle.length, "en session ligger på to niveauer");
  for (const session of alle) {
    assert.equal(SESSION_INTENSITY[session], levelForSession(session));
  }
});

test("færdigheds-sessioner ligger ikke også på et trænings-niveau", () => {
  for (const session of SKILL_SESSIONS) {
    assert.equal(levelForSession(session), null, `${session} er både færdighed og træning`);
  }
});

// ── Derivation af dagstype ────────────────────────────────────────────────

test("hvile vinder over fokusset — de 623 gamle hvile-planer ER hviledage", () => {
  for (const focus of Object.keys(TRAINING_FOCUSES)) {
    assert.equal(dayTypeForProgram({ focus, intensity: "rest" }), "rest");
    assert.equal(sessionForProgram({ focus, intensity: "rest" }), null);
  }
});

test("færdigheds-fokus giver en færdighedsdag uanset gemt intensitet", () => {
  for (const focus of SKILL_SESSIONS) {
    for (const intensity of ["easy", "normal", "hard"]) {
      assert.equal(dayTypeForProgram({ focus, intensity }), "skill");
    }
  }
});

test("restitution kendes på både intensitet og fokus", () => {
  assert.equal(dayTypeForProgram({ focus: RECOVERY_FOCUS, intensity: RECOVERY_INTENSITY }), "recovery");
  assert.equal(dayTypeForProgram({ focus: RECOVERY_FOCUS, intensity: "easy" }), "recovery");
  assert.equal(sessionForProgram({ focus: RECOVERY_FOCUS, intensity: RECOVERY_INTENSITY }), null);
});

test("et tomt/ukendt program falder til træning, ikke til en fejl", () => {
  assert.equal(dayTypeForProgram(null), "training");
  assert.equal(dayTypeForProgram({}), "training");
});

// ── Skrivestien ───────────────────────────────────────────────────────────

test("de meningsløse kombinationer kan ikke længere gemmes", () => {
  // vo2max + hvile: det var 252 planer i prod, og motoren gav 0 vækst.
  assert.equal(programForChoice({ dayType: "training", session: "vo2max" }).intensity, "hard");
  // en trænings-session kan ikke vælges på en færdighedsdag
  assert.equal(programForChoice({ dayType: "skill", session: "vo2max" }).ok, false);
  assert.equal(programForChoice({ dayType: "skill", session: "vo2max" }).reason, "invalid_session");
  // og en færdighed kan ikke vælges som en træningsdag
  assert.equal(programForChoice({ dayType: "training", session: "technique" }).ok, false);
});

test("ukendt dagstype afvises", () => {
  assert.equal(programForChoice({ dayType: "hyggetur", session: "endurance" }).ok, false);
  assert.equal(programForChoice({ dayType: "hyggetur" }).reason, "invalid_day_type");
});

test("hviledag bevarer spillerens hidtidige fokus, så han kan skifte tilbage", () => {
  const out = programForChoice({ dayType: "rest", previousFocus: "sprint" });
  assert.deepEqual(out, { ok: true, focus: "sprint", intensity: "rest" });
});

test("hviledag uden hidtidigt fokus får en inert fallback", () => {
  assert.equal(programForChoice({ dayType: "rest" }).focus, "endurance");
  assert.equal(programForChoice({ dayType: "rest", previousFocus: "opfundet" }).focus, "endurance");
});

test("aktiv restitution gemmes med sin egen nøgle", () => {
  assert.deepEqual(programForChoice({ dayType: "recovery" }), {
    ok: true, focus: RECOVERY_FOCUS, intensity: RECOVERY_INTENSITY,
  });
});

test("hver dagstype kan faktisk vælges", () => {
  for (const dayType of DAY_TYPES) {
    const sessions = sessionsForDayType(dayType);
    const out = programForChoice({ dayType, session: sessions[0] ?? null });
    assert.equal(out.ok, true, `${dayType} kan ikke vælges`);
  }
});

// ── Læsestien / migrationen ───────────────────────────────────────────────
// Ejer-beslutning 14/8: bevar EVNERNE, ikke intensiteten.

test("migration: fokusset følger med, intensiteten følger modellen", () => {
  const cases = [
    // [gemt fokus, gemt intensitet] → [dagstype, session, ny intensitet]
    [["vo2max", "normal"], ["training", "vo2max", "hard"]],
    [["vo2max", "easy"], ["training", "vo2max", "hard"]],
    [["threshold", "easy"], ["training", "threshold", "hard"]],
    [["sprint", "easy"], ["training", "sprint", "hard"]],
    [["endurance", "hard"], ["training", "endurance", "easy"]],
    [["endurance", "normal"], ["training", "endurance", "easy"]],
    [["aero", "hard"], ["skill", "aero", "easy"]],
    [["technique", "normal"], ["skill", "technique", "easy"]],
  ];
  for (const [[focus, intensity], [dayType, session, newIntensity]] of cases) {
    const out = normalizeProgram({ focus, intensity });
    assert.equal(out.dayType, dayType, `${focus}+${intensity} → dagstype`);
    assert.equal(out.session, session, `${focus}+${intensity} → session`);
    assert.equal(out.focus, focus, `${focus}+${intensity} må ALDRIG skifte fokus`);
    assert.equal(out.intensity, newIntensity, `${focus}+${intensity} → intensitet`);
  }
});

test("migration: ingen af de 4.588 planer skifter hvad de trænes med", () => {
  // De intensiteter der KAN stå på en eksisterende række. `recovery` er ny med
  // #3762, så ingen gemt plan bærer den — den testes for sig nedenfor.
  const LEGACY_INTENSITIES = ["easy", "normal", "hard", "rest"];
  for (const focus of Object.keys(TRAINING_FOCUSES)) {
    if (focus === RECOVERY_FOCUS) continue; // ny nøgle, findes ikke i gamle rækker
    for (const intensity of LEGACY_INTENSITIES) {
      const out = normalizeProgram({ focus, intensity });
      assert.equal(out.focus, focus, `${focus}+${intensity} skiftede fokus`);
    }
  }
});

test("en restitutions-intensitet vinder over et hvilket som helst fokus", () => {
  // Kan kun opstå hvis nogen håndredigerer en række: dagen ER restitution, og
  // fokusset erstattes af den nøgle der kun rører restitutions-evnen.
  const out = normalizeProgram({ focus: "vo2max", intensity: RECOVERY_INTENSITY });
  assert.equal(out.dayType, "recovery");
  assert.equal(out.focus, RECOVERY_FOCUS);
  assert.equal(out.session, null);
});

test("migration: en hviledag beholder fokusset i kolonnen men bliver en hviledag", () => {
  const out = normalizeProgram({ focus: "vo2max", intensity: "rest" });
  assert.equal(out.dayType, "rest");
  assert.equal(out.session, null);
  assert.equal(out.focus, "vo2max", "fokusset bevares som spillerens sidste valg");
  assert.equal(out.intensity, "rest");
  assert.equal(out.changed, false, "en hvile-plan der allerede var hvile er uændret");
});

test("migration: `changed` er sand netop når parret flytter sig", () => {
  assert.equal(normalizeProgram({ focus: "vo2max", intensity: "hard" }).changed, false);
  assert.equal(normalizeProgram({ focus: "vo2max", intensity: "normal" }).changed, true);
  assert.equal(normalizeProgram({ focus: "endurance", intensity: "hard" }).changed, true);
  assert.equal(normalizeProgram({ focus: "endurance", intensity: "easy" }).changed, false);
});

test("en ukendt session lander på Lang tur i stedet for at kaste", () => {
  // trin 2 (16/8): "loebslaere" er nu en KENDT skill-session (#3746) og kan
  // ikke længere bruges som eksempel på en ukendt en — brug en opdigtet nøgle.
  const out = normalizeProgram({ focus: "fremtidigt_fokus", intensity: "normal" });
  assert.equal(out.dayType, "training");
  assert.equal(out.session, "endurance");
  assert.equal(out.changed, true);
});

test("normalizeProgram er idempotent — anden kørsel flytter intet", () => {
  for (const focus of Object.keys(TRAINING_FOCUSES)) {
    for (const intensity of TRAINING_CONFIG.intensities) {
      const en = normalizeProgram({ focus, intensity });
      const to = normalizeProgram({ focus: en.focus, intensity: en.intensity });
      assert.equal(to.focus, en.focus);
      assert.equal(to.intensity, en.intensity);
      assert.equal(to.changed, false, `${focus}+${intensity} er ikke stabil`);
    }
  }
});

// ── Naadesdags-reglen (ejer-beslutning 2, 14/8) ───────────────────────────

test("en plan der rykker OP i belastning starter paa hvile", () => {
  // 1.593 planer i prod: en zone paa normal bliver en HAARD session.
  const out = migrationTargetFor({ focus: "vo2max", intensity: "normal" });
  assert.equal(out.graceDay, true);
  assert.equal(out.intensity, "rest");
  assert.equal(out.dayType, "rest");
  assert.equal(out.focus, "vo2max", "sessionen bevares, saa ét klik tager den i brug");
});

test("en plan der rykker NED skrives direkte", () => {
  // 178 planer: haard udholdenhed bliver en let lang tur. Ingen skaderisiko i
  // den retning, saa der er intet at beskytte imod.
  const out = migrationTargetFor({ focus: "endurance", intensity: "hard" });
  assert.equal(out.graceDay, false);
  assert.equal(out.intensity, "easy");
  assert.equal(out.focus, "endurance");
});

test("en plan der allerede er paa modellens form roeres ikke", () => {
  const out = migrationTargetFor({ focus: "vo2max", intensity: "hard" });
  assert.equal(out.changed, false);
  assert.equal(out.graceDay, false);
});

test("en hviledag med et gammelt fokus roeres ikke (den var allerede hvile)", () => {
  const out = migrationTargetFor({ focus: "sprint", intensity: "rest" });
  assert.equal(out.changed, false);
  assert.equal(out.graceDay, false);
  assert.equal(out.focus, "sprint");
});

test("naadesdagen er idempotent — anden koersel flytter intet", () => {
  const foerste = migrationTargetFor({ focus: "threshold", intensity: "normal" });
  const anden = migrationTargetFor({ focus: foerste.focus, intensity: foerste.intensity });
  assert.equal(anden.changed, false);
  assert.equal(anden.graceDay, false);
});

// ── #4631 · de to specialiserede intervaldage i stigen ──────────────────────

test("#4631 · begge nye sessioner ligger paa HAARD, og hybriden staar foerst", () => {
  assert.deepEqual([...TRAINING_SESSIONS_BY_LEVEL.hard], ["vo2max", "vo2max_climb", "vo2max_punch", "threshold", "sprint"]);
  assert.equal(SESSION_INTENSITY.vo2max_climb, "hard");
  assert.equal(SESSION_INTENSITY.vo2max_punch, "hard");
  assert.ok(sessionsForDayType("training").includes("vo2max_climb"));
  assert.ok(sessionsForDayType("training").includes("vo2max_punch"));
  assert.ok(!sessionsForDayType("skill").includes("vo2max_climb"), "en intervaldag er ikke en faerdighedsdag");
});

test("#4631 · skrivestien accepterer de to nye og gemmer dem som haarde traeningsdage", () => {
  for (const session of ["vo2max_climb", "vo2max_punch"]) {
    const out = programForChoice({ dayType: "training", session });
    assert.deepEqual(out, { ok: true, focus: session, intensity: "hard" });
  }
});

test("#4631 · laesestien: den GAMLE noegle er hybriden og roeres ikke", () => {
  // Splittet beholder `vo2max` som hybrid netop for at ingen gemt plan skal
  // migreres. En eksisterende raekke skal derfor komme uaendret igennem.
  const out = normalizeProgram({ focus: "vo2max", intensity: "hard" });
  assert.deepEqual(out, { dayType: "training", session: "vo2max", focus: "vo2max", intensity: "hard", changed: false });
  const migrated = migrationTargetFor({ focus: "vo2max", intensity: "hard" });
  assert.equal(migrated.changed, false, "en hybrid-plan maa ikke flyttes af en migration");
  assert.equal(migrated.graceDay, false);
});

test("#4631 · en gemt specialiseret plan laeses tilbage som sig selv", () => {
  for (const session of ["vo2max_climb", "vo2max_punch"]) {
    const out = normalizeProgram({ focus: session, intensity: "hard" });
    assert.equal(out.session, session);
    assert.equal(out.changed, false);
  }
});

test("INGEN plan i hele kombinations-rummet ender med hoejere belastning end den havde", () => {
  const RANK = { rest: 0, recovery: 1, easy: 2, normal: 3, hard: 4 };
  for (const focus of Object.keys(TRAINING_FOCUSES)) {
    for (const intensity of ["easy", "normal", "hard", "rest"]) {
      const out = migrationTargetFor({ focus, intensity });
      assert.ok(
        RANK[out.intensity] <= RANK[intensity],
        `${focus} + ${intensity} → ${out.intensity} er HAARDERE end foer`,
      );
    }
  }
});
