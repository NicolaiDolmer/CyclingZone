// #5319 · Codex-fund på #7341: flag-svaret må ikke caches for evigt.
import test from "node:test";
import assert from "node:assert/strict";
import { createFreshFlagLoader } from "./freshFlagLoader.ts";

function harness(values: boolean[]) {
  let clock = 0;
  let calls = 0;
  const loader = createFreshFlagLoader(async () => values[Math.min(calls++, values.length - 1)], {
    maxAgeMs: 1000,
    now: () => clock,
  });
  return { loader, tick: (ms: number) => { clock += ms; }, calls: () => calls };
}

test("samtidige kald deler ét request", async () => {
  const h = harness([true]);
  const [a, b, c] = await Promise.all([h.loader.load(), h.loader.load(), h.loader.load()]);
  assert.deepEqual([a, b, c], [true, true, true]);
  assert.equal(h.calls(), 1);
});

test("friskt svar genbruges; forældet svar hentes igen og når lytterne", async () => {
  const h = harness([false, true]);
  const seen: boolean[] = [];
  h.loader.subscribe((on) => seen.push(on));
  assert.equal(await h.loader.load(), false);
  h.tick(500);
  assert.equal(await h.loader.load(), false);
  assert.equal(h.calls(), 1);
  h.tick(600);
  assert.equal(await h.loader.load(), true, "ejeren tændte flaget: åben fane ser det uden genindlæsning");
  assert.equal(h.calls(), 2);
  assert.deepEqual(seen, [false, true]);
});

test("ukendt svar (fejl) er ikke off: sidst kendte svar bevares, og næste kald prøver igen", async () => {
  let clock = 0;
  const answers: Array<boolean | null | "throw"> = [null, true, null, "throw", false];
  let calls = 0;
  const loader = createFreshFlagLoader(async () => {
    const a = answers[calls++];
    if (a === "throw") throw new Error("net");
    return a as boolean | null;
  }, { maxAgeMs: 1000, now: () => clock });
  const seen: boolean[] = [];
  loader.subscribe((on) => seen.push(on));
  assert.equal(await loader.load(), false, "intet kendt endnu: dagens katalog");
  assert.equal(await loader.load(), true, "ukendt blev ikke cachet: prøver igen straks");
  clock += 1001;
  assert.equal(await loader.load(), true, "fejlet genhentning efter 60 s slukker ikke v3");
  assert.equal(await loader.load(), true, "kastet fejl heller ikke");
  assert.equal(await loader.load(), false, "et rigtigt off publiceres");
  assert.deepEqual(seen, [true, false]);
});

test("viewer-skift: reset glemmer svaret, og et sent svar til den gamle viewer gemmes ikke", async () => {
  let release: (v: boolean) => void = () => {};
  let calls = 0;
  const loader = createFreshFlagLoader(() => {
    calls += 1;
    return calls === 1 ? new Promise<boolean>((r) => { release = r; }) : Promise.resolve(false);
  }, { maxAgeMs: 60_000 });
  const seen: boolean[] = [];
  loader.subscribe((on) => seen.push(on));
  const old = loader.load();
  loader.reset();
  release(true);
  await old;
  assert.deepEqual(seen, [false], "kun reset publiceres; den gamle viewers 'on' gør ikke");
  assert.equal(await loader.load(), false);
  assert.equal(calls, 2);
});
