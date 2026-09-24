// #5440 punkt 1 — én delt bund-slot: samtykke > release > NPS.
//
// Registret er ren modul-state, saa det testes direkte. React-siden
// (useBottomSlot) er en tynd effect + useSyncExternalStore oven paa det; at de
// tre flader faktisk bruger den, vogtes af kilde-assertions nederst (repoet har
// ingen jsdom, se useSelectionReminder.test.ts).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BOTTOM_SLOT_PRIORITY,
  __resetBottomSlotForTests,
  claimBottomSlot,
  createBottomSlotInstanceId,
  getBottomSlotHolder,
  resolveBottomSlotHolder,
  subscribeBottomSlot,
} from "./bottomSlot.ts";

test.beforeEach(() => __resetBottomSlotForTests());

test("prioriteten er samtykke > release > NPS", () => {
  assert.ok(BOTTOM_SLOT_PRIORITY.consent > BOTTOM_SLOT_PRIORITY.release);
  assert.ok(BOTTOM_SLOT_PRIORITY.release > BOTTOM_SLOT_PRIORITY.nps);
});

test("resolve: hoejeste prioritet vinder uanset registrerings-raekkefoelge", () => {
  assert.equal(
    resolveBottomSlotHolder([
      { id: 1, kind: "nps", seq: 1 },
      { id: 2, kind: "release", seq: 2 },
    ]),
    2,
  );
  assert.equal(
    resolveBottomSlotHolder([
      { id: 3, kind: "release", seq: 1 },
      { id: 4, kind: "consent", seq: 2 },
      { id: 5, kind: "nps", seq: 3 },
    ]),
    4,
  );
  assert.equal(resolveBottomSlotHolder([]), null);
});

test("resolve: samme prioritet -> den der kom foerst beholder kanten", () => {
  assert.equal(
    resolveBottomSlotHolder([
      { id: 7, kind: "nps", seq: 9 },
      { id: 8, kind: "nps", seq: 4 },
    ]),
    8,
  );
});

test("release-banneret tager kanten fra NPS-baren og giver den tilbage", () => {
  const nps = createBottomSlotInstanceId();
  const release = createBottomSlotInstanceId();

  const releaseNps = claimBottomSlot(nps, "nps");
  assert.equal(getBottomSlotHolder(), nps);

  const releaseRelease = claimBottomSlot(release, "release");
  assert.equal(getBottomSlotHolder(), release, "aldrig to bundbjaelker: release vinder");

  releaseRelease();
  assert.equal(getBottomSlotHolder(), nps, "NPS-baren kommer tilbage naar kanten er fri");

  releaseNps();
  assert.equal(getBottomSlotHolder(), null);
});

test("samtykke slaar baade release og NPS", () => {
  const nps = createBottomSlotInstanceId();
  const release = createBottomSlotInstanceId();
  const consent = createBottomSlotInstanceId();
  claimBottomSlot(nps, "nps");
  claimBottomSlot(release, "release");
  const releaseConsent = claimBottomSlot(consent, "consent");
  assert.equal(getBottomSlotHolder(), consent);
  releaseConsent();
  assert.equal(getBottomSlotHolder(), release);
});

test("lyttere hoerer kun om aendringer af holderen, og release er idempotent", () => {
  const events: Array<number | null> = [];
  const unsubscribe = subscribeBottomSlot(() => events.push(getBottomSlotHolder()));
  const a = createBottomSlotInstanceId();
  const b = createBottomSlotInstanceId();

  const releaseA = claimBottomSlot(a, "release");
  const releaseB = claimBottomSlot(b, "nps"); // taber: ingen aendring af holderen
  releaseB();
  releaseA();
  releaseA(); // anden gang: intet
  unsubscribe();
  claimBottomSlot(b, "nps"); // afmeldt: hoeres ikke

  assert.deepEqual(events, [a, null]);
});

test("en lytter der kaster stopper ikke de andre", () => {
  let heard = 0;
  subscribeBottomSlot(() => {
    throw new Error("flade-fejl");
  });
  subscribeBottomSlot(() => {
    heard += 1;
  });
  claimBottomSlot(createBottomSlotInstanceId(), "nps");
  assert.equal(heard, 1);
});

// --- wiring: de tre flader bruger den delte slot --------------------------------

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("cookie-banneret goer krav paa kanten mens det staar", () => {
  const src = read("../components/CookieBanner.jsx");
  assert.match(src, /import \{ useBottomSlot \} from "\.\.\/lib\/bottomSlot\.ts";/);
  assert.match(src, /useBottomSlot\("consent", mounted && bannerOpen\);/);
});

test("release-banneret tegner kun naar det har kanten", () => {
  const src = read("../components/ReleaseUpdateBanner.jsx");
  assert.match(src, /const slotGranted = useBottomSlot\("release", wantsSlot\);/);
  assert.match(src, /const visible = wantsSlot && slotGranted;/);
});

test("NPS-hooket goer krav med laveste prioritet og returnerer den faktiske synlighed", () => {
  const src = read("../hooks/useNpsPrompt.js");
  assert.match(src, /useBottomSlot\("nps", eligible\)/);
  assert.match(src, /isNpsPromptShown\(\{ eligible, bannerOpen, slotGranted \}\)/);
});
